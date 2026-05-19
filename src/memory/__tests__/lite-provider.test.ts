import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { EmbeddingProvider } from "../embeddings.js";
import { LiteMemoryProvider } from "../lite-provider.js";

/**
 * 8G LiteMemoryProvider — contract + step-1 cross-review reinforcements
 * (F1 project scope / F2 dim integrity / F3 graceful embed-fail / F4 topK
 * sanitize / F5 append-only / writes-off default). naia-agent#41.
 */

/** Deterministic fake embedder — keyword one-hot so cosine is predictable. */
class FakeEmbedder implements EmbeddingProvider {
	readonly name = "fake";
	#fail = false;
	constructor(readonly dims: number, private readonly map: Record<string, number[]>) {}
	setFail(v: boolean) {
		this.#fail = v;
	}
	async embed(text: string): Promise<number[]> {
		if (this.#fail) throw new Error("embed boom");
		const key = Object.keys(this.map).find((k) => text.includes(k));
		return key ? this.map[key] : new Array(this.dims).fill(0);
	}
	async embedBatch(texts: string[]): Promise<number[][]> {
		return Promise.all(texts.map((t) => this.embed(t)));
	}
}

const VEC = { cat: [1, 0, 0], dog: [0, 1, 0], fish: [0, 0, 1] };

let dir: string;
afterEach(async () => {
	if (dir) await rm(dir, { recursive: true, force: true });
});
beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), "lite-"));
});

describe("LiteMemoryProvider", () => {
	it("writes-off by default → encode is a no-op, recall empty", async () => {
		const p = new LiteMemoryProvider({
			dbPath: ":memory:",
			embedder: new FakeEmbedder(3, VEC),
		});
		await p.encode({ content: "cat fact", role: "user" });
		expect(await p.recall("cat")).toEqual([]);
		await p.close();
	});

	it("writesEnabled → encode persists; recall returns cosine-ordered topK normalized 0..1", async () => {
		const p = new LiteMemoryProvider({
			dbPath: ":memory:",
			embedder: new FakeEmbedder(3, VEC),
			writesEnabled: true,
		});
		await p.encode({ content: "cat fact", role: "user" });
		await p.encode({ content: "dog fact", role: "user" });
		const hits = await p.recall("cat", { topK: 2 });
		expect(hits.map((h) => h.content)).toEqual(["cat fact", "dog fact"]);
		expect(hits[0].score).toBeCloseTo(1, 5); // identical vec
		expect(hits[1].score).toBe(0); // orthogonal
		expect(hits[0].id).toMatch(/^lf_/);
		expect(typeof hits[0].createdAt).toBe("number");
		await p.close();
	});

	it("F1: opts.project isolates strictly; no project → all", async () => {
		const p = new LiteMemoryProvider({
			dbPath: ":memory:",
			embedder: new FakeEmbedder(3, VEC),
			writesEnabled: true,
		});
		await p.encode({ content: "cat A", role: "user" }, { project: "A" });
		await p.encode({ content: "cat B", role: "user" }, { project: "B" });
		expect((await p.recall("cat", { project: "A" })).map((h) => h.content)).toEqual(["cat A"]);
		expect((await p.recall("cat")).length).toBe(2);
		await p.close();
	});

	it("F2: embedder dimension change between write and recall → loud throw", async () => {
		const db = join(dir, "f2.db");
		const w = new LiteMemoryProvider({
			dbPath: db,
			embedder: new FakeEmbedder(3, VEC),
			writesEnabled: true,
		});
		await w.encode({ content: "cat fact", role: "user" });
		await w.close();
		const r = new LiteMemoryProvider({
			dbPath: db,
			embedder: new FakeEmbedder(4, { cat: [1, 0, 0, 0] }),
		});
		await expect(r.recall("cat")).rejects.toThrow(/dimension changed/);
		await r.close();
	});

	it("F3: embed failure in recall → [] (graceful, anchor #6)", async () => {
		const emb = new FakeEmbedder(3, VEC);
		const p = new LiteMemoryProvider({
			dbPath: ":memory:",
			embedder: emb,
			writesEnabled: true,
		});
		await p.encode({ content: "cat fact", role: "user" });
		emb.setFail(true);
		expect(await p.recall("cat")).toEqual([]);
		await p.close();
	});

	it("F4: invalid topK (NaN/0/neg) → default; empty query → []", async () => {
		const p = new LiteMemoryProvider({
			dbPath: ":memory:",
			embedder: new FakeEmbedder(3, VEC),
			writesEnabled: true,
			defaultTopK: 1,
		});
		await p.encode({ content: "cat fact", role: "user" });
		await p.encode({ content: "cat two", role: "user" });
		expect((await p.recall("cat", { topK: Number.NaN })).length).toBe(1);
		expect((await p.recall("cat", { topK: -3 })).length).toBe(1);
		expect(await p.recall("   ")).toEqual([]);
		await p.close();
	});

	it("consolidate is a no-op summary (preservation-first); close ok", async () => {
		const p = new LiteMemoryProvider({
			dbPath: ":memory:",
			embedder: new FakeEmbedder(3, VEC),
		});
		expect(await p.consolidate()).toEqual({
			factsCreated: 0,
			factsUpdated: 0,
			episodesProcessed: 0,
			durationMs: 0,
		});
		await expect(p.close()).resolves.toBeUndefined();
	});
});
