#!/usr/bin/env node
import { createHash, randomBytes } from "node:crypto";
import { constants } from "node:fs";
import { link, open, unlink } from "node:fs/promises";
import { canonicalEvidenceJson } from "./public-evidence-crypto.js";
import { readBoundedEvidenceFile } from "./public-evidence-file-io.js";
import type { SemanticPublicGateManifestSignerTrustPolicy } from "./semantic-public-gate-manifest-receipt.js";
import {
	buildSemanticPublicGateManifestSigningPacket,
	collectSemanticPublicGateManifestSignature,
} from "./semantic-public-gate-manifest-signing.js";

const MAX_MANIFEST_BYTES = 1024 * 1024;
const MAX_SIGNING_INPUT_BYTES = 64 * 1024;

async function writeExclusive(path: string, bytes: Buffer): Promise<void> {
	const temporary = `${path}.tmp-${randomBytes(12).toString("hex")}`;
	let created = false;
	try {
		const handle = await open(
			temporary,
			constants.O_WRONLY |
				constants.O_CREAT |
				constants.O_EXCL |
				constants.O_NOFOLLOW,
			0o600,
		);
		created = true;
		try {
			await handle.writeFile(bytes);
			await handle.sync();
		} finally {
			await handle.close();
		}
		await link(temporary, path);
	} finally {
		if (created) await unlink(temporary).catch(() => undefined);
	}
}

async function readJson(path: string, label: string): Promise<unknown> {
	let bytes: Buffer;
	try {
		bytes = await readBoundedEvidenceFile(path, MAX_SIGNING_INPUT_BYTES);
	} catch {
		throw new Error(`${label} is unreadable`);
	}
	try {
		return JSON.parse(bytes.toString("utf8"));
	} catch {
		throw new Error(`${label} is not valid JSON`);
	}
}

async function packet(args: string[]): Promise<void> {
	if (args.length !== 3)
		throw new Error(
			"Usage: packet <manifest.json> <signer-trust-policy.json> <signer-id>",
		);
	let manifest: Buffer;
	try {
		manifest = await readBoundedEvidenceFile(
			args[0] as string,
			MAX_MANIFEST_BYTES,
		);
	} catch {
		throw new Error("public gate manifest is unreadable");
	}
	const trustPolicy = (await readJson(
		args[1] as string,
		"manifest signer trust policy",
	)) as SemanticPublicGateManifestSignerTrustPolicy;
	const result = buildSemanticPublicGateManifestSigningPacket({
		manifestSha256: createHash("sha256").update(manifest).digest("hex"),
		signerId: args[2] as string,
		trustPolicy,
	});
	process.stdout.write(`${canonicalEvidenceJson(result)}\n`);
}

async function collect(args: string[]): Promise<void> {
	if (args.length !== 4)
		throw new Error(
			"Usage: collect <packet.json> <detached-signature.json> <signer-trust-policy.json> <receipt.json>",
		);
	const [signingPacket, detachedSignature, trustPolicy] = await Promise.all([
		readJson(args[0] as string, "manifest signing packet"),
		readJson(args[1] as string, "manifest detached signature"),
		readJson(args[2] as string, "manifest signer trust policy"),
	]);
	const receipt = collectSemanticPublicGateManifestSignature({
		packet: signingPacket,
		detachedSignature,
		trustPolicy: trustPolicy as SemanticPublicGateManifestSignerTrustPolicy,
	});
	const bytes = Buffer.from(`${canonicalEvidenceJson(receipt)}\n`);
	try {
		await writeExclusive(args[3] as string, bytes);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "EEXIST")
			throw new Error("manifest receipt output already exists");
		throw new Error("manifest receipt output cannot be written");
	}
	process.stdout.write(
		`${JSON.stringify({ receiptSha256: createHash("sha256").update(bytes).digest("hex") })}\n`,
	);
}

export async function runSemanticPublicGateManifestSigningCli(
	args: string[],
): Promise<number> {
	try {
		const [command, ...rest] = args;
		if (command === "packet") await packet(rest);
		else if (command === "collect") await collect(rest);
		else
			throw new Error(
				"Usage: <packet|collect> ... (run the command without arguments for details)",
			);
		return 0;
	} catch (error) {
		process.stderr.write(
			`${error instanceof Error ? error.message : "manifest signing operation failed"}\n`,
		);
		return 1;
	}
}

if (import.meta.url === `file://${process.argv[1]}`)
	process.exitCode = await runSemanticPublicGateManifestSigningCli(
		process.argv.slice(2),
	);
