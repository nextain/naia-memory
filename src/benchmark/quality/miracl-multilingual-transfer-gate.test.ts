import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createMiraclLanguageComparison } from "./miracl-language-comparison.js";
import { runMiraclMultilingualTransferGateCli } from "./miracl-multilingual-transfer-gate-cli.js";
import { createMiraclMultilingualTransferGate } from "./miracl-multilingual-transfer-gate.js";
import {
	EXPECTED_TREC_EVAL_BINARY_SHA256,
	TREC_EVAL_COMMIT,
	TREC_EVAL_VERSION,
	sha256Bytes,
} from "./native-full-corpus-evidence.js";
import { evidenceObjectSha256 } from "./public-evidence-crypto.js";

const identities = {
	ko: {
		role: "anchor",
		documentCount: 1_486_752,
		queryCount: 213,
		sourceLockSha256:
			"742952715d6e31eaf9718f04c2bad0509c9d7c754210aa81d793a14430fbb69c",
		docidsSha256:
			"6024e30f6c7aed244a5451a9552163a86f74b4254775022f4d4829fcaa87e879",
	},
	en: {
		role: "transfer",
		documentCount: 32_893_221,
		queryCount: 799,
		sourceLockSha256:
			"99727481b47a8a423ad8fa54ca09c8296515fba17ce9c9ce6356e53654918549",
		docidsSha256:
			"23a425f3889a6b6a3f41f32666cb748fca05ae2e750abad13ebbc0354ebb7847",
	},
	ar: {
		role: "transfer",
		documentCount: 2_061_414,
		queryCount: 2_896,
		sourceLockSha256:
			"6f67a375d0bf8062fb6d591843052ab3555b1b5d69acdae164a83387dbaf71e1",
		docidsSha256:
			"b81389dd2afad4d0273ec92c25f446b478cb41afb8327c162f8919d93b3c3659",
	},
} as const;

function completion(
	language: keyof typeof identities,
	overrideMetrics?: readonly [number, number],
) {
	const identity = identities[language];
	const metrics =
		overrideMetrics ??
		(language === "ko"
			? [0.6526, 0.9233]
			: language === "en"
				? [0.549, 0.882]
				: [0.673, 0.941]);
	const stdout = `ndcg_cut_10 all ${metrics[0]}\nrecall_100 all ${metrics[1]}\n`;
	const artifacts = {
		result: {
			path: `${language}.json`,
			sha256: sha256Bytes(`result:${language}`),
		},
		checkpointChain: {
			documentCount: identity.documentCount,
			docidsSha256: identity.docidsSha256,
		},
	};
	return `${JSON.stringify(
		{
			schemaVersion: "naia-memory-miracl-multilingual-completion-evidence-v1",
			verdict: "LOCAL_PASS",
			assurance: "self-observed-local",
			publicClaimEligible: false,
			publicClaimRequirement: "independent signed execution attestation",
			claimBoundary: { launchReceipt: "observed", runtimeSnapshot: "observed" },
			language,
			benchmark: `miracl-${language}-full-corpus-naia-vector-exact-v1`,
			identity: {
				language,
				role: identity.role,
				documentCount: identity.documentCount,
				queryCount: identity.queryCount,
				sourceLockSha256: identity.sourceLockSha256,
			},
			independentEvaluatorTool: {
				name: "usnistgov/trec_eval",
				version: TREC_EVAL_VERSION,
				commit: TREC_EVAL_COMMIT,
				binarySha256: EXPECTED_TREC_EVAL_BINARY_SHA256,
				stdout,
				stdoutSha256: sha256Bytes(stdout),
			},
			metrics: {
				reproducedByIndependentTool: {
					ndcgAt10: metrics[0],
					recallAt100: metrics[1],
				},
			},
			runtime: {
				cpuOnly: true,
				qdrant: { pointsCount: identity.documentCount },
			},
			artifacts,
			artifactManifestSha256: evidenceObjectSha256(artifacts),
			implementation: {
				evaluationSourceSha256: sha256Bytes("evaluation"),
				runtimeMonitorSourceSha256: sha256Bytes("monitor"),
				artifactStability: {},
			},
		},
		null,
		2,
	)}\n`;
}

