import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { MemoryUpdateContract } from "./memory-update-contract.js";
import { buildSemanticBlindArtifacts } from "./semantic-blind-packet-cli.js";
import { calculateSemanticClusterBootstrap } from "./semantic-cluster-bootstrap.js";
import {
	type RatedSemanticMemory,
	type SemanticJudgmentLabel,
	calculateSemanticInterRaterAgreement,
	consensusSemanticLabel,
} from "./semantic-inter-rater-agreement.js";

type BlindBuildInput = Parameters<typeof buildSemanticBlindArtifacts>[0];
type BlindArtifacts = ReturnType<typeof buildSemanticBlindArtifacts>;
type BlindPacket = BlindArtifacts["packet"];
type BlindSeal = BlindArtifacts["seal"];
type BlindSample = BlindPacket["samples"][number];
type JudgmentSampleRecord = Record<string, unknown>;

const LABELS: SemanticJudgmentLabel[] = [
	"current",
	"stale",
	"deleted",
	"irrelevant",
	"uncertain",
];

type HumanAdjudicator = {
	id: string;
	kind?: "human";
	nativeLanguages: string[];
	completedAt: string;
	independentFromEngineImplementers: boolean;
};

type ModelAdjudicator = {
	id: string;
	kind: "model";
	languageCoverage: string[];
	completedAt: string;
	independentFromEngineImplementers: boolean;
	provider: string;
	model: string;
	promptSha256: string;
};

type JudgmentFile = {
	schemaVersion:
		| "naia-memory-semantic-judgments-v1"
		| "naia-memory-semantic-judgments-v2"
		| "naia-memory-semantic-judgments-v3";
	packetContentSha256: string;
	adjudicators: Array<HumanAdjudicator | ModelAdjudicator>;
	samples: Array<{
		sampleId: string;
		adjudicatorId: string;
		adjudicationMethod?: "model" | "deterministic-no-retrieval";
		judgments: Array<{
			memoryId: string;
			label: SemanticJudgmentLabel;
			notes: string;
		}>;
	}>;
};

type ScoreCell = {
	samples: number;
	currentEligibleSamples: number;
	currentAt1: number;
	currentAtK: number;
	staleEligibleSamples: number;
	staleExposureAtK: number;
	deletionEligibleSamples: number;
	deletionLeakageAtK: number;
	uncertainMemories: number;
};

export function semanticMetricEligibility(
	decision: MemoryUpdateContract["cases"][number]["expectedDecision"],
) {
	return {
		currentEligible: decision === "update" || decision === "no-update",
		staleEligible: decision === "update",
		deletionEligible: decision === "delete",
	};
}

function sha256(value: string | Buffer): string {
	return createHash("sha256").update(value).digest("hex");
}

function readJson(path: string): unknown {
	return JSON.parse(readFileSync(path, "utf8"));
}

function assertObject(
	value: unknown,
	label: string,
): asserts value is Record<string, unknown> {
	if (value === null || typeof value !== "object" || Array.isArray(value))
		throw new Error(`${label} must be an object`);
}

