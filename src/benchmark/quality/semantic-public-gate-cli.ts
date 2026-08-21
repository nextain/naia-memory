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
	isSemanticExecutionEvidenceBundle,
	isSemanticExecutionTrustPolicy,
	validateSemanticExecutionEvidence,
} from "./semantic-execution-evidence.js";
import {
	isSemanticPublicAttestationBundle,
	isSemanticPublicTrustPolicy,
	validateSemanticPublicAttestations,
} from "./semantic-public-attestation.js";

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
			args.length !== 12)
	) {
		process.stderr.write(
			`Usage: pnpm benchmark:semantic-${mode}-gate <contract.json> <attestations.json> <trust-policy.json>${
				mode === "public"
					? " [<campaign.json> <execution-evidence.json> <execution-trust-policy.json> [<packet.json> <seal.json> <judgments.json> <adjudication-evidence.json> <adjudication-trust-policy.json> <blinding-seed>]]"
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
			if (args.length === 12) {
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
				process.stdout.write(
					`${JSON.stringify({
						...corpusResult,
						executionEvidenceQualified: true,
						...execution,
						adjudicationEvidenceQualified: true,
						...adjudication,
						promotable: false,
						failure:
							"competitive thresholds, uncertainty, latency, and released-commit evidence are not evaluated by this gate",
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
