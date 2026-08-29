import { createHash } from "node:crypto";
import { readFile, rename, writeFile } from "node:fs/promises";

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

export function semanticCaseFileName(questionId: string): string {
	return `${createHash("sha256").update(questionId).digest("hex").slice(0, 16)}.json`;
}

export async function loadSemanticCaseCheckpoint(
	path: string,
	expected: SemanticCheckpointContext & {
		caseOrdinal: number;
		questionId: string;
	},
): Promise<SemanticPilotCaseResult | undefined> {
	let bytes: Buffer;
	try {
		bytes = await readFile(path);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
		throw error;
	}
	const checkpoint: unknown = JSON.parse(bytes.toString("utf8"));
	validateSemanticCaseCheckpoint(checkpoint, expected);
	return checkpoint.result;
}

export async function writeJsonAtomic(
	path: string,
	value: unknown,
): Promise<void> {
	const temporaryPath = `${path}.tmp-${process.pid}-${Date.now()}`;
	await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, {
		encoding: "utf8",
		mode: 0o600,
	});
	await rename(temporaryPath, path);
}

export async function writeSemanticCaseCheckpoint(
	path: string,
	context: SemanticCheckpointContext,
	result: SemanticPilotCaseResult,
): Promise<void> {
	await writeJsonAtomic(path, createSemanticCaseCheckpoint(context, result));
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
	if (
		!result ||
		!Number.isSafeInteger(result.caseOrdinal) ||
		result.caseOrdinal < 0 ||
		result.caseOrdinal !== expected.caseOrdinal
	)
		throw new Error("semantic checkpoint case ordinal mismatch");
	if (result.questionId !== expected.questionId)
		throw new Error("semantic checkpoint question ID mismatch");
	validateSemanticPilotCaseResult(result);
}

export function validateSemanticPilotCaseResult(
	result: SemanticPilotCaseResult,
): void {
	if (!SHA256.test(result.retrievalSha256))
		throw new Error("semantic checkpoint retrieval hash is invalid");
	for (const key of [
		"ingestElapsedMs",
		"reindexElapsedMs",
		"recallElapsedMs",
		"retrievedCount",
		"storeBytes",
	] as const)
		if (!Number.isFinite(result[key]) || result[key] < 0)
			throw new Error(`semantic checkpoint result ${key} is invalid`);
	if (!Number.isSafeInteger(result.turnCount) || result.turnCount < 1)
		throw new Error("semantic checkpoint result turnCount is invalid");
	if (
		!Number.isSafeInteger(result.retrievedCount) ||
		result.retrievedCount < 0 ||
		result.retrievedCount > 50
	)
		throw new Error("semantic checkpoint result retrievedCount is invalid");
	if (!Number.isSafeInteger(result.storeBytes) || result.storeBytes < 0)
		throw new Error("semantic checkpoint result storeBytes is invalid");
}
