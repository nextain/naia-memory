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
import {
	OpenAICompatEmbeddingProvider,
} from "../../memory/embeddings.js";
import { buildLLMDeleteVerifier } from "../../memory/llm-delete-verifier.js";
import { buildLLMFactExtractor } from "../../memory/llm-fact-extractor.js";
import { benchmarkReceipt } from "../provenance.js";
import { createGraphitiHistoricalSemanticBridge } from "./bridge-graphiti-historical-semantic.js";
import { createGraphitiSemanticBridge } from "./bridge-graphiti-semantic.js";
import { createHindsightSemanticBridge } from "./bridge-hindsight-semantic.js";
import { createLettaSemanticBridge } from "./bridge-letta-semantic.js";
import { createMem0SemanticBridge } from "./bridge-mem0-semantic.js";
import { createNaiaSemanticBridge } from "./bridge-naia-semantic.js";
import { PlainVectorSemanticBridge } from "./bridge-plain-vector-semantic.js";
import { GraphitiRestSemanticClient } from "./graphiti-rest-semantic-client.js";
import {
	type GraphitiContactedRuntime,
	assertGraphitiContactedRuntime,
	assertGraphitiPinnedRuntime,
	assertGraphitiRuntimeUnchanged,
	graphitiConfigurationAuthority,
} from "./graphiti-runtime-evidence.js";
import {
	type SemanticEngineBridge,
	runSemanticRawContract,
} from "./memory-semantic-runner.js";
import {
	type MemoryUpdateContract,
	validateMemoryUpdateContract,
} from "./memory-update-contract.js";
import {
	assertBenchmarkEmbeddingBaseURL,
	benchmarkEvidenceHmacKey,
	createEmbeddingRouteObserver,
	discloseServerEndpoint,
	semanticProviderDisclosure,
} from "./semantic-embedding-route-evidence.js";

export {
	createEmbeddingRouteObserver,
	discloseServerEndpoint,
	semanticProviderDisclosure,
} from "./semantic-embedding-route-evidence.js";

export type SemanticEngine =
	| "graphiti"
	| "graphiti-historical"
	| "hindsight"
	| "letta"
	| "mem0"
	| "naia"
	| "plain-vector";

export function expectedSemanticRetrievalSurface(
	engine: SemanticEngine,
): SemanticEngineBridge["retrievalSurface"] {
	switch (engine) {
		case "graphiti":
			return "engine-current-state-projected-semantic-memory-v1";
		case "graphiti-historical":
			return "engine-native-historical-search-v1";
		case "letta":
			return "engine-native-core-first-and-semantic-archive-v1";
		case "hindsight":
		case "mem0":
		case "naia":
			return "engine-native-semantic-memory-v1";
		case "plain-vector":
			return "baseline-immutable-turn-vector-search-v1";
	}
}
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
		engine !== "graphiti" &&
		engine !== "graphiti-historical" &&
		engine !== "hindsight" &&
		engine !== "letta" &&
		engine !== "mem0" &&
		engine !== "naia" &&
		engine !== "plain-vector"
	)
		throw new Error(
			"--engine must be graphiti, graphiti-historical, hindsight, letta, mem0, naia, or plain-vector",
		);
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
	return endpoint.origin;
}

export function plainVectorProviderConfig(
	provider: ReturnType<typeof providerConfig>,
) {
	if (provider.auth !== "bearer")
		throw new Error("plain-vector requires bearer embedding auth");
	assertBenchmarkEmbeddingBaseURL(provider.baseURL);
	return { ...provider };
}

let semanticRawExecutionActive = false;

export function providerConfig() {
	const embeddingRevision = () => {
		const revision = process.env.BENCHMARK_EMBEDDING_REVISION?.trim();
		if (!revision)
			throw new Error(
				"BENCHMARK_EMBEDDING_REVISION is required for reproducible competitive runs",
			);
		return revision;
	};
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
			embeddingRevision: embeddingRevision(),
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
			embeddingRevision: embeddingRevision(),
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
		embeddingRevision: embeddingRevision(),
		embeddingDimensions: 3072,
		llmModel: process.env.BENCHMARK_LLM_MODEL ?? "gemini-2.5-flash",
		auth: "bearer" as const,
	};
}

