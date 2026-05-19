import { MemorySystem, OpenAICompatEmbeddingProvider, LocalAdapter } from "../memory/index.js";
import { buildLLMFactExtractor } from "../memory/llm-fact-extractor.js";
import { randomUUID } from "node:crypto";

const API_KEY = process.env.GEMINI_API_KEY || "";
const BASE = "https://generativelanguage.googleapis.com/v1beta/openai";

const dialogues = [
	"Caroline: Hey Mel! I went to the LGBTQ support group on May 7. It was so empowering!",
	"Melanie: That's awesome Caroline! I actually ran a charity race last Saturday, on April 15!",
	"Caroline: I've been friends with my current group for about 3 years now, they're amazing.",
	"Melanie: Guess what, I started my new job at the bakery on March 15! Loving it so far.",
	"Caroline: My birthday is coming up on June 12, I'll be 25! Planning a big party.",
	"Jon: Bad news... I lost my job as a banker back in January. It's been tough.",
	"Gina: I teamed up with a local artist named Park for some cool designs in August!",
	"Maria: Jean and I had dinner on May 3 at this amazing Italian place downtown.",
	"Nate: I'm obsessed with double espresso from Blue Bottle, it's my absolute favorite.",
	"Joanna: I moved to Portland from Seattle in 2022 for a design position at a startup.",
	"Tim: We adopted the sweetest golden retriever named Biscuit back in 2021!",
	"John: I finally completed the marathon! Finished in 4 hours and 32 minutes!",
	"Melanie: I volunteer at the animal shelter every Saturday morning, it's so rewarding.",
	"Caroline: Ugh, I just found out I'm allergic to peanuts and shellfish. No more shrimp...",
	"Jon: My ideal dance studio would have high ceilings and lots of natural light.",
];

const questions = [
	{ q: "When did Caroline go to the LGBTQ support group?", a: "May 7" },
	{ q: "What did Melanie do on April 15?", a: "charity race" },
	{ q: "How long has Caroline had her current group of friends?", a: "3 years" },
	{ q: "When did Melanie start her new job?", a: "March 15" },
	{ q: "When is Caroline's birthday?", a: "June 12" },
	{ q: "When did Jon lose his banking job?", a: "January" },
	{ q: "Who did Gina collaborate with?", a: "Park" },
	{ q: "Who did Maria have dinner with on May 3?", a: "Jean" },
	{ q: "What is Nate's favorite coffee?", a: "double espresso" },
	{ q: "Where did Joanna move from?", a: "Seattle" },
	{ q: "What kind of dog does Tim have?", a: "golden retriever" },
	{ q: "How long did it take John to finish the marathon?", a: "4 hours" },
	{ q: "When does Melanie volunteer?", a: "Saturday" },
	{ q: "What is Caroline allergic to?", a: "peanuts" },
	{ q: "What does Jon's ideal dance studio have?", a: "high ceilings" },
];

async function testMode(mode: "raw_episode" | "llm_extract") {
	const storePath = `/tmp/quick-test-${mode}-${Date.now()}.json`;
	const embedder = new OpenAICompatEmbeddingProvider(BASE, API_KEY, "gemini-embedding-001", 3072);
	const adapter = new LocalAdapter({ storePath, embeddingProvider: embedder });

	let factExtractor;
	if (mode === "raw_episode") {
		factExtractor = async (episodes: any[]) =>
			episodes.map((ep) => ({
				content: ep.content,
				entities: [],
				topics: ep.encodingContext.project ? [ep.encodingContext.project] : [],
				importance: ep.importance.utility,
				maxEmotion: ep.importance.emotion ?? 0,
				sourceEpisodeIds: [ep.id],
			}));
	} else {
		factExtractor = buildLLMFactExtractor({ apiKey: API_KEY });
	}

	const system = new MemorySystem({ adapter, factExtractor });

	for (const d of dialogues) {
		await system.encode(
			{ content: d, role: "user" },
			{ project: "test_user" },
		);
	}

	const cr = await system.consolidateNow(true);

	let correct = 0;
	const misses: string[] = [];
	for (const { q, a } of questions) {
		const result = await system.recall(q, { project: "test_user", topK: 10 });
		const allText = [...result.facts.map((f) => f.content), ...result.episodes.map((e) => e.content)].join(" ").toLowerCase();
		if (allText.includes(a.toLowerCase())) correct++;
		else misses.push(`${q} (expected: ${a})`);
	}

	return { correct, total: questions.length, factsCreated: cr.factsCreated, misses };
}

async function main() {
	console.log("=== Quick Comparison: raw_episode vs LLM extraction ===\n");

	console.log("[1] Raw episode (버그 상태 - fallback)...");
	const r1 = await testMode("raw_episode");
	console.log(`  Result: ${r1.correct}/${r1.total} (${(r1.correct/r1.total*100).toFixed(0)}%) — ${r1.factsCreated} facts`);
	if (r1.misses.length) r1.misses.forEach(m => console.log(`    MISS: ${m}`));
	console.log();

	console.log("[2] LLM extraction (수정 후)...");
	const r2 = await testMode("llm_extract");
	console.log(`  Result: ${r2.correct}/${r2.total} (${(r2.correct/r2.total*100).toFixed(0)}%) — ${r2.factsCreated} facts`);
	if (r2.misses.length) r2.misses.forEach(m => console.log(`    MISS: ${m}`));
	console.log();

	console.log(`=== 요약 ===`);
	console.log(`  Before (raw): ${r1.correct}/${r1.total}`);
	console.log(`  After  (LLM): ${r2.correct}/${r2.total}`);
	console.log(`  개선: ${r2.correct - r1.correct > 0 ? '+' : ''}${r2.correct - r1.correct} points`);
}

main().catch(console.error);
