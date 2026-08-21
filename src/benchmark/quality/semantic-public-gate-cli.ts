import { resolve } from "node:path";
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
	isSemanticPublicAttestationBundle,
	isSemanticPublicTrustPolicy,
	validateSemanticPublicAttestations,
} from "./semantic-public-attestation.js";

const MAX_CONTRACT_BYTES = 16 * 1024 * 1024;

async function runSemanticEvidenceGateCli(
	args: string[],
	mode: "corpus" | "public",
): Promise<number> {
	if (args.length !== 3) {
		process.stderr.write(
			`Usage: pnpm benchmark:semantic-${mode}-gate <contract.json> <attestations.json> <trust-policy.json>\n`,
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
