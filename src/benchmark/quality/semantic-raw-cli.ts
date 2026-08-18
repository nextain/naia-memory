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
import { OpenAICompatEmbeddingProvider } from "../../memory/embeddings.js";
import { buildLLMFactExtractor } from "../../memory/llm-fact-extractor.js";
import { benchmarkReceipt } from "../provenance.js";
import { createMem0SemanticBridge } from "./bridge-mem0-semantic.js";
import { createNaiaSemanticBridge } from "./bridge-naia-semantic.js";
import type { MemoryUpdateContract } from "./memory-update-contract.js";
import { runSemanticRawContract } from "./memory-semantic-runner.js";

type Engine = "mem0" | "naia";
export type SemanticRawCliArgs = {
	engine: Engine;
	contractPath: string;
	outputPath: string;
	topK: number;
};

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/openai/";

export function parseSemanticRawCliArgs(args: string[]): SemanticRawCliArgs {
	const values = new Map<string, string>();
	for (const arg of args) {
		const match = /^--([^=]+)=(.+)$/.exec(arg);
		if (!match) throw new Error(`invalid argument: ${arg}`);
		if (!["engine", "contract", "output", "top-k"].includes(match[1]))
			throw new Error(`unknown argument: --${match[1]}`);
		if (values.has(match[1]))
			throw new Error(`duplicate argument: --${match[1]}`);
		values.set(match[1], match[2]);
	}
	const engine = values.get("engine");
	if (engine !== "mem0" && engine !== "naia")
		throw new Error("--engine must be mem0 or naia");
	const contractPath = values.get("contract");
	const outputPath = values.get("output");
	if (!contractPath || !outputPath)
		throw new Error("--contract and --output are required");
	const topK = Number(values.get("top-k") ?? "5");
	if (!Number.isInteger(topK) || topK < 1)
		throw new Error("--top-k must be a positive integer");
	return { engine, contractPath, outputPath, topK };
}

function discloseEndpoint(baseURL: string): string {
	const endpoint = new URL(baseURL);
	if (endpoint.username || endpoint.password || endpoint.search || endpoint.hash)
		throw new Error("provider endpoint must not contain credentials, query, or fragment");
	return `${endpoint.origin}${endpoint.pathname}`;
}

function providerConfig() {
	const gatewayUrl = process.env.GATEWAY_URL?.replace(/\/+$/, "");
	const gatewayKey = process.env.GATEWAY_MASTER_KEY;
	if (gatewayUrl && gatewayKey)
		return {
			apiKey: gatewayKey,
			baseURL: `${gatewayUrl}/v1/`,
			embeddingModel: "vertexai:gemini-embedding-001",
			embeddingDimensions: 3072,
			llmModel: "vertexai:gemini-2.5-flash-lite",
			auth: "bearer" as const,
		};
	const apiKey = process.env.GEMINI_API_KEY;
	if (!apiKey) throw new Error("GEMINI_API_KEY or gateway credentials are required");
	return {
		apiKey,
		baseURL: GEMINI_BASE,
		embeddingModel: "gemini-embedding-001",
		embeddingDimensions: 3072,
		llmModel: "gemini-2.5-flash-lite",
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
	const provider = providerConfig();
	const runId = randomUUID();
	const workPrefix = resolve(".agents/work/semantic-raw", runId);
	const createBridge =
		parsed.engine === "naia"
			? async () =>
					createNaiaSemanticBridge({
						storePath: `${workPrefix}-naia.json`,
						embeddingProvider: new OpenAICompatEmbeddingProvider(
							provider.baseURL,
							provider.apiKey,
							provider.embeddingModel,
							provider.embeddingDimensions,
						),
						factExtractor: buildLLMFactExtractor({
							apiKey: provider.apiKey,
							baseURL: provider.baseURL,
							model: provider.llmModel,
							auth: provider.auth,
							failurePolicy: "throw",
						}),
					})
			: async () =>
					createMem0SemanticBridge({
						userIdPrefix: `semantic-${runId}`,
						mem0Config: {
							embedder: {
								provider: "openai",
								config: {
									apiKey: provider.apiKey,
									baseURL: provider.baseURL,
									model: provider.embeddingModel,
								},
							},
							vectorStore: {
								provider: "memory",
								config: {
									collectionName: `semantic-${runId}`,
									dimension: provider.embeddingDimensions,
									dbPath: `${workPrefix}-mem0-vector.db`,
								},
							},
							llm: {
								provider: "openai",
								config: {
									apiKey: provider.apiKey,
									baseURL: provider.baseURL,
									model: provider.llmModel,
								},
							},
							historyDbPath: `${workPrefix}-mem0-history.db`,
						},
					});
	const receipts = await runSemanticRawContract(
		contract,
		createBridge,
		parsed.topK,
	);
	const disclosure = {
		engine: parsed.engine,
		topK: parsed.topK,
		embeddingModel: provider.embeddingModel,
		llmModel: provider.llmModel,
		endpoint: discloseEndpoint(provider.baseURL),
	};
	const output = {
		schemaVersion: "naia-memory-semantic-raw-artifact-v1",
		interpretation:
			"Unscored engine-native semantic memories and retrievals; not quality evidence by itself.",
		receipt: benchmarkReceipt(
			[contractPath],
			disclosure,
			[
				"src/benchmark/quality/semantic-raw-cli.ts",
				"src/benchmark/quality/memory-semantic-runner.ts",
				`src/benchmark/quality/bridge-${parsed.engine}-semantic.ts`,
			],
		),
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
		process.stderr.write(`${error instanceof Error ? error.message : "semantic raw run failed"}\n`);
		process.exitCode = 1;
	});
