/**
 * Same-fixture Hindsight control for the structured supersession contract.
 * Hindsight performs its normal LLM-backed extraction/update path, while tags
 * enforce the same case and project scope used by the local benchmark.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { benchmarkReceipt } from "../provenance.js";
import { validateStructuredContract } from "./structured-supersession-schema.js";

const CONTRACT = process.env.BENCH_CONTRACT ?? "src/benchmark/quality/structured-supersession-contract-v3.json";
const TOPK = Number(process.env.BENCH_TOPK ?? 20);
const BASE_URL = process.env.HINDSIGHT_URL ?? "http://127.0.0.1:18888";
const BANK_ID = process.env.HINDSIGHT_BANK_ID ?? `naia-structured-v3-${Date.now()}`;
const RETAIN_CONCURRENCY = Number(process.env.HINDSIGHT_RETAIN_CONCURRENCY ?? 8);

type Statement = { id: string; content: string; project: string };
type ContractCase = {
	id: string;
	language: string;
	query: string;
	statements: Statement[];
	acceptable_statement_ids: string[];
	forbidden_statement_ids: string[];
	expected_inactive_statement_ids: string[];
	recall_project?: string;
};
type Contract = { schema_version: string; cases: ContractCase[] };
type RecallResult = { text: string; metadata?: Record<string, string> | null };

function pct(value: number): string {
	return `${(value * 100).toFixed(1)}%`;
}

async function request(path: string, method: "PUT" | "POST", body: unknown): Promise<unknown> {
	const response = await fetch(`${BASE_URL}${path}`, {
		method,
		headers: { "content-type": "application/json" },
		body: JSON.stringify(body),
		signal: AbortSignal.timeout(30 * 60 * 1000),
	});
	if (!response.ok) throw new Error(`${method} ${path} failed (${response.status}): ${(await response.text()).slice(0, 500)}`);
	return response.json();
}

async function mapConcurrent<T, R>(items: T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]> {
	const results = new Array<R>(items.length);
	let cursor = 0;
	async function worker(): Promise<void> {
		for (;;) {
			const index = cursor++;
			if (index >= items.length) return;
			results[index] = await fn(items[index]);
		}
	}
	await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
	return results;
}

async function main(): Promise<void> {
	if (!Number.isInteger(TOPK) || TOPK < 1) throw new Error("BENCH_TOPK must be a positive integer");
	if (!Number.isInteger(RETAIN_CONCURRENCY) || RETAIN_CONCURRENCY < 1) throw new Error("HINDSIGHT_RETAIN_CONCURRENCY must be a positive integer");
	const contract = JSON.parse(readFileSync(join(process.cwd(), CONTRACT), "utf8")) as Contract;
	validateStructuredContract(contract as Parameters<typeof validateStructuredContract>[0]);

	await request(`/v1/default/banks/${BANK_ID}`, "PUT", {
		name: "Naia structured supersession V3 control",
		enable_observations: false,
	});
	const startedAt = Date.now();
	const retain = await mapConcurrent(contract.cases, RETAIN_CONCURRENCY, (c) =>
		request(`/v1/default/banks/${BANK_ID}/memories`, "POST", {
			async: false,
			items: c.statements.map((statement, index) => ({
				content: statement.content,
				document_id: `${c.id}-${statement.id}`,
				metadata: { statementId: statement.id, caseId: c.id, project: statement.project },
				tags: [`case:${c.id}`, `project:${statement.project}`],
				timestamp: new Date(Date.UTC(2025, 0, 1, 0, 0, index)).toISOString(),
			})),
		}));

	const cases = [];
	for (const c of contract.cases) {
		const recall = await request(`/v1/default/banks/${BANK_ID}/memories/recall`, "POST", {
			query: c.query,
			budget: "high",
			max_tokens: 4096,
			tags: [`case:${c.id}`, `project:${c.recall_project ?? "profile"}`],
			tags_match: "exact",
			types: ["world", "experience"],
		}) as { results: RecallResult[] };
		const retrieved = [...new Set(recall.results
			.map((item) => item.metadata?.statementId)
			.filter((id): id is string => Boolean(id)))].slice(0, TOPK);
		const acceptableIndex = retrieved.findIndex((id) => c.acceptable_statement_ids.includes(id));
		const acceptableRanks = retrieved.map((id, index) => c.acceptable_statement_ids.includes(id) ? index + 1 : 0).filter(Boolean);
		const forbiddenRanks = retrieved.map((id, index) => c.forbidden_statement_ids.includes(id) ? index + 1 : 0).filter(Boolean);
		const staleForbiddenRanks = retrieved.map((id, index) => c.forbidden_statement_ids.includes(id) && c.expected_inactive_statement_ids.includes(id) ? index + 1 : 0).filter(Boolean);
		const activeDistractorRanks = retrieved.map((id, index) => c.forbidden_statement_ids.includes(id) && !c.expected_inactive_statement_ids.includes(id) ? index + 1 : 0).filter(Boolean);
		cases.push({
			id: c.id,
			language: c.language,
			query: c.query,
			retrieved_statement_ids: retrieved,
			acceptable_rank: acceptableIndex < 0 ? null : acceptableIndex + 1,
			acceptable_ranks: acceptableRanks,
			forbidden_ranks: forbiddenRanks,
			stale_forbidden_ranks: staleForbiddenRanks,
			active_distractor_ranks: activeDistractorRanks,
		});
	}

	const evaluated = cases.length;
	const score = {
		evaluated,
		hitAt1: cases.filter((c) => c.acceptable_rank === 1).length / evaluated,
		hitAtK: cases.filter((c) => c.acceptable_rank !== null).length / evaluated,
		completeAcceptableAtK: cases.filter((c, index) => c.acceptable_ranks.length === contract.cases[index].acceptable_statement_ids.length).length / evaluated,
		acceptableRecallAtK: cases.reduce((sum, c, index) => sum + c.acceptable_ranks.length / contract.cases[index].acceptable_statement_ids.length, 0) / evaluated,
		mrr: cases.reduce((sum, c) => sum + (c.acceptable_rank ? 1 / c.acceptable_rank : 0), 0) / evaluated,
		forbiddenAt1: cases.filter((c) => c.forbidden_ranks.includes(1)).length / evaluated,
		forbiddenAtK: cases.filter((c) => c.forbidden_ranks.length > 0).length / evaluated,
		staleForbiddenAtK: cases.filter((c) => c.stale_forbidden_ranks.length > 0).length / evaluated,
		activeDistractorAtK: cases.filter((c) => c.active_distractor_ranks.length > 0).length / evaluated,
		cases,
	};
	const receipt = benchmarkReceipt([CONTRACT], {
		engine: "hindsight",
		engineVersion: "0.9.1",
		containerImage: "ghcr.io/vectorize-io/hindsight:latest",
		containerDigest: "sha256:8a305bc7de1acbabd26da01820b2c31d77c6092d186f262029f5db0deda33729",
		mode: "normal synchronous retain and recall",
		llmProvider: "gemini",
		llmModel: "gemini-2.5-flash",
		embeddingProvider: "local",
		embeddingModel: "intfloat/multilingual-e5-small",
		device: "cpu",
		retainConcurrency: RETAIN_CONCURRENCY,
		topK: TOPK,
		protocolNote: "Hindsight accepts a token budget rather than result count; unique statement IDs are truncated to topK after recall.",
		elapsedMs: Date.now() - startedAt,
		retainResponse: retain,
	}, [
		"src/benchmark/quality/structured-supersession-hindsight-control.ts",
		"src/benchmark/provenance.ts",
	]);
	const output = {
		benchmark: "structured-supersession-contract-v3-hindsight-control",
		receipt,
		interpretation: "Executable feature-effect control using Hindsight's normal LLM-backed extraction/update path. API token-budget semantics and extraction differ from Naia's direct structured-ingest protocol.",
		score,
	};
	const directory = join(process.cwd(), "reports", "quality");
	mkdirSync(directory, { recursive: true });
	const artifact = join(directory, "structured-supersession-contract-v3-hindsight-gemini-2.5-flash-multilingual-e5-small-top20.json");
	writeFileSync(artifact, `${JSON.stringify(output, null, 2)}\n`);
	console.log(`hindsight: hit@1=${pct(score.hitAt1)} hit@${TOPK}=${pct(score.hitAtK)} complete@${TOPK}=${pct(score.completeAcceptableAtK)} acceptable-recall@${TOPK}=${pct(score.acceptableRecallAtK)} MRR=${score.mrr.toFixed(3)} forbidden@1=${pct(score.forbiddenAt1)} forbidden@${TOPK}=${pct(score.forbiddenAtK)}`);
	console.log(`Artifact: ${artifact}`);
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
