import { randomUUID } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { LocalAdapter } from "../../memory/adapters/local.js";
import { GeminiFlashLiteContradictionFilter } from "../../memory/contradiction-filter.js";
import { OpenAICompatEmbeddingProvider } from "../../memory/embeddings.js";
import { buildLLMDeleteVerifier } from "../../memory/llm-delete-verifier.js";
import { buildLLMFactExtractor } from "../../memory/llm-fact-extractor.js";
import { benchmarkReceipt } from "../provenance.js";
import { createHindsightSemanticBridge } from "./bridge-hindsight-semantic.js";
import { createLettaSemanticBridge } from "./bridge-letta-semantic.js";
import { createMem0SemanticBridge } from "./bridge-mem0-semantic.js";
import { createNaiaSemanticBridge } from "./bridge-naia-semantic.js";
import { runSemanticRawContract } from "./memory-semantic-runner.js";
import {
	type MemoryUpdateContract,
	validateMemoryUpdateContract,
} from "./memory-update-contract.js";

export type SemanticEngine = "hindsight" | "letta" | "mem0" | "naia";
export type SemanticRawCliArgs = {
	engine: SemanticEngine;
	contractPath: string;
	outputPath: string;
	topK: number;
	executionSeed?: string;
};

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/openai/";

export function parseSemanticRawCliArgs(args: string[]): SemanticRawCliArgs {
	const values = new Map<string, string>();
	for (const arg of args) {
		const match = /^--([^=]+)=(.+)$/.exec(arg);
		if (!match) throw new Error(`invalid argument: ${arg}`);
		if (!["engine", "contract", "output", "top-k", "seed"].includes(match[1]))
			throw new Error(`unknown argument: --${match[1]}`);
		if (values.has(match[1]))
			throw new Error(`duplicate argument: --${match[1]}`);
		values.set(match[1], match[2]);
	}
	const engine = values.get("engine");
	if (
		engine !== "hindsight" &&
		engine !== "letta" &&
		engine !== "mem0" &&
		engine !== "naia"
	)
		throw new Error("--engine must be hindsight, letta, mem0, or naia");
	const contractPath = values.get("contract");
	const outputPath = values.get("output");
	if (!contractPath || !outputPath)
		throw new Error("--contract and --output are required");
	const topK = Number(values.get("top-k") ?? "5");
	if (!Number.isInteger(topK) || topK < 1)
		throw new Error("--top-k must be a positive integer");
	const executionSeed = values.get("seed");
	if (executionSeed !== undefined && !executionSeed.trim())
		throw new Error("--seed must not be blank");
	return { engine, contractPath, outputPath, topK, executionSeed };
}

function discloseEndpoint(baseURL: string): string {
	const endpoint = new URL(baseURL);
	if (
		endpoint.username ||
		endpoint.password ||
		endpoint.search ||
		endpoint.hash
	)
		throw new Error(
			"provider endpoint must not contain credentials, query, or fragment",
		);
	return `${endpoint.origin}${endpoint.pathname}`;
}

export function providerConfig() {
	const configuredBaseURL = process.env.BENCHMARK_OPENAI_BASE_URL;
	const configuredApiKey = process.env.BENCHMARK_OPENAI_API_KEY;
	if (configuredBaseURL || configuredApiKey) {
		if (!configuredBaseURL || !configuredApiKey)
			throw new Error(
				"BENCHMARK_OPENAI_BASE_URL and BENCHMARK_OPENAI_API_KEY must be set together",
			);
		const dimensions = Number(
			process.env.BENCHMARK_EMBEDDING_DIMENSIONS ?? "1536",
		);
		if (!Number.isInteger(dimensions) || dimensions < 1)
			throw new Error(
				"BENCHMARK_EMBEDDING_DIMENSIONS must be a positive integer",
			);
		const embeddingModel =
			process.env.BENCHMARK_EMBEDDING_MODEL ?? "text-embedding-3-small";
		const auth = process.env.BENCHMARK_AUTH ?? "bearer";
		if (auth !== "bearer" && auth !== "x-anyllm")
			throw new Error("BENCHMARK_AUTH must be bearer or x-anyllm");
		return {
			apiKey: configuredApiKey,
			baseURL: configuredBaseURL.endsWith("/")
				? configuredBaseURL
				: `${configuredBaseURL}/`,
			embeddingModel,
			embeddingRevision:
				process.env.BENCHMARK_EMBEDDING_REVISION ?? embeddingModel,
			embeddingDimensions: dimensions,
			llmModel: process.env.BENCHMARK_LLM_MODEL ?? "gpt-4.1-mini",
			auth,
		};
	}
	const gatewayUrl = process.env.GATEWAY_URL?.replace(/\/+$/, "");
	const gatewayKey = process.env.GATEWAY_MASTER_KEY;
	if (gatewayUrl && gatewayKey)
		return {
			apiKey: gatewayKey,
			baseURL: `${gatewayUrl}/v1/`,
			embeddingModel: "vertexai:gemini-embedding-001",
			embeddingRevision: "gemini-embedding-001",
			embeddingDimensions: 3072,
			llmModel: process.env.BENCHMARK_LLM_MODEL ?? "vertexai:gemini-2.5-flash",
			auth: "bearer" as const,
		};
	const apiKey = process.env.GEMINI_API_KEY;
	if (!apiKey)
		throw new Error("GEMINI_API_KEY or gateway credentials are required");
	return {
		apiKey,
		baseURL: GEMINI_BASE,
		embeddingModel: "gemini-embedding-001",
		embeddingRevision: "gemini-embedding-001",
		embeddingDimensions: 3072,
		llmModel: process.env.BENCHMARK_LLM_MODEL ?? "gemini-2.5-flash",
		auth: "bearer" as const,
	};
}

