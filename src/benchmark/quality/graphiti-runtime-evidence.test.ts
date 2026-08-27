import { describe, expect, it, vi } from "vitest";
import {
	assertGraphitiContactedRuntime,
	assertGraphitiPinnedRuntime,
	assertGraphitiRuntimeUnchanged,
	verifyGraphitiContactedRuntime,
} from "./graphiti-runtime-evidence.js";

const pinnedRuntime = {
	revision: "993e081a6d7948a0d8851c12a5fbdbeb49fed862",
	coreVersion: "0.28.2",
	neo4jDriverVersion: "5.28.1",
	providerAdapterVersion: "google-genai@1.62.0",
	llmModel: "gemini-2.5-flash",
	embeddingProvider: "gemini",
	embeddingModel: "gemini-embedding-001",
	embeddingDimensions: 3072,
};

describe("Graphiti runtime evidence", () => {
	it("accepts the source-pinned sidecar configuration", () => {
		expect(() => assertGraphitiPinnedRuntime(pinnedRuntime)).not.toThrow();
	});

	it.each([
		["revision", "different-revision", "GRAPHITI_REVISION"],
		["coreVersion", "0.29.0", "GRAPHITI_CORE_VERSION"],
		["neo4jDriverVersion", "5.29.0", "GRAPHITI_NEO4J_DRIVER_VERSION"],
		[
			"providerAdapterVersion",
			"google-genai@1.63.0",
			"GRAPHITI_PROVIDER_ADAPTER_VERSION",
		],
		["llmModel", "different-llm", "GRAPHITI_LLM_MODEL"],
		["embeddingProvider", "different-provider", "GRAPHITI_EMBEDDING_PROVIDER"],
		["embeddingModel", "different-embedding", "GRAPHITI_EMBEDDING_MODEL"],
		["embeddingDimensions", 1024, "GRAPHITI_EMBEDDING_DIMENSIONS"],
	] as const)("rejects drift in %s", (field, value, environmentName) => {
		expect(() =>
			assertGraphitiPinnedRuntime({ ...pinnedRuntime, [field]: value }),
		).toThrow(`${environmentName} does not match`);
	});

	const contacted = {
		graphitiCoreVersion: "0.28.2",
		neo4jDriverVersion: "5.28.1",
		providerAdapterVersion: "google-genai@1.62.0",
		llmClientClass: "graphiti_core.llm_client.gemini_client.GeminiClient",
		llmModel: "gemini-2.5-flash",
		embeddingClientClass: "graphiti_core.embedder.gemini.GeminiEmbedder",
		embeddingProvider: "gemini",
		embeddingModel: "gemini-embedding-001",
		embeddingDimensions: 3072,
		serverLockSha256: "a".repeat(64),
		deployedSidecarSha256: "b".repeat(64),
	};
	const expected = {
		graphitiCoreVersion: contacted.graphitiCoreVersion,
		neo4jDriverVersion: contacted.neo4jDriverVersion,
		providerAdapterVersion: contacted.providerAdapterVersion,
		llmModel: contacted.llmModel,
		embeddingProvider: contacted.embeddingProvider,
		embeddingModel: contacted.embeddingModel,
		embeddingDimensions: contacted.embeddingDimensions,
		serverLockSha256: contacted.serverLockSha256,
		deployedSidecarSha256: contacted.deployedSidecarSha256,
	};

	it("binds the contacted server's observed configuration and deployed files", () => {
		expect(() =>
			assertGraphitiContactedRuntime(contacted, expected),
		).not.toThrow();
	});

	it.each([
		["graphitiCoreVersion", "0.29.0"],
		["neo4jDriverVersion", "5.29.0"],
		["providerAdapterVersion", "google-genai@1.63.0"],
		["llmModel", "other-model"],
		["embeddingProvider", "openai"],
		["embeddingModel", "other-embedding"],
		["embeddingDimensions", 768],
		["serverLockSha256", "c".repeat(64)],
		["deployedSidecarSha256", "d".repeat(64)],
	] as const)("rejects contacted-server drift in %s", (field, value) => {
		expect(() =>
			assertGraphitiContactedRuntime(
				{ ...contacted, [field]: value },
				expected,
			),
		).toThrow(`Contacted Graphiti runtime ${field} mismatch`);
	});

	it("rejects a non-Gemini live client even when labels match", () => {
		expect(() =>
			assertGraphitiContactedRuntime(
				{ ...contacted, llmClientClass: "fake.GeminiCompatible" },
				expected,
			),
		).toThrow(/does not use GeminiClient/);
	});

	it("contacts and validates the server before returning its identity", async () => {
		const runtimeIdentity = vi.fn().mockResolvedValue(contacted);
		await expect(
			verifyGraphitiContactedRuntime({ runtimeIdentity }, expected),
		).resolves.toEqual(contacted);
		expect(runtimeIdentity).toHaveBeenCalledOnce();
	});

	it("fails closed when the contacted server identity drifts", async () => {
		const runtimeIdentity = vi.fn().mockResolvedValue({
			...contacted,
			llmModel: "unexpected-model",
		});
		await expect(
			verifyGraphitiContactedRuntime({ runtimeIdentity }, expected),
		).rejects.toThrow("llmModel mismatch");
		expect(runtimeIdentity).toHaveBeenCalledOnce();
	});

	it("accepts identical before and after runtime observations", () => {
		expect(() =>
			assertGraphitiRuntimeUnchanged(contacted, { ...contacted }),
		).not.toThrow();
	});

	it("fails closed when runtime identity changes during execution", () => {
		expect(() =>
			assertGraphitiRuntimeUnchanged(contacted, {
				...contacted,
				deployedSidecarSha256: "c".repeat(64),
			}),
		).toThrow(/changed during execution: deployedSidecarSha256/);
	});
});
