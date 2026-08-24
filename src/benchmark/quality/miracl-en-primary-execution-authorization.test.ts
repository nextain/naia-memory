import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	MIRACL_EN_PRIMARY_OUTPUT,
	MIRACL_EN_PRIMARY_TREC,
	authorizeMiraclEnPrimaryExecution,
	verifyMiraclEnPrimaryExecutionFiles,
} from "./miracl-en-primary-execution-authorization.js";

function baseEnvironment(): NodeJS.ProcessEnv {
	return {
		MIRACL_LANGUAGE: "en",
		MIRACL_EN_PRIMARY_EXECUTION: "1",
		CUDA_VISIBLE_DEVICES: "",
		MIRACL_QDRANT_SERVICE_RECEIPT: "qdrant.json",
	};
}

describe("MIRACL English primary authorization", () => {
	it("rejects noncanonical evidence before accepting its semantic fields", () => {
		const preflight = {};
		expect(() =>
			authorizeMiraclEnPrimaryExecution({
				preflight,
				preflightBytes: Buffer.from("{}"),
				sampleReceipt: {},
				sampleReceiptBytes: Buffer.from("{}\n"),
				sourceReceipt: {},
				sourceReceiptBytes: Buffer.from("{}\n"),
				qdrantReceipt: {},
				qdrantReceiptBytes: Buffer.from("{}\n"),
				evaluationSourceSha256: "a".repeat(64),
				authorizationSourceSha256: "b".repeat(64),
			}),
		).toThrow("English preflight is not canonical");
	});

	it("requires mutually exclusive authorization modes and pinned launch paths", () => {
		expect(() =>
			verifyMiraclEnPrimaryExecutionFiles({
				...baseEnvironment(),
				MIRACL_MULTILINGUAL_AUTHORIZATION: "candidate.json",
			}),
		).toThrow("mutually exclusive");
		expect(() =>
			verifyMiraclEnPrimaryExecutionFiles({
				...baseEnvironment(),
				MIRACL_FULL_OUTPUT: "score-shopping.json",
			}),
		).toThrow("paths are pinned");
	});

	it("refuses to overwrite either result surface", () => {
		for (const output of [MIRACL_EN_PRIMARY_OUTPUT, MIRACL_EN_PRIMARY_TREC]) {
			const root = mkdtempSync(join(tmpdir(), "miracl-en-primary-"));
			const path = join(root, output);
			mkdirSync(dirname(path), { recursive: true });
			writeFileSync(path, "existing\n");
			expect(() =>
				verifyMiraclEnPrimaryExecutionFiles(baseEnvironment(), root),
			).toThrow(output === MIRACL_EN_PRIMARY_OUTPUT ? "result" : "TREC");
		}
	});

	it("requires an explicit CPU-only opt-in", () => {
		expect(() =>
			verifyMiraclEnPrimaryExecutionFiles({
				...baseEnvironment(),
				CUDA_VISIBLE_DEVICES: undefined,
			}),
		).toThrow("CPU-only");
		expect(() =>
			verifyMiraclEnPrimaryExecutionFiles({
				...baseEnvironment(),
				MIRACL_EN_PRIMARY_EXECUTION: undefined,
			}),
		).toThrow("opt-in");
	});
});
