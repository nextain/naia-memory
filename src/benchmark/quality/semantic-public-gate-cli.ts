import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
	type MemoryUpdateContract,
	validateSemanticPublicEvidenceCoverage,
} from "./memory-update-contract.js";
import {
	PublicEvidenceFileTooLargeError,
	readBoundedEvidenceFile,
} from "./public-evidence-file-io.js";
import {
	isSemanticAdjudicationEvidenceBundle,
	isSemanticAdjudicationTrustPolicy,
	validateSemanticAdjudicationEvidence,
} from "./semantic-adjudication-evidence.js";
import {
	isSemanticAnalysisPlan,
	isSemanticAnalysisPlanTrustPolicy,
	validateSemanticAnalysisPlan,
} from "./semantic-analysis-plan.js";
import { calculateSemanticCompetitiveInference } from "./semantic-competitive-inference.js";
import {
	isSemanticExecutionEvidenceBundle,
	isSemanticExecutionTrustPolicy,
	validateSemanticExecutionEvidence,
} from "./semantic-execution-evidence.js";
import type { SemanticPilotCollectionPlan } from "./semantic-pilot-collection-packet.js";
import { validateSemanticPilotResultBinding } from "./semantic-pilot-result-binding.js";
import {
	isSemanticPowerReview,
	isSemanticPowerReviewTrustPolicy,
} from "./semantic-power-review.js";
import {
	isSemanticPublicAttestationBundle,
	isSemanticPublicTrustPolicy,
	validateSemanticPublicAttestations,
} from "./semantic-public-attestation.js";
import { isSemanticSampleSizeAssumptions } from "./semantic-sample-size-simulation.js";

const MAX_CONTRACT_BYTES = 16 * 1024 * 1024;

