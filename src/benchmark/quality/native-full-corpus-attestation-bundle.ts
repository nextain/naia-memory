import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { open, realpath, stat } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import {
	PublicEvidenceFileTooLargeError,
	readBoundedEvidenceFile,
} from "./public-evidence-file-io.js";

const MAX_MANIFEST_BYTES = 1024 * 1024;
const MAX_ARTIFACT_BYTES = 16 * 1024 * 1024;
const SHA256 = /^[a-f0-9]{64}$/u;

export const FULL_CORPUS_ATTESTATION_ARTIFACT_NAMES = [
	"receipt",
	"challenge",
	"attestation",
	"trustPolicy",
	"challengeTimestampEvidence",
	"challengeTimestampTrustPolicy",
	"attestationTimestampEvidence",
	"attestationTimestampTrustPolicy",
	"challengeTimestampToken",
	"challengeTimestampTrustedCa",
	"attestationTimestampToken",
	"attestationTimestampTrustedCa",
] as const;

export const FULL_CORPUS_ATTESTATION_JSON_ARTIFACT_NAMES =
	FULL_CORPUS_ATTESTATION_ARTIFACT_NAMES.slice(0, 8) as readonly (
		| "receipt"
		| "challenge"
		| "attestation"
		| "trustPolicy"
		| "challengeTimestampEvidence"
		| "challengeTimestampTrustPolicy"
		| "attestationTimestampEvidence"
		| "attestationTimestampTrustPolicy"
	)[];

type ArtifactName = (typeof FULL_CORPUS_ATTESTATION_ARTIFACT_NAMES)[number];
type ArtifactReference = { path: string; sha256: string };
export type LoadedFullCorpusAttestationArtifact = ArtifactReference & {
	name: ArtifactName;
	absolutePath: string;
	bytes: Buffer;
};

export type FullCorpusAttestationBundle = {
	schemaVersion: "naia-memory-full-corpus-attestation-bundle-v1";
	artifacts: Record<ArtifactName, ArtifactReference>;
};

function exactKeys(
	value: Record<string, unknown>,
	expected: readonly string[],
	label: string,
) {
	const actual = Object.keys(value).sort();
	const canonical = [...expected].sort();
	const missing = canonical.filter((key) => !actual.includes(key));
	const unexpected = actual.filter((key) => !canonical.includes(key));
	if (missing.length || unexpected.length)
		throw new Error(
			`${label} fields are invalid (missing: ${missing.join(",") || "none"}; unexpected: ${unexpected.join(",") || "none"})`,
		);
}

function confinedPath(root: string, candidate: string): string {
	if (!candidate || isAbsolute(candidate))
		throw new Error("full-corpus attestation artifact path must be relative");
	const target = resolve(root, candidate);
	const fromRoot = relative(root, target);
	if (
		fromRoot === ".." ||
		fromRoot.startsWith(`..${sep}`) ||
		isAbsolute(fromRoot)
	)
		throw new Error("full-corpus attestation artifact path escapes bundle");
	return target;
}

async function readConfinedArtifact(
	realRoot: string,
	target: string,
	name: ArtifactName,
): Promise<Buffer> {
	const initialRealTarget = await realpath(target);
	const initialFromRoot = relative(realRoot, initialRealTarget);
	if (
		initialFromRoot === ".." ||
		initialFromRoot.startsWith(`..${sep}`) ||
		isAbsolute(initialFromRoot)
	)
		throw new Error(
			"full-corpus attestation artifact path escapes bundle through a symbolic link",
		);
	const handle = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
	try {
		const opened = await handle.stat();
		if (!opened.isFile())
			throw new Error(`full-corpus attestation artifact ${name} is unreadable`);
		if (opened.size > MAX_ARTIFACT_BYTES)
			throw new PublicEvidenceFileTooLargeError();
		const realTarget = await realpath(target);
		const fromRoot = relative(realRoot, realTarget);
		if (
			fromRoot === ".." ||
			fromRoot.startsWith(`..${sep}`) ||
			isAbsolute(fromRoot)
		)
			throw new Error(
				"full-corpus attestation artifact path escapes bundle through a symbolic link",
			);
		const current = await stat(target);
		if (opened.dev !== current.dev || opened.ino !== current.ino)
			throw new Error(
				`full-corpus attestation artifact ${name} changed during validation`,
			);
		const bytes = await handle.readFile();
		if (bytes.length > MAX_ARTIFACT_BYTES)
			throw new PublicEvidenceFileTooLargeError();
		return bytes;
	} finally {
		await handle.close();
	}
}

