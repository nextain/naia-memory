import { describe, expect, it } from "vitest";
import { validateSemanticConfigurationParity } from "./semantic-execution-evidence.js";

describe("semantic execution provider parity", () => {
	it("verifies stable direct-comparator provider configuration", () => {
		const shared = {
			topK: 5,
			embeddingModel: "embedding-model",
			embeddingRevision: "embedding-revision",
			embeddingRevisionAuthority: "operator-asserted",
			configurationAuthority:
				"source-pin-matched-and-contacted-server-observed",
			embeddingDimensions: 768,
			llmModel: "llm-model",
			authScheme: "bearer",
			endpoint: "https://provider.example/v1/",
			endpointRouteHmacSha256: "e".repeat(64),
			endpointRouteBindingPolicy:
				"independent-key-hmac-sha256-observed-openai-embedding-route-v3",
		};
		expect(() =>
			validateSemanticConfigurationParity([
				{ ...shared, engine: "naia", executionSeed: "naia-1" },
				{ ...shared, engine: "naia", executionSeed: "naia-2" },
				{ ...shared, engine: "mem0", executionSeed: "mem0-1" },
				{ ...shared, engine: "mem0", executionSeed: "mem0-2" },
				{
					...shared,
					engine: "plain-vector",
					executionSeed: "plain-vector-1",
					inferencePolicy: "embedding-only-no-llm-v1",
					mutationAuthorizationPolicy: "none-immutable-turn-baseline-v1",
					llmModel: undefined,
				},
			]),
		).not.toThrow();
	});

	it("rejects every plain-vector embedding parity mismatch", () => {
		const shared = {
			topK: 5,
			embeddingModel: "embedding-model",
			embeddingRevision: "embedding-revision",
			embeddingDimensions: 768,
			authScheme: "bearer",
			endpoint: "https://provider.example",
			endpointRouteHmacSha256: "e".repeat(64),
			endpointRouteBindingPolicy:
				"independent-key-hmac-sha256-observed-openai-embedding-route-v3",
		};
		for (const [field, changed] of [
			["topK", 6],
			["embeddingModel", "other-model"],
			["embeddingRevision", "other-revision"],
			["embeddingDimensions", 384],
			["authScheme", "other-auth"],
			["endpoint", "https://other.example"],
			["endpointRouteHmacSha256", "f".repeat(64)],
			["endpointRouteBindingPolicy", "other-policy"],
		] as const) {
			expect(() =>
				validateSemanticConfigurationParity(
					[
						{
							...shared,
							engine: "naia",
							executionSeed: "naia",
							llmModel: "llm",
						},
						{
							...shared,
							engine: "plain-vector",
							executionSeed: "plain-vector",
							inferencePolicy: "embedding-only-no-llm-v1",
							mutationAuthorizationPolicy: "none-immutable-turn-baseline-v1",
							[field]: changed,
						},
					],
					{ requireRouteBinding: true },
				),
			).toThrow(
				field === "endpointRouteBindingPolicy"
					? "configuration disclosure is incomplete"
					: "provider parity mismatch",
			);
		}
	});
});
