import { randomUUID } from "node:crypto";
import type {
	SemanticEngineBridge,
	SemanticIngestReceipt,
	SemanticNativeMemory,
} from "./memory-semantic-runner.js";

export type Mem0SemanticClient = {
	add(
		messages: Array<{ role: "user"; content: string }>,
		options: { userId: string; infer: true },
	): Promise<{ results: unknown[] }>;
	search(
		query: string,
		options: { userId: string; limit: number },
	): Promise<{ results: Array<{ id: string; memory: string }> }>;
	getAll(options: { userId: string }): Promise<{
		results: Array<{ id: string; memory: string }>;
	}>;
	deleteAll(options: { userId: string }): Promise<unknown>;
};

export type Mem0SemanticFactoryOptions = {
	mem0Config: Record<string, unknown>;
	userIdPrefix: string;
};

export async function createMem0SemanticBridge(
	options: Mem0SemanticFactoryOptions,
): Promise<Mem0SemanticBridge> {
	if (!options.userIdPrefix.trim())
		throw new Error("mem0 semantic benchmark user ID prefix is invalid");
	const { Memory } = await import("mem0ai/oss");
	const client = new Memory(
		options.mem0Config as ConstructorParameters<typeof Memory>[0],
	);
	return new Mem0SemanticBridge(
		client as unknown as Mem0SemanticClient,
		`${options.userIdPrefix}-${randomUUID()}`,
	);
}

/** Runs Mem0's production inference path without benchmark labels or metadata. */
export class Mem0SemanticBridge implements SemanticEngineBridge {
	readonly isolationPolicy = "fresh-case-state-v1" as const;
	readonly identityPolicy = "engine-native-memory-v1" as const;
	readonly ingestionPolicy = "sequential-turn-commit-v1" as const;
	readonly temporalInputPolicy = "engine-default-ingest-time-v1" as const;
	readonly retrievalSurface = "engine-native-semantic-memory-v1" as const;

	constructor(
		private readonly client: Mem0SemanticClient,
		private readonly userId: string,
	) {
		if (!userId.trim())
			throw new Error("mem0 semantic benchmark user ID is invalid");
	}

	async ingestTurn(turn: { content: string }): Promise<SemanticIngestReceipt> {
		const response = await this.client.add(
			[{ role: "user", content: turn.content }],
			{
				userId: this.userId,
				infer: true,
			},
		);
		if (!response || !Array.isArray(response.results))
			throw new Error("Mem0 add returned an invalid native receipt");
		return {
			outcome: "native-operations",
			nativeOperationCount: response.results.length,
		};
	}

	async search(query: string, topK: number): Promise<SemanticNativeMemory[]> {
		const response = await this.client.search(query, {
			userId: this.userId,
			limit: topK,
		});
		return response.results.map(toNativeMemory);
	}

	async getNativeState(): Promise<SemanticNativeMemory[]> {
		const response = await this.client.getAll({ userId: this.userId });
		return response.results.map(toNativeMemory);
	}

	async close(): Promise<void> {
		await this.client.deleteAll({ userId: this.userId });
	}
}

function toNativeMemory(item: {
	id: string;
	memory: string;
}): SemanticNativeMemory {
	return { nativeId: item.id, content: item.memory };
}
