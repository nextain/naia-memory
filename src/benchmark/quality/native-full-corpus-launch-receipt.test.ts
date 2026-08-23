import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
	resolveEnglishCorpusIdentityBinding,
	resolveFullCorpusLanguage,
	resolveFullCorpusLaunchReceiptOutput,
	resolveFullCorpusLaunchReceiptPath,
	resolveFullCorpusOutputPath,
	verifyEnglishCorpusIdentityLaunchChain,
} from "./native-full-corpus-launch-receipt.js";

describe("full-corpus launch receipt defaults", () => {
	it("fails closed unless English binds the locked corpus identity", () => {
		const environment = new Map([
			["MIRACL_LANGUAGE", "en"],
			[
				"MIRACL_CORPUS_IDENTITY_RECEIPT",
				"reports/quality/miracl-en-corpus-identity-observation-v2.json",
			],
		]);
		expect(
			resolveEnglishCorpusIdentityBinding(
				environment,
				(path) => JSON.parse(readFileSync(path, "utf8")) as unknown,
			),
		).toEqual({
			receiptSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
			sourceLockSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
		});
		expect(() =>
			resolveEnglishCorpusIdentityBinding(
				new Map([["MIRACL_LANGUAGE", "en"]]),
				() => ({}),
			),
		).toThrow("requires a corpus identity");
		expect(() =>
			resolveEnglishCorpusIdentityBinding(
				new Map([
					["MIRACL_LANGUAGE", "ar"],
					["MIRACL_CORPUS_IDENTITY_RECEIPT", "receipt.json"],
				]),
				() => ({}),
			),
		).toThrow("reserved for English");
	});

	it("rejects absent, malformed, or mismatched English identity chains", () => {
		const valid = {
			language: "en" as const,
			receiptSha256: "a".repeat(64),
			launchSourceLockSha256: "b".repeat(64),
			resultSourceLockSha256: "b".repeat(64),
		};
		expect(() => verifyEnglishCorpusIdentityLaunchChain(valid)).not.toThrow();
		for (const changed of [
			{ ...valid, receiptSha256: null },
			{ ...valid, receiptSha256: "A".repeat(64) },
			{ ...valid, launchSourceLockSha256: null },
			{ ...valid, resultSourceLockSha256: "c".repeat(64) },
		])
			expect(() => verifyEnglishCorpusIdentityLaunchChain(changed)).toThrow(
				"identity launch chain mismatch",
			);
		expect(() =>
			verifyEnglishCorpusIdentityLaunchChain({
				...valid,
				language: "ar",
				receiptSha256: null,
			}),
		).not.toThrow();
	});
	it("binds the implicit output path to the live MIRACL language", () => {
		expect(
			resolveFullCorpusOutputPath(new Map([["MIRACL_LANGUAGE", "ar"]])),
		).toBe("reports/quality/miracl-ar-full-corpus-vector-exact.json");
		expect(
			resolveFullCorpusLaunchReceiptPath(new Map([["MIRACL_LANGUAGE", "ar"]])),
		).toBe("reports/quality/miracl-ar-full-corpus-launch-receipt.json");
	});

	it("retains the frozen Korean default when language is absent", () => {
		expect(resolveFullCorpusOutputPath(new Map())).toBe(
			"reports/quality/miracl-ko-full-corpus-vector-exact.json",
		);
	});

	it("honors an explicit output and rejects malformed language values", () => {
		expect(
			resolveFullCorpusOutputPath(
				new Map([
					["MIRACL_LANGUAGE", "ar"],
					["MIRACL_FULL_OUTPUT", "custom/miracl-ar-full-corpus-result.json"],
				]),
			),
		).toBe("custom/miracl-ar-full-corpus-result.json");
		expect(
			resolveFullCorpusLaunchReceiptPath(
				new Map([
					["MIRACL_LANGUAGE", "ar"],
					[
						"MIRACL_FULL_LAUNCH_RECEIPT",
						"custom/miracl-ar-full-corpus-launch.json",
					],
				]),
			),
		).toBe("custom/miracl-ar-full-corpus-launch.json");
		expect(() =>
			resolveFullCorpusLanguage(new Map([["MIRACL_LANGUAGE", "arabic"]])),
		).toThrow("language is invalid");
		expect(() =>
			resolveFullCorpusLanguage(new Map([["MIRACL_LANGUAGE", "zz"]])),
		).toThrow("language is invalid");
		expect(() =>
			resolveFullCorpusLaunchReceiptPath(
				new Map([
					["MIRACL_LANGUAGE", "ar"],
					["MIRACL_FULL_OUTPUT", "custom/miracl-ar-full-corpus-same.json"],
					[
						"MIRACL_FULL_LAUNCH_RECEIPT",
						"custom/miracl-ar-full-corpus-same.json",
					],
				]),
			),
		).toThrow("paths collide");
		expect(() =>
			resolveFullCorpusOutputPath(
				new Map([
					["MIRACL_LANGUAGE", "ar"],
					["MIRACL_FULL_OUTPUT", "custom/miracl-ko-full-corpus-result.json"],
				]),
			),
		).toThrow("not language scoped");
	});

	it("accepts only a language-scoped, non-colliding local override", () => {
		const environment = new Map([["MIRACL_LANGUAGE", "ar"]]);
		expect(
			resolveFullCorpusLaunchReceiptOutput(
				environment,
				"reports/quality/miracl-ar-full-corpus-launch-receipt-v2.json",
			),
		).toContain("miracl-ar-full-corpus");
		expect(() =>
			resolveFullCorpusLaunchReceiptOutput(
				environment,
				"reports/quality/miracl-ko-full-corpus-launch-receipt.json",
			),
		).toThrow("not language scoped");
		expect(() =>
			resolveFullCorpusLaunchReceiptOutput(
				environment,
				"reports/quality/miracl-ar-full-corpus-proof/../miracl-ko-full-corpus-launch-receipt.json",
			),
		).toThrow("not language scoped");
		expect(() =>
			resolveFullCorpusLaunchReceiptOutput(
				environment,
				"../../tmp/miracl-ar-full-corpus-launch-receipt-v2.json",
			),
		).toThrow("not language scoped");
		expect(() =>
			resolveFullCorpusLaunchReceiptOutput(
				environment,
				"reports/quality/miracl-ar-full-corpus-vector-exact.json",
			),
		).toThrow("collide");
	});
});
