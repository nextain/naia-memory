import { createHash } from "node:crypto";
import { realpath } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import {
	PublicEvidenceFileTooLargeError,
	readBoundedEvidenceFile,
} from "./public-evidence-file-io.js";

const MAX_MANIFEST_BYTES = 1024 * 1024;
const MAX_ARTIFACT_BYTES = 16 * 1024 * 1024;
const SHA256 = /^[a-f0-9]{64}$/u;

export const SEMANTIC_PUBLIC_GATE_ARTIFACT_NAMES = [
	"contract",
	"attestations",
	"trustPolicy",
	"campaign",
	"executionEvidence",
	"executionTrustPolicy",
	"blindPacket",
	"blindSeal",
	"judgments",
	"adjudicationEvidence",
	"adjudicationTrustPolicy",
	"analysisPlan",
	"analysisPlanTrustPolicy",
	"pilotCollectionPlan",
	"pilotContract",
	"sampleSizeAssumptions",
	"powerReview",
	"powerReviewTrustPolicy",
	"planTimestampEvidence",
	"planTimestampTrustPolicy",
	"pilotLaunchReceipt",
	"deliveryAcknowledgements",
	"participantTrustPolicy",
	"deliveryTimestampEvidence",
	"deliveryTimestampTrustPolicy",
	"selectionDisclosure",
	"selectionDisclosureTrustPolicy",
] as const;

export const SEMANTIC_PUBLIC_GATE_BLINDING_SEED_INDEX = 11;

export type SemanticPublicGateArtifactName =
	(typeof SEMANTIC_PUBLIC_GATE_ARTIFACT_NAMES)[number];
type ArtifactReference = { path: string; sha256: string };

export type SemanticPublicGateManifest = {
	schemaVersion: "naia-memory-semantic-public-gate-manifest-v2";
	blindingSeed: string;
	artifacts: Record<SemanticPublicGateArtifactName, ArtifactReference>;
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
		throw new Error("semantic public gate artifact path must be relative");
	const target = resolve(root, candidate);
	const fromRoot = relative(root, target);
	if (
		fromRoot === ".." ||
		fromRoot.startsWith(`..${sep}`) ||
		isAbsolute(fromRoot)
	)
		throw new Error(
			"semantic public gate artifact path escapes manifest directory",
		);
	return target;
}

async function rejectRealPathEscape(
	root: string,
	target: string,
): Promise<void> {
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
			"semantic public gate artifact path escapes manifest directory through a symbolic link",
		);
}

export async function loadSemanticPublicGateManifest(
	manifestPath: string,
): Promise<{
	manifest: SemanticPublicGateManifest;
	manifestSha256: string;
	args: string[];
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
			throw new Error(
				"semantic public gate manifest exceeds the 1 MiB intake limit",
			);
		throw new Error("semantic public gate manifest is unreadable");
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(bytes.toString("utf8"));
	} catch {
		throw new Error("semantic public gate manifest is not valid JSON");
	}
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
		throw new Error("semantic public gate manifest root must be an object");
	const root = parsed as Record<string, unknown>;
	exactKeys(
		root,
		["schemaVersion", "blindingSeed", "artifacts"],
		"semantic public gate manifest",
	);
	if (root.schemaVersion !== "naia-memory-semantic-public-gate-manifest-v2")
		throw new Error("semantic public gate manifest schema version is invalid");
	if (typeof root.blindingSeed !== "string" || !root.blindingSeed)
		throw new Error("semantic public gate manifest blinding seed is invalid");
	if (
		!root.artifacts ||
		typeof root.artifacts !== "object" ||
		Array.isArray(root.artifacts)
	)
		throw new Error("semantic public gate manifest artifacts are invalid");
	const artifacts = root.artifacts as Record<string, unknown>;
	exactKeys(
		artifacts,
		SEMANTIC_PUBLIC_GATE_ARTIFACT_NAMES,
		"semantic public gate manifest artifacts",
	);
	const directory = dirname(absoluteManifestPath);
	const paths = new Map<SemanticPublicGateArtifactName, string>();
	for (const name of SEMANTIC_PUBLIC_GATE_ARTIFACT_NAMES) {
		const reference = artifacts[name];
		if (!reference || typeof reference !== "object" || Array.isArray(reference))
			throw new Error(`semantic public gate artifact ${name} is invalid`);
		const fields = reference as Record<string, unknown>;
		exactKeys(
			fields,
			["path", "sha256"],
			`semantic public gate artifact ${name}`,
		);
		if (
			typeof fields.path !== "string" ||
			typeof fields.sha256 !== "string" ||
			!SHA256.test(fields.sha256)
		)
			throw new Error(
				`semantic public gate artifact ${name} reference is invalid`,
			);
		const path = confinedPath(directory, fields.path);
		try {
			await rejectRealPathEscape(directory, path);
		} catch (error) {
			if (
				error instanceof Error &&
				error.message.startsWith("semantic public gate")
			)
				throw error;
			throw new Error(`semantic public gate artifact ${name} is unreadable`);
		}
		let artifactBytes: Buffer;
		try {
			artifactBytes = await readBoundedEvidenceFile(path, MAX_ARTIFACT_BYTES);
		} catch (error) {
			if (error instanceof PublicEvidenceFileTooLargeError)
				throw new Error(
					`semantic public gate artifact ${name} exceeds the 16 MiB intake limit`,
				);
			throw new Error(`semantic public gate artifact ${name} is unreadable`);
		}
		const actual = createHash("sha256").update(artifactBytes).digest("hex");
		if (actual !== fields.sha256)
			throw new Error(`semantic public gate artifact ${name} hash mismatch`);
		paths.set(name, path);
	}
	const ordered = SEMANTIC_PUBLIC_GATE_ARTIFACT_NAMES.map(
		(name) => paths.get(name) as string,
	);
	ordered.splice(
		SEMANTIC_PUBLIC_GATE_BLINDING_SEED_INDEX,
		0,
		root.blindingSeed,
	);
	return {
		manifest: parsed as SemanticPublicGateManifest,
		manifestSha256: createHash("sha256").update(bytes).digest("hex"),
		args: ordered,
	};
}
