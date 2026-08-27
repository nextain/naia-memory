import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { benchmarkReceipt } from "../provenance.js";
import { runGraphitiBackendSmoke } from "./graphiti-backend-smoke.js";
import { GraphitiRestSemanticClient } from "./graphiti-rest-semantic-client.js";
import {
	assertGraphitiPinnedRuntime,
	assertGraphitiRuntimeUnchanged,
	graphitiConfigurationAuthority,
	verifyGraphitiContactedRuntime,
} from "./graphiti-runtime-evidence.js";

const baseUrl = process.env.GRAPHITI_BENCHMARK_URL;
if (!baseUrl) throw new Error("GRAPHITI_BENCHMARK_URL is required");

const requiredRuntime = [
	"GRAPHITI_REVISION",
	"GRAPHITI_IMAGE_ID",
	"GRAPHITI_CORE_VERSION",
	"GRAPHITI_NEO4J_DRIVER_VERSION",
	"GRAPHITI_PROVIDER_ADAPTER_VERSION",
	"GRAPHITI_SERVER_LOCK_SHA256",
	"GRAPHITI_DEPLOYED_SIDECAR_SHA256",
	"GRAPHITI_LLM_MODEL",
	"GRAPHITI_EMBEDDING_PROVIDER",
	"GRAPHITI_EMBEDDING_MODEL",
	"GRAPHITI_EMBEDDING_REVISION",
	"GRAPHITI_EMBEDDING_DIMENSIONS",
] as const;
const runtime = Object.fromEntries(
	requiredRuntime.map((name) => {
		const value = process.env[name]?.trim();
		if (!value) throw new Error(`${name} is required`);
		return [name, value];
	}),
);
if (!/^[a-f0-9]{40}$/.test(runtime.GRAPHITI_REVISION))
	throw new Error("GRAPHITI_REVISION must be an immutable Git commit");
if (!/^[a-f0-9]{64}$/.test(runtime.GRAPHITI_IMAGE_ID))
	throw new Error("GRAPHITI_IMAGE_ID must be an immutable image identifier");
if (!/^[a-f0-9]{64}$/.test(runtime.GRAPHITI_SERVER_LOCK_SHA256))
	throw new Error("GRAPHITI_SERVER_LOCK_SHA256 must be a sha256 hash");
if (!/^[a-f0-9]{64}$/.test(runtime.GRAPHITI_DEPLOYED_SIDECAR_SHA256))
	throw new Error("GRAPHITI_DEPLOYED_SIDECAR_SHA256 must be a sha256 hash");
const embeddingDimensions = Number(runtime.GRAPHITI_EMBEDDING_DIMENSIONS);
if (!Number.isInteger(embeddingDimensions) || embeddingDimensions < 1)
	throw new Error("GRAPHITI_EMBEDDING_DIMENSIONS must be a positive integer");
