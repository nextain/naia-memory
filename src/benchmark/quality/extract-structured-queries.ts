import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { buildLLMQueryStructurer } from "../../memory/llm-query-structurer.js";
import type { StructuredContract } from "./structured-supersession-schema.js";

const contractPath =
	process.env.BENCH_CONTRACT ??
	"src/benchmark/quality/structured-supersession-contract-v3.json";
const outputPath =
	process.env.BENCH_QUERY_PREDICTIONS ??
	"reports/quality/structured-query-predictions-v3.json";
const baseURL =
	process.env.BENCH_LLM_BASE_URL ??
	"https://generativelanguage.googleapis.com/v1beta/openai";
const model = process.env.BENCH_LLM_MODEL ?? "gemini-2.5-flash";
const apiKey = process.env.BENCH_LLM_API_KEY ?? "";
const identityIdsRequested = process.env.BENCH_QUERY_IDENTITY_IDS === "true";

if (!apiKey) throw new Error("BENCH_LLM_API_KEY is required");
const contract = JSON.parse(
	readFileSync(join(process.cwd(), contractPath), "utf8"),
) as StructuredContract;
const structure = buildLLMQueryStructurer({
	apiKey,
	baseURL,
	model,
	includeIdentityIds: identityIdsRequested,
});
const predictions: Record<string, unknown> = {};
let exact = 0;
let exactSubject = 0;
let exactProperty = 0;
let failures = 0;
let completeIdentityIdPairs = 0;
const startedAt = new Date().toISOString();

for (const [index, benchmarkCase] of contract.cases.entries()) {
	const prediction = await structure(benchmarkCase.query);
	predictions[benchmarkCase.id] = prediction ?? null;
	if (!prediction) failures++;
	if (prediction?.subjectId && prediction.propertyId) completeIdentityIdPairs++;
	if (prediction?.subject === benchmarkCase.recall_structured_query?.subject)
		exactSubject++;
	if (prediction?.property === benchmarkCase.recall_structured_query?.property)
		exactProperty++;
	if (
		prediction?.subject === benchmarkCase.recall_structured_query?.subject &&
		prediction.property === benchmarkCase.recall_structured_query?.property
	)
		exact++;
	if ((index + 1) % 12 === 0)
		console.log(`structured ${index + 1}/${contract.cases.length}`);
}

const artifact = {
	schemaVersion: "naia-memory-structured-query-predictions-v1",
	contract: contractPath,
	startedAt,
	completedAt: new Date().toISOString(),
	provider: { baseURL, model, auth: "bearer", identityIdsRequested },
	score: {
		evaluated: contract.cases.length,
		exactIdentity: exact / contract.cases.length,
		exactSubject: exactSubject / contract.cases.length,
		exactProperty: exactProperty / contract.cases.length,
		failures,
		completeIdentityIdPairs,
		completeIdentityIdPairCoverage:
			completeIdentityIdPairs / contract.cases.length,
		metricDisclosure:
			"Label metrics are exact string equality against fixture subject/property; no oracle normalization is applied. completeIdentityIdPairCoverage reports output presence only. This fixture has no subjectId/propertyId oracle, so the artifact does not measure ID correctness and must not support an ID-accuracy or product-readiness claim.",
	},
	predictions,
};
mkdirSync(dirname(join(process.cwd(), outputPath)), { recursive: true });
writeFileSync(
	join(process.cwd(), outputPath),
	`${JSON.stringify(artifact, null, 2)}\n`,
);
console.log(
	`exact identity: ${exact}/${contract.cases.length} (${((exact / contract.cases.length) * 100).toFixed(1)}%), failures=${failures}`,
);
console.log(`Artifact: ${outputPath}`);
