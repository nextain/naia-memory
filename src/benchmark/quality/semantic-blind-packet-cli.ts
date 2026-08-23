import { createHash, randomUUID } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { SemanticNativeMemory } from "./memory-semantic-runner.js";
import {
	type MemoryUpdateContract,
	validateMemoryUpdateContract,
} from "./memory-update-contract.js";
import { hasValidSemanticComparisonLanes } from "./semantic-analysis-plan.js";
import {
	SUPPORTED_SEMANTIC_ENGINES,
	type SemanticCampaignRun,
	buildSemanticCampaignPlan,
	validateRawArtifact,
} from "./semantic-campaign-cli.js";

const LEGACY_V2_SEMANTIC_ENGINES = ["hindsight", "mem0", "naia"] as const;

type CampaignManifest = {
	schemaVersion:
		| "naia-memory-semantic-campaign-v2"
		| "naia-memory-semantic-campaign-v3"
		| "naia-memory-semantic-campaign-v4"
		| "naia-memory-semantic-campaign-v5";
	disclosure: {
		eligibility?: "diagnostic" | "competitive-candidate";
		executionSeed: string;
		repetitions: number;
		topK: number;
		engines?: string[];
		analysisPlanSha256?: string | null;
		claimScope?: string;
		comparisonLanes?: unknown;
		crossLaneAggregation?: "prohibited";
		confirmatoryAuthorizationSha256?: string | null;
		analysisPlanTimestampEvidenceSha256?: string | null;
		analysisPlanTimestampTrustPolicyIdentitySha256?: string | null;
	};
	runs: Array<SemanticCampaignRun & { artifactSha256: string }>;
};

type RawArtifact = {
	cases: Array<{
		caseId: string;
		retrieved: SemanticNativeMemory[];
	}>;
};

export type SemanticBlindPacketCliArgs = {
	contractPath: string;
	campaignPath: string;
	outputDir: string;
	blindingSeed: string;
};

function sha256Bytes(value: string | Buffer): string {
	return createHash("sha256").update(value).digest("hex");
}

function sha256Json(value: unknown): string {
	return sha256Bytes(JSON.stringify(value));
}

function assertSafeArtifactName(
	value: string,
	engines: readonly string[],
): void {
	if (
		!engines.some((engine) =>
			new RegExp(`^repetition-\\d{2,}-${engine}\\.json$`).test(value),
		)
	)
		throw new Error(`campaign contains an unsafe artifact path: ${value}`);
}

export function parseSemanticBlindPacketCliArgs(
	args: string[],
): SemanticBlindPacketCliArgs {
	const values = new Map<string, string>();
	for (const arg of args) {
		const match = /^--([^=]+)=(.+)$/.exec(arg);
		if (!match) throw new Error(`invalid argument: ${arg}`);
		if (!["contract", "campaign", "output-dir", "seed"].includes(match[1]))
			throw new Error(`unknown argument: --${match[1]}`);
		if (values.has(match[1]))
			throw new Error(`duplicate argument: --${match[1]}`);
		values.set(match[1], match[2]);
	}
	const contractPath = values.get("contract");
	const campaignPath = values.get("campaign");
	const outputDir = values.get("output-dir");
	const blindingSeed = values.get("seed");
	if (!contractPath || !campaignPath || !outputDir || !blindingSeed?.trim())
		throw new Error(
			"--contract, --campaign, --output-dir, and non-blank --seed are required",
		);
	return { contractPath, campaignPath, outputDir, blindingSeed };
}