export function hindsightRuntimeConfig() {
	const version = process.env.HINDSIGHT_ENGINE_VERSION?.trim();
	const imageDigest = process.env.HINDSIGHT_IMAGE_DIGEST?.trim();
	const llmProvider = process.env.HINDSIGHT_LLM_PROVIDER?.trim();
	const llmModel = process.env.HINDSIGHT_LLM_MODEL?.trim();
	const embeddingProvider = process.env.HINDSIGHT_EMBEDDING_PROVIDER?.trim();
	const embeddingModel = process.env.HINDSIGHT_EMBEDDING_MODEL?.trim();
	const embeddingRevision = process.env.HINDSIGHT_EMBEDDING_REVISION?.trim();
	const embeddingDimensions = Number(
		process.env.HINDSIGHT_EMBEDDING_DIMENSIONS,
	);
	if (
		!version ||
		!imageDigest ||
		!llmProvider ||
		!llmModel ||
		!embeddingProvider ||
		!embeddingModel ||
		!embeddingRevision ||
		!Number.isInteger(embeddingDimensions) ||
		embeddingDimensions < 1
	)
		throw new Error(
			"Hindsight runs require HINDSIGHT_ENGINE_VERSION, HINDSIGHT_IMAGE_DIGEST, HINDSIGHT_LLM_PROVIDER, HINDSIGHT_LLM_MODEL, HINDSIGHT_EMBEDDING_PROVIDER, HINDSIGHT_EMBEDDING_MODEL, HINDSIGHT_EMBEDDING_REVISION, and a positive HINDSIGHT_EMBEDDING_DIMENSIONS",
		);
	if (!/^sha256:[a-f0-9]{64}$/.test(imageDigest))
		throw new Error(
			"HINDSIGHT_IMAGE_DIGEST must be an immutable sha256 digest",
		);
	return {
		version,
		imageDigest,
		llmProvider,
		llmModel,
		embeddingProvider,
		embeddingModel,
		embeddingRevision,
		embeddingDimensions,
	};
}

export function lettaRuntimeConfig() {
	const version = process.env.LETTA_ENGINE_VERSION?.trim();
	const imageDigest = process.env.LETTA_IMAGE_DIGEST?.trim();
	const llmModel = process.env.LETTA_LLM_MODEL?.trim();
	const embeddingProvider = process.env.LETTA_EMBEDDING_PROVIDER?.trim();
	const embeddingModel = process.env.LETTA_EMBEDDING_MODEL?.trim();
	const embeddingRevision = process.env.LETTA_EMBEDDING_REVISION?.trim();
	const embeddingDimensions = Number(process.env.LETTA_EMBEDDING_DIMENSIONS);
	if (
		!version ||
		!imageDigest ||
		!llmModel ||
		!embeddingProvider ||
		!embeddingModel ||
		!embeddingRevision ||
		!Number.isInteger(embeddingDimensions) ||
		embeddingDimensions < 1
	)
		throw new Error(
			"Letta runs require LETTA_ENGINE_VERSION, LETTA_IMAGE_DIGEST, LETTA_LLM_MODEL, LETTA_EMBEDDING_PROVIDER, LETTA_EMBEDDING_MODEL, LETTA_EMBEDDING_REVISION, and positive LETTA_EMBEDDING_DIMENSIONS",
		);
	if (!/^sha256:[a-f0-9]{64}$/.test(imageDigest))
		throw new Error("LETTA_IMAGE_DIGEST must be an immutable sha256 digest");
	return {
		version,
		imageDigest,
		llmModel,
		embeddingProvider,
		embeddingModel,
		embeddingRevision,
		embeddingDimensions,
	};
}

