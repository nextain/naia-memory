import { afterEach, describe, expect, it, vi } from "vitest";
import {
	graphitiRuntimeConfig,
	hindsightRuntimeConfig,
	lettaRuntimeConfig,
	parseSemanticRawCliArgs,
	providerConfig,
} from "./semantic-raw-cli.js";

afterEach(() => vi.unstubAllEnvs());

describe("semantic raw CLI", () => {
	it("parses an explicit reproducible execution request", () => {
		expect(
			parseSemanticRawCliArgs([
				"--engine=naia",
				"--contract=contract.json",
				"--output=receipt.json",
				"--top-k=7",
			]),
		).toEqual({
			engine: "naia",
			contractPath: "contract.json",
			outputPath: "receipt.json",
			topK: 7,
			executionSeed: undefined,
		});
	});

	it("accepts an explicit reproducible execution seed", () => {
		expect(
			parseSemanticRawCliArgs([
				"--engine=naia",
				"--contract=contract.json",
				"--output=receipt.json",
				"--seed=held-out-run-1",
			]),
		).toMatchObject({ executionSeed: "held-out-run-1" });
	});

	it("accepts Hindsight as an equivalent natural-language engine", () => {
		expect(
			parseSemanticRawCliArgs([
				"--engine=hindsight",
				"--contract=contract.json",
				"--output=receipt.json",
			]),
		).toMatchObject({ engine: "hindsight" });
	});

	it("binds the complete Hindsight LLM and embedding runtime", () => {
		vi.stubEnv("HINDSIGHT_ENGINE_VERSION", "0.4.0");
		vi.stubEnv("HINDSIGHT_IMAGE_DIGEST", `sha256:${"a".repeat(64)}`);
		vi.stubEnv("HINDSIGHT_LLM_PROVIDER", "gemini");
		vi.stubEnv("HINDSIGHT_LLM_MODEL", "gemini-2.5-flash");
		vi.stubEnv("HINDSIGHT_EMBEDDING_PROVIDER", "local");
		vi.stubEnv("HINDSIGHT_EMBEDDING_MODEL", "BAAI/bge-small-en-v1.5");
		vi.stubEnv("HINDSIGHT_EMBEDDING_REVISION", "model-revision");
		vi.stubEnv("HINDSIGHT_EMBEDDING_DIMENSIONS", "384");

		expect(hindsightRuntimeConfig()).toEqual({
			version: "0.4.0",
			imageDigest: `sha256:${"a".repeat(64)}`,
			llmProvider: "gemini",
			llmModel: "gemini-2.5-flash",
			embeddingProvider: "local",
			embeddingModel: "BAAI/bge-small-en-v1.5",
			embeddingRevision: "model-revision",
			embeddingDimensions: 384,
		});
	});

	it("rejects incomplete or invalid Hindsight embedding evidence", () => {
		vi.stubEnv("HINDSIGHT_ENGINE_VERSION", "0.4.0");
		vi.stubEnv("HINDSIGHT_IMAGE_DIGEST", `sha256:${"a".repeat(64)}`);
		vi.stubEnv("HINDSIGHT_LLM_PROVIDER", "gemini");
		vi.stubEnv("HINDSIGHT_LLM_MODEL", "gemini-2.5-flash");
		vi.stubEnv("HINDSIGHT_EMBEDDING_PROVIDER", "local");
		vi.stubEnv("HINDSIGHT_EMBEDDING_MODEL", "BAAI/bge-small-en-v1.5");
		vi.stubEnv("HINDSIGHT_EMBEDDING_REVISION", "model-revision");
		expect(() => hindsightRuntimeConfig()).toThrow(
			"positive HINDSIGHT_EMBEDDING_DIMENSIONS",
		);
		vi.stubEnv("HINDSIGHT_EMBEDDING_DIMENSIONS", "0");
		expect(() => hindsightRuntimeConfig()).toThrow(
			"positive HINDSIGHT_EMBEDDING_DIMENSIONS",
		);
		vi.stubEnv("HINDSIGHT_EMBEDDING_DIMENSIONS", "384");
		for (const [name, value] of [
			["HINDSIGHT_EMBEDDING_PROVIDER", "local"],
			["HINDSIGHT_EMBEDDING_MODEL", "BAAI/bge-small-en-v1.5"],
			["HINDSIGHT_EMBEDDING_REVISION", "model-revision"],
		] as const) {
			vi.stubEnv(name, "");
			expect(() => hindsightRuntimeConfig()).toThrow(name);
			vi.stubEnv(name, value);
		}
	});

	it("accepts Graphiti as a temporal graph memory engine", () => {
		expect(
			parseSemanticRawCliArgs([
				"--engine=graphiti",
				"--contract=contract.json",
				"--output=receipt.json",
			]),
		).toMatchObject({ engine: "graphiti" });
	});

	it("binds Graphiti embedding provider, model, revision, and dimensions", () => {
		vi.stubEnv("GRAPHITI_REVISION", "993e081a6d7948a0d8851c12a5fbdbeb49fed862");
		vi.stubEnv("GRAPHITI_IMAGE_DIGEST", `sha256:${"b".repeat(64)}`);
		vi.stubEnv("GRAPHITI_CORE_VERSION", "0.28.2");
		vi.stubEnv("GRAPHITI_NEO4J_DRIVER_VERSION", "5.28.1");
		vi.stubEnv("GRAPHITI_PROVIDER_ADAPTER_VERSION", "google-genai@1.62.0");
		vi.stubEnv("GRAPHITI_LLM_MODEL", "gemini-2.5-flash");
		vi.stubEnv("GRAPHITI_EMBEDDING_PROVIDER", "gemini");
		vi.stubEnv("GRAPHITI_EMBEDDING_MODEL", "gemini-embedding-001");
		vi.stubEnv("GRAPHITI_EMBEDDING_REVISION", "provider-release-2026-08-01");
		vi.stubEnv("GRAPHITI_EMBEDDING_DIMENSIONS", "3072");
		vi.stubEnv("GRAPHITI_SERVER_LOCK_SHA256", "c".repeat(64));
		vi.stubEnv("GRAPHITI_DEPLOYED_SIDECAR_SHA256", "d".repeat(64));
		expect(graphitiRuntimeConfig()).toEqual({
			revision: "993e081a6d7948a0d8851c12a5fbdbeb49fed862",
			imageDigest: `sha256:${"b".repeat(64)}`,
			coreVersion: "0.28.2",
			neo4jDriverVersion: "5.28.1",
			providerAdapterVersion: "google-genai@1.62.0",
			llmModel: "gemini-2.5-flash",
			embeddingProvider: "gemini",
			embeddingModel: "gemini-embedding-001",
			embeddingRevision: "provider-release-2026-08-01",
			embeddingRevisionAuthority: "operator-asserted",
			embeddingDimensions: 3072,
			serverLockSha256: "c".repeat(64),
			deployedSidecarSha256: "d".repeat(64),
			configurationAuthority: "source-pinned-deployment-operator-attested",
		});
	});

	it("rejects incomplete Graphiti embedding identity", () => {
		vi.stubEnv("GRAPHITI_REVISION", "993e081a6d7948a0d8851c12a5fbdbeb49fed862");
		vi.stubEnv("GRAPHITI_IMAGE_DIGEST", `sha256:${"b".repeat(64)}`);
		vi.stubEnv("GRAPHITI_CORE_VERSION", "0.28.2");
		vi.stubEnv("GRAPHITI_NEO4J_DRIVER_VERSION", "5.28.1");
		vi.stubEnv("GRAPHITI_PROVIDER_ADAPTER_VERSION", "google-genai@1.62.0");
		vi.stubEnv("GRAPHITI_LLM_MODEL", "gemini-2.5-flash");
		vi.stubEnv("GRAPHITI_EMBEDDING_PROVIDER", "gemini");
		vi.stubEnv("GRAPHITI_EMBEDDING_MODEL", "gemini-embedding-001");
		vi.stubEnv("GRAPHITI_EMBEDDING_REVISION", "provider-release-2026-08-01");
		vi.stubEnv("GRAPHITI_EMBEDDING_DIMENSIONS", "3072");
		vi.stubEnv("GRAPHITI_SERVER_LOCK_SHA256", "c".repeat(64));
		vi.stubEnv("GRAPHITI_DEPLOYED_SIDECAR_SHA256", "d".repeat(64));
		for (const name of [
			"GRAPHITI_EMBEDDING_PROVIDER",
			"GRAPHITI_EMBEDDING_MODEL",
			"GRAPHITI_EMBEDDING_REVISION",
		] as const) {
			const restored = {
				GRAPHITI_EMBEDDING_PROVIDER: "gemini",
				GRAPHITI_EMBEDDING_MODEL: "gemini-embedding-001",
				GRAPHITI_EMBEDDING_REVISION: "provider-release-2026-08-01",
			}[name];
			vi.stubEnv(name, "");
			expect(() => graphitiRuntimeConfig()).toThrow(name);
			vi.stubEnv(name, restored);
		}
		vi.stubEnv("GRAPHITI_EMBEDDING_DIMENSIONS", "0");
		expect(() => graphitiRuntimeConfig()).toThrow(
			"positive GRAPHITI_EMBEDDING_DIMENSIONS",
		);
		vi.stubEnv("GRAPHITI_EMBEDDING_DIMENSIONS", "3072");
		vi.stubEnv("GRAPHITI_EMBEDDING_MODEL", "different-model");
		expect(() => graphitiRuntimeConfig()).toThrow(
			"GRAPHITI_EMBEDDING_MODEL does not match",
		);
		vi.stubEnv("GRAPHITI_EMBEDDING_MODEL", "gemini-embedding-001");
		vi.stubEnv("GRAPHITI_SERVER_LOCK_SHA256", "invalid");
		expect(() => graphitiRuntimeConfig()).toThrow(
			"GRAPHITI_SERVER_LOCK_SHA256 must be a sha256 hash",
		);
	});

	it("keeps Graphiti native historical search under a separate engine ID", () => {
		expect(
			parseSemanticRawCliArgs([
				"--engine=graphiti-historical",
				"--contract=contract.json",
				"--output=receipt.json",
			]),
		).toMatchObject({ engine: "graphiti-historical" });
	});

	it("accepts Letta as an agent-managed memory engine", () => {
		expect(
			parseSemanticRawCliArgs([
				"--engine=letta",
				"--contract=contract.json",
				"--output=receipt.json",
			]),
		).toMatchObject({ engine: "letta" });
	});

	it("binds Letta embedding provider, model, revision, and dimensions", () => {
		vi.stubEnv("LETTA_ENGINE_VERSION", "0.13.0");
		vi.stubEnv("LETTA_IMAGE_DIGEST", `sha256:${"d".repeat(64)}`);
		vi.stubEnv("LETTA_LLM_MODEL", "openai/gpt-4.1-mini");
		vi.stubEnv("LETTA_EMBEDDING_PROVIDER", "openai");
		vi.stubEnv("LETTA_EMBEDDING_MODEL", "text-embedding-3-small");
		vi.stubEnv("LETTA_EMBEDDING_REVISION", "provider-release-2026-08-01");
		vi.stubEnv("LETTA_EMBEDDING_DIMENSIONS", "1536");

		expect(lettaRuntimeConfig()).toEqual({
			version: "0.13.0",
			imageDigest: `sha256:${"d".repeat(64)}`,
			llmModel: "openai/gpt-4.1-mini",
			embeddingProvider: "openai",
			embeddingModel: "text-embedding-3-small",
			embeddingRevision: "provider-release-2026-08-01",
			embeddingDimensions: 1536,
		});
	});

	it("rejects incomplete Letta embedding identity", () => {
		vi.stubEnv("LETTA_ENGINE_VERSION", "0.13.0");
		vi.stubEnv("LETTA_IMAGE_DIGEST", `sha256:${"d".repeat(64)}`);
		vi.stubEnv("LETTA_LLM_MODEL", "openai/gpt-4.1-mini");
		vi.stubEnv("LETTA_EMBEDDING_PROVIDER", "openai");
		vi.stubEnv("LETTA_EMBEDDING_MODEL", "text-embedding-3-small");
		vi.stubEnv("LETTA_EMBEDDING_REVISION", "provider-release-2026-08-01");
		vi.stubEnv("LETTA_EMBEDDING_DIMENSIONS", "1536");
		for (const [name, value] of [
			["LETTA_EMBEDDING_PROVIDER", "openai"],
			["LETTA_EMBEDDING_MODEL", "text-embedding-3-small"],
			["LETTA_EMBEDDING_REVISION", "provider-release-2026-08-01"],
		] as const) {
			vi.stubEnv(name, "");
			expect(() => lettaRuntimeConfig()).toThrow(name);
			vi.stubEnv(name, value);
		}
		vi.stubEnv("LETTA_EMBEDDING_DIMENSIONS", "0");
		expect(() => lettaRuntimeConfig()).toThrow(
			"positive LETTA_EMBEDDING_DIMENSIONS",
		);
	});

	it("rejects a blank execution seed", () => {
		expect(() =>
			parseSemanticRawCliArgs([
				"--engine=naia",
				"--contract=contract.json",
				"--output=receipt.json",
				"--seed=  ",
			]),
		).toThrow("--seed must not be blank");
	});

	it("rejects unknown engines, malformed arguments, and invalid top-k", () => {
		expect(() =>
			parseSemanticRawCliArgs(["--engine=other", "--contract=x", "--output=y"]),
		).toThrow("--engine");
		expect(() => parseSemanticRawCliArgs(["engine=naia"])).toThrow(
			"invalid argument",
		);
		expect(() =>
			parseSemanticRawCliArgs([
				"--engine=mem0",
				"--contract=x",
				"--output=y",
				"--top-k=0",
			]),
		).toThrow("--top-k");
		expect(() =>
			parseSemanticRawCliArgs([
				"--engine=mem0",
				"--engine=naia",
				"--contract=x",
				"--output=y",
			]),
		).toThrow("duplicate argument: --engine");
		expect(() =>
			parseSemanticRawCliArgs([
				"--engine=mem0",
				"--contract=x",
				"--output=y",
				"--provider=hidden-default",
			]),
		).toThrow("unknown argument: --provider");
	});

	it("accepts an explicit shared OpenAI-compatible provider configuration", () => {
		vi.stubEnv("BENCHMARK_OPENAI_BASE_URL", "https://provider.example/v1");
		vi.stubEnv("BENCHMARK_OPENAI_API_KEY", "test-secret");
		vi.stubEnv("BENCHMARK_EMBEDDING_MODEL", "embed-model");
		vi.stubEnv("BENCHMARK_EMBEDDING_REVISION", "embed-revision");
		vi.stubEnv("BENCHMARK_EMBEDDING_DIMENSIONS", "768");
		vi.stubEnv("BENCHMARK_LLM_MODEL", "llm-model");
		vi.stubEnv("BENCHMARK_AUTH", "x-anyllm");

		expect(providerConfig()).toEqual({
			apiKey: "test-secret",
			baseURL: "https://provider.example/v1/",
			embeddingModel: "embed-model",
			embeddingRevision: "embed-revision",
			embeddingDimensions: 768,
			llmModel: "llm-model",
			auth: "x-anyllm",
		});
	});

	it("rejects incomplete or invalid shared provider configuration", () => {
		vi.stubEnv("BENCHMARK_OPENAI_BASE_URL", "https://provider.example/v1");
		expect(() => providerConfig()).toThrow("must be set together");
		vi.stubEnv("BENCHMARK_OPENAI_API_KEY", "test-secret");
		vi.stubEnv("BENCHMARK_EMBEDDING_DIMENSIONS", "0");
		expect(() => providerConfig()).toThrow("positive integer");
		vi.stubEnv("BENCHMARK_EMBEDDING_DIMENSIONS", "768");
		vi.stubEnv("BENCHMARK_AUTH", "unsupported");
		expect(() => providerConfig()).toThrow("must be bearer or x-anyllm");
	});

	it("requires an explicit embedding revision for competitive runs", () => {
		vi.stubEnv("BENCHMARK_OPENAI_BASE_URL", "https://provider.example/v1");
		vi.stubEnv("BENCHMARK_OPENAI_API_KEY", "test-secret");
		expect(() => providerConfig()).toThrow(
			"BENCHMARK_EMBEDDING_REVISION is required",
		);
	});

	it("requires an explicit embedding revision through the gateway", () => {
		vi.stubEnv("GATEWAY_URL", "https://gateway.example");
		vi.stubEnv("GATEWAY_MASTER_KEY", "test-secret");
		expect(() => providerConfig()).toThrow(
			"BENCHMARK_EMBEDDING_REVISION is required",
		);
	});

	it("requires an explicit embedding revision with direct Gemini", () => {
		vi.stubEnv("GEMINI_API_KEY", "test-secret");
		expect(() => providerConfig()).toThrow(
			"BENCHMARK_EMBEDDING_REVISION is required",
		);
	});
});
