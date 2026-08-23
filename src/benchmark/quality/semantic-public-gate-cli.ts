import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
	isBenchmarkDevelopmentExecutionEvidence,
	isBenchmarkDevelopmentExecutionTrustPolicy,
	validateBenchmarkDevelopmentExecutionEvidence,
} from "./benchmark-development-execution-evidence.js";
import {
	isBenchmarkDevelopmentExecutionRegistryEvidence,
	isBenchmarkDevelopmentExecutionRegistryTrustPolicy,
	validateBenchmarkDevelopmentExecutionRegistry,
} from "./benchmark-development-execution-registry.js";
import {
	isBenchmarkSelectionDisclosure,
	isBenchmarkSelectionDisclosureTrustPolicy,
	validateBenchmarkSelectionDisclosure,
} from "./benchmark-selection-disclosure.js";
import {
	type MemoryUpdateContract,
	validateSemanticPublicEvidenceCoverage,
} from "./memory-update-contract.js";
import { evidenceObjectSha256 } from "./public-evidence-crypto.js";
import {
	PublicEvidenceFileTooLargeError,
	readBoundedEvidenceFile,
} from "./public-evidence-file-io.js";
import type {
	Rfc3161DigestTimestampEvidence,
	Rfc3161TimestampEvidence,
	Rfc3161TimestampTrustPolicy,
} from "./rfc3161-timestamp.js";
import {
	isRfc3161DigestTimestampEvidence,
	isRfc3161TimestampTrustPolicy,
	validateRfc3161DigestTimestampBinding,
} from "./rfc3161-timestamp.js";
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
import type { SemanticPilotDeliveryAcknowledgementBundle } from "./semantic-pilot-delivery-acknowledgement.js";
import type { SemanticPilotLaunchReceipt } from "./semantic-pilot-launch.js";
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
			args.length !== 19 &&
			args.length !== 22 &&
			args.length !== 26 &&
			args.length !== 28 &&
			args.length !== 32 &&
			args.length !== 34)
	) {
		process.stderr.write(
			`Usage: pnpm benchmark:semantic-${mode}-gate <contract.json> <attestations.json> <trust-policy.json>${
				mode === "public"
					? " [<campaign.json> <execution-evidence.json> <execution-trust-policy.json> [<packet.json> <seal.json> <judgments.json> <adjudication-evidence.json> <adjudication-trust-policy.json> <blinding-seed> [<analysis-plan.json> <analysis-plan-trust-policy.json> [<pilot-collection-plan.json> <pilot-contract.json> <sample-size-assumptions.json> <power-review.json> <power-review-trust-policy.json> [<rfc3161-timestamp-evidence.json> <rfc3161-timestamp-trust-policy.json> <pilot-launch-receipt.json> [<delivery-acknowledgements.json> <participant-trust-policy.json> <delivery-rfc3161-evidence.json> <delivery-rfc3161-trust-policy.json> [<selection-disclosure.json> <selection-disclosure-trust-policy.json> [<development-execution-evidence.json> <development-execution-trust-policy.json> <development-plan-rfc3161-evidence.json> <development-plan-rfc3161-trust-policy.json> [<development-execution-registry.json> <development-execution-registry-trust-policy.json>]]]]]]]]]"
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
				let selectionHistory = {};
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
					if (args.length >= 19) {
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
						const timestampEvidence =
							args.length >= 22
								? ((await readJson(
										args[19],
										"RFC 3161 timestamp evidence",
									)) as Rfc3161TimestampEvidence)
								: undefined;
						const timestampTrustPolicy =
							args.length >= 22
								? ((await readJson(
										args[20],
										"RFC 3161 timestamp verifier trust policy",
									)) as Rfc3161TimestampTrustPolicy)
								: undefined;
						const launchReceipt =
							args.length >= 22
								? ((await readJson(
										args[21],
										"semantic pilot launch receipt",
									)) as SemanticPilotLaunchReceipt)
								: undefined;
						const deliveryAcknowledgements =
							args.length >= 26
								? ((await readJson(
										args[22],
										"delivery acknowledgement bundle",
									)) as SemanticPilotDeliveryAcknowledgementBundle)
								: undefined;
						const participantTrustPolicy =
							args.length >= 26
								? await readJson(args[23], "participant trust policy")
								: undefined;
						if (
							participantTrustPolicy !== undefined &&
							!isSemanticPublicTrustPolicy(participantTrustPolicy)
						)
							throw new Error("participant trust policy shape is invalid");
						const deliveryTimestampEvidence =
							args.length >= 26
								? ((await readJson(
										args[24],
										"delivery RFC 3161 timestamp evidence",
									)) as Rfc3161DigestTimestampEvidence)
								: undefined;
						const deliveryTimestampTrustPolicy =
							args.length >= 26
								? ((await readJson(
										args[25],
										"delivery RFC 3161 timestamp trust policy",
									)) as Rfc3161TimestampTrustPolicy)
								: undefined;
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
								timestampEvidence,
								timestampTrustPolicy,
								launchReceipt,
								deliveryAcknowledgements,
								participantTrustPolicy,
								deliveryTimestampEvidence,
								deliveryTimestampTrustPolicy,
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
						if (args.length >= 28) {
							const disclosure = await readJson(
								args[26],
								"selection disclosure",
							);
							if (!isBenchmarkSelectionDisclosure(disclosure))
								throw new Error("selection disclosure shape is invalid");
							const selectionTrust = await readJson(
								args[27],
								"selection disclosure trust policy",
							);
							if (!isBenchmarkSelectionDisclosureTrustPolicy(selectionTrust))
								throw new Error(
									"selection disclosure trust policy shape is invalid",
								);
							const firstExecutionStartedAt = executionBundle.receipts
								.map((receipt) => receipt.startedAt)
								.sort()[0];
							const naiaReceipt = executionBundle.receipts.find(
								(receipt) => receipt.engine === "naia",
							);
							if (!firstExecutionStartedAt || !naiaReceipt)
								throw new Error(
									"selection disclosure requires a Naia confirmatory execution",
								);
							const contractSha256 = evidenceObjectSha256(contract);
							if (disclosure.confirmatoryDatasetSha256 !== contractSha256)
								throw new Error(
									"selection disclosure confirmatory dataset binding is invalid",
								);
							selectionHistory = validateBenchmarkSelectionDisclosure({
								disclosure,
								trustPolicy: selectionTrust,
								expectedContractSha256: contractSha256,
								expectedAnalysisPlanSha256: evidenceObjectSha256(parsedPlan),
								firstConfirmatoryExecutionStartedAt: firstExecutionStartedAt,
								forbiddenTrustIdentities: [
									...Object.values(
										trustPolicy.authorPublicKeysByLanguage,
									).flatMap((keys) => Object.keys(keys)),
									...Object.values(
										trustPolicy.nativeReviewerPublicKeysByLanguage,
									).flatMap((keys) => Object.keys(keys)),
									...Object.keys(executionTrustPolicy.executorPublicKeys),
									...Object.keys(adjudicationTrust.adjudicators),
									...Object.keys(analysisTrust.administratorPublicKeys),
									...Object.keys(powerTrust.reviewerPublicKeys),
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
									...Object.values(powerTrust.reviewerPublicKeys),
								],
							});
							if (
								selectionHistory.selectedPolicySha256 !==
								naiaReceipt.configurationSha256
							)
								throw new Error(
									"selected benchmark policy does not match the executed Naia configuration",
								);
							if (args.length === 32 || args.length === 34) {
								const developmentEvidence = await readJson(
									args[28],
									"development execution evidence",
								);
								if (
									!isBenchmarkDevelopmentExecutionEvidence(developmentEvidence)
								)
									throw new Error(
										"development execution evidence shape is invalid",
									);
								const developmentTrust = await readJson(
									args[29],
									"development execution trust policy",
								);
								if (
									!isBenchmarkDevelopmentExecutionTrustPolicy(developmentTrust)
								)
									throw new Error(
										"development execution trust policy shape is invalid",
									);
								const developmentTimestampEvidence = await readJson(
									args[30],
									"development plan RFC 3161 evidence",
								);
								if (
									!isRfc3161DigestTimestampEvidence(
										developmentTimestampEvidence,
									)
								)
									throw new Error(
										"development plan RFC 3161 evidence shape is invalid",
									);
								const developmentTimestampTrust = await readJson(
									args[31],
									"development plan RFC 3161 trust policy",
								);
								if (!isRfc3161TimestampTrustPolicy(developmentTimestampTrust))
									throw new Error(
										"development plan RFC 3161 trust policy shape is invalid",
									);
								const developmentTimestamp =
									validateRfc3161DigestTimestampBinding({
										expectedArtifactSha256: evidenceObjectSha256(
											developmentEvidence.plan,
										),
										evidence: developmentTimestampEvidence,
										trustPolicy: developmentTimestampTrust,
									});
								selectionHistory = {
									...selectionHistory,
									...validateBenchmarkDevelopmentExecutionEvidence({
										evidence: developmentEvidence,
										trustPolicy: developmentTrust,
										expectedSelectionRuleSha256: disclosure.selectionRuleSha256,
										expectedConfirmatoryDatasetSha256:
											disclosure.confirmatoryDatasetSha256,
										trustedPlanTimestampedAt:
											developmentTimestamp.timestampedAt,
										expectedObservations: disclosure.developmentObservations,
										forbiddenTrustIdentities: [
											...Object.keys(selectionTrust.auditorPublicKeys),
											...Object.keys(executionTrustPolicy.executorPublicKeys),
											...Object.keys(adjudicationTrust.adjudicators),
										],
										forbiddenTrustPublicKeys: [
											...Object.values(selectionTrust.auditorPublicKeys),
											...Object.values(executionTrustPolicy.executorPublicKeys),
											...Object.values(adjudicationTrust.adjudicators).map(
												(policy) => policy.publicKey,
											),
										],
									}),
								};
								if (args.length === 34) {
									const registryEvidence = await readJson(
										args[32],
										"development execution registry",
									);
									if (
										!isBenchmarkDevelopmentExecutionRegistryEvidence(
											registryEvidence,
										)
									)
										throw new Error(
											"development execution registry shape is invalid",
										);
									const registryTrust = await readJson(
										args[33],
										"development execution registry trust policy",
									);
									if (
										!isBenchmarkDevelopmentExecutionRegistryTrustPolicy(
											registryTrust,
										)
									)
										throw new Error(
											"development execution registry trust policy shape is invalid",
										);
									selectionHistory = {
										...selectionHistory,
										...validateBenchmarkDevelopmentExecutionRegistry({
											evidence: registryEvidence,
											trustPolicy: registryTrust,
											developmentTrustPolicy: developmentTrust,
											timestampTrustPolicy: developmentTimestampTrust,
											plan: developmentEvidence.plan,
											receipts: developmentEvidence.receipts,
											trustedPlanTimestampedAt:
												developmentTimestamp.timestampedAt,
											forbiddenTrustIdentities: [
												...Object.keys(selectionTrust.auditorPublicKeys),
												...Object.keys(executionTrustPolicy.executorPublicKeys),
												...Object.keys(adjudicationTrust.adjudicators),
											],
											forbiddenTrustPublicKeys: [
												...Object.values(selectionTrust.auditorPublicKeys),
												...Object.values(
													executionTrustPolicy.executorPublicKeys,
												),
												...Object.values(adjudicationTrust.adjudicators).map(
													(policy) => policy.publicKey,
												),
											],
										}),
									};
								}
							}
						}
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
						...selectionHistory,
						...competitiveInference,
						promotable: false,
						failure:
							args.length >= 14
								? args.length >= 19
									? args.length >= 26
										? args.length >= 28
											? args.length === 34
												? "pilot review, prior-assignment timing, participant acknowledgement signatures, trusted prior existence of the complete acknowledgement bundle, signed selection disclosure, development receipt binding, and registered development execution start/finish chronology are verified; absence of off-registry executions, absence of undisclosed shadow trials, and selection-history completeness remain unverified; human identity, comprehension, independence, physical delivery, and construction-cause independence are not empirically verified; competitive thresholds, simultaneous uncertainty, latency, and released-commit evidence are not evaluated by this gate"
												: args.length === 32
													? "pilot review, prior-assignment timing, participant acknowledgement signatures, trusted prior existence of the complete acknowledgement bundle, signed candidate-selection disclosure internal consistency, executed Naia policy binding, a trusted timestamp on the development matrix, complete timestamped-matrix coverage, and development receipt binding are verified; receipt event times, absence of undisclosed shadow trials, and selection-history completeness are not externally verified; human identity, comprehension, independence, physical delivery, and construction-cause independence are not empirically verified; competitive thresholds, simultaneous uncertainty, latency, and released-commit evidence are not evaluated by this gate"
													: "pilot review, prior-assignment timing, participant acknowledgement signatures, trusted prior existence of the complete acknowledgement bundle, signed candidate-selection disclosure internal consistency, and executed Naia policy binding are verified; development observation receipts and selection-history completeness are not externally verified; human identity, comprehension, independence, physical delivery, and construction-cause independence are not empirically verified; competitive thresholds, simultaneous uncertainty, latency, and released-commit evidence are not evaluated by this gate"
											: "pilot review, prior-assignment timing, participant acknowledgement signatures, and trusted prior existence of the complete acknowledgement bundle are verified; candidate-selection history and executed-policy binding are not evaluated by this gate; human identity, comprehension, independence, physical delivery, and construction-cause independence are not empirically verified; competitive thresholds, simultaneous uncertainty, latency, and released-commit evidence are not evaluated by this gate"
										: args.length === 22
											? "pilot review and prior-assignment timing are verified, and the operator-created launch receipt is internally consistent with the plan and timestamp token; participant delivery and construction-cause independence are not empirically verified; competitive thresholds, simultaneous uncertainty, latency, and released-commit evidence are not evaluated by this gate"
											: "pilot review is attested but construction-cause independence and prior-assignment timing are not empirically verified; competitive thresholds, simultaneous uncertainty, latency, and released-commit evidence are not evaluated by this gate"
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