export function buildSemanticBlindArtifacts(input: {
	contract: MemoryUpdateContract;
	campaign: CampaignManifest;
	campaignDirectory: string;
	blindingSeed: string;
	contractSha256: string;
	campaignSha256: string;
}) {
	validateMemoryUpdateContract(input.contract);
	if (input.contract.tier !== "semantic-update-interpretation")
		throw new Error("blind packet requires a semantic-update contract");
	const disclosure = input.campaign.disclosure;
	const engines =
		input.campaign.schemaVersion === "naia-memory-semantic-campaign-v2"
			? [...LEGACY_V2_SEMANTIC_ENGINES]
			: disclosure?.engines;
	if (
		(input.campaign.schemaVersion !== "naia-memory-semantic-campaign-v2" &&
			input.campaign.schemaVersion !== "naia-memory-semantic-campaign-v3" &&
			input.campaign.schemaVersion !== "naia-memory-semantic-campaign-v4" &&
			input.campaign.schemaVersion !== "naia-memory-semantic-campaign-v5") ||
		(input.campaign.schemaVersion === "naia-memory-semantic-campaign-v2" &&
			disclosure?.engines !== undefined &&
			(!Array.isArray(disclosure.engines) ||
				disclosure.engines.length !== LEGACY_V2_SEMANTIC_ENGINES.length ||
				disclosure.engines.some(
					(engine, index) => engine !== LEGACY_V2_SEMANTIC_ENGINES[index],
				))) ||
		!Array.isArray(engines) ||
		engines.length < 2 ||
		new Set(engines).size !== engines.length ||
		engines.some(
			(engine) =>
				typeof engine !== "string" ||
				!SUPPORTED_SEMANTIC_ENGINES.includes(
					engine as (typeof SUPPORTED_SEMANTIC_ENGINES)[number],
				),
		) ||
		!disclosure?.executionSeed?.trim() ||
		!Number.isInteger(disclosure.repetitions) ||
		disclosure.repetitions < engines.length ||
		disclosure.repetitions % engines.length !== 0 ||
		!Number.isInteger(disclosure.topK) ||
		disclosure.topK < 1 ||
		(input.campaign.schemaVersion === "naia-memory-semantic-campaign-v4" &&
			(disclosure.claimScope !== "diagnostic-characterization-only-v1" ||
				disclosure.analysisPlanSha256 !== null ||
				disclosure.comparisonLanes !== null)) ||
		(input.campaign.schemaVersion === "naia-memory-semantic-campaign-v5" &&
			(disclosure.claimScope === "diagnostic-characterization-only-v1"
				? disclosure.eligibility !== "diagnostic" ||
					disclosure.analysisPlanSha256 !== null ||
					disclosure.comparisonLanes !== null ||
					disclosure.confirmatoryAuthorizationSha256 !== null
				: ![
						"direct-lifecycle-competitive-report-v1",
						"declared-multi-class-competitive-report-v1",
					].includes(disclosure.claimScope ?? "") ||
					disclosure.eligibility !== "competitive-candidate" ||
					typeof disclosure.analysisPlanSha256 !== "string" ||
					!/^[a-f0-9]{64}$/.test(disclosure.analysisPlanSha256) ||
					!hasValidSemanticComparisonLanes(
						disclosure.comparisonLanes,
						disclosure.claimScope,
					) ||
					disclosure.crossLaneAggregation !== "prohibited" ||
					![
						disclosure.confirmatoryAuthorizationSha256,
						disclosure.analysisPlanTimestampEvidenceSha256,
						disclosure.analysisPlanTimestampTrustPolicyIdentitySha256,
					].every(
						(value) =>
							typeof value === "string" && /^[a-f0-9]{64}$/.test(value),
					))) ||
		!Array.isArray(input.campaign.runs) ||
		input.campaign.runs.length !== disclosure.repetitions * engines.length
	)
		throw new Error("invalid semantic campaign manifest");
	if (!input.blindingSeed.trim()) throw new Error("blinding seed is required");
	const expectedPlan = buildSemanticCampaignPlan(
		disclosure.executionSeed,
		disclosure.repetitions,
		engines,
	);
	if (
		input.campaign.runs.some((run, index) => {
			const expected = expectedPlan[index];
			return (
				expected === undefined ||
				run.repetition !== expected.repetition ||
				run.enginePosition !== expected.enginePosition ||
				run.engine !== expected.engine ||
				run.caseExecutionSeed !== expected.caseExecutionSeed ||
				run.outputFile !== expected.outputFile ||
				!/^[a-f0-9]{64}$/.test(run.artifactSha256)
			);
		})
	)
		throw new Error("semantic campaign run plan does not match its disclosure");

	const caseById = new Map(input.contract.cases.map((item) => [item.id, item]));
	const sourceSamples = input.campaign.runs.flatMap((run) => {
		assertSafeArtifactName(run.outputFile, engines);
		const artifactPath = resolve(input.campaignDirectory, run.outputFile);
		const bytes = readFileSync(artifactPath);
		if (sha256Bytes(bytes) !== run.artifactSha256)
			throw new Error(`campaign artifact hash mismatch: ${run.outputFile}`);
		validateRawArtifact(
			artifactPath,
			run,
			input.contract.cases,
			disclosure.topK,
		);
		const artifact = JSON.parse(bytes.toString("utf8")) as RawArtifact;
		return artifact.cases.map((result) => {
			const benchmarkCase = caseById.get(result.caseId);
			if (!benchmarkCase)
				throw new Error(`unknown campaign case: ${result.caseId}`);
			return { run, result, benchmarkCase };
		});
	});
	const ordered = sourceSamples.sort((left, right) => {
		const key = (item: (typeof sourceSamples)[number]) =>
			sha256Json({
				seed: input.blindingSeed,
				scope: "blind-sample-order-v1",
				artifact: item.run.outputFile,
				caseId: item.result.caseId,
			});
		return key(left).localeCompare(key(right));
	});
	const samples = ordered.map((item, index) => ({
		sampleId: `sample-${String(index + 1).padStart(4, "0")}`,
		language: item.benchmarkCase.language,
		turns: item.benchmarkCase.turns.map(({ content }) => ({ content })),
		query: item.benchmarkCase.query,
		retrieved: item.result.retrieved.map((memory, rank) => ({
			memoryId: `memory-${String(rank + 1).padStart(2, "0")}`,
			rank: rank + 1,
			content: memory.content,
		})),
		judgments: item.result.retrieved.map((_memory, rank) => ({
			memoryId: `memory-${String(rank + 1).padStart(2, "0")}`,
			label: null as
				| "current"
				| "stale"
				| "deleted"
				| "irrelevant"
				| "uncertain"
				| null,
			notes: "",
		})),
	}));
	const packetCore = {
		schemaVersion: "naia-memory-semantic-blind-packet-v1" as const,
		instructions: {
			engineIdentity: "withheld",
			recurrenceDisclosure:
				"Each conversation recurs once per engine in each repetition. Judge every sample independently; do not compare or group recurring conversations.",
			sealHandling:
				"The campaign manifest and adjudication seal must remain unavailable to adjudicators until judgments are frozen.",
			labelEachRetrievedMemory:
				"Label every retrieved memory as current, stale, deleted, irrelevant, or uncertain using only the turns and query.",
			qualityClaim:
				"This packet is an adjudication input, not quality evidence until independently completed and unsealed.",
		},
		source: {
			contractSha256: input.contractSha256,
			campaignSha256: input.campaignSha256,
			construction: input.contract.construction,
		},
		samples,
	};
	const packetContentSha256 = sha256Json(packetCore);
	const seal = {
		schemaVersion: "naia-memory-semantic-blind-seal-v1" as const,
		interpretation:
			"Confidential engine/run mapping. Do not provide this file to adjudicators.",
		packetContentSha256,
		blindingSeedSha256: sha256Bytes(input.blindingSeed),
		samples: ordered.map((item, index) => ({
			sampleId: `sample-${String(index + 1).padStart(4, "0")}`,
			caseId: item.result.caseId,
			engine: item.run.engine,
			repetition: item.run.repetition,
			enginePosition: item.run.enginePosition,
			artifactFile: item.run.outputFile,
			artifactSha256: item.run.artifactSha256,
			retrieved: item.result.retrieved.map((memory, rank) => ({
				memoryId: `memory-${String(rank + 1).padStart(2, "0")}`,
				nativeId: memory.nativeId,
			})),
		})),
	};
	return { packet: { ...packetCore, packetContentSha256 }, seal };
}

