import { describe, expect, it } from "vitest";
import {
	resolveFullCorpusLanguage,
	resolveFullCorpusLaunchReceiptOutput,
	resolveFullCorpusLaunchReceiptPath,
	resolveFullCorpusOutputPath,
} from "./native-full-corpus-launch-receipt.js";

describe("full-corpus launch receipt defaults", () => {
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
