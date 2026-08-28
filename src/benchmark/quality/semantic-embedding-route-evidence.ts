import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { openAICompatEmbeddingEndpoint } from "../../memory/embeddings.js";

export function assertBenchmarkEmbeddingBaseURL(baseURL: string): void {
	const endpoint = new URL(baseURL);
	if (
		!/^https?:$/.test(endpoint.protocol) ||
		endpoint.username ||
		endpoint.password ||
		endpoint.search ||
		endpoint.hash
	)
		throw new Error(
			"benchmark provider endpoint must use HTTP(S) without credentials, query, or fragment",
		);
	const path = endpoint.pathname.replace(/\/+$/, "");
	if (!/\/(?:v1|openai)$/.test(path))
		throw new Error(
			"benchmark OpenAI-compatible base URL must end in /v1 or /openai so every engine uses the same embedding route",
		);
}

export function benchmarkEvidenceHmacKey(operationalKey: string): string {
	const key = process.env.BENCHMARK_EVIDENCE_HMAC_KEY;
	if (!key || Buffer.byteLength(key) < 32)
		throw new Error(
			"BENCHMARK_EVIDENCE_HMAC_KEY must be an independent secret of at least 32 bytes",
		);
	const evidenceBytes = Buffer.from(key);
	const operationalBytes = Buffer.from(operationalKey);
	if (
		evidenceBytes.length === operationalBytes.length &&
		timingSafeEqual(evidenceBytes, operationalBytes)
	)
		throw new Error(
			"BENCHMARK_EVIDENCE_HMAC_KEY must differ from the operational provider API key",
		);
	return key;
}

export function endpointRouteHmacSha256(
	route: string,
	evidenceKey: string,
): string {
	return createHmac("sha256", evidenceKey).update(route).digest("hex");
}

export interface SemanticProviderDisclosureConfig {
	baseURL: string;
	apiKey: string;
	embeddingModel: string;
	embeddingRevision: string;
	embeddingDimensions: number;
	auth: string;
	llmModel: string;
}

export function discloseServerEndpoint(baseURL: string) {
	const endpoint = new URL(baseURL);
	if (endpoint.username || endpoint.password || endpoint.search || endpoint.hash)
		throw new Error(
			"engine endpoint must not contain credentials, query, or fragment",
		);
	const evidenceKey = process.env.BENCHMARK_EVIDENCE_HMAC_KEY?.trim();
	return {
		endpoint: endpoint.origin,
		...(evidenceKey && Buffer.byteLength(evidenceKey) >= 32
			? {
					endpointPathHmacSha256: createHmac("sha256", evidenceKey)
						.update(endpoint.pathname)
						.digest("hex"),
					endpointPathBindingPolicy:
						"independent-key-hmac-sha256-redacted-path-v1",
				}
			: {}),
	};
}

export function semanticProviderDisclosure(
	engine: string,
	provider: SemanticProviderDisclosureConfig,
	observedEmbeddingRoute: string,
) {
	if (observedEmbeddingRoute !== openAICompatEmbeddingEndpoint(provider.baseURL))
		throw new Error("observed embedding route does not match provider base URL");
	const evidenceKey = process.env.BENCHMARK_EVIDENCE_HMAC_KEY?.trim();
	const routeBinding = evidenceKey
		? {
				endpointRouteHmacSha256: endpointRouteHmacSha256(
					observedEmbeddingRoute,
					benchmarkEvidenceHmacKey(provider.apiKey),
				),
				endpointRouteBindingPolicy:
					"independent-key-hmac-sha256-observed-openai-embedding-route-v3",
			}
		: {
				endpointRouteSha256: createHash("sha256")
					.update(observedEmbeddingRoute)
					.digest("hex"),
				endpointRouteBindingPolicy:
					"unkeyed-sha256-observed-openai-embedding-route-v1",
			};
	const embeddingDisclosure = {
		embeddingModel: provider.embeddingModel,
		embeddingRevision: provider.embeddingRevision,
		embeddingDimensions: provider.embeddingDimensions,
		authScheme: provider.auth,
		endpoint: new URL(provider.baseURL).origin,
		...routeBinding,
	};
	return engine === "plain-vector"
		? {
				...embeddingDisclosure,
				inferencePolicy: "embedding-only-no-llm-v1" as const,
			}
		: { ...embeddingDisclosure, llmModel: provider.llmModel };
}

export function createEmbeddingRouteObserver(
	baseURL: string,
	delegate: typeof fetch,
) {
	const configured = new URL(baseURL);
	if (
		!/^https?:$/.test(configured.protocol) ||
		configured.username ||
		configured.password ||
		configured.search ||
		configured.hash
	)
		throw new Error(
			"benchmark provider endpoint must use HTTP(S) without credentials, query, or fragment",
		);
	const expectedRoute = openAICompatEmbeddingEndpoint(baseURL);
	const observedRoutes = new Set<string>();
	const observedFetch: typeof fetch = async (input, init) => {
		const rawUrl =
			typeof input === "string"
				? input
				: input instanceof URL
					? input.href
					: input.url;
		const url = new URL(rawUrl);
		const isEmbedding = url.pathname.replace(/\/+$/, "").endsWith("/embeddings");
		if (isEmbedding) {
			url.search = "";
			url.hash = "";
			observedRoutes.add(url.href);
		}
		const response = await delegate(
			input,
			isEmbedding ? { ...init, redirect: "manual" } : init,
		);
		if (isEmbedding && response.status >= 300 && response.status < 400)
			throw new Error(
				"benchmark embedding route observation rejects redirects",
			);
		return response;
	};
	return {
		fetch: observedFetch,
		assertObservedRoute(): string {
			if (observedRoutes.size !== 1 || !observedRoutes.has(expectedRoute))
				throw new Error(
					`benchmark embedding route observation mismatch: expected exactly one configured OpenAI-compatible embedding route (observedRouteCount=${observedRoutes.size}, expectedRouteObserved=${observedRoutes.has(expectedRoute)})`,
				);
			return expectedRoute;
		},
	};
}