export function graphitiRuntimeConfig() {
	const revision = process.env.GRAPHITI_REVISION?.trim();
	const imageDigest = process.env.GRAPHITI_IMAGE_DIGEST?.trim();
	const coreVersion = process.env.GRAPHITI_CORE_VERSION?.trim();
	const neo4jDriverVersion = process.env.GRAPHITI_NEO4J_DRIVER_VERSION?.trim();
	const providerAdapterVersion =
		process.env.GRAPHITI_PROVIDER_ADAPTER_VERSION?.trim();
	const llmModel = process.env.GRAPHITI_LLM_MODEL?.trim();
	const embeddingProvider = process.env.GRAPHITI_EMBEDDING_PROVIDER?.trim();
	const embeddingModel = process.env.GRAPHITI_EMBEDDING_MODEL?.trim();
	const embeddingRevision = process.env.GRAPHITI_EMBEDDING_REVISION?.trim();
	const embeddingDimensions = Number(process.env.GRAPHITI_EMBEDDING_DIMENSIONS);
	const serverLockSha256 = process.env.GRAPHITI_SERVER_LOCK_SHA256?.trim();
	const deployedSidecarSha256 =
		process.env.GRAPHITI_DEPLOYED_SIDECAR_SHA256?.trim();
	if (
		!revision ||
		!imageDigest ||
		!coreVersion ||
		!neo4jDriverVersion ||
		!providerAdapterVersion ||
		!llmModel ||
		!embeddingProvider ||
		!embeddingModel ||
		!embeddingRevision ||
		!serverLockSha256 ||
		!deployedSidecarSha256 ||
		!Number.isInteger(embeddingDimensions) ||
		embeddingDimensions < 1
	)
		throw new Error(
			"Graphiti runs require GRAPHITI_REVISION, GRAPHITI_IMAGE_DIGEST, GRAPHITI_CORE_VERSION, GRAPHITI_NEO4J_DRIVER_VERSION, GRAPHITI_PROVIDER_ADAPTER_VERSION, GRAPHITI_LLM_MODEL, GRAPHITI_EMBEDDING_PROVIDER, GRAPHITI_EMBEDDING_MODEL, GRAPHITI_EMBEDDING_REVISION, GRAPHITI_SERVER_LOCK_SHA256, GRAPHITI_DEPLOYED_SIDECAR_SHA256, and positive GRAPHITI_EMBEDDING_DIMENSIONS",
		);
	if (!/^[a-f0-9]{40}$/.test(revision))
		throw new Error("GRAPHITI_REVISION must be an immutable Git commit");
	if (!/^sha256:[a-f0-9]{64}$/.test(imageDigest))
		throw new Error("GRAPHITI_IMAGE_DIGEST must be an immutable sha256 digest");
	if (!/^[a-f0-9]{64}$/.test(serverLockSha256))
		throw new Error("GRAPHITI_SERVER_LOCK_SHA256 must be a sha256 hash");
	if (!/^[a-f0-9]{64}$/.test(deployedSidecarSha256))
		throw new Error("GRAPHITI_DEPLOYED_SIDECAR_SHA256 must be a sha256 hash");
	assertGraphitiPinnedRuntime({
		revision,
		coreVersion,
		neo4jDriverVersion,
		providerAdapterVersion,
		llmModel,
		embeddingProvider,
		embeddingModel,
		embeddingDimensions,
	});
	return {
		revision,
		imageDigest,
		coreVersion,
		neo4jDriverVersion,
		providerAdapterVersion,
		llmModel,
		embeddingProvider,
		embeddingModel,
		embeddingRevision,
		embeddingRevisionAuthority: "operator-asserted",
		embeddingDimensions,
		serverLockSha256,
		deployedSidecarSha256,
		configurationAuthority: graphitiConfigurationAuthority,
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
	const rawProvider =
		parsed.engine === "graphiti" ||
		parsed.engine === "graphiti-historical" ||
		parsed.engine === "hindsight" ||
		parsed.engine === "letta"
			? undefined
			: providerConfig();
	const provider =
		parsed.engine === "plain-vector" && rawProvider
			? plainVectorProviderConfig(rawProvider)
			: rawProvider;
	// Every provider-backed competitive lane must bind the route it actually
	// contacted. Keeping this conditional on the schema generation or on an
	// optional key would let legacy campaigns collapse distinct base paths to
	// the same origin-only disclosure.
	const routeEvidenceEnabled = Boolean(provider);
	if (parsed.engine === "plain-vector" && provider)
		benchmarkEvidenceHmacKey(provider.apiKey);
	const requireProvider = () => {
		if (!provider)
			throw new Error("semantic provider configuration is unavailable");
		return provider;
	};
	const runId = randomUUID();
	const executionSeed = parsed.executionSeed ?? runId;
	const workPrefix = resolve(".agents/work/semantic-raw", runId);
	const createBridge =
		parsed.engine === "plain-vector"
			? async () => {
					const configuredProvider = requireProvider();
					return new PlainVectorSemanticBridge(
						new OpenAICompatEmbeddingProvider(
							configuredProvider.baseURL,
							configuredProvider.apiKey,
							configuredProvider.embeddingModel,
							configuredProvider.embeddingDimensions,
							configuredProvider.embeddingRevision,
						),
					);
				}
			: parsed.engine === "naia"
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
				: parsed.engine === "graphiti" ||
						parsed.engine === "graphiti-historical"
					? async () =>
							(parsed.engine === "graphiti"
								? createGraphitiSemanticBridge
								: createGraphitiHistoricalSemanticBridge)(
								new GraphitiRestSemanticClient({
									baseUrl: process.env.GRAPHITI_URL ?? "http://127.0.0.1:8000",
								}),
								`semantic-${runId}`,
							)
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
											process.env.LETTA_EMBEDDING_MODEL ??
											"text-embedding-3-small",
										embeddingDimensions: Number(
											process.env.LETTA_EMBEDDING_DIMENSIONS ?? "1536",
										),
										embeddingEndpoint: process.env.LETTA_EMBEDDING_ENDPOINT,
									})
							: async () =>
									createHindsightSemanticBridge({
										baseUrl:
											process.env.HINDSIGHT_URL ?? "http://127.0.0.1:18888",
										bankIdPrefix: `semantic-${runId}`,
										apiKey: process.env.HINDSIGHT_API_KEY,
									});
	const hindsightEndpoint =
		process.env.HINDSIGHT_URL ?? "http://127.0.0.1:18888";
	const lettaEndpoint = process.env.LETTA_URL ?? "http://127.0.0.1:8283";
	const graphitiEndpoint = process.env.GRAPHITI_URL ?? "http://127.0.0.1:8000";
	let graphitiRuntimeReceipt =
		parsed.engine === "graphiti" || parsed.engine === "graphiti-historical"
			? graphitiRuntimeConfig()
			: undefined;
	const graphitiIdentityClient = graphitiRuntimeReceipt
		? new GraphitiRestSemanticClient({ baseUrl: graphitiEndpoint })
		: undefined;
	let contactedServerIdentityBefore: GraphitiContactedRuntime | undefined;
	if (graphitiRuntimeReceipt && graphitiIdentityClient) {
		contactedServerIdentityBefore =
			await graphitiIdentityClient.runtimeIdentity();
		assertGraphitiContactedRuntime(contactedServerIdentityBefore, {
			graphitiCoreVersion: graphitiRuntimeReceipt.coreVersion,
			neo4jDriverVersion: graphitiRuntimeReceipt.neo4jDriverVersion,
			providerAdapterVersion: graphitiRuntimeReceipt.providerAdapterVersion,
			llmModel: graphitiRuntimeReceipt.llmModel,
			embeddingProvider: graphitiRuntimeReceipt.embeddingProvider,
			embeddingModel: graphitiRuntimeReceipt.embeddingModel,
			embeddingDimensions: graphitiRuntimeReceipt.embeddingDimensions,
			serverLockSha256: graphitiRuntimeReceipt.serverLockSha256,
			deployedSidecarSha256: graphitiRuntimeReceipt.deployedSidecarSha256,
		});
		graphitiRuntimeReceipt = {
			...graphitiRuntimeReceipt,
			contactedServerIdentityBefore,
			configurationAuthority:
				"source-pin-matched-and-contacted-server-observed" as const,
			serviceRevisionAuthority:
				"operator-attested-not-server-observed" as const,
			serviceImageAuthority: "operator-attested-not-server-observed" as const,
		};
	}
	const hindsightRuntimeReceipt =
		parsed.engine === "hindsight" ? hindsightRuntimeConfig() : undefined;
	const lettaRuntimeReceipt =
		parsed.engine === "letta" ? lettaRuntimeConfig() : undefined;
	const originalFetch = globalThis.fetch;
	const embeddingRouteObserver =
		routeEvidenceEnabled && provider
			? createEmbeddingRouteObserver(provider.baseURL, originalFetch)
			: undefined;
	if (semanticRawExecutionActive)
		throw new Error(
			"concurrent in-process semantic raw executions are not supported",
		);
	semanticRawExecutionActive = true;
	if (embeddingRouteObserver) globalThis.fetch = embeddingRouteObserver.fetch;
	let receipts: Awaited<ReturnType<typeof runSemanticRawContract>>;
	try {
		receipts = await runSemanticRawContract(
			contract,
			createBridge,
			parsed.topK,
			executionSeed,
		);
	} finally {
		globalThis.fetch = originalFetch;
		semanticRawExecutionActive = false;
	}
	const observedEmbeddingRoute = embeddingRouteObserver?.assertObservedRoute();
	if (
		graphitiRuntimeReceipt &&
		graphitiIdentityClient &&
		contactedServerIdentityBefore
	) {
		const contactedServerIdentityAfter =
			await graphitiIdentityClient.runtimeIdentity();
		assertGraphitiContactedRuntime(contactedServerIdentityAfter, {
			graphitiCoreVersion: graphitiRuntimeReceipt.coreVersion,
			neo4jDriverVersion: graphitiRuntimeReceipt.neo4jDriverVersion,
			providerAdapterVersion: graphitiRuntimeReceipt.providerAdapterVersion,
			llmModel: graphitiRuntimeReceipt.llmModel,
			embeddingProvider: graphitiRuntimeReceipt.embeddingProvider,
			embeddingModel: graphitiRuntimeReceipt.embeddingModel,
			embeddingDimensions: graphitiRuntimeReceipt.embeddingDimensions,
			serverLockSha256: graphitiRuntimeReceipt.serverLockSha256,
			deployedSidecarSha256: graphitiRuntimeReceipt.deployedSidecarSha256,
		});
		assertGraphitiRuntimeUnchanged(
			contactedServerIdentityBefore,
			contactedServerIdentityAfter,
		);
		graphitiRuntimeReceipt = {
			...graphitiRuntimeReceipt,
			contactedServerIdentityAfter,
		};
	}
	const expectedRetrievalSurface = expectedSemanticRetrievalSurface(
		parsed.engine,
	);
	if (
		receipts.some(
			(receipt) => receipt.retrievalSurface !== expectedRetrievalSurface,
		)
	)
		throw new Error(
			`semantic ${parsed.engine} bridge disclosed an unexpected retrieval surface`,
		);
	const disclosure = {
		engine: parsed.engine,
		topK: parsed.topK,
		executionSeed,
		mutationAuthorizationPolicy:
			parsed.engine === "naia"
				? "independent-llm-delete-verifier-fail-closed-v1"
				: parsed.engine === "plain-vector"
					? "none-immutable-turn-baseline-v1"
					: "engine-native-mutation-policy-v1",
		...(provider && routeEvidenceEnabled
			? semanticProviderDisclosure(
					parsed.engine,
					provider,
					observedEmbeddingRoute as string,
				)
			: provider
				? {
						embeddingModel: provider.embeddingModel,
						embeddingRevision: provider.embeddingRevision,
						embeddingDimensions: provider.embeddingDimensions,
						llmModel: provider.llmModel,
						authScheme: provider.auth,
						endpoint: discloseEndpoint(provider.baseURL),
					}
				: parsed.engine === "graphiti" ||
						parsed.engine === "graphiti-historical"
					? {
							providerPolicy: "engine-server-native-configuration-v1",
							ingestionSurface: "synchronous-native-episode-v1",
							stateObservationPolicy:
								parsed.engine === "graphiti"
									? "complete-current-native-edges-v1"
									: "complete-historical-native-edges-independent-of-query-v1",
							searchValidityPolicy:
								parsed.engine === "graphiti"
									? "native-search-intersect-current-native-edges-v1"
									: "unprojected-native-historical-search-v1",
							...discloseServerEndpoint(graphitiEndpoint),
							graphitiRuntime: graphitiRuntimeReceipt,
						}
					: parsed.engine === "letta"
						? {
								providerPolicy: "engine-server-native-configuration-v1",
								ingestionSurface: "agent-user-message-v1",
								stateObservationPolicy:
									"full-nonpersona-core-state-no-query-ranking-v1",
								...discloseServerEndpoint(lettaEndpoint),
								lettaRuntime: lettaRuntimeReceipt,
							}
						: {
								providerPolicy: "engine-server-native-configuration-v1",
								ingestionSurface: "synchronous-retain-settled-bank-v1",
								settlePolicy:
									"two-consecutive-zero-pending-bank-stats-fail-on-background-error-v1",
								...discloseServerEndpoint(hindsightEndpoint),
								hindsightRuntime: hindsightRuntimeReceipt,
							}),
	};
	const output = {
		schemaVersion: "naia-memory-semantic-raw-artifact-v2",
		interpretation:
			"Unscored engine-native semantic memories or immutable turn-level baseline vectors and retrievals; not quality evidence by itself.",
		receipt: benchmarkReceipt([contractPath], disclosure, [
			"src/benchmark/quality/semantic-raw-cli.ts",
			"src/benchmark/quality/memory-semantic-runner.ts",
			...(provider
				? [
						"src/benchmark/quality/semantic-embedding-route-evidence.ts",
						"src/memory/embeddings.ts",
					]
				: []),
			parsed.engine === "graphiti-historical"
				? "src/benchmark/quality/bridge-graphiti-historical-semantic.ts"
				: `src/benchmark/quality/bridge-${parsed.engine}-semantic.ts`,
			...(parsed.engine === "graphiti" ||
			parsed.engine === "graphiti-historical"
				? [
						"src/benchmark/quality/graphiti-rest-semantic-client.ts",
						"tools/graphiti-benchmark-sidecar/router.py",
						"tools/graphiti-benchmark-sidecar/pin.json",
					]
				: []),
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
