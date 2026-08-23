import type {
	GraphitiNativeFact,
	GraphitiSemanticClient,
} from "./bridge-graphiti-semantic.js";

type FetchLike = typeof fetch;

export type GraphitiRestSemanticClientOptions = {
	baseUrl: string;
	fetch?: FetchLike;
	/** Graphiti's reference graph-service has no authentication. */
	allowUnsafeRemote?: boolean;
};

export class GraphitiRestSemanticClient implements GraphitiSemanticClient {
	private readonly baseUrl: URL;
	private readonly request: FetchLike;
	private readonly episodeIds = new Map<string, string>();

	constructor(options: GraphitiRestSemanticClientOptions) {
		this.baseUrl = normalizeBaseUrl(options.baseUrl);
		if (!options.allowUnsafeRemote && !isLoopback(this.baseUrl.hostname)) {
			throw new Error(
				"Graphiti benchmark service must be loopback-only unless explicitly overridden",
			);
		}
		this.request = options.fetch ?? fetch;
	}

	async addEpisode(input: {
		uuid: string;
		groupId: string;
		content: string;
		name: string;
		sourceDescription: string;
	}): Promise<void> {
		const value = await this.fetchJson("benchmark/messages", {
			method: "POST",
			body: JSON.stringify({
				group_id: input.groupId,
				content: input.content,
				uuid: input.uuid,
				name: input.name,
				timestamp: new Date().toISOString(),
				source_description: input.sourceDescription,
			}),
		});
		if (
			!isRecord(value) ||
			value.committed !== true ||
			typeof value.uuid !== "string" ||
			!value.uuid
		)
			throw new Error("Graphiti companion did not acknowledge episode commit");
		this.episodeIds.set(input.uuid, value.uuid);
	}

	async hasEpisode(input: {
		uuid: string;
		groupId: string;
	}): Promise<boolean> {
		const value = await this.fetchJson(
			`benchmark/episodes/${encodeURIComponent(input.groupId)}/${encodeURIComponent(this.episodeIds.get(input.uuid) ?? input.uuid)}`,
		);
		if (!isRecord(value) || typeof value.committed !== "boolean")
			throw new Error("Graphiti companion returned an invalid episode receipt");
		return value.committed;
	}

	async searchCurrentFacts(input: {
		query: string;
		groupIds: string[];
		maxFacts: number;
	}): Promise<GraphitiNativeFact[]> {
		const searchFacts = await this.searchFactsRaw(input);
		const currentFacts = (
			await Promise.all(
				input.groupIds.map((groupId) => this.listCurrentFacts(groupId)),
			)
		).flat();
		const currentById = new Map(
			currentFacts.map((fact) => [fact.uuid, fact.fact] as const),
		);
		return searchFacts.filter(
			(fact) => currentById.get(fact.uuid) === fact.fact,
		);
	}

	/** Unprojected Graphiti search output, used only for contamination audits. */
	async searchFactsRaw(input: {
		query: string;
		groupIds: string[];
		maxFacts: number;
	}): Promise<GraphitiNativeFact[]> {
		const value = await this.fetchJson("search", {
			method: "POST",
			body: JSON.stringify({
				query: input.query,
				group_ids: input.groupIds,
				max_facts: input.maxFacts,
			}),
		});
		return parseFacts(value, "search");
	}

	async listCurrentFacts(groupId: string): Promise<GraphitiNativeFact[]> {
		const value = await this.fetchJson(
			`benchmark/current-facts/${encodeURIComponent(groupId)}`,
		);
		return parseFacts(value, "current-facts");
	}

	async deleteGroup(groupId: string): Promise<void> {
		await this.fetchJson(`group/${encodeURIComponent(groupId)}`, {
			method: "DELETE",
		});
	}

	private async fetchJson(
		path: string,
		init: RequestInit = {},
	): Promise<unknown> {
		const headers = new Headers(init.headers);
		if (init.body !== undefined)
			headers.set("content-type", "application/json");
		const response = await this.request(new URL(path, this.baseUrl), {
			...init,
			headers,
		});
		if (!response.ok) {
			const detail = (await response.text()).slice(0, 500);
			throw new Error(
				`Graphiti request failed (${response.status} ${response.statusText}): ${detail}`,
			);
		}
		return response.json();
	}
}

function normalizeBaseUrl(value: string): URL {
	const url = new URL(value);
	if (url.protocol !== "http:" && url.protocol !== "https:")
		throw new Error("Graphiti base URL must use HTTP or HTTPS");
	if (!url.pathname.endsWith("/")) url.pathname += "/";
	return url;
}

function isLoopback(hostname: string): boolean {
	return (
		hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]"
	);
}

function parseFacts(value: unknown, surface: string): GraphitiNativeFact[] {
	if (!isRecord(value) || !Array.isArray(value.facts))
		throw new Error(`Graphiti ${surface} response is invalid`);
	return value.facts.map((fact) => {
		if (
			!isRecord(fact) ||
			typeof fact.uuid !== "string" ||
			!fact.uuid.trim() ||
			typeof fact.fact !== "string" ||
			!fact.fact.trim()
		)
			throw new Error(`Graphiti ${surface} returned an invalid fact`);
		return { uuid: fact.uuid, fact: fact.fact };
	});
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}
