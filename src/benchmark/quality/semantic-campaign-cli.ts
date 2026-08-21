import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { benchmarkReceipt } from "../provenance.js";
import {
	type MemoryUpdateCase,
	type MemoryUpdateContract,
	validateMemoryUpdateContract,
} from "./memory-update-contract.js";
import { runSemanticRawCli } from "./semantic-raw-cli.js";
import type { SemanticEngine } from "./semantic-raw-cli.js";

export const SUPPORTED_SEMANTIC_ENGINES = [
	"hindsight",
	"mem0",
	"naia",
] as const;

export type SemanticCampaignCliArgs = {
	contractPath: string;
	outputDir: string;
	topK: number;
	executionSeed: string;
	repetitions: number;
	engines: SemanticEngine[];
};

export type SemanticCampaignRun = {
	repetition: number;
	enginePosition: number;
	engine: string;
	caseExecutionSeed: string;
	outputFile: string;
};

function sha256(value: unknown): string {
	return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function fileSha256(path: string): string {
	return createHash("sha256").update(readFileSync(path)).digest("hex");
}

export function validateRawArtifact(
	path: string,
	expected: SemanticCampaignRun,
	expectedCases: MemoryUpdateCase[],
	expectedTopK: number,
): void {
	const artifact = JSON.parse(readFileSync(path, "utf8")) as {
		schemaVersion?: unknown;
		disclosure?: { engine?: unknown; executionSeed?: unknown; topK?: unknown };
		cases?: Array<{
			caseId?: unknown;
			executionPosition?: unknown;
			language?: unknown;
			fixtureSha256?: unknown;
			engineInputSha256?: unknown;
			ingestionPolicy?: unknown;
			temporalInputPolicy?: unknown;
			retrievalSurface?: unknown;
			ingestionReceipts?: unknown;
			nativeState?: unknown;
			retrieved?: unknown;
			outputSha256?: unknown;
		}>;
	};
	const expectedById = new Map(expectedCases.map((item) => [item.id, item]));
	if (
		artifact.schemaVersion !== "naia-memory-semantic-raw-artifact-v2" ||
		artifact.disclosure?.engine !== expected.engine ||
		artifact.disclosure.executionSeed !== expected.caseExecutionSeed ||
		artifact.disclosure.topK !== expectedTopK ||
		!Array.isArray(artifact.cases) ||
		artifact.cases.length !== expectedCases.length ||
		new Set(artifact.cases.map((item) => item.caseId)).size !==
			expectedCases.length ||
		artifact.cases.some((item, index) => {
			const benchmarkCase =
				typeof item.caseId === "string"
					? expectedById.get(item.caseId)
					: undefined;
			const nativeState = Array.isArray(item.nativeState)
				? (item.nativeState as Array<{
						nativeId?: unknown;
						content?: unknown;
					}>)
				: [];
			const retrieved = Array.isArray(item.retrieved)
				? (item.retrieved as Array<{
						nativeId?: unknown;
						content?: unknown;
					}>)
				: [];
			const nativeIds = new Set(nativeState.map((memory) => memory.nativeId));
			return (
				benchmarkCase === undefined ||
				item.executionPosition !== index + 1 ||
				item.language !== benchmarkCase.language ||
				item.fixtureSha256 !==
					sha256({
						language: benchmarkCase.language,
						turns: benchmarkCase.turns,
						query: benchmarkCase.query,
					}) ||
				item.engineInputSha256 !==
					sha256({
						language: benchmarkCase.language,
						turns: benchmarkCase.turns.map((turn) => ({
							content: turn.content,
						})),
						query: benchmarkCase.query,
					}) ||
				item.ingestionPolicy !== "sequential-turn-commit-v1" ||
				item.temporalInputPolicy !== "engine-default-ingest-time-v1" ||
				item.retrievalSurface !== "engine-native-semantic-memory-v1" ||
				!Array.isArray(item.ingestionReceipts) ||
				!Array.isArray(item.nativeState) ||
				!Array.isArray(item.retrieved) ||
				!Number.isInteger(artifact.disclosure?.topK) ||
				Number(artifact.disclosure?.topK) < 1 ||
				retrieved.length > Number(artifact.disclosure?.topK) ||
				nativeState.some(
					(memory) =>
						typeof memory.nativeId !== "string" ||
						typeof memory.content !== "string",
				) ||
				retrieved.some(
					(memory) =>
						typeof memory.nativeId !== "string" ||
						typeof memory.content !== "string" ||
						!nativeIds.has(memory.nativeId),
				) ||
				item.outputSha256 !==
					sha256({
						ingestionReceipts: item.ingestionReceipts,
						nativeState: item.nativeState,
						retrieved: item.retrieved,
					})
			);
		})
	)
		throw new Error(`invalid semantic raw artifact: ${expected.outputFile}`);
}

export function parseSemanticCampaignCliArgs(
	args: string[],
): SemanticCampaignCliArgs {
	const values = new Map<string, string>();
	for (const arg of args) {
		const match = /^--([^=]+)=(.+)$/.exec(arg);
		if (!match) throw new Error(`invalid argument: ${arg}`);
		if (
			![
				"contract",
				"output-dir",
				"top-k",
				"seed",
				"repetitions",
				"engines",
			].includes(match[1])
		)
			throw new Error(`unknown argument: --${match[1]}`);
		if (values.has(match[1]))
			throw new Error(`duplicate argument: --${match[1]}`);
		values.set(match[1], match[2]);
	}
	const contractPath = values.get("contract");
	const outputDir = values.get("output-dir");
	const executionSeed = values.get("seed");
	if (!contractPath || !outputDir || !executionSeed?.trim())
		throw new Error(
			"--contract, --output-dir, and non-blank --seed are required",
		);
	const topK = Number(values.get("top-k") ?? "5");
	if (!Number.isInteger(topK) || topK < 1)
		throw new Error("--top-k must be a positive integer");
	const requestedEngines = (
		values.get("engines") ?? SUPPORTED_SEMANTIC_ENGINES.join(",")
	)
		.split(",")
		.map((engine) => engine.trim());
	if (
		requestedEngines.length < 2 ||
		requestedEngines.some(
			(engine) =>
				!SUPPORTED_SEMANTIC_ENGINES.includes(
					engine as (typeof SUPPORTED_SEMANTIC_ENGINES)[number],
				),
		) ||
		new Set(requestedEngines).size !== requestedEngines.length
	)
		throw new Error(
			`--engines must select at least two unique engines from ${SUPPORTED_SEMANTIC_ENGINES.join(", ")}`,
		);
	const engines = requestedEngines as SemanticEngine[];
	const repetitions = Number(
		values.get("repetitions") ?? String(engines.length),
	);
	if (
		!Number.isInteger(repetitions) ||
		repetitions < engines.length ||
		repetitions % engines.length !== 0
	)
		throw new Error(
			`--repetitions must be a positive multiple of the ${engines.length}-engine matrix of at least ${engines.length}`,
		);
	return {
		contractPath,
		outputDir,
		topK,
		executionSeed,
		repetitions,
		engines,
	};
}

export function buildSemanticCampaignPlan(
	executionSeed: string,
	repetitions: number,
	engines: readonly string[] = SUPPORTED_SEMANTIC_ENGINES,
): SemanticCampaignRun[] {
	if (!executionSeed.trim())
		throw new Error("campaign execution seed is required");
	if (
		engines.length < 2 ||
		engines.some((engine) => typeof engine !== "string" || !engine.trim()) ||
		new Set(engines).size !== engines.length
	)
		throw new Error("campaign engines must contain at least two unique names");
	if (
		!Number.isInteger(repetitions) ||
		repetitions < engines.length ||
		repetitions % engines.length !== 0
	)
		throw new Error(
			`campaign repetitions must be a positive multiple of the ${engines.length}-engine matrix of at least ${engines.length}`,
		);
	const offset =
		Number.parseInt(
			sha256({ executionSeed, scope: "engine-order" }).slice(0, 8),
			16,
		) % engines.length;
	const firstOrder = engines.map(
		(_engine, index) => engines[(index + offset) % engines.length],
	);
	const plan: SemanticCampaignRun[] = [];
	for (let repetition = 1; repetition <= repetitions; repetition += 1) {
		const rotation = (repetition - 1) % engines.length;
		const order = firstOrder.map(
			(_engine, index) => firstOrder[(index + rotation) % engines.length],
		);
		const caseExecutionSeed = sha256({
			executionSeed,
			scope: "case-order",
			repetition,
		});
		for (const [engineIndex, engine] of order.entries())
			plan.push({
				repetition,
				enginePosition: engineIndex + 1,
				engine,
				caseExecutionSeed,
				outputFile: `repetition-${String(repetition).padStart(2, "0")}-${engine}.json`,
			});
	}
	return plan;
}

export async function runSemanticCampaignCli(args: string[]): Promise<void> {
	const parsed = parseSemanticCampaignCliArgs(args);
	const contractPath = resolve(parsed.contractPath);
	const outputDir = resolve(parsed.outputDir);
	const contract = JSON.parse(
		readFileSync(contractPath, "utf8"),
	) as MemoryUpdateContract;
	validateMemoryUpdateContract(contract);
	if (contract.tier !== "semantic-update-interpretation")
		throw new Error("semantic campaign requires a semantic-update contract");
	const plan = buildSemanticCampaignPlan(
		parsed.executionSeed,
		parsed.repetitions,
		parsed.engines,
	);
	mkdirSync(dirname(outputDir), { recursive: true });
	mkdirSync(outputDir, { mode: 0o700 });
	for (const run of plan) {
		await runSemanticRawCli([
			`--engine=${run.engine}`,
			`--contract=${contractPath}`,
			`--output=${resolve(outputDir, run.outputFile)}`,
			`--top-k=${parsed.topK}`,
			`--seed=${run.caseExecutionSeed}`,
		]);
		validateRawArtifact(
			resolve(outputDir, run.outputFile),
			run,
			contract.cases,
			parsed.topK,
		);
	}
	const enginePositionCounts = Object.fromEntries(
		parsed.engines.map((engine) => [
			engine,
			Object.fromEntries(
				Array.from({ length: parsed.engines.length }, (_unused, index) => [
					String(index + 1),
					plan.filter(
						(run) => run.engine === engine && run.enginePosition === index + 1,
					).length,
				]),
			),
		]),
	);
	const disclosure = {
		executionSeed: parsed.executionSeed,
		repetitions: parsed.repetitions,
		topK: parsed.topK,
		engines: parsed.engines,
		engineOrderPolicy: "seeded-n-engine-latin-rotation-v2",
		caseOrderPolicy: "shared-seeded-per-repetition-v1",
		enginePositionCounts,
		languageCaseCounts: Object.fromEntries(
			["ko", "en", "ja"].map((language) => [
				language,
				contract.cases.filter((item) => item.language === language).length,
			]),
		),
		generalizationBoundary:
			"Generated diagnostic cases only; repetitions measure execution stability, not held-out generalization.",
		configurationPolicy:
			"Engine-native semantic surfaces are compared with their disclosed native configurations; component-level parity is not claimed.",
	};
	const manifest = {
		schemaVersion: "naia-memory-semantic-campaign-v3",
		interpretation:
			"Balanced execution manifest over unscored raw artifacts; not quality evidence by itself.",
		receipt: benchmarkReceipt([contractPath], disclosure, [
			"src/benchmark/quality/semantic-campaign-cli.ts",
			"src/benchmark/quality/semantic-raw-cli.ts",
			"src/benchmark/quality/memory-semantic-runner.ts",
			"src/benchmark/quality/bridge-hindsight-semantic.ts",
			"src/benchmark/quality/bridge-mem0-semantic.ts",
			"src/benchmark/quality/bridge-naia-semantic.ts",
		]),
		disclosure,
		runs: plan.map((run) => ({
			...run,
			artifactSha256: fileSha256(resolve(outputDir, run.outputFile)),
		})),
	};
	const manifestPath = resolve(outputDir, "campaign.json");
	const temporaryPath = `${manifestPath}.${randomUUID()}.tmp`;
	writeFileSync(temporaryPath, `${JSON.stringify(manifest, null, 2)}\n`, {
		flag: "wx",
		mode: 0o600,
	});
	renameSync(temporaryPath, manifestPath);
	process.stdout.write(`${manifestPath}\n`);
}

const invokedPath = process.argv[1]
	? pathToFileURL(resolve(process.argv[1])).href
	: undefined;
if (invokedPath === import.meta.url)
	runSemanticCampaignCli(process.argv.slice(2)).catch((error) => {
		process.stderr.write(
			`${error instanceof Error ? error.message : "semantic campaign failed"}\n`,
		);
		process.exitCode = 1;
	});
