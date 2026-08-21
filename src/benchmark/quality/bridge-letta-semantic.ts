import { randomUUID } from "node:crypto";
import type {
	SemanticEngineBridge,
	SemanticIngestReceipt,
	SemanticNativeMemory,
} from "./memory-semantic-runner.js";

type LettaMemoryBlock = { id: string; label: string; value: string };

export type LettaSemanticClient = {
	createAgent(name: string): Promise<{ id: string }>;
	sendUserMessage(agentId: string, content: string): Promise<number>;
	listMemoryBlocks(agentId: string): Promise<LettaMemoryBlock[]>;
	deleteAgent(agentId: string): Promise<void>;
};

export type LettaSemanticFactoryOptions = {
	baseUrl: string;
	apiKey?: string;
	model: string;
	embeddingModel: string;
	embeddingDimensions: number;
	embeddingEndpoint?: string;
};

export async function createLettaSemanticBridge(
	options: LettaSemanticFactoryOptions,
): Promise<LettaSemanticBridge> {
	const client = new LettaRestSemanticClient(options);
	const agent = await client.createAgent(`semantic-${randomUUID()}`);
	if (!agent.id?.trim()) throw new Error("Letta returned an invalid agent ID");
	return new LettaSemanticBridge(client, agent.id);
}

/** Exercises Letta's agent-managed memory path, including native archival tools. */
export class LettaSemanticBridge implements SemanticEngineBridge {
	readonly isolationPolicy = "fresh-case-state-v1" as const;
	readonly identityPolicy = "engine-native-memory-v1" as const;
	readonly ingestionPolicy = "sequential-turn-commit-v1" as const;
	readonly temporalInputPolicy = "engine-default-ingest-time-v1" as const;
	readonly retrievalSurface = "engine-native-core-state-v1" as const;

	constructor(
		private readonly client: LettaSemanticClient,
		private readonly agentId: string,
	) {
		if (!agentId.trim()) throw new Error("Letta benchmark agent ID is invalid");
	}

	async ingestTurn(turn: { content: string }): Promise<SemanticIngestReceipt> {
		const nativeOperationCount = await this.client.sendUserMessage(
			this.agentId,
			turn.content,
		);
		return { outcome: "native-operations", nativeOperationCount };
	}

	async search(_query: string, topK: number): Promise<SemanticNativeMemory[]> {
		return (await this.userMemoryBlocks()).slice(0, topK).map(toNativeMemory);
	}

	async getNativeState(): Promise<SemanticNativeMemory[]> {
		return (await this.userMemoryBlocks()).map(toNativeMemory);
	}

	async close(): Promise<void> {
		await this.client.deleteAgent(this.agentId);
	}

	private async userMemoryBlocks(): Promise<LettaMemoryBlock[]> {
		return (await this.client.listMemoryBlocks(this.agentId)).filter(
			(block) => block.label !== "persona" && block.value.trim().length > 0,
		);
	}
}

class LettaRestSemanticClient implements LettaSemanticClient {
	private readonly baseUrl: string;

	constructor(private readonly options: LettaSemanticFactoryOptions) {
		this.baseUrl = options.baseUrl.replace(/\/+$/, "");
		if (!this.baseUrl) throw new Error("Letta base URL is invalid");
		if (!options.model.trim() || !options.embeddingModel.trim())
			throw new Error("Letta model disclosure is required");
		if (
			!Number.isInteger(options.embeddingDimensions) ||
			options.embeddingDimensions < 1
		)
			throw new Error("Letta embedding dimensions must be a positive integer");
	}

	async createAgent(name: string): Promise<{ id: string }> {
		return this.request("POST", "/v1/agents/", {
			name,
			model: this.options.model,
			embedding_config: {
				embedding_endpoint_type: "openai",
				embedding_model: this.options.embeddingModel,
				embedding_dim: this.options.embeddingDimensions,
				...(this.options.embeddingEndpoint
					? { embedding_endpoint: this.options.embeddingEndpoint }
					: {}),
			},
			include_base_tools: true,
			memory_blocks: [
				{
					label: "persona",
					value:
						"Maintain durable user facts using the available native memory tools when useful.",
				},
				{ label: "human", value: "The user whose durable facts may change." },
			],
		});
	}

	async sendUserMessage(agentId: string, content: string): Promise<number> {
		const response = await this.request<{ messages?: unknown }>(
			"POST",
			`/v1/agents/${encodeURIComponent(agentId)}/messages`,
			{
				messages: [{ role: "user", content }],
				streaming: false,
			},
		);
		if (!Array.isArray(response.messages))
			throw new Error("Letta message response omitted messages");
		return response.messages.filter((message) => {
			if (typeof message !== "object" || message === null) return false;
			const candidate = message as {
				message_type?: unknown;
				tool_call?: { name?: unknown };
			};
			return (
				candidate.message_type === "tool_call_message" &&
				typeof candidate.tool_call?.name === "string" &&
				candidate.tool_call.name.startsWith("memory_")
			);
		}).length;
	}

	async listMemoryBlocks(agentId: string): Promise<LettaMemoryBlock[]> {
		const response = await this.request<unknown>(
			"GET",
			`/v1/agents/${encodeURIComponent(agentId)}/core-memory/blocks`,
		);
		return parseMemoryBlocks(response);
	}

	async deleteAgent(agentId: string): Promise<void> {
		await this.request("DELETE", `/v1/agents/${encodeURIComponent(agentId)}`);
	}

	private async request<T = unknown>(
		method: string,
		path: string,
		body?: unknown,
	): Promise<T> {
		const response = await fetch(`${this.baseUrl}${path}`, {
			method,
			headers: {
				"Content-Type": "application/json",
				...(this.options.apiKey
					? { Authorization: `Bearer ${this.options.apiKey}` }
					: {}),
			},
			...(body === undefined ? {} : { body: JSON.stringify(body) }),
		});
		if (!response.ok)
			throw new Error(
				`Letta ${method} ${path} failed (${response.status}): ${(await response.text()).slice(0, 300)}`,
			);
		if (response.status === 204) return undefined as T;
		return (await response.json()) as T;
	}
}

function parseMemoryBlocks(value: unknown): LettaMemoryBlock[] {
	if (!Array.isArray(value))
		throw new Error("Letta returned invalid core-memory blocks");
	return value.map((item) => {
		if (
			typeof item !== "object" ||
			item === null ||
			typeof (item as { id?: unknown }).id !== "string" ||
			typeof (item as { label?: unknown }).label !== "string" ||
			typeof (item as { value?: unknown }).value !== "string"
		)
			throw new Error("Letta returned a malformed core-memory block");
		return {
			id: (item as { id: string }).id,
			label: (item as { label: string }).label,
			value: (item as { value: string }).value,
		};
	});
}

function toNativeMemory(item: LettaMemoryBlock): SemanticNativeMemory {
	return { nativeId: item.id, content: item.value };
}
