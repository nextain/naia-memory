#!/usr/bin/env node
import { createHash } from "node:crypto";
import { realpath } from "node:fs/promises";
import {
	dirname,
	isAbsolute,
	normalize,
	relative,
	resolve,
	sep,
} from "node:path";
import { pathToFileURL } from "node:url";
import {
	isPublicDatasetCustodySeal,
	publicDatasetCustodySealSigningPacket,
} from "./public-dataset-custody-seal.js";
import {
	PublicEvidenceFileTooLargeError,
	readBoundedEvidenceFile,
	writeExclusiveEvidenceFile,
} from "./public-evidence-file-io.js";
import {
	evaluatePublicEvidenceV10,
	isPublicEvidenceV10TrustPolicy,
} from "./public-evidence-v10-gate.js";
import {
	buildPublicEvidenceV10SigningPacket,
	canonicalPublicEvidenceV10SigningPacket,
	collectPublicEvidenceV10Signature,
} from "./public-evidence-v10-signing.js";
import { isRfc3161DigestTimestampEvidence } from "./rfc3161-timestamp.js";

const MAX_JSON_BYTES = 1024 * 1024;
const MAX_CA_BYTES = 16 * 1024 * 1024;

async function readBytes(path: string, limit: number, label: string) {
	try {
		return await readBoundedEvidenceFile(resolve(path), limit);
	} catch (error) {
		if (error instanceof PublicEvidenceFileTooLargeError)
			throw new Error(`${label} exceeds its intake limit`);
		throw new Error(`${label} is unreadable`);
	}
}

async function readJson(path: string, label: string): Promise<unknown> {
	const bytes = await readBytes(path, MAX_JSON_BYTES, label);
	try {
		return JSON.parse(bytes.toString("utf8"));
	} catch {
		throw new Error(`${label} is not valid JSON`);
	}
}

function isOutside(root: string, candidate: string): boolean {
	const path = relative(root, candidate);
	return path === ".." || path.startsWith(`..${sep}`) || isAbsolute(path);
}

async function readEvidenceArtifact(
	evidenceRoot: string,
	artifactPath: string,
): Promise<{ path: string; sha256: string; bytes: Buffer }> {
	if (
		artifactPath.length === 0 ||
		isAbsolute(artifactPath) ||
		normalize(artifactPath) !== artifactPath ||
		artifactPath.includes("\\")
	)
		throw new Error("v10 launch artifact path must be canonical and relative");
	const candidate = resolve(evidenceRoot, artifactPath);
	if (isOutside(evidenceRoot, candidate))
		throw new Error("v10 launch artifact path escapes evidence root");
	let canonical: string;
	try {
		canonical = await realpath(candidate);
	} catch {
		throw new Error("v10 launch artifact is unreadable");
	}
	if (isOutside(evidenceRoot, canonical))
		throw new Error("v10 launch artifact path escapes evidence root");
	const bytes = await readBytes(canonical, MAX_CA_BYTES, "v10 launch artifact");
	return {
		path: artifactPath,
		sha256: createHash("sha256").update(bytes).digest("hex"),
		bytes,
	};
}

