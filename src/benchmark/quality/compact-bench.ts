/**
 * Context-compression benchmark for MemorySystem.compact() — the /goal's
 * "실시간 컨텍스트 압축" axis. Measures, on a synthetic multi-turn conversation
 * with known anchor facts scattered through it:
 *   - compression ratio  = tokens(recap) / tokens(compacted window)
 *   - anchor-fact fidelity = fraction of injected key facts that survive
 *   - latency + realtime flag
 * across the paths compact() actually takes:
 *   (A) deterministic recap   — no summarizer, no rolling summary (default)
 *   (B) rolling-summary path  — sessionId primed via encode() (realtime=true)
 *   (C) mock summarizer       — upper bound if a real LLM polishes the recap
 *
 * Fully local — no external API. Run: npx tsx src/benchmark/quality/compact-bench.ts
 */
import { MemorySystem } from "../../memory/index.js";
import { LocalAdapter } from "../../memory/adapters/local.js";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const NOW = 1_720_000_000_000;
const estTokens = (s: string) => Math.ceil(s.length / 4);

// Anchor facts — each carries a rare, unique token we can detect in the recap.
const ANCHORS = [
	{ key: "Rex", text: "By the way, my dog's name is Rex." },
	{ key: "Busan", text: "I should mention I was born in Busan." },
	{ key: "March-15", text: "Remember my project deadline is March-15." },
	{ key: "dark-roast", text: "I really prefer dark-roast coffee over anything." },
	{ key: "Sarah-Kim", text: "My manager's name is Sarah-Kim." },
	{ key: "blue-Civic", text: "I drive a blue-Civic to work every day." },
	{ key: "peanut-allergy", text: "Important: I have a peanut-allergy so no nuts." },
	{ key: "Tuesday", text: "Our team standup is every Tuesday morning." },
	{ key: "guitar", text: "On weekends I like to play the guitar." },
	{ key: "Seattle", text: "We are relocating the office to Seattle next year." },
];

const FILLER_USER = [
	"Can you help me with something?",
	"That makes sense, thanks.",
	"Hmm, let me think about that.",
	"Okay, what should I do next?",
	"Interesting, tell me more.",
	"I see, and then what?",
];
const FILLER_ASSISTANT = [
	"Sure, I can help with that.",
	"Here is one way to approach it.",
	"Let me walk you through the steps.",
	"That depends on a few factors.",
	"Good question — consider the tradeoffs.",
	"Happy to elaborate on any part.",
];

type Msg = { role: string; content: string; timestamp: number };

function buildConversation(turns: number): Msg[] {
	const msgs: Msg[] = [];
	let t = NOW;
	// First user message = the "goal".
	msgs.push({ role: "user", content: "I want to plan my week and keep track of a few personal details.", timestamp: (t += 1000) });
	msgs.push({ role: "assistant", content: "Of course. Tell me the details and I'll keep track.", timestamp: (t += 1000) });
	let anchorIdx = 0;
	for (let i = 0; i < turns; i++) {
		// Every 4th user turn carries an anchor fact (scattered through the middle).
		if (i % 4 === 0 && anchorIdx < ANCHORS.length) {
			msgs.push({ role: "user", content: ANCHORS[anchorIdx++].text, timestamp: (t += 1000) });
		} else {
			msgs.push({ role: "user", content: FILLER_USER[i % FILLER_USER.length], timestamp: (t += 1000) });
		}
		msgs.push({ role: "assistant", content: FILLER_ASSISTANT[i % FILLER_ASSISTANT.length], timestamp: (t += 1000) });
	}
	return msgs;
}

function fidelity(recap: string): { hit: number; total: number; missing: string[] } {
	const hits = ANCHORS.filter((a) => recap.includes(a.key));
	return { hit: hits.length, total: ANCHORS.length, missing: ANCHORS.filter((a) => !recap.includes(a.key)).map((a) => a.key) };
}