function validateJudgments(value: unknown, packet: BlindPacket): JudgmentFile {
	assertObject(value, "judgments");
	if (
		value.schemaVersion !== "naia-memory-semantic-judgments-v1" &&
		value.schemaVersion !== "naia-memory-semantic-judgments-v2" &&
		value.schemaVersion !== "naia-memory-semantic-judgments-v3"
	)
		throw new Error("unsupported semantic judgments schema");
	if (value.packetContentSha256 !== packet.packetContentSha256)
		throw new Error("judgments packet hash mismatch");
	if (!Array.isArray(value.adjudicators) || value.adjudicators.length === 0)
		throw new Error("at least one adjudicator is required");
	const adjudicators = new Map<string, Record<string, unknown>>();
	for (const adjudicator of value.adjudicators) {
		assertObject(adjudicator, "adjudicator");
		const commonInvalid =
			typeof adjudicator.id !== "string" ||
			!adjudicator.id.trim() ||
			adjudicators.has(adjudicator.id) ||
			!Number.isFinite(Date.parse(String(adjudicator.completedAt))) ||
			adjudicator.independentFromEngineImplementers !== true;
		const isModel = adjudicator.kind === "model";
		const invalidCoverage = (field: unknown) =>
			!Array.isArray(field) ||
			field.length === 0 ||
			field.some((item) => typeof item !== "string" || !item.trim());
		const provenanceInvalid = isModel
			? value.schemaVersion === "naia-memory-semantic-judgments-v1" ||
				invalidCoverage(adjudicator.languageCoverage) ||
				typeof adjudicator.provider !== "string" ||
				!adjudicator.provider.trim() ||
				typeof adjudicator.model !== "string" ||
				!adjudicator.model.trim() ||
				typeof adjudicator.promptSha256 !== "string" ||
				!/^[0-9a-f]{64}$/.test(adjudicator.promptSha256)
			: invalidCoverage(adjudicator.nativeLanguages);
		if (commonInvalid || provenanceInvalid)
			throw new Error("invalid or non-independent adjudicator provenance");
		adjudicators.set(adjudicator.id, adjudicator);
	}
	if (!Array.isArray(value.samples))
		throw new Error("judgments must be an array");
	const multiRater =
		value.schemaVersion === "naia-memory-semantic-judgments-v3";
	if (
		multiRater &&
		[...adjudicators.values()].some(
			(adjudicator) => adjudicator.kind === "model",
		)
	)
		throw new Error(
			"multi-rater agreement evidence accepts native human adjudicators only",
		);
	if (!multiRater && value.samples.length !== packet.samples.length)
		throw new Error("judgments must cover every packet sample exactly once");
	const byAssignment = new Map<string, JudgmentSampleRecord>();
	const usedAdjudicators = new Set<string>();
	for (const sample of value.samples) {
		assertObject(sample, "judgment sample");
		const assignment = `${String(sample.sampleId)}\0${String(sample.adjudicatorId)}`;
		if (
			typeof sample.sampleId !== "string" ||
			typeof sample.adjudicatorId !== "string" ||
			byAssignment.has(assignment)
		)
			throw new Error("duplicate or invalid judgment assignment");
		byAssignment.set(assignment, sample);
	}
	for (const packetSample of packet.samples) {
		const eligible = [...adjudicators.entries()].filter(([, adjudicator]) => {
			const coverage =
				adjudicator.kind === "model"
					? adjudicator.languageCoverage
					: adjudicator.nativeLanguages;
			return (coverage as string[]).includes(packetSample.language);
		});
		if (multiRater) {
			const nativeHumans = eligible.filter(
				([, adjudicator]) => adjudicator.kind !== "model",
			);
			if (nativeHumans.length < 2)
				throw new Error(
					`multi-rater judgments require two native human adjudicators for ${packetSample.language}`,
				);
		} else if (eligible.length === 0) {
			throw new Error(
				`incomplete or uncovered judgments for ${packetSample.sampleId}`,
			);
		}
		const assignments = multiRater
			? eligible
			: eligible.filter(([id]) =>
					byAssignment.has(`${packetSample.sampleId}\0${id}`),
				);
		if (!multiRater && assignments.length !== 1)
			throw new Error(
				`incomplete or uncovered judgments for ${packetSample.sampleId}`,
			);
		for (const [adjudicatorId] of assignments) {
			const sample = byAssignment.get(
				`${packetSample.sampleId}\0${adjudicatorId}`,
			);
			if (
				!sample ||
				!Array.isArray(sample.judgments) ||
				sample.judgments.length !== packetSample.retrieved.length
			)
				throw new Error(
					`incomplete multi-rater coverage for ${packetSample.sampleId}/${adjudicatorId}`,
				);
			if (
				sample.adjudicationMethod === "deterministic-no-retrieval" &&
				packetSample.retrieved.length !== 0
			)
				throw new Error(
					`deterministic no-retrieval adjudication has memories in ${packetSample.sampleId}`,
				);
			if (
				sample.adjudicationMethod === "model" &&
				adjudicators.get(adjudicatorId)?.kind !== "model"
			)
				throw new Error(
					`model adjudication method requires a model adjudicator in ${packetSample.sampleId}`,
				);
			usedAdjudicators.add(adjudicatorId);
			const expectedIds = packetSample.retrieved.map((item) => item.memoryId);
			const seen = new Set<string>();
			for (const judgment of sample.judgments) {
				assertObject(judgment, "memory judgment");
				if (
					typeof judgment.memoryId !== "string" ||
					seen.has(judgment.memoryId) ||
					!expectedIds.includes(judgment.memoryId)
				)
					throw new Error(
						`invalid memory judgment in ${packetSample.sampleId}`,
					);
				seen.add(judgment.memoryId);
				if (!LABELS.includes(judgment.label as SemanticJudgmentLabel))
					throw new Error(`invalid label in ${packetSample.sampleId}`);
				if (
					typeof judgment.notes !== "string" ||
					(judgment.label === "uncertain" && !judgment.notes.trim())
				)
					throw new Error(
						`uncertain judgment requires notes in ${packetSample.sampleId}`,
					);
			}
		}
	}
	if (byAssignment.size !== value.samples.length)
		throw new Error("judgment assignments are invalid");
	const expectedAssignments = packet.samples.reduce((count, sample) => {
		if (!multiRater) return count + 1;
		return (
			count +
			[...adjudicators.values()].filter((adjudicator) => {
				const coverage =
					adjudicator.kind === "model"
						? adjudicator.languageCoverage
						: adjudicator.nativeLanguages;
				return (coverage as string[]).includes(sample.language);
			}).length
		);
	}, 0);
	if (value.samples.length !== expectedAssignments)
		throw new Error("judgments contain uncovered or missing assignments");
	if (usedAdjudicators.size !== adjudicators.size)
		throw new Error("every declared adjudicator must be assigned a sample");
	return value as unknown as JudgmentFile;
}

