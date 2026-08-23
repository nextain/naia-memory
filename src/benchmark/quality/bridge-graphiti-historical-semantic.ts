import { randomUUID } from "node:crypto";
import type {
	GraphitiNativeFact,
	GraphitiSemanticBridgeOptions,
	GraphitiSemanticClient,
} from "./bridge-graphiti-semantic.js";
import type {
	SemanticEngineBridge,
	SemanticIngestReceipt,
	SemanticNativeMemory,
} from "./memory-semantic-runner.js";

export type GraphitiHistoricalSemanticClient = GraphitiSemanticClient & {
	/** Unprojected native query output. */
	searchFactsRaw(input: {
		query: string;
		groupIds: string[];
		maxFacts: number;
	}): Promise<GraphitiNativeFact[]>;
	/** Complete group history obtained independently from query output. */
	listHistoricalFacts(groupId: string): Promise<GraphitiNativeFact[]>;
};

export async function createGraphitiHistoricalSemanticBridge(
	client: GraphitiHistoricalSemanticClient,
	groupIdPrefix: string,
	options: GraphitiSemanticBridgeOptions = {},
): Promise<GraphitiHistoricalSemanticBridge> {
	if (!groupIdPrefix.trim())
		throw new Error("Graphiti benchmark group ID prefix is invalid");
	return new GraphitiHistoricalSemanticBridge(
		client,
		`${groupIdPrefix}-${randomUUID()}`,
		options,
	);
}

/**
 * Exposes Graphiti's unprojected historical query surface. Historical state is
 * loaded through a separate complete-state endpoint, never from query output.
 */
export class GraphitiHistoricalSemanticBridge implements SemanticEngineBridge {
	readonly isolationPolicy = "fresh-case-state-v1" as const;
	readonly identityPolicy = "engine-native-memory-v1" as const;
	readonly ingestionPolicy = "sequential-turn-commit-v1" as const;
	readonly temporalInputPolicy = "engine-default-ingest-time-v1" as const;
	readonly retrievalSurface = "engine-native-historical-search-v1" as const;
	private readonly pollIntervalMs: number;
	private readonly ingestionTimeoutMs: number;
	private readonly wait: (milliseconds: number) => Promise<void>;

	constructor(
		private readonly client: GraphitiHistoricalSemanticClient,
		private readonly groupId: string,
		options: GraphitiSemanticBridgeOptions = {},
	) {
		if (!groupId.trim())
			throw new Error("Graphiti benchmark group ID is invalid");
		this.pollIntervalMs = options.pollIntervalMs ?? 250;
		this.ingestionTimeoutMs = options.ingestionTimeoutMs ?? 30 * 60 * 1000;
		if (!Number.isFinite(this.pollIntervalMs) || this.pollIntervalMs < 0)
			throw new Error("Graphiti poll interval is invalid");
		if (
			!Number.isFinite(this.ingestionTimeoutMs) ||
			this.ingestionTimeoutMs <= 0
		)
			throw new Error("Graphiti ingestion timeout is invalid");
		this.wait =
			options.wait ??
			((milliseconds) =>
				new Promise((resolve) => setTimeout(resolve, milliseconds)));
	}

	async ingestTurn(turn: { content: string }): Promise<SemanticIngestReceipt> {
		const episodeUuid = randomUUID();
		await this.client.addEpisode({
			uuid: episodeUuid,
			groupId: this.groupId,
			content: turn.content,
			name: `benchmark-turn-${episodeUuid}`,
			sourceDescription: "sequential user memory turn",
		});
		const deadline = Date.now() + this.ingestionTimeoutMs;
		while (
			!(await this.client.hasEpisode({
				uuid: episodeUuid,
				groupId: this.groupId,
			}))
		) {
			if (Date.now() >= deadline)
				throw new Error(
					"Graphiti episode ingestion did not commit before timeout",
				);
			await this.wait(this.pollIntervalMs);
		}
		return { outcome: "opaque" };
	}

	async search(query: string, topK: number): Promise<SemanticNativeMemory[]> {
		return (
			await this.client.searchFactsRaw({
				query,
				groupIds: [this.groupId],
				maxFacts: topK,
			})
		).map(toNativeMemory);
	}

	async getNativeState(): Promise<SemanticNativeMemory[]> {
		return (await this.client.listHistoricalFacts(this.groupId)).map(
			toNativeMemory,
		);
	}

	async close(): Promise<void> {
		await this.client.deleteGroup(this.groupId);
	}
}

function toNativeMemory(fact: GraphitiNativeFact): SemanticNativeMemory {
	if (typeof fact.uuid !== "string" || !fact.uuid.trim())
		throw new Error("Graphiti returned a fact without a native UUID");
	if (typeof fact.fact !== "string" || !fact.fact.trim())
		throw new Error("Graphiti returned an empty native fact");
	return { nativeId: fact.uuid, content: fact.fact };
}
