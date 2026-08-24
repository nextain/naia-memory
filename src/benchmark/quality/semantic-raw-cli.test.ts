import { afterEach, describe, expect, it, vi } from "vitest";
import {
	hindsightRuntimeConfig,
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