export async function preparePublicEvidenceV10LaunchPacket(input: {
	evidenceRoot: string;
	publisher: string;
	publisherPublicKeyPath: string;
	coreManifestPath: string;
	datasetPath: string;
	custodySealPath: string;
	custodyTimestampEvidencePath: string;
	custodyTimestampTokenPath: string;
}) {
	if (input.publisher.length === 0)
		throw new Error("v10 launch publisher must not be empty");
	const evidenceRoot = await realpath(resolve(input.evidenceRoot));
	const [publicKeyBytes, core, dataset, seal, timestampEvidence, token] =
		await Promise.all([
			readBytes(
				input.publisherPublicKeyPath,
				MAX_JSON_BYTES,
				"publisher public key",
			),
			readEvidenceArtifact(evidenceRoot, input.coreManifestPath),
			readEvidenceArtifact(evidenceRoot, input.datasetPath),
			readEvidenceArtifact(evidenceRoot, input.custodySealPath),
			readEvidenceArtifact(evidenceRoot, input.custodyTimestampEvidencePath),
			readEvidenceArtifact(evidenceRoot, input.custodyTimestampTokenPath),
		]);
	let coreValue: unknown;
	let sealValue: unknown;
	let timestampValue: unknown;
	try {
		coreValue = JSON.parse(core.bytes.toString("utf8"));
		sealValue = JSON.parse(seal.bytes.toString("utf8"));
		timestampValue = JSON.parse(timestampEvidence.bytes.toString("utf8"));
	} catch {
		throw new Error("v10 launch JSON artifact is invalid");
	}
	const coreRecord = coreValue as {
		publisher?: unknown;
		dataset?: { path?: unknown; sha256?: unknown };
	};
	if (
		!coreValue ||
		typeof coreValue !== "object" ||
		coreRecord.publisher !== input.publisher ||
		coreRecord.dataset?.path !== dataset.path ||
		coreRecord.dataset.sha256 !== dataset.sha256
	)
		throw new Error("v10 launch core manifest binding mismatch");
	if (
		!isPublicDatasetCustodySeal(sealValue) ||
		sealValue.datasetSha256 !== dataset.sha256
	)
		throw new Error("v10 launch custody seal binding mismatch");
	if (
		!isRfc3161DigestTimestampEvidence(timestampValue) ||
		timestampValue.artifactSha256 !==
			publicDatasetCustodySealSigningPacket(sealValue)
				.timestampArtifactSha256 ||
		timestampValue.tokenPath !== token.path ||
		timestampValue.tokenSha256 !== token.sha256
	)
		throw new Error("v10 launch custody timestamp binding mismatch");
	return buildPublicEvidenceV10SigningPacket({
		unsignedEnvelope: {
			schemaVersion: "naia-memory-public-evidence-promotion-v10",
			publisher: input.publisher,
			coreManifestPath: core.path,
			coreManifestSha256: core.sha256,
			datasetPath: dataset.path,
			datasetSha256: dataset.sha256,
			custodySealPath: seal.path,
			custodySealSha256: seal.sha256,
			custodyTimestampEvidencePath: timestampEvidence.path,
			custodyTimestampEvidenceSha256: timestampEvidence.sha256,
			custodyTimestampTokenPath: token.path,
			custodyTimestampTokenSha256: token.sha256,
		},
		publisherPublicKey: publicKeyBytes.toString("utf8"),
	});
}

async function prepare(args: string[]): Promise<void> {
	if (args.length !== 9)
		throw new Error(
			"Usage: prepare <evidence-root> <publisher> <publisher-public-key.pem> <core-manifest-path> <dataset-path> <custody-seal-path> <timestamp-evidence-path> <timestamp-token-path> <packet.json>",
		);
	const result = await preparePublicEvidenceV10LaunchPacket({
		evidenceRoot: args[0] as string,
		publisher: args[1] as string,
		publisherPublicKeyPath: args[2] as string,
		coreManifestPath: args[3] as string,
		datasetPath: args[4] as string,
		custodySealPath: args[5] as string,
		custodyTimestampEvidencePath: args[6] as string,
		custodyTimestampTokenPath: args[7] as string,
	});
	try {
		await writeExclusiveEvidenceFile(
			resolve(args[8] as string),
			Buffer.from(`${canonicalPublicEvidenceV10SigningPacket(result)}\n`),
		);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "EEXIST")
			throw new Error("v10 launch packet output already exists");
		throw new Error("v10 launch packet output cannot be written");
	}
	process.stdout.write(
		`${JSON.stringify({ packetSha256: result.packetSha256 })}\n`,
	);
}

async function packet(args: string[]): Promise<void> {
	if (args.length !== 2)
		throw new Error(
			"Usage: packet <unsigned-envelope.json> <publisher-public-key.pem>",
		);
	const [unsignedEnvelope, publicKeyBytes] = await Promise.all([
		readJson(args[0] as string, "unsigned envelope"),
		readBytes(args[1] as string, MAX_JSON_BYTES, "publisher public key"),
	]);
	const result = buildPublicEvidenceV10SigningPacket({
		unsignedEnvelope: unsignedEnvelope as never,
		publisherPublicKey: publicKeyBytes.toString("utf8"),
	});
	process.stdout.write(`${canonicalPublicEvidenceV10SigningPacket(result)}\n`);
}

