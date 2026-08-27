import { createHash, randomBytes } from "node:crypto";
import { constants } from "node:fs";
import { link, open, realpath, unlink } from "node:fs/promises";
import {
	basename,
	dirname,
	isAbsolute,
	relative,
	resolve,
	sep,
} from "node:path";
import {
	PublicEvidenceFileTooLargeError,
	readBoundedEvidenceFile,
} from "./public-evidence-file-io.js";
import {
	SEMANTIC_PUBLIC_GATE_ARTIFACT_NAMES,
	type SemanticPublicGateArtifactName,
	type SemanticPublicGateManifest,
	loadSemanticPublicGateManifest,
} from "./semantic-public-gate-manifest.js";

const MAX_DRAFT_BYTES = 1024 * 1024;
const MAX_ARTIFACT_BYTES = 16 * 1024 * 1024;

type Draft = {
	schemaVersion: "naia-memory-semantic-public-gate-manifest-draft-v5";
	blindingSeed: string;
	artifacts: Record<SemanticPublicGateArtifactName, string>;
};

function requireExactKeys(
	value: Record<string, unknown>,
	expected: readonly string[],
	label: string,
) {
	const actual = Object.keys(value);
	const missing = expected.filter((key) => !actual.includes(key));
	const unexpected = actual.filter((key) => !expected.includes(key));
	if (missing.length || unexpected.length)
		throw new Error(
			`${label} fields are invalid (missing: ${missing.join(",") || "none"}; unexpected: ${unexpected.join(",") || "none"})`,
		);
}

function resolveConfined(root: string, candidate: string): string {
	if (!candidate || isAbsolute(candidate))
		throw new Error(
			"semantic public gate draft artifact path must be relative",
		);
	const target = resolve(root, candidate);
	const fromRoot = relative(root, target);
	if (
		fromRoot === ".." ||
		fromRoot.startsWith(`..${sep}`) ||
		isAbsolute(fromRoot)
	)
		throw new Error(
			"semantic public gate draft artifact path escapes draft directory",
		);
	return target;
}

async function rejectSymlinkEscape(root: string, target: string) {
	const [realRoot, realTarget] = await Promise.all([
		realpath(root),
		realpath(target),
	]);
	const fromRoot = relative(realRoot, realTarget);
	if (
		fromRoot === ".." ||
		fromRoot.startsWith(`..${sep}`) ||
		isAbsolute(fromRoot)
	)
		throw new Error(
			"semantic public gate draft artifact path escapes draft directory through a symbolic link",
		);
}

async function readDraft(path: string): Promise<Draft> {
	let bytes: Buffer;
	try {
		bytes = await readBoundedEvidenceFile(path, MAX_DRAFT_BYTES);
	} catch (error) {
		if (error instanceof PublicEvidenceFileTooLargeError)
			throw new Error(
				"semantic public gate manifest draft exceeds the 1 MiB intake limit",
			);
		throw new Error("semantic public gate manifest draft is unreadable");
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(bytes.toString("utf8"));
	} catch {
		throw new Error("semantic public gate manifest draft is not valid JSON");
	}
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
		throw new Error(
			"semantic public gate manifest draft root must be an object",
		);
	const root = parsed as Record<string, unknown>;
	requireExactKeys(
		root,
		["schemaVersion", "blindingSeed", "artifacts"],
		"semantic public gate manifest draft",
	);
	if (
		root.schemaVersion !== "naia-memory-semantic-public-gate-manifest-draft-v5"
	)
		throw new Error(
			"semantic public gate manifest draft schema version is invalid",
		);
	if (typeof root.blindingSeed !== "string" || !root.blindingSeed)
		throw new Error(
			"semantic public gate manifest draft blinding seed is invalid",
		);
	if (
		!root.artifacts ||
		typeof root.artifacts !== "object" ||
		Array.isArray(root.artifacts)
	)
		throw new Error(
			"semantic public gate manifest draft artifacts are invalid",
		);
	const artifacts = root.artifacts as Record<string, unknown>;
	requireExactKeys(
		artifacts,
		SEMANTIC_PUBLIC_GATE_ARTIFACT_NAMES,
		"semantic public gate manifest draft artifacts",
	);
	for (const name of SEMANTIC_PUBLIC_GATE_ARTIFACT_NAMES) {
		if (typeof artifacts[name] !== "string" || !artifacts[name])
			throw new Error(
				`semantic public gate manifest draft artifact ${name} is invalid`,
			);
	}
	return parsed as Draft;
}

async function writeExclusive(path: string, bytes: Buffer) {
	const temporary = `${path}.tmp-${randomBytes(12).toString("hex")}`;
	let created = false;
	try {
		const handle = await open(
			temporary,
			constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL,
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

export async function generateSemanticPublicGateManifest(
	draftPath: string,
	outputPath: string,
): Promise<{ manifestPath: string; sha256: string }> {
	const absoluteDraft = resolve(draftPath);
	const directory = dirname(absoluteDraft);
	const absoluteOutput = resolve(outputPath);
	if (
		dirname(absoluteOutput) !== directory ||
		basename(absoluteOutput) === basename(absoluteDraft)
	)
		throw new Error(
			"semantic public gate manifest output must be a new file in the draft directory",
		);
	const draft = await readDraft(absoluteDraft);
	const artifacts = {} as SemanticPublicGateManifest["artifacts"];
	for (const name of SEMANTIC_PUBLIC_GATE_ARTIFACT_NAMES) {
		const candidate = draft.artifacts[name];
		const path = resolveConfined(directory, candidate);
		try {
			await rejectSymlinkEscape(directory, path);
		} catch (error) {
			if (
				error instanceof Error &&
				error.message.startsWith("semantic public gate")
			)
				throw error;
			throw new Error(
				`semantic public gate draft artifact ${name} is unreadable`,
			);
		}
		let bytes: Buffer;
		try {
			bytes = await readBoundedEvidenceFile(path, MAX_ARTIFACT_BYTES);
		} catch (error) {
			if (error instanceof PublicEvidenceFileTooLargeError)
				throw new Error(
					`semantic public gate draft artifact ${name} exceeds the 16 MiB intake limit`,
				);
			throw new Error(
				`semantic public gate draft artifact ${name} is unreadable`,
			);
		}
		artifacts[name] = {
			path: candidate,
			sha256: createHash("sha256").update(bytes).digest("hex"),
		};
	}
	const manifest: SemanticPublicGateManifest = {
		schemaVersion: "naia-memory-semantic-public-gate-manifest-v5",
		blindingSeed: draft.blindingSeed,
		artifacts,
	};
	const bytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
	await writeExclusive(absoluteOutput, bytes);
	await loadSemanticPublicGateManifest(absoluteOutput);
	return {
		manifestPath: absoluteOutput,
		sha256: createHash("sha256").update(bytes).digest("hex"),
	};
}