function emptyCell(): ScoreCell {
	return {
		samples: 0,
		currentEligibleSamples: 0,
		currentAt1: 0,
		currentAtK: 0,
		staleEligibleSamples: 0,
		staleExposureAtK: 0,
		deletionEligibleSamples: 0,
		deletionLeakageAtK: 0,
		uncertainMemories: 0,
	};
}

export function scoreSemanticAdjudication(input: {
	contract: MemoryUpdateContract;
	campaign: BlindBuildInput["campaign"];
	campaignDirectory: string;
	blindingSeed: string;
	contractSha256: string;
	campaignSha256: string;
	packet: BlindPacket;
	seal: BlindSeal;
	judgmentsBytes: string | Buffer;
}) {
	const judgmentText = Buffer.isBuffer(input.judgmentsBytes)
		? input.judgmentsBytes.toString("utf8")
		: input.judgmentsBytes;
	const judgmentValue: unknown = JSON.parse(judgmentText);
	const rebuilt = buildSemanticBlindArtifacts(input);
	if (JSON.stringify(input.packet) !== JSON.stringify(rebuilt.packet))
		throw new Error(
			"adjudication packet does not match frozen inputs and seed",
		);
	if (JSON.stringify(input.seal) !== JSON.stringify(rebuilt.seal))
		throw new Error("adjudication seal does not match frozen inputs and seed");
	const judgments = validateJudgments(judgmentValue, input.packet);
	const judgmentsBySample = new Map<string, JudgmentFile["samples"]>();
	for (const item of judgments.samples) {
		const current = judgmentsBySample.get(item.sampleId) ?? [];
		current.push(item);
		judgmentsBySample.set(item.sampleId, current);
	}
	const packetBySample = new Map<string, BlindSample>(
		input.packet.samples.map((item) => [item.sampleId, item]),
	);
	const cells: Record<string, ScoreCell> = {};
	const caseById = new Map(input.contract.cases.map((item) => [item.id, item]));
	const agreementSubjects: RatedSemanticMemory[] = [];
	const sampleResults = input.seal.samples.map((sealed) => {
		const packetSample = packetBySample.get(sealed.sampleId);
		const judged = judgmentsBySample.get(sealed.sampleId);
		if (!packetSample || !judged?.length)
			throw new Error(`unmatched sealed sample: ${sealed.sampleId}`);
		const labels = packetSample.retrieved.map((memory) => {
			const ratings = judged.map(
				(record) =>
					record.judgments.find((item) => item.memoryId === memory.memoryId)
						?.label,
			);
			if (ratings.some((label) => !label))
				throw new Error(
					`missing scored judgment for ${sealed.sampleId}/${memory.memoryId}`,
				);
			const completeRatings = ratings as SemanticJudgmentLabel[];
			if (judgments.schemaVersion === "naia-memory-semantic-judgments-v3") {
				agreementSubjects.push({
					subjectId: `${sealed.sampleId}\0${memory.memoryId}`,
					language: packetSample.language,
					ratings: completeRatings,
				});
				return consensusSemanticLabel(completeRatings);
			}
			return completeRatings[0];
		});
		const key = `${sealed.engine}/${packetSample.language}`;
		if (!cells[key]) cells[key] = emptyCell();
		const cell = cells[key];
		const benchmarkCase = caseById.get(sealed.caseId);
		if (!benchmarkCase)
			throw new Error(`scored sample has unknown case: ${sealed.caseId}`);
		const { currentEligible, staleEligible, deletionEligible } =
			semanticMetricEligibility(benchmarkCase.expectedDecision);
		cell.samples += 1;
		cell.currentEligibleSamples += currentEligible ? 1 : 0;
		cell.currentAt1 += currentEligible && labels[0] === "current" ? 1 : 0;
		cell.currentAtK += currentEligible && labels.includes("current") ? 1 : 0;
		cell.staleEligibleSamples += staleEligible ? 1 : 0;
		cell.staleExposureAtK += staleEligible && labels.includes("stale") ? 1 : 0;
		cell.deletionEligibleSamples += deletionEligible ? 1 : 0;
		cell.deletionLeakageAtK +=
			deletionEligible && labels.includes("deleted") ? 1 : 0;
		cell.uncertainMemories += labels.filter(
			(label) => label === "uncertain",
		).length;
		return {
			sampleId: sealed.sampleId,
			engine: sealed.engine,
			language: packetSample.language,
			caseId: sealed.caseId,
			repetition: sealed.repetition,
			metricEligibility: { currentEligible, staleEligible, deletionEligible },
			labels,
		};
	});
	const agreement =
		judgments.schemaVersion === "naia-memory-semantic-judgments-v3"
			? calculateSemanticInterRaterAgreement(agreementSubjects)
			: null;
	const uncertainty = calculateSemanticClusterBootstrap(
		sampleResults.map((sample) => {
			const benchmarkCase = caseById.get(sample.caseId);
			if (!benchmarkCase)
				throw new Error(`scored sample has unknown case: ${sample.caseId}`);
			return {
				engine: sample.engine,
				language: sample.language,
				familyId: benchmarkCase.familyId,
				currentAt1: sample.metricEligibility.currentEligible
					? sample.labels[0] === "current"
						? 1
						: 0
					: null,
				currentAtK: sample.metricEligibility.currentEligible
					? sample.labels.includes("current")
						? 1
						: 0
					: null,
				staleExposureAtK: sample.metricEligibility.staleEligible
					? sample.labels.includes("stale")
						? 1
						: 0
					: null,
				deletionLeakageAtK: sample.metricEligibility.deletionEligible
					? sample.labels.includes("deleted")
						? 1
						: 0
					: null,
			};
		}),
		`${input.packet.packetContentSha256}\0${sha256(input.judgmentsBytes)}`,
	);
	return {
		schemaVersion: "naia-memory-semantic-adjudication-score-v2" as const,
		disclosure: {
			metricUnit:
				"eligible sample-level binary exposure: current metrics use update/no-update cases, stale exposure uses update cases, and deletion leakage uses delete cases; uncertain memories are reported and never coerced to another label",
			packetContentSha256: input.packet.packetContentSha256,
			judgmentsFileSha256: sha256(input.judgmentsBytes),
			judgmentsCanonicalSha256: sha256(JSON.stringify(judgments)),
			adjudicators: judgments.adjudicators,
			interRaterAgreementEvaluated: agreement !== null,
			uncertaintyInterpretation:
				"95% percentile intervals resample independent, equal-sized familyId clusters; repetitions stay inside their family and paired engine differences reuse identical draws. Fewer than 10 clusters raises a sparse-cluster warning. Pairwise intervals are unadjusted exploratory comparisons, not simultaneous family-wise inference. Intervals are descriptive unless the separate public-evidence coverage gate passes.",
		},
		cells,
		samples: sampleResults,
		agreement,
		uncertainty,
	};
}