async function collect(args: string[]): Promise<void> {
	if (args.length !== 4)
		throw new Error(
			"Usage: collect <packet.json> <detached-signature.json> <publisher-public-key.pem> <envelope.json>",
		);
	const [packetValue, detachedSignature, publicKeyBytes] = await Promise.all([
		readJson(args[0] as string, "v10 signing packet"),
		readJson(args[1] as string, "v10 detached signature"),
		readBytes(args[2] as string, MAX_JSON_BYTES, "publisher public key"),
	]);
	const envelope = collectPublicEvidenceV10Signature({
		packet: packetValue,
		detachedSignature,
		publisherPublicKey: publicKeyBytes.toString("utf8"),
	});
	const bytes = Buffer.from(`${JSON.stringify(envelope, null, 2)}\n`);
	try {
		await writeExclusiveEvidenceFile(resolve(args[3] as string), bytes);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "EEXIST")
			throw new Error("v10 envelope output already exists");
		throw new Error("v10 envelope output cannot be written");
	}
	process.stdout.write(
		`${JSON.stringify({ envelopeSha256: createHash("sha256").update(bytes).digest("hex") })}\n`,
	);
}

export async function evaluatePublicEvidenceV10Bundle(
	envelopePath: string,
	trustPolicyPath: string,
	trustedCaPath: string,
) {
	try {
		const canonicalEnvelope = await realpath(resolve(envelopePath));
		const evidenceRoot = dirname(canonicalEnvelope);
		const [canonicalTrust, canonicalCa] = await Promise.all([
			realpath(resolve(trustPolicyPath)),
			realpath(resolve(trustedCaPath)),
		]);
		if (!isOutside(evidenceRoot, canonicalTrust))
			throw new Error(
				"v10 trust policy must be outside the submitted evidence root",
			);
		if (!isOutside(evidenceRoot, canonicalCa))
			throw new Error(
				"v10 trusted CA must be outside the submitted evidence root",
			);
		const [envelope, trustPolicy, trustedCaBytes] = await Promise.all([
			readJson(canonicalEnvelope, "v10 envelope"),
			readJson(canonicalTrust, "v10 trust policy"),
			readBytes(canonicalCa, MAX_CA_BYTES, "v10 trusted CA"),
		]);
		if (!isPublicEvidenceV10TrustPolicy(trustPolicy))
			throw new Error("v10 verifier trust policy shape is invalid");
		if (
			createHash("sha256").update(trustedCaBytes).digest("hex") !==
			trustPolicy.custodyTimestamp.trustedCaFileSha256
		)
			throw new Error("v10 trusted CA hash mismatch");
		return evaluatePublicEvidenceV10({
			envelope,
			evidenceRoot,
			trustPolicy,
			trustedCaBytes,
		});
	} catch (error) {
		return {
			promotable: false,
			failures: [
				error instanceof Error ? error.message : "v10 evidence intake failed",
			],
		};
	}
}

async function verify(args: string[]): Promise<number> {
	if (args.length !== 3)
		throw new Error(
			"Usage: verify <envelope.json> <verifier-trust-policy.json> <trusted-ca.pem>",
		);
	const result = await evaluatePublicEvidenceV10Bundle(
		args[0] as string,
		args[1] as string,
		args[2] as string,
	);
	process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
	return result.promotable ? 0 : 1;
}

export async function runPublicEvidenceV10Cli(args: string[]): Promise<number> {
	try {
		const [command, ...rest] = args;
		if (command === "prepare") await prepare(rest);
		else if (command === "packet") await packet(rest);
		else if (command === "collect") await collect(rest);
		else if (command === "verify") return await verify(rest);
		else throw new Error("Usage: <prepare|packet|collect|verify> ...");
		return 0;
	} catch (error) {
		process.stderr.write(
			`${error instanceof Error ? error.message : "v10 evidence operation failed"}\n`,
		);
		return 1;
	}
}

const invokedPath =
	process.argv[1] && pathToFileURL(resolve(process.argv[1])).href;
if (invokedPath === import.meta.url)
	process.exitCode = await runPublicEvidenceV10Cli(process.argv.slice(2));