export async function loadFullCorpusAttestationBundle(
	manifestPath: string,
): Promise<{
	manifest: FullCorpusAttestationBundle;
	manifestSha256: string;
	artifacts: LoadedFullCorpusAttestationArtifact[];
}> {
	const absoluteManifestPath = resolve(manifestPath);
	let bytes: Buffer;
	try {
		bytes = await readBoundedEvidenceFile(
			absoluteManifestPath,
			MAX_MANIFEST_BYTES,
		);
	} catch (error) {
		if (error instanceof PublicEvidenceFileTooLargeError)
			throw new Error("full-corpus attestation bundle exceeds 1 MiB");
		throw new Error("full-corpus attestation bundle is unreadable");
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(bytes.toString("utf8"));
	} catch {
		throw new Error("full-corpus attestation bundle is not valid JSON");
	}
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
		throw new Error("full-corpus attestation bundle root must be an object");
	const root = parsed as Record<string, unknown>;
	exactKeys(
		root,
		["schemaVersion", "artifacts"],
		"full-corpus attestation bundle",
	);
	if (root.schemaVersion !== "naia-memory-full-corpus-attestation-bundle-v1")
		throw new Error("full-corpus attestation bundle schema version is invalid");
	if (
		!root.artifacts ||
		typeof root.artifacts !== "object" ||
		Array.isArray(root.artifacts)
	)
		throw new Error("full-corpus attestation bundle artifacts are invalid");
	const artifacts = root.artifacts as Record<string, unknown>;
	exactKeys(
		artifacts,
		FULL_CORPUS_ATTESTATION_ARTIFACT_NAMES,
		"full-corpus attestation bundle artifacts",
	);
	const directory = dirname(absoluteManifestPath);
	const realDirectory = await realpath(directory);
	const loadedArtifacts: LoadedFullCorpusAttestationArtifact[] = [];
	for (const name of FULL_CORPUS_ATTESTATION_ARTIFACT_NAMES) {
		const reference = artifacts[name];
		if (!reference || typeof reference !== "object" || Array.isArray(reference))
			throw new Error(`full-corpus attestation artifact ${name} is invalid`);
		const fields = reference as Record<string, unknown>;
		exactKeys(
			fields,
			["path", "sha256"],
			`full-corpus attestation artifact ${name}`,
		);
		if (
			typeof fields.path !== "string" ||
			typeof fields.sha256 !== "string" ||
			!SHA256.test(fields.sha256)
		)
			throw new Error(
				`full-corpus attestation artifact ${name} reference is invalid`,
			);
		const path = confinedPath(directory, fields.path);
		let artifactBytes: Buffer;
		try {
			artifactBytes = await readConfinedArtifact(realDirectory, path, name);
		} catch (error) {
			if (error instanceof PublicEvidenceFileTooLargeError)
				throw new Error(
					`full-corpus attestation artifact ${name} exceeds 16 MiB`,
				);
			if (error instanceof Error && error.message.startsWith("full-corpus"))
				throw error;
			throw new Error(`full-corpus attestation artifact ${name} is unreadable`);
		}
		const actual = createHash("sha256").update(artifactBytes).digest("hex");
		if (actual !== fields.sha256)
			throw new Error(`full-corpus attestation artifact ${name} hash mismatch`);
		loadedArtifacts.push({
			name,
			path: fields.path,
			sha256: fields.sha256,
			absolutePath: path,
			bytes: artifactBytes,
		});
	}
	return {
		manifest: parsed as FullCorpusAttestationBundle,
		manifestSha256: createHash("sha256").update(bytes).digest("hex"),
		artifacts: loadedArtifacts,
	};
}
