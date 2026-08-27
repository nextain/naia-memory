import { describe, expect, it } from "vitest";
import {
	resolveFullCorpusRuntimeMonitorPaths,
	verifyFullCorpusRuntimeMonitorLanguage,
} from "./native-full-corpus-runtime-monitor-config.js";

describe("full-corpus runtime monitor paths", () => {
	it.each(["ko", "en", "ar"] as const)(
		"uses language-scoped defaults for %s",
		(language) => {
			expect(
				resolveFullCorpusRuntimeMonitorPaths({ MIRACL_LANGUAGE: language }),
			).toEqual({
				language,
				launchPath: `reports/quality/miracl-${language}-full-corpus-launch-receipt.json`,
				outputPath: `reports/quality/miracl-${language}-full-corpus-runtime-observation.json`,
			});
		},
	);

	it("preserves explicit paths", () => {
		expect(
			resolveFullCorpusRuntimeMonitorPaths({
				MIRACL_LANGUAGE: "en",
				MIRACL_FULL_LAUNCH_RECEIPT: "/tmp/launch.json",
				MIRACL_FULL_RUNTIME_OBSERVATION: "/tmp/observation.json",
			}),
		).toMatchObject({
			launchPath: "/tmp/launch.json",
			outputPath: "/tmp/observation.json",
		});
	});

	it("defaults to Korean and rejects unsupported languages", () => {
		expect(resolveFullCorpusRuntimeMonitorPaths({})).toMatchObject({
			language: "ko",
		});
		expect(() =>
			resolveFullCorpusRuntimeMonitorPaths({ MIRACL_LANGUAGE: "fr" }),
		).toThrow("unsupported MIRACL runtime monitor language: fr");
	});

	it("rejects a launch receipt from another or unspecified language", () => {
		expect(() =>
			verifyFullCorpusRuntimeMonitorLanguage("ar", { language: "ko" }),
		).toThrow("runtime monitor language mismatch: expected ar, received ko");
		expect(() => verifyFullCorpusRuntimeMonitorLanguage("ar", {})).toThrow(
			"runtime monitor language mismatch: expected ar, received undefined",
		);
		expect(() =>
			verifyFullCorpusRuntimeMonitorLanguage("ar", { language: "ar" }),
		).not.toThrow();
	});
});
