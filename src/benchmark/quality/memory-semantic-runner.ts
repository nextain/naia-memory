import { createHash } from "node:crypto";
import type {
	DeleteOutcome,
	MutationOutcome,
} from "../../memory/usage-tracker.js";
import {
	type MemoryUpdateCase,
	type MemoryUpdateContract,
	validateMemoryUpdateContract,
} from "./memory-update-contract.js";

export type SemanticNativeMemory = {
	nativeId: string;
	content: string;
};

export type SemanticIngestReceipt = {
	outcome: "opaque" | "native-operations";
	nativeOperationCount?: number;
	/** Privacy-safe lifecycle counters; no memory content or benchmark labels. */
	deleteOutcomeDelta?: Record<DeleteOutcome, number>;
	/** Privacy-safe structured mutation branch counters; no fixture labels. */
	mutationOutcomeDelta?: Record<MutationOutcome, number>;
};

export type SemanticEngineBridge = {
	readonly isolationPolicy: "fresh-case-state-v1";
	readonly identityPolicy: "engine-native-memory-v1";
	readonly ingestionPolicy:
		| "sequential-turn-commit-v1"
		| "sequential-turn-settled-bank-v1";
	readonly temporalInputPolicy: "engine-default-ingest-time-v1";
	readonly retrievalSurface:
		| "engine-native-semantic-memory-v1"
		| "engine-native-core-state-v1"
		| "engine-native-core-first-and-semantic-archive-v1";
	ingestTurn(turn: { content: string }): Promise<SemanticIngestReceipt>;
	search(query: string, topK: number): Promise<SemanticNativeMemory[]>;
	getNativeState(): Promise<SemanticNativeMemory[]>;
	close(): Promise<void>;
};

export type SemanticEngineBridgeFactory = (
	language: MemoryUpdateCase["language"],
) => Promise<SemanticEngineBridge>;

export type SemanticRawReceipt = {
	caseId: string;
	executionPosition: number;
	language: MemoryUpdateCase["language"];
	fixtureSha256: string;
	engineInputSha256: string;
	ingestionPolicy: SemanticEngineBridge["ingestionPolicy"];
	temporalInputPolicy: SemanticEngineBridge["temporalInputPolicy"];
	retrievalSurface: SemanticEngineBridge["retrievalSurface"];
	ingestionReceipts: SemanticIngestReceipt[];
	nativeState: SemanticNativeMemory[];
	retrieved: SemanticNativeMemory[];
	outputSha256: string;
};

function sha256(value: unknown): string {
	return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function scheduledCases(contract: MemoryUpdateContract, executionSeed: string) {
	if (!executionSeed.trim())
		throw new Error("semantic runner execution seed is required");
	return [...contract.cases].sort((left, right) => {
		const leftKey = sha256({ executionSeed, caseId: left.id });
		const rightKey = sha256({ executionSeed, caseId: right.id });
		return leftKey.localeCompare(rightKey) || left.id.localeCompare(right.id);
	});
}

function assertNativeMemories(
	items: SemanticNativeMemory[],
	label: string,
): void {
	if (!Array.isArray(items)) throw new Error(`${label} must be an array`);
	const ids = new Set<string>();
	for (const item of items) {
		if (!item.nativeId.trim() || !item.content.trim())
			throw new Error(`${label} contains an invalid native memory`);
		if (ids.has(item.nativeId))
			throw new Error(`${label} contains duplicate native IDs`);
		ids.add(item.nativeId);
	}
}

/**
 * Captures semantic-engine output without assigning benchmark logical IDs or
 * scoring it. The bridge receives only natural-language turns and the query;
 * frozen expected/forbidden labels remain outside the execution boundary.
 */
export async function runSemanticRawContract(
	contract: MemoryUpdateContract,
	createBridge: SemanticEngineBridgeFactory,
	topK: number,
	executionSeed: string,
): Promise<SemanticRawReceipt[]> {
	validateMemoryUpdateContract(contract);
	if (contract.tier !== "semantic-update-interpretation")
		throw new Error(
			"semantic runner requires semantic-update-interpretation tier",
		);
	if (!Number.isInteger(topK) || topK < 1)
		throw new Error("semantic runner topK must be a positive integer");

	const receipts: SemanticRawReceipt[] = [];
	const schedule = scheduledCases(contract, executionSeed);
	for (const [executionIndex, benchmarkCase] of schedule.entries()) {
		const bridge = await createBridge(benchmarkCase.language);
		try {
			if (bridge.isolationPolicy !== "fresh-case-state-v1")
				throw new Error("semantic bridge does not guarantee fresh case state");
			if (bridge.identityPolicy !== "engine-native-memory-v1")
				throw new Error("semantic bridge must preserve engine-native identity");
			if (
				bridge.ingestionPolicy !== "sequential-turn-commit-v1" &&
				bridge.ingestionPolicy !== "sequential-turn-settled-bank-v1"
			)
				throw new Error("semantic bridge must commit each turn sequentially");
			if (bridge.temporalInputPolicy !== "engine-default-ingest-time-v1")
				throw new Error("semantic bridge must not receive fixture timestamps");
			if (
				bridge.retrievalSurface !== "engine-native-semantic-memory-v1" &&
				bridge.retrievalSurface !== "engine-native-core-state-v1" &&
				bridge.retrievalSurface !==
					"engine-native-core-first-and-semantic-archive-v1"
			)
				throw new Error(
					"semantic bridge exposes an unsupported retrieval surface",
				);
			const ingestionReceipts = [];
			for (const turn of benchmarkCase.turns)
				ingestionReceipts.push(
					await bridge.ingestTurn({ content: turn.content }),
				);
			const retrieved = await bridge.search(benchmarkCase.query, topK);
			const nativeState = await bridge.getNativeState();
			assertNativeMemories(retrieved, "semantic retrieval output");
			assertNativeMemories(nativeState, "semantic native state");
			if (retrieved.length > topK)
				throw new Error("semantic bridge returned more than topK memories");
			const stateById = new Map(
				nativeState.map((item) => [item.nativeId, item.content]),
			);
			for (const item of retrieved) {
				const stateContent = stateById.get(item.nativeId);
				if (stateContent === undefined)
					throw new Error("semantic retrieval ID is absent from native state");
				if (stateContent !== item.content)
					throw new Error(
						"semantic retrieval content differs from native state",
					);
			}
			const rawOutput = { ingestionReceipts, nativeState, retrieved };
			const engineInput = {
				language: benchmarkCase.language,
				turns: benchmarkCase.turns.map((turn) => ({ content: turn.content })),
				query: benchmarkCase.query,
			};
			receipts.push({
				caseId: benchmarkCase.id,
				executionPosition: executionIndex + 1,
				language: benchmarkCase.language,
				fixtureSha256: sha256({
					language: benchmarkCase.language,
					turns: benchmarkCase.turns,
					query: benchmarkCase.query,
				}),
				engineInputSha256: sha256(engineInput),
				ingestionPolicy: bridge.ingestionPolicy,
				temporalInputPolicy: bridge.temporalInputPolicy,
				retrievalSurface: bridge.retrievalSurface,
				ingestionReceipts,
				nativeState,
				retrieved,
				outputSha256: sha256(rawOutput),
			});
		} finally {
			await bridge.close();
		}
	}
	return receipts;
}