export async function runSemanticRawCli(args: string[]): Promise<void> {
	const parsed = parseSemanticRawCliArgs(args);
	const contractPath = resolve(parsed.contractPath);
	const outputPath = resolve(parsed.outputPath);
	if (existsSync(outputPath)) throw new Error("output path already exists");
	const contract = JSON.parse(
		readFileSync(contractPath, "utf8"),
	) as MemoryUpdateContract;
	validateMemoryUpdateContract(contract);
	const provider =
		parsed.engine === "hindsight" || parsed.engine === "letta"
			? undefined
			: providerConfig();
	const requireProvider = () => {
		if (!provider)
			throw new Error("semantic provider configuration is unavailable");
		return provider;
	};
	const runId = randomUUID();
	const executionSeed = parsed.executionSeed ?? runId;
	const workPrefix = resolve(".agents/work/semantic-raw", runId);
	const createBridge =
		parsed.engine === "naia"
			? async () => {
					const configuredProvider = requireProvider();
					return createNaiaSemanticBridge({
						storePath: `${workPrefix}-naia.json`,
						embeddingProvider: new OpenAICompatEmbeddingProvider(
							configuredProvider.baseURL,
							configuredProvider.apiKey,
							configuredProvider.embeddingModel,
							configuredProvider.embeddingDimensions,
							configuredProvider.embeddingRevision,
						),
						factExtractor: buildLLMFactExtractor({
							apiKey: configuredProvider.apiKey,
							baseURL: configuredProvider.baseURL,
							model: configuredProvider.llmModel,
							auth: configuredProvider.auth,
							failurePolicy: "throw",
						}),
						deleteVerifier: buildLLMDeleteVerifier({
							apiKey: configuredProvider.apiKey,
							baseURL: configuredProvider.baseURL,
							model: configuredProvider.llmModel,
							auth: configuredProvider.auth,
						}),
						contradictionFilter: new GeminiFlashLiteContradictionFilter({
							apiKey: configuredProvider.apiKey,
							baseURL: configuredProvider.baseURL,
							model: configuredProvider.llmModel,
						}),
					});
				}
			: parsed.engine === "mem0"
				? async () => {
						const configuredProvider = requireProvider();
						return createMem0SemanticBridge({
							userIdPrefix: `semantic-${runId}`,
							mem0Config: {
								embedder: {
									provider: "openai",
									config: {
										apiKey: configuredProvider.apiKey,
										baseURL: configuredProvider.baseURL,
										model: configuredProvider.embeddingModel,
									},
								},
								vectorStore: {
									provider: "memory",
									config: {
										collectionName: `semantic-${runId}`,
										dimension: configuredProvider.embeddingDimensions,
										dbPath: `${workPrefix}-mem0-vector.db`,
									},
								},
								llm: {
									provider: "openai",
									config: {
										apiKey: configuredProvider.apiKey,
										baseURL: configuredProvider.baseURL,
										model: configuredProvider.llmModel,
									},
								},
								historyDbPath: `${workPrefix}-mem0-history.db`,
							},
						});
					}
				: parsed.engine === "letta"
					? async () =>
							createLettaSemanticBridge({
								baseUrl: process.env.LETTA_URL ?? "http://127.0.0.1:8283",
								apiKey: process.env.LETTA_API_KEY,
								model: process.env.LETTA_LLM_MODEL ?? "openai/gpt-4.1-mini",
								embeddingModel:
									process.env.LETTA_EMBEDDING_MODEL ?? "text-embedding-3-small",
								embeddingDimensions: Number(
									process.env.LETTA_EMBEDDING_DIMENSIONS ?? "1536",
								),
								embeddingEndpoint: process.env.LETTA_EMBEDDING_ENDPOINT,
							})
					: async () =>
							createHindsightSemanticBridge({
								baseUrl: process.env.HINDSIGHT_URL ?? "http://127.0.0.1:18888",
								bankIdPrefix: `semantic-${runId}`,
								apiKey: process.env.HINDSIGHT_API_KEY,
							});
	const receipts = await runSemanticRawContract(
		contract,
		createBridge,
		parsed.topK,
		executionSeed,
	);
	const hindsightEndpoint =
		process.env.HINDSIGHT_URL ?? "http://127.0.0.1:18888";
	const lettaEndpoint = process.env.LETTA_URL ?? "http://127.0.0.1:8283";
	const hindsightRuntime = () => {
		const version = process.env.HINDSIGHT_ENGINE_VERSION?.trim();
		const imageDigest = process.env.HINDSIGHT_IMAGE_DIGEST?.trim();
		const llmProvider = process.env.HINDSIGHT_LLM_PROVIDER?.trim();
		const llmModel = process.env.HINDSIGHT_LLM_MODEL?.trim();
		if (!version || !imageDigest || !llmProvider || !llmModel)
			throw new Error(
				"Hindsight runs require HINDSIGHT_ENGINE_VERSION, HINDSIGHT_IMAGE_DIGEST, HINDSIGHT_LLM_PROVIDER, and HINDSIGHT_LLM_MODEL",
			);
		if (!/^sha256:[a-f0-9]{64}$/.test(imageDigest))
			throw new Error(
				"HINDSIGHT_IMAGE_DIGEST must be an immutable sha256 digest",
			);
		return { version, imageDigest, llmProvider, llmModel };
	};
	const lettaRuntime = () => {
		const version = process.env.LETTA_ENGINE_VERSION?.trim();
		const imageDigest = process.env.LETTA_IMAGE_DIGEST?.trim();
		const llmModel = process.env.LETTA_LLM_MODEL?.trim();
		const embeddingModel = process.env.LETTA_EMBEDDING_MODEL?.trim();
		const embeddingDimensions = Number(process.env.LETTA_EMBEDDING_DIMENSIONS);
		if (
			!version ||
			!imageDigest ||
			!llmModel ||
			!embeddingModel ||
			!Number.isInteger(embeddingDimensions) ||
			embeddingDimensions < 1
		)
			throw new Error(
				"Letta runs require LETTA_ENGINE_VERSION, LETTA_IMAGE_DIGEST, LETTA_LLM_MODEL, LETTA_EMBEDDING_MODEL, and positive LETTA_EMBEDDING_DIMENSIONS",
			);
		if (!/^sha256:[a-f0-9]{64}$/.test(imageDigest))
			throw new Error("LETTA_IMAGE_DIGEST must be an immutable sha256 digest");
		return {
			version,
			imageDigest,
			llmModel,
			embeddingModel,
			embeddingDimensions,
		};
	};
	const disclosure = {
		engine: parsed.engine,
		topK: parsed.topK,
		executionSeed,
		mutationAuthorizationPolicy:
			parsed.engine === "naia"
				? "independent-llm-delete-verifier-fail-closed-v1"
				: "engine-native-mutation-policy-v1",
		...(provider
			? {
					embeddingModel: provider.embeddingModel,
					embeddingRevision: provider.embeddingRevision,
					embeddingDimensions: provider.embeddingDimensions,
					llmModel: provider.llmModel,
					authScheme: provider.auth,
					endpoint: discloseEndpoint(provider.baseURL),
				}
			: parsed.engine === "letta"
				? {
						providerPolicy: "engine-server-native-configuration-v1",
						ingestionSurface: "agent-user-message-v1",
						stateObservationPolicy:
							"full-nonpersona-core-state-no-query-ranking-v1",
						endpoint: discloseEndpoint(lettaEndpoint),
						lettaRuntime: lettaRuntime(),
					}
				: {
						providerPolicy: "engine-server-native-configuration-v1",
						endpoint: discloseEndpoint(hindsightEndpoint),
						hindsightRuntime: hindsightRuntime(),
					}),
	};
	const output = {
		schemaVersion: "naia-memory-semantic-raw-artifact-v2",
		interpretation:
			"Unscored engine-native semantic memories and retrievals; not quality evidence by itself.",
		receipt: benchmarkReceipt([contractPath], disclosure, [
			"src/benchmark/quality/semantic-raw-cli.ts",
			"src/benchmark/quality/memory-semantic-runner.ts",
			`src/benchmark/quality/bridge-${parsed.engine}-semantic.ts`,
		]),
		disclosure,
		cases: receipts,
	};
	mkdirSync(dirname(outputPath), { recursive: true });
	const temporaryPath = `${outputPath}.${randomUUID()}.tmp`;
	writeFileSync(temporaryPath, `${JSON.stringify(output, null, 2)}\n`, {
		flag: "wx",
		mode: 0o600,
	});
	renameSync(temporaryPath, outputPath);
	process.stdout.write(`${outputPath}\n`);
}

const invokedPath = process.argv[1]
	? pathToFileURL(resolve(process.argv[1])).href
	: undefined;
if (invokedPath === import.meta.url)
	runSemanticRawCli(process.argv.slice(2)).catch((error) => {
		const message =
			error instanceof Error ? error.message : "semantic raw run failed";
		const cause =
			error instanceof Error && error.cause instanceof Error
				? `: ${error.cause.message}`
				: "";
		process.stderr.write(`${message}${cause}\n`);
		process.exitCode = 1;
	});