async function measure(
	label: string,
	build: () => Promise<MemorySystem>,
	compactInput: (msgs: Msg[]) => Parameters<MemorySystem["compact"]>[0],
	msgs: Msg[],
) {
	const mem = await build();
	const window = compactInput(msgs);
	const compactedMsgs = window.messages;
	const inputChars = compactedMsgs.reduce((s, m) => s + m.content.length, 0);
	const t0 = performance.now();
	const res = await mem.compact(window);
	const latency = performance.now() - t0;
	const recap = res.summary.content;
	const fid = fidelity(recap);
	await mem.close?.();
	return {
		label,
		realtime: res.realtime ?? false,
		latencyMs: Number(latency.toFixed(3)),
		inputTokens: estTokens(compactedMsgs.map((m) => m.content).join(" ")),
		recapTokens: estTokens(recap),
		compressionRatio: Number((estTokens(recap) / estTokens(compactedMsgs.map((m) => m.content).join(" "))).toFixed(3)),
		inputChars,
		recapChars: recap.length,
		fidelityPct: Number(((fid.hit / fid.total) * 100).toFixed(1)),
		missing: fid.missing,
	};
}

async function main() {
	const TURNS = Number(process.env.BENCH_TURNS ?? 40); // ~82 messages
	const KEEP_TAIL = 8;
	const msgs = buildConversation(TURNS);
	console.log(`=== compact() compression bench (turns=${TURNS}, messages=${msgs.length}, keepTail=${KEEP_TAIL}, anchors=${ANCHORS.length}) ===`);

	const head = msgs.slice(0, msgs.length - KEEP_TAIL);

	// (A) deterministic — no summarizer, no rolling summary
	const A = await measure(
		"A: deterministic recap",
		async () => {
			const m = new MemorySystem({ adapter: new LocalAdapter() });
			await m.init();
			return m;
		},
		() => ({ messages: head, keepTail: KEEP_TAIL, targetTokens: 500 }),
		msgs,
	);

	// (B) rolling-summary path — prime sessionId via encode() so realtime=true
	const B = await measure(
		"B: rolling-summary (primed)",
		async () => {
			const m = new MemorySystem({ adapter: new LocalAdapter() });
			await m.init();
			// Prime the rolling summary by encoding the head turns under a sessionId.
			for (const msg of head) {
				await m.encode({ role: msg.role as any, content: msg.content, timestamp: msg.timestamp }, { sessionId: "bench-sess" } as any);
			}
			return m;
		},
		() => ({ messages: head, keepTail: KEEP_TAIL, targetTokens: 500, sessionId: "bench-sess" }),
		msgs,
	);

	// (C) mock summarizer — models an LLM that extracts every stated fact
	const C = await measure(
		"C: mock LLM summarizer",
		async () => {
			const m = new MemorySystem({
				adapter: new LocalAdapter(),
				// A "good" summarizer would preserve stated facts; model that here.
				summarizer: async ({ messages }: any) => {
					const facts = (messages as Msg[])
						.filter((mm) => mm.role === "user")
						.map((mm) => mm.content)
						.filter((c) => ANCHORS.some((a) => c.includes(a.key)));
					return { content: `Recap of ${messages.length} messages. Key facts: ${facts.join(" ")}`, realtime: true };
				},
			} as any);
			await m.init();
			return m;
		},
		() => ({ messages: head, keepTail: KEEP_TAIL, targetTokens: 500, sessionId: "bench-sess-c" }),
		msgs,
	);

	const rows = [A, B, C];
	console.log("\n| Path | realtime | latency ms | in tok | recap tok | compression | fidelity |");
	console.log("|---|---|---|---|---|---|---|");
	for (const r of rows) {
		console.log(`| ${r.label} | ${r.realtime} | ${r.latencyMs} | ${r.inputTokens} | ${r.recapTokens} | ${(r.compressionRatio * 100).toFixed(1)}% | ${r.fidelityPct}% |`);
	}
	for (const r of rows) {
		if (r.missing.length > 0) console.log(`  ${r.label} dropped: ${r.missing.join(", ")}`);
	}

	const outDir = join(process.cwd(), "reports", "quality");
	mkdirSync(outDir, { recursive: true });
	const outPath = join(outDir, `compact-compression.json`);
	writeFileSync(outPath, JSON.stringify({ benchmark: "compact-compression", turns: TURNS, messages: msgs.length, keepTail: KEEP_TAIL, anchors: ANCHORS.length, results: rows }, null, 2));
	console.log(`\nArtifact: ${outPath}`);
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
