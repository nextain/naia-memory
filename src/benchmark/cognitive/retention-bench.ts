/**
 * Cognitive retention benchmark — the /goal's "소뇌: 기억" axis, made objective.
 *
 * Measures BEHAVIORAL properties of the Ebbinghaus decay model (decay.ts),
 * not just that the formula computes (unit tests cover that):
 *   1. Half-life & survival by importance — important memories persist longer.
 *   2. Recall reinforcement — recalling a memory extends its life (Hebbian /
 *      spacing effect).
 *   3. Forgetting discrimination — at a time horizon, are important memories
 *      retained and trivial ones forgotten? (ranking AUC + threshold precision/recall)
 *
 * Fully deterministic (no embedder/LLM). Run:
 *   npx tsx src/benchmark/cognitive/retention-bench.ts
 */
import { calculateStrength, PRUNE_THRESHOLD, BASE_DECAY, IMPORTANCE_DAMPING } from "../../memory/decay.js";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const DAY = 24 * 60 * 60 * 1000;
const T0 = 1_600_000_000_000; // fixed epoch (no Date.now — determinism)

/** strength at `day` for a memory created at day 0, last accessed at `lastAccessDay`. */
const strengthAt = (importance: number, recallCount: number, day: number, lastAccessDay = 0) =>
	calculateStrength(importance, T0, recallCount, T0 + lastAccessDay * DAY, T0 + day * DAY);

/** First integer day at which strength drops below `frac` × initial (or absolute if abs). */
function daysUntil(importance: number, recallCount: number, target: number): number {
	for (let d = 0; d <= 3650; d++) {
		if (strengthAt(importance, recallCount, d) < target) return d;
	}
	return Infinity;
}

function main() {
	console.log(`=== Cognitive Retention Bench (BASE_DECAY=${BASE_DECAY}, IMPORTANCE_DAMPING=${IMPORTANCE_DAMPING}, prune=${PRUNE_THRESHOLD}) ===`);

	// 1. Half-life & survival by importance ---------------------------------
	const importances = [0.1, 0.3, 0.5, 0.7, 0.9];
	const survival = importances.map((imp) => {
		const initial = strengthAt(imp, 0, 0);
		const halfLife = daysUntil(imp, 0, initial * 0.5);
		const survivalDays = daysUntil(imp, 0, PRUNE_THRESHOLD);
		return { importance: imp, initialStrength: Number(initial.toFixed(3)), halfLifeDays: halfLife, survivalDays };
	});
	console.log("\n1) Half-life & survival by importance (no recall)");
	console.log("| importance | initial | half-life (d) | survival to prune (d) |");
	console.log("|---|---|---|---|");
	for (const s of survival) console.log(`| ${s.importance} | ${s.initialStrength} | ${s.halfLifeDays} | ${s.survivalDays} |`);

	// 2. Recall reinforcement (spacing / Hebbian) ---------------------------
	// (a) multiplier effect: survival vs recallCount at fixed importance.
	// (b) clock-reset effect: a recall at day R resets decay → survival extends.
	const impFixed = 0.5;
	const recallCounts = [0, 1, 3, 5, 10];
	const reinforcement = recallCounts.map((rc) => ({
		recallCount: rc,
		survivalDays: daysUntil(impFixed, rc, PRUNE_THRESHOLD),
	}));
	console.log(`\n2) Recall reinforcement — survival to prune vs recallCount (importance=${impFixed})`);
	console.log("| recallCount | survival (d) |");
	console.log("|---|---|");
	for (const r of reinforcement) console.log(`| ${r.recallCount} | ${r.survivalDays} |`);
	// clock reset: strength of a trivial fact recalled at day 30 vs never, measured at day 31
	const noRecall = strengthAt(0.3, 0, 31, 0);
	const recalledAt30 = strengthAt(0.3, 1, 31, 30); // recall resets lastAccessed to day 30
	console.log(`   clock-reset: trivial(0.3) at day31 — never-recalled=${noRecall.toFixed(3)} vs recalled@30=${recalledAt30.toFixed(3)} (×${(recalledAt30 / noRecall).toFixed(1)})`);

	// 3. Forgetting discrimination ------------------------------------------
	// Population: 50 important (imp 0.7–0.9) + 50 trivial (imp 0.1–0.3), created day 0, no recall.
	// "should be retained" = important. Measure at several horizons.
	const pop: { imp: number; important: boolean }[] = [];
	for (let i = 0; i < 50; i++) pop.push({ imp: 0.7 + (i % 3) * 0.1, important: true });
	for (let i = 0; i < 50; i++) pop.push({ imp: 0.1 + (i % 3) * 0.1, important: false });
	const horizons = [7, 30, 90, 180];
	console.log("\n3) Forgetting discrimination (50 important vs 50 trivial)");
	console.log("| day | AUC (imp>triv ranking) | retained-important % | pruned-trivial % |");
	console.log("|---|---|---|---|");
	const discRows = horizons.map((T) => {
		const scored = pop.map((p) => ({ ...p, s: strengthAt(p.imp, 0, T) }));
		// AUC: fraction of (important, trivial) pairs where important has higher strength
		const imps = scored.filter((x) => x.important).map((x) => x.s);
		const trivs = scored.filter((x) => !x.important).map((x) => x.s);
		let correct = 0, ties = 0;
		for (const a of imps) for (const b of trivs) { if (a > b) correct++; else if (a === b) ties++; }
		const auc = (correct + 0.5 * ties) / (imps.length * trivs.length);
		const retainedImp = scored.filter((x) => x.important && x.s >= PRUNE_THRESHOLD).length / imps.length;
		const prunedTriv = scored.filter((x) => !x.important && x.s < PRUNE_THRESHOLD).length / trivs.length;
		return { day: T, auc: Number(auc.toFixed(3)), retainedImportantPct: Number((retainedImp * 100).toFixed(1)), prunedTrivialPct: Number((prunedTriv * 100).toFixed(1)) };
	});
	for (const r of discRows) console.log(`| ${r.day} | ${r.auc} | ${r.retainedImportantPct}% | ${r.prunedTrivialPct}% |`);

	const outDir = join(process.cwd(), "reports", "cognitive");
	mkdirSync(outDir, { recursive: true });
	writeFileSync(join(outDir, "retention.json"), JSON.stringify({
		benchmark: "cognitive-retention",
		model: { baseDecay: BASE_DECAY, importanceDamping: IMPORTANCE_DAMPING, pruneThreshold: PRUNE_THRESHOLD },
		survivalByImportance: survival,
		recallReinforcement: { survivalVsRecallCount: reinforcement, clockReset: { neverRecalled: noRecall, recalledAt30: recalledAt30 } },
		discrimination: discRows,
	}, null, 2));
	console.log(`\nArtifact: reports/cognitive/retention.json`);
}

main();
