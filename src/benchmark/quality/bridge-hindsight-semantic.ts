import { randomUUID } from "node:crypto";
import type {
	SemanticEngineBridge,
	SemanticIngestReceipt,
	SemanticNativeMemory,
} from "./memory-semantic-runner.js";

type HindsightMemory = { id: string; text: string };
type HindsightRetainResponse = {
	success: boolean;
	items_count: number;
};

export type HindsightSemanticFactoryOptions = {
	baseUrl: string;
	bankIdPrefix: string;
	apiKey?: string;
};

export function createHindsightSemanticBridge(
	options: HindsightSemanticFactoryOptions,
): Promise<HindsightSemanticBridge> {
	if (!options.bankIdPrefix.trim())
		throw new Error("Hindsight semantic bank ID prefix is invalid");
	return Promise.resolve(
		new HindsightSemanticBridge(
			options.baseUrl,
			`${options.bankIdPrefix}-${randomUUID()}`,
			options.apiKey,
		),
	);
}

/** Uses Hindsight's normal synchronous retain/recall path with no fixture metadata. */
export class HindsightSemanticBridge implements SemanticEngineBridge {
	readonly isolationPolicy = "fresh-case-state-v1" as const;
	readonly identityPolicy = "engine-native-memory-v1" as const;
	readonly ingestionPolicy = "sequential-turn-commit-v1" as const;
	readonly temporalInputPolicy = "engine-default-ingest-time-v1" as const;
	readonly retrievalSurface = "engine-native-semantic-memory-v1" as const;

	constructor(
		private readonly baseUrl: string,
		private readonly bankId: string,
		private readonly apiKey?: string,
	) {
		const endpoint = new URL(baseUrl);
		if (
			endpoint.username ||
			endpoint.password ||
			endpoint.search ||
			endpoint.hash
		)
			throw new Error("Hindsight endpoint must not contain credentials");
		if (!bankId.trim()) throw new Error("Hindsight bank ID is invalid");
		this.baseUrl = baseUrl.replace(/\/+$/, "");
	}

	private async request(
		path: string,
		init?: RequestInit,
		allowedStatuses: readonly number[] = [],
	): Promise<unknown> {
		const response = await fetch(`${this.baseUrl}${path}`, {
			...init,
			headers: {
				...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}),
				...(init?.body ? { "content-type": "application/json" } : {}),
			},
			signal: AbortSignal.timeout(30 * 60 * 1000),
		});
		if (!response.ok && !allowedStatuses.includes(response.status))
			throw new Error(
				`${init?.method ?? "GET"} ${path} failed (${response.status}): ${(await response.text()).slice(0, 300)}`,
			);
		if (response.status === 204) return undefined;
		return response.json();
	}

	async ingestTurn(turn: { content: string }): Promise<SemanticIngestReceipt> {
		const response = (await this.request(
			`/v1/default/banks/${encodeURIComponent(this.bankId)}/memories`,
			{
				method: "POST",
				body: JSON.stringify({
					async: false,
					items: [{ content: turn.content }],
				}),
			},
		)) as HindsightRetainResponse;
		if (!response.success || !Number.isInteger(response.items_count))
			throw new Error("Hindsight retain returned an invalid native receipt");
		return {
			outcome: "native-operations",
			nativeOperationCount: response.items_count,
		};
	}

	async search(query: string, topK: number): Promise<SemanticNativeMemory[]> {
		const response = (await this.request(
			`/v1/default/banks/${encodeURIComponent(this.bankId)}/memories/recall`,
			{
				method: "POST",
				body: JSON.stringify({
					query,
					budget: "high",
					max_tokens: 4096,
					types: ["world", "experience", "observation"],
					prefer_observations: true,
				}),
			},
		)) as { results: HindsightMemory[] };
		if (!Array.isArray(response.results))
			throw new Error("Hindsight recall returned invalid results");
		return response.results.slice(0, topK).map(toNativeMemory);
	}

	async getNativeState(): Promise<SemanticNativeMemory[]> {
		const output: SemanticNativeMemory[] = [];
		for (let offset = 0; ; offset += 100) {
			const response = (await this.request(
				`/v1/default/banks/${encodeURIComponent(this.bankId)}/memories/list?limit=100&offset=${offset}`,
			)) as { items: HindsightMemory[]; total: number };
			if (!Array.isArray(response.items) || !Number.isInteger(response.total))
				throw new Error("Hindsight memory list returned invalid results");
			output.push(...response.items.map(toNativeMemory));
			if (output.length >= response.total || response.items.length === 0)
				return output;
		}
	}

	async close(): Promise<void> {
		await this.request(
			`/v1/default/banks/${encodeURIComponent(this.bankId)}`,
			{ method: "DELETE" },
			[404],
		);
	}
}

function toNativeMemory(item: HindsightMemory): SemanticNativeMemory {
	if (typeof item.id !== "string" || typeof item.text !== "string")
		throw new Error("Hindsight returned an invalid native memory");
	return { nativeId: item.id, content: item.text };
}
