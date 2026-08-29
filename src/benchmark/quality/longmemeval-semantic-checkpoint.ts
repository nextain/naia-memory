import { createHash } from "node:crypto";

export interface SemanticPilotCaseResult {
	caseOrdinal: number;
	questionId: string;
	turnCount: number;
	ingestElapsedMs: number;
	reindexElapsedMs: number;
	recallElapsedMs: number;
	retrievedCount: number;
	retrievalSha256: string;
	storeBytes: number;
}

export interface SemanticCheckpointContext {
	inputFileSha256: string;
	inputContentSha256: string;
	policySha256: string;
}

export interface SemanticCaseCheckpoint extends SemanticCheckpointContext {
	schemaVersion: "naia-memory-longmemeval-semantic-case-v1";
	result: SemanticPilotCaseResult;
}

const SHA256 = /^[a-f0-9]{64}$/u;

export function semanticPolicySha256(policy: unknown): string {
	return createHash("sha256").update(JSON.stringify(policy)).digest("hex");
}

export function createSemanticCaseCheckpoint(
	context: SemanticCheckpointContext,
	result: SemanticPilotCaseResult,
): SemanticCaseCheckpoint {
	return {
		schemaVersion: "naia-memory-longmemeval-semantic-case-v1",
		...context,
		result,
	};
}

export function validateSemanticCaseCheckpoint(
	value: unknown,
	expected: SemanticCheckpointContext & {
		caseOrdinal: number;
		questionId: string;
	},
): asserts value is SemanticCaseCheckpoint {
	if (!value || typeof value !== "object")
		throw new Error("semantic checkpoint must be an object");
	const checkpoint = value as Partial<SemanticCaseCheckpoint>;
	if (checkpoint.schemaVersion !== "naia-memory-longmemeval-semantic-case-v1")
		throw new Error("semantic checkpoint schema mismatch");
	for (const key of [
		"inputFileSha256",
		"inputContentSha256",
		"policySha256",
	] as const) {
		if (!SHA256.test(checkpoint[key] ?? ""))
			throw new Error(`semantic checkpoint ${key} is invalid`);
		if (checkpoint[key] !== expected[key])
			throw new Error(`semantic checkpoint ${key} mismatch`);
	}
	const result = checkpoint.result;
	if (!result || result.caseOrdinal !== expected.caseOrdinal)
		throw new Error("semantic checkpoint case ordinal mismatch");
	if (result.questionId !== expected.questionId)
		throw new Error("semantic checkpoint question ID mismatch");
	if (!SHA256.test(result.retrievalSha256))
		throw new Error("semantic checkpoint retrieval hash is invalid");
	for (const key of [
		"turnCount",
		"ingestElapsedMs",
		"reindexElapsedMs",
		"recallElapsedMs",
		"retrievedCount",
		"storeBytes",
	] as const)
		if (!Number.isFinite(result[key]) || result[key] < 0)
			throw new Error(`semantic checkpoint result ${key} is invalid`);
}