export function runSemanticAdjudicationCli(args: string[]): void {
	const values = new Map<string, string>();
	for (const arg of args) {
		const match = /^--([^=]+)=(.+)$/.exec(arg);
		if (!match) throw new Error(`invalid argument: ${arg}`);
		if (values.has(match[1]))
			throw new Error(`duplicate argument: --${match[1]}`);
		values.set(match[1], match[2]);
	}
	const required = [
		"contract",
		"campaign",
		"packet",
		"seal",
		"judgments",
		"seed",
		"output",
	];
	for (const key of required)
		if (!values.get(key)?.trim()) throw new Error(`--${key} is required`);
	if ([...values.keys()].some((key) => !required.includes(key)))
		throw new Error("unknown or duplicate adjudication argument");
	const requiredValue = (key: string): string => {
		const value = values.get(key);
		if (!value) throw new Error(`--${key} is required`);
		return value;
	};
	const output = resolve(requiredValue("output"));
	if (existsSync(output))
		throw new Error(`score output already exists: ${output}`);
	const contractPath = resolve(requiredValue("contract"));
	const campaignPath = resolve(requiredValue("campaign"));
	const contractBytes = readFileSync(contractPath);
	const campaignBytes = readFileSync(campaignPath);
	const judgmentsBytes = readFileSync(resolve(requiredValue("judgments")));
	const score = scoreSemanticAdjudication({
		contract: JSON.parse(contractBytes.toString("utf8")),
		campaign: JSON.parse(campaignBytes.toString("utf8")),
		campaignDirectory: dirname(campaignPath),
		blindingSeed: requiredValue("seed"),
		contractSha256: sha256(contractBytes),
		campaignSha256: sha256(campaignBytes),
		packet: readJson(resolve(requiredValue("packet"))) as BlindPacket,
		seal: readJson(resolve(requiredValue("seal"))) as BlindSeal,
		judgmentsBytes,
	});
	const temporary = `${output}.${randomUUID()}.tmp`;
	writeFileSync(temporary, `${JSON.stringify(score, null, 2)}\n`, {
		flag: "wx",
		mode: 0o600,
	});
	renameSync(temporary, output);
	process.stdout.write(`${output}\n`);
}

const invokedPath = process.argv[1]
	? pathToFileURL(resolve(process.argv[1])).href
	: undefined;
if (invokedPath === import.meta.url)
	try {
		runSemanticAdjudicationCli(process.argv.slice(2));
	} catch (error) {
		process.stderr.write(
			`${error instanceof Error ? error.message : "semantic adjudication failed"}\n`,
		);
		process.exitCode = 1;
	}