function writeExclusive(path: string, value: unknown): void {
	const temporaryPath = `${path}.${randomUUID()}.tmp`;
	writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, {
		flag: "wx",
		mode: 0o600,
	});
	renameSync(temporaryPath, path);
}

export function runSemanticBlindPacketCli(args: string[]): void {
	const parsed = parseSemanticBlindPacketCliArgs(args);
	const contractPath = resolve(parsed.contractPath);
	const campaignPath = resolve(parsed.campaignPath);
	const outputDir = resolve(parsed.outputDir);
	if (existsSync(outputDir))
		throw new Error(`blind packet output already exists: ${outputDir}`);
	const contractBytes = readFileSync(contractPath);
	const campaignBytes = readFileSync(campaignPath);
	const artifacts = buildSemanticBlindArtifacts({
		contract: JSON.parse(
			contractBytes.toString("utf8"),
		) as MemoryUpdateContract,
		campaign: JSON.parse(campaignBytes.toString("utf8")) as CampaignManifest,
		campaignDirectory: dirname(campaignPath),
		blindingSeed: parsed.blindingSeed,
		contractSha256: sha256Bytes(contractBytes),
		campaignSha256: sha256Bytes(campaignBytes),
	});
	mkdirSync(dirname(outputDir), { recursive: true });
	const stagingDirectory = `${outputDir}.${randomUUID()}.tmp`;
	mkdirSync(stagingDirectory, { mode: 0o700 });
	writeExclusive(
		resolve(stagingDirectory, "adjudication-packet.json"),
		artifacts.packet,
	);
	writeExclusive(
		resolve(stagingDirectory, "adjudication-seal.json"),
		artifacts.seal,
	);
	renameSync(stagingDirectory, outputDir);
	process.stdout.write(`${outputDir}\n`);
}

const invokedPath = process.argv[1]
	? pathToFileURL(resolve(process.argv[1])).href
	: undefined;
if (invokedPath === import.meta.url)
	try {
		runSemanticBlindPacketCli(process.argv.slice(2));
	} catch (error) {
		process.stderr.write(
			`${error instanceof Error ? error.message : "semantic blind packet failed"}\n`,
		);
		process.exitCode = 1;
	}
