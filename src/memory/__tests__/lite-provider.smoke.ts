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
import { createRequire } from "node:module";
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
// cat/dog orthogonal; mix → fractional cosine vs cat (1/√2≈0.7071);
// neg → anti-correlated vs cat (raw −1 → clamp 0, distinct from orthogonal).
const VEC = {
	cat: [1, 0, 0],
	dog: [0, 1, 0],
	mix: [1, 1, 0],
	neg: [-1, 0, 0],
};

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

await t("B2: cosine produces real fractional score + anti-correlated clamp", async () => {
	const p = new LiteMemoryProvider({ dbPath: ":memory:", embedder: new FakeEmbedder(3, VEC), writesEnabled: true });
	await p.encode({ content: "mix fact", role: "user" }); // vec [1,1,0]
	await p.encode({ content: "neg fact", role: "user" }); // vec [-1,0,0]
	const h = await p.recall("cat", { topK: 2 }); // query [1,0,0]
	const byId = Object.fromEntries(h.map((x) => [x.content, x.score]));
	// mix: 1/√2 ≈ 0.7071 — kills "identity-equality" cosine mutation.
	assert.ok(Math.abs(byId["mix fact"] - 0.70710678) < 1e-6, `mix=${byId["mix fact"]}`);
	// neg: raw cosine −1 → clamp 0 (distinct path from orthogonal).
	assert.equal(byId["neg fact"], 0);
	assert.equal(h[0].content, "mix fact"); // 0.707 > 0 ordering
	await p.close();
});

await t("corrupt vec row → skipped, no throw (anchor #6 preservation)", async () => {
	const db = join(dir, "corrupt.db");
	const p = new LiteMemoryProvider({ dbPath: db, embedder: new FakeEmbedder(3, VEC), writesEnabled: true });
	await p.encode({ content: "cat fact", role: "user" });
	await p.close();
	// Inject a corrupt-vec row directly (same native CJS require path).
	const require = createRequire(import.meta.url);
	const Database = require("better-sqlite3") as typeof import("better-sqlite3");
	const raw = new Database(db);
	raw.prepare(
		"INSERT INTO lite_facts (id, content, vec, dims, project, created_at) VALUES (?,?,?,?,?,?)",
	).run("bad1", "corrupt", "{not json", 3, null, Date.now());
	raw.close();
	const p2 = new LiteMemoryProvider({ dbPath: db, embedder: new FakeEmbedder(3, VEC) });
	const h = await p2.recall("cat"); // must NOT throw; corrupt row skipped
	assert.equal(h.length, 1);
	assert.equal(h[0].content, "cat fact");
	await p2.close();
});

await t("consolidate no-op summary; close ok", async () => {
	const p = new LiteMemoryProvider({ dbPath: ":memory:", embedder: new FakeEmbedder(3, VEC) });
	assert.deepEqual(await p.consolidate(), { factsCreated: 0, factsUpdated: 0, episodesProcessed: 0, durationMs: 0 });
	await p.close();
});

rmSync(dir, { recursive: true, force: true });
console.log(`\nLiteMemoryProvider smoke: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
