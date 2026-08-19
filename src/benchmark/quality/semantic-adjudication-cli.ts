import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { MemoryUpdateContract } from "./memory-update-contract.js";
import { buildSemanticBlindArtifacts } from "./semantic-blind-packet-cli.js";

type BlindBuildInput = Parameters<typeof buildSemanticBlindArtifacts>[0];
type BlindArtifacts = ReturnType<typeof buildSemanticBlindArtifacts>;
type BlindPacket = BlindArtifacts["packet"];
type BlindSeal = BlindArtifacts["seal"];
type BlindSample = BlindPacket["samples"][number];
type JudgmentSampleRecord = Record<string, unknown>;

const LABELS = [
	"current",
	"stale",
	"deleted",
	"irrelevant",
	"uncertain",
] as const;
type JudgmentLabel = (typeof LABELS)[number];

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
		| "naia-memory-semantic-judgments-v2";
	packetContentSha256: string;
	adjudicators: Array<HumanAdjudicator | ModelAdjudicator>;
	samples: Array<{
		sampleId: string;
		adjudicatorId: string;
		judgments: Array<{ memoryId: string; label: JudgmentLabel; notes: string }>;
	}>;
};

type ScoreCell = {
	samples: number;
	currentAt1: number;
	currentAtK: number;
	staleExposureAtK: number;
	deletionLeakageAtK: number;
	uncertainMemories: number;
};

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
		value.schemaVersion !== "naia-memory-semantic-judgments-v2"
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
			? value.schemaVersion !== "naia-memory-semantic-judgments-v2" ||
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
	if (
		!Array.isArray(value.samples) ||
		value.samples.length !== packet.samples.length
	)
		throw new Error("judgments must cover every packet sample exactly once");
	const bySample = new Map<string, JudgmentSampleRecord>();
	const usedAdjudicators = new Set<string>();
	for (const sample of value.samples) {
		assertObject(sample, "judgment sample");
		if (typeof sample.sampleId !== "string" || bySample.has(sample.sampleId))
			throw new Error("duplicate or invalid judgment sample ID");
		bySample.set(sample.sampleId, sample);
	}
	for (const packetSample of packet.samples) {
		const sample = bySample.get(packetSample.sampleId);
		const adjudicator = sample
			? adjudicators.get(String(sample.adjudicatorId))
			: undefined;
		const languageCoverage =
			adjudicator?.kind === "model"
				? adjudicator.languageCoverage
				: adjudicator?.nativeLanguages;
		if (
			!sample ||
			!adjudicator ||
			!(languageCoverage as string[] | undefined)?.includes(
				packetSample.language,
			) ||
			!Array.isArray(sample.judgments) ||
			sample.judgments.length !== packetSample.retrieved.length
		)
			throw new Error(
				`incomplete or uncovered judgments for ${packetSample.sampleId}`,
			);
		usedAdjudicators.add(String(sample.adjudicatorId));
		const expectedIds = packetSample.retrieved.map((item) => item.memoryId);
		const seen = new Set<string>();
		for (const judgment of sample.judgments) {
			assertObject(judgment, "memory judgment");
			if (
				typeof judgment.memoryId !== "string" ||
				seen.has(judgment.memoryId) ||
				!expectedIds.includes(judgment.memoryId)
			)
				throw new Error(`invalid memory judgment in ${packetSample.sampleId}`);
			seen.add(judgment.memoryId);
			if (!LABELS.includes(judgment.label as JudgmentLabel))
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
	if (usedAdjudicators.size !== adjudicators.size)
		throw new Error("every declared adjudicator must be assigned a sample");
	return value as unknown as JudgmentFile;
}

function emptyCell(): ScoreCell {
	return {
		samples: 0,
		currentAt1: 0,
		currentAtK: 0,
		staleExposureAtK: 0,
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
	const judgmentBySample = new Map(
		judgments.samples.map((item) => [item.sampleId, item]),
	);
	const packetBySample = new Map<string, BlindSample>(
		input.packet.samples.map((item) => [item.sampleId, item]),
	);
	const cells: Record<string, ScoreCell> = {};
	const sampleResults = input.seal.samples.map((sealed) => {
		const packetSample = packetBySample.get(sealed.sampleId);
		const judged = judgmentBySample.get(sealed.sampleId);
		if (!packetSample || !judged)
			throw new Error(`unmatched sealed sample: ${sealed.sampleId}`);
		const labels = packetSample.retrieved.map((memory) => {
			const label = judged.judgments.find(
				(item) => item.memoryId === memory.memoryId,
			)?.label;
			if (!label)
				throw new Error(
					`missing scored judgment for ${sealed.sampleId}/${memory.memoryId}`,
				);
			return label;
		});
		const key = `${sealed.engine}/${packetSample.language}`;
		if (!cells[key]) cells[key] = emptyCell();
		const cell = cells[key];
		cell.samples += 1;
		cell.currentAt1 += labels[0] === "current" ? 1 : 0;
		cell.currentAtK += labels.includes("current") ? 1 : 0;
		cell.staleExposureAtK += labels.includes("stale") ? 1 : 0;
		cell.deletionLeakageAtK += labels.includes("deleted") ? 1 : 0;
		cell.uncertainMemories += labels.filter(
			(label) => label === "uncertain",
		).length;
		return {
			sampleId: sealed.sampleId,
			engine: sealed.engine,
			language: packetSample.language,
			caseId: sealed.caseId,
			repetition: sealed.repetition,
			labels,
		};
	});
	return {
		schemaVersion: "naia-memory-semantic-adjudication-score-v1" as const,
		disclosure: {
			metricUnit:
				"sample-level binary exposure; uncertain memories are reported and never coerced to another label",
			packetContentSha256: input.packet.packetContentSha256,
			judgmentsFileSha256: sha256(input.judgmentsBytes),
			judgmentsCanonicalSha256: sha256(JSON.stringify(judgments)),
			adjudicators: judgments.adjudicators,
		},
		cells,
		samples: sampleResults,
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