assertGraphitiPinnedRuntime({
	revision: runtime.GRAPHITI_REVISION,
	coreVersion: runtime.GRAPHITI_CORE_VERSION,
	neo4jDriverVersion: runtime.GRAPHITI_NEO4J_DRIVER_VERSION,
	providerAdapterVersion: runtime.GRAPHITI_PROVIDER_ADAPTER_VERSION,
	llmModel: runtime.GRAPHITI_LLM_MODEL,
	embeddingProvider: runtime.GRAPHITI_EMBEDDING_PROVIDER,
	embeddingModel: runtime.GRAPHITI_EMBEDDING_MODEL,
	embeddingDimensions,
});
const client = new GraphitiRestSemanticClient({ baseUrl });
const observedRuntime = await verifyGraphitiContactedRuntime(client, {
	graphitiCoreVersion: runtime.GRAPHITI_CORE_VERSION,
	neo4jDriverVersion: runtime.GRAPHITI_NEO4J_DRIVER_VERSION,
	providerAdapterVersion: runtime.GRAPHITI_PROVIDER_ADAPTER_VERSION,
	llmModel: runtime.GRAPHITI_LLM_MODEL,
	embeddingProvider: runtime.GRAPHITI_EMBEDDING_PROVIDER,
	embeddingModel: runtime.GRAPHITI_EMBEDDING_MODEL,
	embeddingDimensions,
	serverLockSha256: runtime.GRAPHITI_SERVER_LOCK_SHA256,
	deployedSidecarSha256: runtime.GRAPHITI_DEPLOYED_SIDECAR_SHA256,
});
const smoke = await runGraphitiBackendSmoke(client);
const observedRuntimeAfter = await verifyGraphitiContactedRuntime(client, {
	graphitiCoreVersion: runtime.GRAPHITI_CORE_VERSION,
	neo4jDriverVersion: runtime.GRAPHITI_NEO4J_DRIVER_VERSION,
	providerAdapterVersion: runtime.GRAPHITI_PROVIDER_ADAPTER_VERSION,
	llmModel: runtime.GRAPHITI_LLM_MODEL,
	embeddingProvider: runtime.GRAPHITI_EMBEDDING_PROVIDER,
	embeddingModel: runtime.GRAPHITI_EMBEDDING_MODEL,
	embeddingDimensions,
	serverLockSha256: runtime.GRAPHITI_SERVER_LOCK_SHA256,
	deployedSidecarSha256: runtime.GRAPHITI_DEPLOYED_SIDECAR_SHA256,
});
assertGraphitiRuntimeUnchanged(observedRuntime, observedRuntimeAfter);
const result = {
	schemaVersion: "naia-memory-graphiti-backend-smoke-v4",
	evidenceClass: "local-backend-integration-smoke",
	publicCompetitiveEvidence: false,
	receipt: benchmarkReceipt([], { runtime }, [
		"src/benchmark/quality/graphiti-backend-smoke-cli.ts",
		"src/benchmark/quality/graphiti-backend-smoke.ts",
		"src/benchmark/quality/graphiti-rest-semantic-client.ts",
		"tools/graphiti-benchmark-sidecar/pin.json",
		"tools/graphiti-benchmark-sidecar/process-lifetime-client.patch",
		"tools/graphiti-benchmark-sidecar/provider-adapter.patch",
		"tools/graphiti-benchmark-sidecar/router.py",
		"tools/graphiti-benchmark-sidecar/test_process_lifetime_client.py",
	]),
	runtime: {
		serviceRevision: runtime.GRAPHITI_REVISION,
		serviceImageId: runtime.GRAPHITI_IMAGE_ID,
		graphitiCoreVersion: runtime.GRAPHITI_CORE_VERSION,
		neo4jDriverVersion: runtime.GRAPHITI_NEO4J_DRIVER_VERSION,
		providerAdapterVersion: runtime.GRAPHITI_PROVIDER_ADAPTER_VERSION,
		serverLockSha256: runtime.GRAPHITI_SERVER_LOCK_SHA256,
		deployedSidecarSha256: runtime.GRAPHITI_DEPLOYED_SIDECAR_SHA256,
		llmModel: runtime.GRAPHITI_LLM_MODEL,
		embeddingProvider: runtime.GRAPHITI_EMBEDDING_PROVIDER,
		embeddingModel: runtime.GRAPHITI_EMBEDDING_MODEL,
		embeddingRevision: runtime.GRAPHITI_EMBEDDING_REVISION,
		embeddingRevisionAuthority: "operator-asserted",
		embeddingDimensions,
		configurationAuthority: "source-pin-matched-and-contacted-server-observed",
		operatorConfigurationAuthority: graphitiConfigurationAuthority,
		contactedServerIdentityBefore: observedRuntime,
		contactedServerIdentityAfter: observedRuntimeAfter,
		serviceRevisionAuthority: "operator-attested-not-server-observed",
		serviceImageAuthority: "operator-attested-not-server-observed",
		modelNetworkPolicy: "external-gemini-api-required-non-hermetic",
	},
	smoke,
	limitations: [
		"This receipt proves only local backend lifecycle and integration behavior.",
		"It does not establish comparative quality, generalization, or external reproducibility.",
		"The external Gemini dependency makes this run non-hermetic.",
	],
};
const serialized = `${JSON.stringify(result, null, 2)}\n`;
const outputPath = process.argv[2];
if (outputPath) await writeFile(resolve(outputPath), serialized, "utf8");
process.stdout.write(serialized);
if (!smoke.passed) process.exitCode = 1;
