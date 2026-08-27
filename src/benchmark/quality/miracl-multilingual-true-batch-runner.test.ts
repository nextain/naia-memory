import { createHash } from "node:crypto";
import {
	existsSync,
	lstatSync,
	mkdtempSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
	MULTILINGUAL_TRUE_BATCH_EQUIVALENCE_TEXTS,
	MULTILINGUAL_TRUE_BATCH_MODEL,
	MULTILINGUAL_TRUE_BATCH_MODEL_REVISION,
	type MultilingualEquivalenceExpectedIdentity,
	multilingualEquivalenceInputSha256,
} from "./miracl-multilingual-true-batch-equivalence.js";
import {
	expectedMultilingualTrueBatchIdentity,
	multilingualTrueBatchObservationEnvironment,
	multilingualTrueBatchOutputDirectory,
	multilingualTrueBatchProducerSourceManifest,
	runMultilingualTrueBatchEquivalencePilot,
	verifyMultilingualTrueBatchObservationReceipt,
} from "./miracl-multilingual-true-batch-runner.js";

function root(): string {
	return mkdtempSync(join(tmpdir(), "naia-multilingual-equivalence-"));
}

const expected: MultilingualEquivalenceExpectedIdentity = {
	model: MULTILINGUAL_TRUE_BATCH_MODEL,
	modelRevision: MULTILINGUAL_TRUE_BATCH_MODEL_REVISION,
	policySha256: "a".repeat(64),
	producerSourceSha256: "c".repeat(64),
};

function observation(
	_root: string,
	language: "ar" | "en",
	mode: "per-item-v1" | "padded-array-batch-v1",
	output: string,
	identity: MultilingualEquivalenceExpectedIdentity,
): void {
	writeFileSync(
		output,
		`${JSON.stringify({
			schemaVersion: 1,
			language,
			mode,
			inputSha256: multilingualEquivalenceInputSha256(language),
			policySha256: identity.policySha256,
			policyBasisMode: "per-item-v1",
			model: identity.model,
			modelRevision: identity.modelRevision,
			producerSourceSha256: identity.producerSourceSha256,
			vectors: MULTILINGUAL_TRUE_BATCH_EQUIVALENCE_TEXTS[language].map(
				(_, index) => [1, index / 100, 0],
			),
		})}\n`,
	);
}