async function runSemanticEvidenceGateCli(
	args: string[],
	mode: "corpus" | "public",
): Promise<number> {
	if (
		(mode === "corpus" && args.length !== 3) ||
		(mode === "public" &&
			args.length !== 3 &&
			args.length !== 6 &&
			args.length !== 12 &&
			args.length !== 14 &&
			args.length !== 19)
	) {
		process.stderr.write(
			`Usage: pnpm benchmark:semantic-${mode}-gate <contract.json> <attestations.json> <trust-policy.json>${
				mode === "public"
					? " [<campaign.json> <execution-evidence.json> <execution-trust-policy.json> [<packet.json> <seal.json> <judgments.json> <adjudication-evidence.json> <adjudication-trust-policy.json> <blinding-seed> [<analysis-plan.json> <analysis-plan-trust-policy.json> [<pilot-collection-plan.json> <pilot-contract.json> <sample-size-assumptions.json> <power-review.json> <power-review-trust-policy.json>]]]]"
					: ""
			}\n`,
		);
		return 2;
	}
	try {
		const readJson = async (path: string, label: string): Promise<unknown> => {
			let bytes: Buffer;
			try {
				bytes = await readBoundedEvidenceFile(
					resolve(path),
					MAX_CONTRACT_BYTES,
				);
			} catch (error) {
				if (error instanceof PublicEvidenceFileTooLargeError)
					throw new Error(`${label} exceeds the 16 MiB intake limit`);
				throw new Error(`${label} is unreadable`);
			}
			try {
				return JSON.parse(bytes.toString("utf8"));
			} catch {
				throw new Error(`${label} is not valid JSON`);
			}
		};
		const parsed = await readJson(args[0], "contract");
		if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed))
			throw new Error("contract root must be an object");
		if (!("cases" in parsed) || !Array.isArray(parsed.cases))
			throw new Error("contract cases must be an array");
		const contract = parsed as MemoryUpdateContract;
		validateSemanticPublicEvidenceCoverage(contract);
		const bundle = await readJson(args[1], "attestation bundle");
		if (!isSemanticPublicAttestationBundle(bundle))
			throw new Error("semantic attestation bundle shape is invalid");
		const trustPolicy = await readJson(args[2], "trust policy");
		if (!isSemanticPublicTrustPolicy(trustPolicy))
			throw new Error("semantic trust policy shape is invalid");
		validateSemanticPublicAttestations(contract, bundle, trustPolicy);
		const testCases = contract.cases.filter(
			(current) => current.split === "test",
		);
		const corpusResult = {
			corpusQualified: true,
			testCaseCount: testCases.length,
			testFamilyCount: new Set(testCases.map((current) => current.familyId))
				.size,
		};
		if (mode === "corpus") {
			process.stdout.write(`${JSON.stringify(corpusResult)}\n`);
			return 0;
		}
		if (args.length >= 6) {
			const campaignPath = resolve(args[3]);
			let campaignBytes: Buffer;
			try {
				campaignBytes = await readBoundedEvidenceFile(
					campaignPath,
					MAX_CONTRACT_BYTES,
				);
			} catch (error) {
				if (error instanceof PublicEvidenceFileTooLargeError)
					throw new Error("campaign exceeds the 16 MiB intake limit");
				throw new Error("campaign is unreadable");
			}
			let campaign: unknown;
			try {
				campaign = JSON.parse(campaignBytes.toString("utf8"));
			} catch {
				throw new Error("campaign is not valid JSON");
			}
			const executionBundle = await readJson(
				args[4],
				"execution evidence bundle",
			);
			if (!isSemanticExecutionEvidenceBundle(executionBundle))
				throw new Error("semantic execution evidence bundle shape is invalid");
			const executionTrustPolicy = await readJson(
				args[5],
				"execution trust policy",
			);
			if (!isSemanticExecutionTrustPolicy(executionTrustPolicy))
				throw new Error("semantic execution trust policy shape is invalid");
			const execution = validateSemanticExecutionEvidence({
				contract,
				campaign,
				campaignBytes,
				campaignDirectory: dirname(campaignPath),
				bundle: executionBundle,
				trustPolicy: executionTrustPolicy,
			});
			if (args.length >= 12) {
				const packet = await readJson(args[6], "blind packet");
				const seal = await readJson(args[7], "blind seal");
				let judgmentsBytes: Buffer;
				try {
					judgmentsBytes = await readBoundedEvidenceFile(
						resolve(args[8]),
						MAX_CONTRACT_BYTES,
					);
				} catch (error) {
					if (error instanceof PublicEvidenceFileTooLargeError)
						throw new Error("judgments exceed the 16 MiB intake limit");
					throw new Error("judgments are unreadable");
				}
				const adjudicationBundle = await readJson(
					args[9],
					"adjudication evidence bundle",
				);
				if (!isSemanticAdjudicationEvidenceBundle(adjudicationBundle))
					throw new Error(
						"semantic adjudication evidence bundle shape is invalid",
					);
				const adjudicationTrust = await readJson(
					args[10],
					"adjudication trust policy",
				);
				if (!isSemanticAdjudicationTrustPolicy(adjudicationTrust))
					throw new Error(
						"semantic adjudication trust policy shape is invalid",
					);
				if (
					packet === null ||
					typeof packet !== "object" ||
					Array.isArray(packet)
				)
					throw new Error("blind packet shape is invalid");
				if (seal === null || typeof seal !== "object" || Array.isArray(seal))
					throw new Error("blind seal shape is invalid");
				const adjudication = validateSemanticAdjudicationEvidence({
					contract,
					campaign: campaign as Record<string, unknown>,
					campaignBytes,
					campaignDirectory: dirname(campaignPath),
					blindingSeed: args[11],
					packet: packet as Parameters<
						typeof validateSemanticAdjudicationEvidence
					>[0]["packet"],
					seal: seal as Parameters<
						typeof validateSemanticAdjudicationEvidence
					>[0]["seal"],
					judgmentsBytes,
					bundle: adjudicationBundle,
					trustPolicy: adjudicationTrust,
					forbiddenTrustIdentities: [
						...Object.values(trustPolicy.authorPublicKeysByLanguage).flatMap(
							(keys) => Object.keys(keys),
						),
						...Object.values(
							trustPolicy.nativeReviewerPublicKeysByLanguage,
						).flatMap((keys) => Object.keys(keys)),
						...Object.keys(executionTrustPolicy.executorPublicKeys),
					],
					forbiddenTrustPublicKeys: [
						...Object.values(trustPolicy.authorPublicKeysByLanguage).flatMap(
							(keys) => Object.values(keys),
						),
						...Object.values(
							trustPolicy.nativeReviewerPublicKeysByLanguage,
						).flatMap((keys) => Object.values(keys)),
						...Object.values(executionTrustPolicy.executorPublicKeys),
					],
				});
				let analysisPlan = {};
				let competitiveInference = {};
				if (args.length >= 14) {
					const parsedPlan = await readJson(args[12], "analysis plan");
					if (!isSemanticAnalysisPlan(parsedPlan))
						throw new Error("semantic analysis plan shape is invalid");
					const analysisTrust = await readJson(
						args[13],
						"analysis plan trust policy",
					);
					if (!isSemanticAnalysisPlanTrustPolicy(analysisTrust))
						throw new Error(
							"semantic analysis plan trust policy shape is invalid",
						);
					const firstExecutionStartedAt = executionBundle.receipts
						.map((receipt) => receipt.startedAt)
						.sort()[0];
					if (!firstExecutionStartedAt)
						throw new Error("semantic execution start time is unavailable");
					analysisPlan = validateSemanticAnalysisPlan({
						contract,
						plan: parsedPlan,
						trustPolicy: analysisTrust,
						campaign: campaign as Record<string, unknown>,
						firstExecutionStartedAt,
						forbiddenTrustIdentities: [
							...Object.values(trustPolicy.authorPublicKeysByLanguage).flatMap(
								(keys) => Object.keys(keys),
							),
							...Object.values(
								trustPolicy.nativeReviewerPublicKeysByLanguage,
							).flatMap((keys) => Object.keys(keys)),
							...Object.keys(executionTrustPolicy.executorPublicKeys),
							...Object.keys(adjudicationTrust.adjudicators),
						],
						forbiddenTrustPublicKeys: [
							...Object.values(trustPolicy.authorPublicKeysByLanguage).flatMap(
								(keys) => Object.values(keys),
							),
							...Object.values(
								trustPolicy.nativeReviewerPublicKeysByLanguage,
							).flatMap((keys) => Object.values(keys)),
							...Object.values(executionTrustPolicy.executorPublicKeys),
							...Object.values(adjudicationTrust.adjudicators).map(
								(policy) => policy.publicKey,
							),
						],
					});
					if (args.length === 19) {
						const collectionPlan = await readJson(
							args[14],
							"power pilot collection plan",
						);
						if (
							collectionPlan === null ||
							typeof collectionPlan !== "object" ||
							Array.isArray(collectionPlan)
						)
							throw new Error(
								"semantic power pilot collection plan shape is invalid",
							);
						const pilotContract = await readJson(
							args[15],
							"power pilot contract",
						);
						if (
							pilotContract === null ||
							typeof pilotContract !== "object" ||
							Array.isArray(pilotContract)
						)
							throw new Error("semantic power pilot contract shape is invalid");
						const assumptions = await readJson(
							args[16],
							"sample-size assumptions",
						);
						if (!isSemanticSampleSizeAssumptions(assumptions))
							throw new Error("semantic sample-size assumptions are invalid");
						const powerReview = await readJson(args[17], "power review");
						if (!isSemanticPowerReview(powerReview))
							throw new Error("semantic power review shape is invalid");
						const powerTrust = await readJson(
							args[18],
							"power review trust policy",
						);
						if (!isSemanticPowerReviewTrustPolicy(powerTrust))
							throw new Error(
								"semantic power review trust policy shape is invalid",
							);
						analysisPlan = {
							...analysisPlan,
							...validateSemanticPilotResultBinding({
								collectionPlan: collectionPlan as SemanticPilotCollectionPlan,
								pilotContract: pilotContract as MemoryUpdateContract,
								publicContract: contract,
								assumptions,
								plan: parsedPlan,
								review: powerReview,
								trustPolicy: powerTrust,
								forbiddenTrustIdentities: [
									...Object.values(
										trustPolicy.authorPublicKeysByLanguage,
									).flatMap((keys) => Object.keys(keys)),
									...Object.values(
										trustPolicy.nativeReviewerPublicKeysByLanguage,
									).flatMap((keys) => Object.keys(keys)),
									...Object.keys(executionTrustPolicy.executorPublicKeys),
									...Object.keys(adjudicationTrust.adjudicators),
									parsedPlan.administrator,
								],
								forbiddenTrustPublicKeys: [
									...Object.values(
										trustPolicy.authorPublicKeysByLanguage,
									).flatMap((keys) => Object.values(keys)),
									...Object.values(
										trustPolicy.nativeReviewerPublicKeysByLanguage,
									).flatMap((keys) => Object.values(keys)),
									...Object.values(executionTrustPolicy.executorPublicKeys),
									...Object.values(adjudicationTrust.adjudicators).map(
										(policy) => policy.publicKey,
									),
									...Object.values(analysisTrust.administratorPublicKeys),
								],
							}),
						};
					}
					const caseById = new Map(
						contract.cases.map((item) => [item.id, item]),
					);
					competitiveInference = calculateSemanticCompetitiveInference({
						plan: parsedPlan,
						samples: adjudication.score.samples.map((sample) => {
							const benchmarkCase = caseById.get(sample.caseId);
							if (!benchmarkCase)
								throw new Error(
									`competitive inference case is unknown: ${sample.caseId}`,
								);
							return {
								engine: sample.engine,
								language: sample.language,
								familyId: benchmarkCase.familyId,
								authorClusterId: benchmarkCase.provenance?.authorId ?? "",
								constructionClusterId:
									benchmarkCase.provenance?.constructionClusterId ?? "",
								caseId: sample.caseId,
								currentAt1: sample.labels[0] === "current" ? 1 : 0,
								currentAtK: sample.labels.includes("current") ? 1 : 0,
								staleExposureAtK: sample.labels.includes("stale") ? 1 : 0,
								deletionLeakageAtK: sample.labels.includes("deleted") ? 1 : 0,
							};
						}),
					});
				}
				process.stdout.write(
					`${JSON.stringify({
						...corpusResult,
						executionEvidenceQualified: true,
						...execution,
						adjudicationEvidenceQualified: true,
						...adjudication,
						...analysisPlan,
						...competitiveInference,
						promotable: false,
						failure:
							args.length >= 14
								? args.length === 19
									? "pilot review is attested but construction-cause independence and prior-assignment timing are not empirically verified; competitive thresholds, simultaneous uncertainty, latency, and released-commit evidence are not evaluated by this gate"
									: "an independent pilot power review, competitive thresholds, simultaneous uncertainty, latency, and released-commit evidence are not evaluated by this gate"
								: "a preregistered analysis plan, competitive thresholds, uncertainty, latency, and released-commit evidence are not evaluated by this gate",
					})}\n`,
				);
				return 1;
			}
			process.stdout.write(
				`${JSON.stringify({
					...corpusResult,
					executionEvidenceQualified: true,
					...execution,
					promotable: false,
					failure:
						"blinded independent adjudication and competitive metrics are not evaluated by this gate",
				})}\n`,
			);
			return 1;
		}
		process.stdout.write(
			`${JSON.stringify({
				...corpusResult,
				promotable: false,
				failure:
					"semantic engine execution evidence is not evaluated by this gate",
			})}\n`,
		);
		return 1;
	} catch (error) {
		const failure =
			error instanceof Error ? error.message : "contract intake failed";
		process.stdout.write(
			`${JSON.stringify(
				mode === "corpus"
					? { corpusQualified: false, failure }
					: { promotable: false, failure },
			)}\n`,
		);
		return 1;
	}
}

export async function runSemanticPublicGateCli(
	args: string[],
): Promise<number> {
	return runSemanticEvidenceGateCli(args, "public");
}

export async function runSemanticCorpusGateCli(
	args: string[],
): Promise<number> {
	return runSemanticEvidenceGateCli(args, "corpus");
}

const invokedPath =
	process.argv[1] && pathToFileURL(resolve(process.argv[1])).href;
if (invokedPath === import.meta.url)
	process.exitCode = await runSemanticPublicGateCli(process.argv.slice(2));