function inputs(overrideMetrics?: readonly [number, number]) {
	return (["ko", "en", "ar"] as const).map((language) => {
		const completionEvidenceText = completion(language, overrideMetrics);
		return {
			completionEvidenceText,
			comparisonText: `${JSON.stringify(createMiraclLanguageComparison(completionEvidenceText), null, 2)}\n`,
		};
	});
}

describe("MIRACL multilingual transfer gate", () => {
	it("requires and reports every preregistered language without pooling", () => {
		const result = createMiraclMultilingualTransferGate(inputs());
		expect(result.requiredLanguages).toEqual(["ko", "en", "ar"]);
		expect(result.languages.map(({ language }) => language)).toEqual([
			"ko",
			"en",
			"ar",
		]);
		expect(result.aggregation).toBe("none");
		expect(result.publicClaimEligible).toBe(false);
		expect(result.preregisteredInterpretation.outcome).toBe(
			"STRONG_TRANSFER_NOT_ESTABLISHED",
		);
	});

	it("uses the frozen all-languages, both-metrics threshold for strong transfer", () => {
		const result = createMiraclMultilingualTransferGate(inputs([0.99, 0.99]));
		expect(result.preregisteredInterpretation).toMatchObject({
			outcome: "STRONG_TRANSFER",
			postHocThresholdChangesAllowed: false,
		});
	});

	it("rejects a gain that remains inside published-row rounding on one metric", () => {
		const result = createMiraclMultilingualTransferGate(inputs([0.6734, 0.99]));
		expect(result.preregisteredInterpretation.outcome).toBe(
			"STRONG_TRANSFER_NOT_ESTABLISHED",
		);
	});

	it("rejects omission, duplication, and a comparison detached from its evidence", () => {
		const valid = inputs();
		expect(() =>
			createMiraclMultilingualTransferGate(valid.slice(0, 2)),
		).toThrow("all preregistered");
		expect(() =>
			createMiraclMultilingualTransferGate([valid[0], valid[0], valid[2]]),
		).toThrow("duplicate comparison language");
		const forged = structuredClone(valid);
		const comparison = JSON.parse(forged[1].comparisonText);
		comparison.metrics.ndcgAt10 = 1;
		forged[1].comparisonText = JSON.stringify(comparison);
		expect(() => createMiraclMultilingualTransferGate(forged)).toThrow(
			"does not reproduce",
		);
	});

	it("normalizes input order to the preregistered order", () => {
		const result = createMiraclMultilingualTransferGate(inputs().reverse());
		expect(result.languages.map(({ language }) => language)).toEqual([
			"ko",
			"en",
			"ar",
		]);
	});

	it("writes the six-input gate through the CLI and refuses overwrite", async () => {
		const directory = await mkdtemp(join(tmpdir(), "miracl-transfer-gate-"));
		const output = join(directory, "gate.json");
		const args = ["--output", output];
		for (const [index, input] of inputs().entries()) {
			const evidencePath = join(directory, `${index}-evidence.json`);
			const comparisonPath = join(directory, `${index}-comparison.json`);
			await writeFile(evidencePath, input.completionEvidenceText);
			await writeFile(comparisonPath, input.comparisonText);
			args.push(evidencePath, comparisonPath);
		}
		expect(await runMiraclMultilingualTransferGateCli(args)).toBe(0);
		expect(
			JSON.parse(await readFile(output, "utf8")).requiredLanguages,
		).toEqual(["ko", "en", "ar"]);
		await expect(runMiraclMultilingualTransferGateCli(args)).rejects.toThrow();
		expect(await runMiraclMultilingualTransferGateCli(args.slice(0, -1))).toBe(
			2,
		);
	});
});
