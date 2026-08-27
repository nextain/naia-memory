import { createHash } from "node:crypto";
import {
	mkdirSync,
	mkdtempSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	MIRACL_EN_PRIMARY_OUTPUT,
	MIRACL_EN_PRIMARY_TREC,
	authorizeMiraclEnPrimaryExecution,
	verifyMiraclEnPreflightVectorArtifact,
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
				vectorArtifactSha256: "c".repeat(64),
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

	it("requires authorization and execution to use the same source root", () => {
		expect(() =>
			verifyMiraclEnPrimaryExecutionFiles({
				...baseEnvironment(),
				MIRACL_SOURCE_DIR: ".cache/benchmark-sources/other-en",
				MIRACL_SOURCE_RECEIPT:
					".cache/benchmark-sources/miracl-en-v1.0/source-lock-receipt.json",
			}),
		).toThrow("source receipt and execution source root must be identical");
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

	it("binds authorization to the actual vector artifact bytes", () => {
		const root = mkdtempSync(join(tmpdir(), "miracl-en-vectors-"));
		const path = join(root, "evidence.json.vectors.f32");
		const bytes = Buffer.from("sealed-vector-artifact");
		const digest = createHash("sha256").update(bytes).digest("hex");
		try {
			writeFileSync(path, bytes);
			expect(verifyMiraclEnPreflightVectorArtifact(path, digest)).toBe(digest);
			writeFileSync(path, "tampered");
			expect(() => verifyMiraclEnPreflightVectorArtifact(path, digest)).toThrow(
				"digest mismatch",
			);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("rejects a symlink in place of the vector artifact", () => {
		const root = mkdtempSync(join(tmpdir(), "miracl-en-vectors-"));
		const target = join(root, "target.f32");
		const link = join(root, "evidence.json.vectors.f32");
		const bytes = Buffer.from("sealed-vector-artifact");
		const digest = createHash("sha256").update(bytes).digest("hex");
		try {
			writeFileSync(target, bytes);
			symlinkSync(target, link);
			expect(() =>
				verifyMiraclEnPreflightVectorArtifact(link, digest),
			).toThrow();
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});
