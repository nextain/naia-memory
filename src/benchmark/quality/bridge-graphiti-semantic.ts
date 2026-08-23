import { randomUUID } from "node:crypto";
import type {
	SemanticEngineBridge,
	SemanticIngestReceipt,
	SemanticNativeMemory,
} from "./memory-semantic-runner.js";

export type GraphitiNativeFact = {
	uuid: string;
	fact: string;
};

export type GraphitiSemanticClient = {
	addEpisode(input: {
		uuid: string;
		groupId: string;
		content: string;
		name: string;
		sourceDescription: string;
	}): Promise<void>;
	hasEpisode(input: { uuid: string; groupId: string }): Promise<boolean>;
	/** Searches Graphiti and returns only results identical to current native edges. */
	searchCurrentFacts(input: {
		query: string;
		groupIds: string[];
		maxFacts: number;
	}): Promise<GraphitiNativeFact[]>;
	/** Lists only currently valid native entity edges for the group. */
	listCurrentFacts(groupId: string): Promise<GraphitiNativeFact[]>;
	deleteGroup(groupId: string): Promise<void>;
};

export type GraphitiSemanticBridgeOptions = {
	pollIntervalMs?: number;
	ingestionTimeoutMs?: number;
	wait?: (milliseconds: number) => Promise<void>;
};

export function createGraphitiSemanticBridge(
	client: GraphitiSemanticClient,
	groupIdPrefix: string,
	options: GraphitiSemanticBridgeOptions = {},
): Promise<GraphitiSemanticBridge> {
	if (!groupIdPrefix.trim())
		throw new Error("Graphiti benchmark group ID prefix is invalid");
	return Promise.resolve(
		new GraphitiSemanticBridge(
			client,
			`${groupIdPrefix}-${randomUUID()}`,
			options,
		),
	);
}

/**
 * Exercises Graphiti's sequential episode ingestion and current-state-projected
 * native fact retrieval.
 *
 * The injected client must expose Graphiti core's group-scoped current edges;
 * the stock graph-service REST API does not provide a complete fact-list route.
 * This prevents query results or raw episodes from being mislabeled as state.
 */
export class GraphitiSemanticBridge implements SemanticEngineBridge {
	readonly isolationPolicy = "fresh-case-state-v1" as const;
	readonly identityPolicy = "engine-native-memory-v1" as const;
	readonly ingestionPolicy = "sequential-turn-commit-v1" as const;
	readonly temporalInputPolicy = "engine-default-ingest-time-v1" as const;
	readonly retrievalSurface =
		"engine-current-state-projected-semantic-memory-v1" as const;

	private readonly pollIntervalMs: number;
	private readonly ingestionTimeoutMs: number;
	private readonly wait: (milliseconds: number) => Promise<void>;

	constructor(
		private readonly client: GraphitiSemanticClient,
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
			await this.client.searchCurrentFacts({
				query,
				groupIds: [this.groupId],
				maxFacts: topK,
			})
		).map(toNativeMemory);
	}

	async getNativeState(): Promise<SemanticNativeMemory[]> {
		return (await this.client.listCurrentFacts(this.groupId)).map(
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
