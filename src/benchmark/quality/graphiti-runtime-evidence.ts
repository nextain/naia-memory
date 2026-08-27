import { readFileSync } from "node:fs";

type GraphitiPin = {
	revision: string;
	graphitiCoreVersion: string;
	neo4jDriverVersion: string;
	providerAdapterVersion: string;
	llmModel: string;
	embeddingProvider: string;
	embeddingModel: string;
	embeddingDimensions: number;
};

const pin = JSON.parse(
	readFileSync(
		new URL(
			"../../../tools/graphiti-benchmark-sidecar/pin.json",
			import.meta.url,
		),
		"utf8",
	),
) as GraphitiPin;

export type GraphitiPinnedRuntime = {
	revision: string;
	coreVersion: string;
	neo4jDriverVersion: string;
	providerAdapterVersion: string;
	llmModel: string;
	embeddingProvider: string;
	embeddingModel: string;
	embeddingDimensions: number;
};

export type GraphitiContactedRuntime = {
	graphitiCoreVersion: string;
	neo4jDriverVersion: string;
	providerAdapterVersion: string;
	llmClientClass: string;
	llmModel: string;
	embeddingClientClass: string;
	embeddingProvider: string;
	embeddingModel: string;
	embeddingDimensions: number;
	serverLockSha256: string;
	deployedSidecarSha256: string;
};

export type GraphitiRuntimeIdentityClient = {
	runtimeIdentity(): Promise<GraphitiContactedRuntime>;
};

const graphitiGeminiClientClass =
	"graphiti_core.llm_client.gemini_client.GeminiClient";
const graphitiGeminiEmbedderClass =
	"graphiti_core.embedder.gemini.GeminiEmbedder";

export function assertGraphitiPinnedRuntime(
	runtime: GraphitiPinnedRuntime,
): void {
	const expectations = [
		["GRAPHITI_REVISION", runtime.revision, pin.revision],
		["GRAPHITI_CORE_VERSION", runtime.coreVersion, pin.graphitiCoreVersion],
		[
			"GRAPHITI_NEO4J_DRIVER_VERSION",
			runtime.neo4jDriverVersion,
			pin.neo4jDriverVersion,
		],
		[
			"GRAPHITI_PROVIDER_ADAPTER_VERSION",
			runtime.providerAdapterVersion,
			pin.providerAdapterVersion,
		],
		["GRAPHITI_LLM_MODEL", runtime.llmModel, pin.llmModel],
		[
			"GRAPHITI_EMBEDDING_PROVIDER",
			runtime.embeddingProvider,
			pin.embeddingProvider,
		],
		["GRAPHITI_EMBEDDING_MODEL", runtime.embeddingModel, pin.embeddingModel],
		[
			"GRAPHITI_EMBEDDING_DIMENSIONS",
			runtime.embeddingDimensions,
			pin.embeddingDimensions,
		],
	] as const;
	for (const [name, actual, expected] of expectations) {
		if (actual !== expected)
			throw new Error(`${name} does not match the source-pinned sidecar value`);
	}
}

export function assertGraphitiContactedRuntime(
	observed: GraphitiContactedRuntime,
	expected: Omit<
		GraphitiContactedRuntime,
		"llmClientClass" | "embeddingClientClass"
	>,
): void {
	for (const [field, expectedValue] of Object.entries(expected)) {
		const observedValue = observed[field as keyof typeof expected];
		if (observedValue !== expectedValue)
			throw new Error(
				`Contacted Graphiti runtime ${field} mismatch: expected ${expectedValue}, observed ${observedValue}`,
			);
	}
	if (observed.llmClientClass !== graphitiGeminiClientClass)
		throw new Error("Contacted Graphiti runtime does not use GeminiClient");
	if (observed.embeddingClientClass !== graphitiGeminiEmbedderClass)
		throw new Error("Contacted Graphiti runtime does not use GeminiEmbedder");
}

export function assertGraphitiRuntimeUnchanged(
	before: GraphitiContactedRuntime,
	after: GraphitiContactedRuntime,
): void {
	for (const field of Object.keys(
		before,
	) as (keyof GraphitiContactedRuntime)[]) {
		if (before[field] !== after[field])
			throw new Error(
				`Contacted Graphiti runtime changed during execution: ${field}`,
			);
	}
}

export async function verifyGraphitiContactedRuntime(
	client: GraphitiRuntimeIdentityClient,
	expected: Omit<
		GraphitiContactedRuntime,
		"llmClientClass" | "embeddingClientClass"
	>,
): Promise<GraphitiContactedRuntime> {
	const observed = await client.runtimeIdentity();
	assertGraphitiContactedRuntime(observed, expected);
	return observed;
}

export const graphitiConfigurationAuthority =
	"source-pinned-deployment-operator-attested" as const;
