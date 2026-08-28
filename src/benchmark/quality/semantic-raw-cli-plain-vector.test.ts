import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { semanticBlindFixture } from "./semantic-blind-packet-fixture.js";
import { runSemanticRawCli } from "./semantic-raw-cli.js";

const roots: string[] = [];

beforeEach(() => {
	vi.stubEnv("BENCHMARK_OPENAI_BASE_URL", "https://provider.example/v1/");
	vi.stubEnv("BENCHMARK_OPENAI_API_KEY", "test-secret");
	vi.stubEnv("BENCHMARK_EMBEDDING_MODEL", "embed-model");
	vi.stubEnv("BENCHMARK_EMBEDDING_REVISION", "embed-revision");
	vi.stubEnv("BENCHMARK_EMBEDDING_DIMENSIONS", "2");
	vi.stubEnv("BENCHMARK_LLM_MODEL", "must-not-be-used");
	vi.stubEnv("BENCHMARK_AUTH", "bearer");
	vi.stubEnv("BENCHMARK_EVIDENCE_HMAC_KEY", "evidence-key".repeat(4));
});

afterEach(async () => {
	vi.unstubAllGlobals();
	vi.unstubAllEnvs();
	await Promise.all(
		roots.splice(0).map((path) => rm(path, { recursive: true, force: true })),
	);
});

describe("semantic raw CLI plain-vector execution", () => {
	it("uses only the embedding route and emits the no-LLM disclosure", async () => {
		const root = await mkdtemp(resolve(tmpdir(), "semantic-raw-plain-"));
		roots.push(root);
		const source = semanticBlindFixture(root, {
			engines: ["plain-vector", "naia"],
		});
		const outputPath = resolve(root, "plain-vector.json");
		const observedRoutes: string[] = [];
		vi.stubGlobal(
			"fetch",
			vi.fn<typeof fetch>(async (input, init) => {
				const url = String(input);
				observedRoutes.push(new URL(url).pathname);
				if (new URL(url).pathname !== "/v1/embeddings")
					throw new Error(`unexpected non-embedding request: ${url}`);
				const body = JSON.parse(String(init?.body)) as { input: string[] };
				return Response.json({
					data: body.input.map((text, index) => ({
						index,
						embedding: [1, text.length + 1],
					})),
				});
			}),
		);

		await runSemanticRawCli([
			"--engine=plain-vector",
			`--contract=${source.contractPath}`,
			`--output=${outputPath}`,
			"--seed=plain-vector-route-test",
		]);

		const artifact = JSON.parse(await readFile(outputPath, "utf8")) as {
			disclosure: Record<string, unknown>;
			receipt: { implementations: Record<string, string> };
		};
		expect(observedRoutes.length).toBeGreaterThan(0);
		expect(new Set(observedRoutes)).toEqual(new Set(["/v1/embeddings"]));
		expect(artifact.disclosure).toMatchObject({
			engine: "plain-vector",
			inferencePolicy: "embedding-only-no-llm-v1",
			mutationAuthorizationPolicy: "none-immutable-turn-baseline-v1",
			endpointRouteBindingPolicy:
				"independent-key-hmac-sha256-observed-openai-embedding-route-v3",
		});
		expect(artifact.disclosure).not.toHaveProperty("llmModel");
		expect(Object.keys(artifact.receipt.implementations)).toEqual(
			expect.arrayContaining([
				"src/benchmark/quality/semantic-embedding-route-evidence.ts",
				"src/memory/embeddings.ts",
			]),
		);
	});

	it("rejects overlapping in-process provider executions without disturbing the active run", async () => {
		const root = await mkdtemp(resolve(tmpdir(), "semantic-raw-concurrent-"));
		roots.push(root);
		const source = semanticBlindFixture(root, {
			engines: ["plain-vector", "naia"],
		});
		let signalStarted!: () => void;
		const started = new Promise<void>((resolveStarted) => {
			signalStarted = resolveStarted;
		});
		let releaseFetch!: () => void;
		const fetchGate = new Promise<void>((resolveFetch) => {
			releaseFetch = resolveFetch;
		});
		vi.stubGlobal(
			"fetch",
			vi.fn<typeof fetch>(async (_input, init) => {
				signalStarted();
				await fetchGate;
				const body = JSON.parse(String(init?.body)) as { input: string[] };
				return Response.json({
					data: body.input.map((text, index) => ({
						index,
						embedding: [1, text.length + 1],
					})),
				});
			}),
		);

		const activeRun = runSemanticRawCli([
			"--engine=plain-vector",
			`--contract=${source.contractPath}`,
			`--output=${resolve(root, "active.json")}`,
			"--seed=active-run",
		]);
		await started;
		try {
			await expect(
				runSemanticRawCli([
					"--engine=plain-vector",
					`--contract=${source.contractPath}`,
					`--output=${resolve(root, "overlap.json")}`,
					"--seed=overlap-run",
				]),
			).rejects.toThrow("concurrent in-process semantic raw executions");
		} finally {
			releaseFetch();
		}
		await activeRun;
	});
});
