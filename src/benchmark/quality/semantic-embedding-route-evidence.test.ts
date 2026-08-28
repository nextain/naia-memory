import { describe, expect, it, vi } from "vitest";
import {
	createEmbeddingRouteObserver,
	semanticProviderDisclosure,
} from "./semantic-embedding-route-evidence.js";

describe("semantic embedding route evidence", () => {
	it("discloses the plain-vector route without an LLM or path leakage", () => {
		vi.stubEnv("BENCHMARK_EVIDENCE_HMAC_KEY", "evidence-key".repeat(4));
		const disclosure = semanticProviderDisclosure(
			"plain-vector",
			{
				apiKey: "provider-secret",
				baseURL: "https://provider.example/private/v1/",
				embeddingModel: "embed-model",
				embeddingRevision: "revision",
				embeddingDimensions: 768,
				llmModel: "unused",
				auth: "bearer",
			},
			"https://provider.example/private/v1/embeddings",
		);
		expect(disclosure).toMatchObject({
			endpoint: "https://provider.example",
			inferencePolicy: "embedding-only-no-llm-v1",
			endpointRouteHmacSha256: expect.stringMatching(/^[0-9a-f]{64}$/),
		});
		expect(disclosure).not.toHaveProperty("llmModel");
		expect(JSON.stringify(disclosure)).not.toContain("private");
	});

	it("rejects a route inconsistent with the configured provider", () => {
		vi.stubEnv("BENCHMARK_EVIDENCE_HMAC_KEY", "evidence-key".repeat(4));
		expect(() =>
			semanticProviderDisclosure(
				"plain-vector",
				{
					apiKey: "provider-secret",
					baseURL: "https://provider.example/v1/",
					embeddingModel: "model",
					embeddingRevision: "revision",
					embeddingDimensions: 2,
					llmModel: "unused",
					auth: "bearer",
				},
				"https://other.example/v1/embeddings",
			),
		).toThrow("does not match provider base URL");
	});
	it("binds disclosure to an embedding route observed during execution", async () => {
		const delegate = vi.fn<typeof fetch>(async () => new Response("{}"));
		const observer = createEmbeddingRouteObserver(
			"https://provider.example/v1/",
			delegate,
		);
		await observer.fetch("https://provider.example/v1/embeddings", {
			method: "POST",
		});
		expect(observer.assertObservedRoute()).toBe(
			"https://provider.example/v1/embeddings",
		);
		expect(delegate).toHaveBeenCalledOnce();
		const missing = createEmbeddingRouteObserver(
			"https://provider.example/v1/",
			delegate,
		);
		expect(() => missing.assertObservedRoute()).toThrow(
			"embedding route observation mismatch",
		);
	});

	it("rejects unsafe endpoints before any network call", () => {
		for (const endpoint of [
			"ftp://provider.example/v1",
			"https://user:secret@provider.example/v1",
			"https://provider.example/v1?tenant=unsafe",
			"https://provider.example/v1#unsafe",
		]) {
			const delegate = vi.fn<typeof fetch>();
			expect(() => createEmbeddingRouteObserver(endpoint, delegate)).toThrow(
				"must use HTTP(S) without credentials, query, or fragment",
			);
			expect(delegate).not.toHaveBeenCalled();
		}
	});

	it("rejects redirects instead of binding only the pre-redirect URL", async () => {
		const delegate = vi.fn<typeof fetch>(
			async () =>
				new Response(null, {
					status: 307,
					headers: { location: "https://other.example/v1/embeddings" },
				}),
		);
		const observer = createEmbeddingRouteObserver(
			"https://provider.example/v1/",
			delegate,
		);
		await expect(
			observer.fetch("https://provider.example/v1/embeddings", {
				method: "POST",
			}),
		).rejects.toThrow("rejects redirects");
		expect(delegate).toHaveBeenCalledWith(
			"https://provider.example/v1/embeddings",
			expect.objectContaining({ redirect: "manual" }),
		);
	});

	it("leaves non-embedding request redirect behavior unchanged", async () => {
		const delegate = vi.fn<typeof fetch>(async () =>
			Response.redirect("https://provider.example/final", 307),
		);
		const observer = createEmbeddingRouteObserver(
			"https://provider.example/custom/compat/",
			delegate,
		);
		await expect(
			observer.fetch("https://provider.example/chat/completions", {
				method: "POST",
			}),
		).resolves.toHaveProperty("status", 307);
		expect(delegate).toHaveBeenCalledWith(
			"https://provider.example/chat/completions",
			{ method: "POST" },
		);
	});

	it("observes legacy custom compatible base paths without canonicalizing them", async () => {
		const delegate = vi.fn<typeof fetch>(async () => new Response("{}"));
		const observer = createEmbeddingRouteObserver(
			"https://provider.example/custom/compat/",
			delegate,
		);
		await observer.fetch(
			"https://provider.example/custom/compat/v1/embeddings",
		);
		expect(observer.assertObservedRoute()).toBe(
			"https://provider.example/custom/compat/v1/embeddings",
		);
	});
});