describe("multilingual true-batch runner", () => {
	it("binds the producer's transitive source and lockfile", () => {
		const projectRoot = resolve(".");
		const manifest = multilingualTrueBatchProducerSourceManifest(projectRoot);
		expect(manifest.additionalInputs).toEqual(["pnpm-lock.yaml"]);
		expect(manifest.files.map(({ path }) => path)).toEqual(
			expect.arrayContaining([
				"pnpm-lock.yaml",
				"src/benchmark/quality/miracl-multilingual-true-batch-observation-cli.ts",
				"src/benchmark/quality/miracl-multilingual-true-batch-equivalence.ts",
				"src/benchmark/quality/native-full-corpus-policy.ts",
				"src/memory/embeddings.ts",
			]),
		);
		expect(expectedMultilingualTrueBatchIdentity(projectRoot)).toMatchObject({
			model: MULTILINGUAL_TRUE_BATCH_MODEL,
			modelRevision: MULTILINGUAL_TRUE_BATCH_MODEL_REVISION,
			producerSourceSha256: manifest.manifestSha256,
		});
	});

	it("allowlists child environment and cannot inherit Korean or GPU bindings", () => {
		const environment = multilingualTrueBatchObservationEnvironment(
			"ar",
			"per-item-v1",
			"/tmp/ar-observation.json",
			expected,
			{
				PATH: "/bin",
				HOME: "/tmp/home",
				CUDA_VISIBLE_DEVICES: "1",
				MIRACL_KO_AUTHORIZATION: "must-not-leak",
				SECRET_TOKEN: "must-not-leak",
			},
		);
		expect(environment.CUDA_VISIBLE_DEVICES).toBe("");
		expect(environment.MIRACL_MULTILINGUAL_EQUIVALENCE_LANGUAGE).toBe("ar");
		expect(environment).not.toHaveProperty("MIRACL_KO_AUTHORIZATION");
		expect(environment).not.toHaveProperty("SECRET_TOKEN");
	});

	it("accepts stdout diagnostics but binds the receipt to the observation bytes", () => {
		const observationPath = join(root(), "observation.json");
		writeFileSync(observationPath, '{"vectors":[]}\n');
		const receiptSha256 = createHash("sha256")
			.update(readFileSync(observationPath))
			.digest("hex");
		const receipt = JSON.stringify({
			schemaVersion: 1,
			language: "en",
			mode: "per-item-v1",
			output: observationPath,
			receiptSha256,
		});
		expect(() =>
			verifyMultilingualTrueBatchObservationReceipt(
				`dependency diagnostic\n${receipt}\n`,
				observationPath,
				"en",
				"per-item-v1",
			),
		).not.toThrow();
		writeFileSync(observationPath, '{"vectors":[[1]]}\n');
		expect(() =>
			verifyMultilingualTrueBatchObservationReceipt(
				receipt,
				observationPath,
				"en",
				"per-item-v1",
			),
		).toThrow("observation receipt mismatch");
	});

	it("fails closed with a clear error for a malformed child receipt", () => {
		const observationPath = join(root(), "observation.json");
		writeFileSync(observationPath, "{}\n");
		expect(() =>
			verifyMultilingualTrueBatchObservationReceipt(
				"dependency diagnostic only",
				observationPath,
				"ar",
				"padded-array-batch-v1",
			),
		).toThrow("observation receipt is invalid JSON");
	});

	it.each(["ar", "en"] as const)(
		"atomically publishes a complete language-isolated %s artifact set",
		(language) => {
			const directory = root();
			expect(
				runMultilingualTrueBatchEquivalencePilot(language, {
					root: directory,
					expected,
					observe: observation,
				}).verdict,
			).toBe("PASS");
			const published = resolve(
				directory,
				multilingualTrueBatchOutputDirectory(language),
			);
			for (const name of ["baseline.json", "candidate.json", "evidence.json"])
				expect(existsSync(join(published, name))).toBe(true);
			expect(lstatSync(published).isSymbolicLink()).toBe(false);
			expect(
				JSON.parse(readFileSync(join(published, "evidence.json"), "utf8")),
			).toMatchObject({ language, producerSourceSha256: "c".repeat(64) });
			expect(published).not.toContain("miracl-ko-");
		},
	);

	it("publishes nothing when the candidate is outside tolerance", () => {
		const directory = root();
		expect(() =>
			runMultilingualTrueBatchEquivalencePilot("ar", {
				root: directory,
				expected,
				observe: (...args) => {
					observation(...args);
					if (args[2] === "padded-array-batch-v1") {
						const value = JSON.parse(readFileSync(args[3], "utf8"));
						value.vectors[0] = [1, 0.1, 0];
						writeFileSync(args[3], `${JSON.stringify(value)}\n`);
					}
				},
			}),
		).toThrow("pilot failed");
		expect(
			existsSync(
				resolve(directory, multilingualTrueBatchOutputDirectory("ar")),
			),
		).toBe(false);
	});

	it("reports which language and mode produced malformed observation JSON", () => {
		const directory = root();
		expect(() =>
			runMultilingualTrueBatchEquivalencePilot("ar", {
				root: directory,
				expected,
				observe: (...args) => {
					observation(...args);
					if (args[2] === "padded-array-batch-v1")
						writeFileSync(args[3], "not-json\n");
				},
			}),
		).toThrow("ar/padded-array-batch-v1: observation is invalid JSON");
	});

	it("rejects a child that self-certifies a different producer source", () => {
		const directory = root();
		expect(() =>
			runMultilingualTrueBatchEquivalencePilot("en", {
				root: directory,
				expected,
				observe: (...args) =>
					observation(...args.slice(0, 4), {
						...args[4],
						producerSourceSha256: "d".repeat(64),
					}),
			}),
		).toThrow("producer identity mismatch");
	});

	it("refuses to replace an existing published language directory", () => {
		const directory = root();
		runMultilingualTrueBatchEquivalencePilot("en", {
			root: directory,
			expected,
			observe: observation,
		});
		expect(() =>
			runMultilingualTrueBatchEquivalencePilot("en", {
				root: directory,
				expected,
				observe: observation,
			}),
		).toThrow("already exists");
	});
});
