import { afterEach, describe, expect, it, vi } from "vitest";
import { parseSemanticRawCliArgs, providerConfig } from "./semantic-raw-cli.js";

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
});
