/**
 * LiteMemoryProvider smoke — REAL provider + REAL better-sqlite3.
 *
 * Why a tsx smoke instead of (only) vitest: vitest's module runner double-
 * loads the better-sqlite3 native addon under Node v26 ("Module did not
 * self-register") — a vitest/native-addon env defect (plain `node` require
 * works). The vitest spec (lite-provider.test.ts) is kept for when that is
 * fixed; THIS smoke is the active "real backend 호출" slice verification.
 *
 * Run:  pnpm exec tsx src/memory/__tests__/lite-provider.smoke.ts
 * Exit: 0 all pass / 1 any fail.
 */

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { EmbeddingProvider } from "../embeddings.js";
import { LiteMemoryProvider } from "../lite-provider.js";

class FakeEmbedder implements EmbeddingProvider {
	readonly name = "fake";
	#fail = false;
	constructor(readonly dims: number, private readonly map: Record<string, number[]>) {}
	setFail(v: boolean) {
		this.#fail = v;
	}
	async embed(text: string): Promise<number[]> {
		if (this.#fail) throw new Error("embed boom");
		const k = Object.keys(this.map).find((x) => text.includes(x));
		return k ? this.map[k] : new Array(this.dims).fill(0);
	}
	async embedBatch(t: string[]): Promise<number[][]> {
		return Promise.all(t.map((x) => this.embed(x)));
	}
}
const VEC = { cat: [1, 0, 0], dog: [0, 1, 0] };

let pass = 0;
let fail = 0;
async function t(name: string, fn: () => Promise<void>) {
	try {
		await fn();
		pass++;
		console.log(`✓ ${name}`);
	} catch (e) {
		fail++;
		console.log(`✗ ${name}\n  ${(e as Error).message}`);
	}
}

const dir = mkdtempSync(join(tmpdir(), "lite-smoke-"));

await t("writes-off default → encode no-op, recall empty", async () => {
	const p = new LiteMemoryProvider({ dbPath: ":memory:", embedder: new FakeEmbedder(3, VEC) });
	await p.encode({ content: "cat fact", role: "user" });
	assert.deepEqual(await p.recall("cat"), []);
	await p.close();
});

await t("writesEnabled → persist; recall cosine-ordered topK, score 0..1", async () => {
	const p = new LiteMemoryProvider({ dbPath: ":memory:", embedder: new FakeEmbedder(3, VEC), writesEnabled: true });
	await p.encode({ content: "cat fact", role: "user" });
	await p.encode({ content: "dog fact", role: "user" });
	const h = await p.recall("cat", { topK: 2 });
	assert.deepEqual(h.map((x) => x.content), ["cat fact", "dog fact"]);
	assert.ok(Math.abs(h[0].score - 1) < 1e-9, `score0=${h[0].score}`);
	assert.equal(h[1].score, 0);
	assert.match(h[0].id, /^lf_/);
	await p.close();
});

await t("F1 project isolation; no project → all", async () => {
	const p = new LiteMemoryProvider({ dbPath: ":memory:", embedder: new FakeEmbedder(3, VEC), writesEnabled: true });
	await p.encode({ content: "cat A", role: "user" }, { project: "A" });
	await p.encode({ content: "cat B", role: "user" }, { project: "B" });
	assert.deepEqual((await p.recall("cat", { project: "A" })).map((x) => x.content), ["cat A"]);
	assert.equal((await p.recall("cat")).length, 2);
	await p.close();
});

await t("F2 dim change between write/recall → loud throw", async () => {
	const db = join(dir, "f2.db");
	const w = new LiteMemoryProvider({ dbPath: db, embedder: new FakeEmbedder(3, VEC), writesEnabled: true });
	await w.encode({ content: "cat fact", role: "user" });
	await w.close();
	const r = new LiteMemoryProvider({ dbPath: db, embedder: new FakeEmbedder(4, { cat: [1, 0, 0, 0] }) });
	await assert.rejects(() => r.recall("cat"), /dimension changed/);
	await r.close();
});

await t("F3 embed failure in recall → [] graceful", async () => {
	const e = new FakeEmbedder(3, VEC);
	const p = new LiteMemoryProvider({ dbPath: ":memory:", embedder: e, writesEnabled: true });
	await p.encode({ content: "cat fact", role: "user" });
	e.setFail(true);
	assert.deepEqual(await p.recall("cat"), []);
	await p.close();
});

await t("F4 invalid topK → default; empty query → []", async () => {
	const p = new LiteMemoryProvider({ dbPath: ":memory:", embedder: new FakeEmbedder(3, VEC), writesEnabled: true, defaultTopK: 1 });
	await p.encode({ content: "cat one", role: "user" });
	await p.encode({ content: "cat two", role: "user" });
	assert.equal((await p.recall("cat", { topK: Number.NaN })).length, 1);
	assert.equal((await p.recall("cat", { topK: -3 })).length, 1);
	assert.deepEqual(await p.recall("   "), []);
	await p.close();
});

await t("consolidate no-op summary; close ok", async () => {
	const p = new LiteMemoryProvider({ dbPath: ":memory:", embedder: new FakeEmbedder(3, VEC) });
	assert.deepEqual(await p.consolidate(), { factsCreated: 0, factsUpdated: 0, episodesProcessed: 0, durationMs: 0 });
	await p.close();
});

rmSync(dir, { recursive: true, force: true });
console.log(`\nLiteMemoryProvider smoke: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
