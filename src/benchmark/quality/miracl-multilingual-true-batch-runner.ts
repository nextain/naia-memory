import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import {
	OFFLINE_MODEL_REVISIONS,
	OfflineEmbeddingProvider,
} from "../../memory/embeddings.js";
import {
	MULTILINGUAL_TRUE_BATCH_INPUT_COMPOSITION,
	MULTILINGUAL_TRUE_BATCH_MODEL,
	MULTILINGUAL_TRUE_BATCH_MODEL_REVISION,
	type MultilingualEquivalenceExpectedIdentity,
	type MultilingualEquivalenceObservation,
	type MultilingualTrueBatchLanguage,
	analyzeMultilingualTrueBatchEquivalence,
} from "./miracl-multilingual-true-batch-equivalence.js";
import { fullCorpusEmbeddingExecutionPolicy } from "./native-full-corpus-policy.js";
import { buildNativeRuntimeSourceManifest } from "./native-runtime-source-manifest.js";
import type { NativeRuntimeSourceManifest } from "./native-runtime-source-manifest.js";

type Mode = MultilingualEquivalenceObservation["mode"];

interface ObservationReceipt {
	schemaVersion?: number;
	language?: string;
	mode?: string;
	output?: string;
	receiptSha256?: string;
}

function readObservation(
	path: string,
	language: MultilingualTrueBatchLanguage,
	mode: Mode,
): MultilingualEquivalenceObservation {
	try {
		return JSON.parse(
			readFileSync(path, "utf8"),
		) as MultilingualEquivalenceObservation;
	} catch {
		throw new Error(`${language}/${mode}: observation is invalid JSON`);
	}
}

export function multilingualTrueBatchOutputDirectory(
	language: MultilingualTrueBatchLanguage,
): string {
	return `reports/quality/miracl-${language}-preflight-true-batch`;
}

export function expectedMultilingualTrueBatchIdentity(
	root: string,
): MultilingualEquivalenceExpectedIdentity {
	if (
		OFFLINE_MODEL_REVISIONS["multilingual-e5-large"] !==
		MULTILINGUAL_TRUE_BATCH_MODEL_REVISION
	)
		throw new Error("multilingual true-batch model revision drifted");
	const embedder = new OfflineEmbeddingProvider(
		"multilingual-e5-large",
		"cpu",
		MULTILINGUAL_TRUE_BATCH_MODEL_REVISION,
		"per-item-v1",
	);
	const policy = fullCorpusEmbeddingExecutionPolicy(
		embedder.policyReceipt,
		MULTILINGUAL_TRUE_BATCH_INPUT_COMPOSITION,
		"per-item-v1",
	);
	const source = multilingualTrueBatchProducerSourceManifest(root);
	return {
		model: MULTILINGUAL_TRUE_BATCH_MODEL,
		modelRevision: MULTILINGUAL_TRUE_BATCH_MODEL_REVISION,
		policySha256: policy.embeddingPolicySha256,
		producerSourceSha256: source.manifestSha256,
	};
}

export function multilingualTrueBatchProducerSourceManifest(
	root: string,
): NativeRuntimeSourceManifest {
	return buildNativeRuntimeSourceManifest({
		root,
		entryPoint:
			"src/benchmark/quality/miracl-multilingual-true-batch-observation-cli.ts",
		additionalInputs: ["pnpm-lock.yaml"],
	});
}

export function multilingualTrueBatchObservationEnvironment(
	language: MultilingualTrueBatchLanguage,
	mode: Mode,
	output: string,
	expected: MultilingualEquivalenceExpectedIdentity,
	environment: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
	return {
		PATH: environment.PATH,
		HOME: environment.HOME,
		XDG_CACHE_HOME: environment.XDG_CACHE_HOME,
		HF_HOME: environment.HF_HOME,
		CUDA_VISIBLE_DEVICES: "",
		MIRACL_MULTILINGUAL_EQUIVALENCE_LANGUAGE: language,
		MIRACL_EMBEDDING_INFERENCE_MODE: mode,
		MIRACL_MULTILINGUAL_EQUIVALENCE_OBSERVATION: output,
		MIRACL_MULTILINGUAL_EQUIVALENCE_POLICY_SHA256: expected.policySha256,
		MIRACL_MULTILINGUAL_EQUIVALENCE_PRODUCER_SHA256:
			expected.producerSourceSha256,
	};
}

export function verifyMultilingualTrueBatchObservationReceipt(
	stdout: string,
	observationPath: string,
	language: MultilingualTrueBatchLanguage,
	mode: Mode,
): void {
	const lastLine = stdout.trim().split(/\r?\n/).at(-1);
	let receipt: ObservationReceipt;
	try {
		receipt = JSON.parse(lastLine ?? "") as ObservationReceipt;
	} catch {
		throw new Error(`${language}/${mode}: observation receipt is invalid JSON`);
	}
	const observationSha256 = createHash("sha256")
		.update(readFileSync(observationPath))
		.digest("hex");
	if (
		receipt.schemaVersion !== 1 ||
		receipt.language !== language ||
		receipt.mode !== mode ||
		receipt.output !== observationPath ||
		receipt.receiptSha256 !== observationSha256
	)
		throw new Error(`${language}/${mode}: observation receipt mismatch`);
}

function observe(
	root: string,
	language: MultilingualTrueBatchLanguage,
	mode: Mode,
	output: string,
	expected: MultilingualEquivalenceExpectedIdentity,
	environment: NodeJS.ProcessEnv,
): void {
	const source = resolve(
		root,
		"src/benchmark/quality/miracl-multilingual-true-batch-observation-cli.ts",
	);
	const child = spawnSync(process.execPath, ["--import", "tsx", source], {
		cwd: root,
		env: multilingualTrueBatchObservationEnvironment(
			language,
			mode,
			output,
			expected,
			environment,
		),
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	});
	if (child.status !== 0)
		throw new Error(
			`${language}/${mode}: observation failed: ${child.stderr.trim() || `exit ${child.status}`}`,
		);
	verifyMultilingualTrueBatchObservationReceipt(
		child.stdout,
		output,
		language,
		mode,
	);
}

export function runMultilingualTrueBatchEquivalencePilot(
	language: MultilingualTrueBatchLanguage,
	input: {
		root?: string;
		environment?: NodeJS.ProcessEnv;
		expected?: MultilingualEquivalenceExpectedIdentity;
		observe?: typeof observe;
	} = {},
) {
	const root = realpathSync(resolve(input.root ?? "."));
	const outputDirectory = resolve(
		root,
		multilingualTrueBatchOutputDirectory(language),
	);
	if (
		basename(outputDirectory).includes("miracl-ko-") ||
		!basename(outputDirectory).startsWith(`miracl-${language}-preflight-`)
	)
		throw new Error("multilingual preflight output path is unsafe");
	if (existsSync(outputDirectory))
		throw new Error(
			`multilingual preflight output already exists: ${outputDirectory}`,
		);
	const parent = dirname(outputDirectory);
	mkdirSync(parent, { recursive: true });
	const artifactDirectory = mkdtempSync(
		join(parent, `.miracl-${language}-preflight-true-batch-artifacts-`),
	);
	const expected =
		input.expected ?? expectedMultilingualTrueBatchIdentity(root);
	const runObservation = input.observe ?? observe;
	try {
		const baselinePath = join(artifactDirectory, "baseline.json");
		const candidatePath = join(artifactDirectory, "candidate.json");
		const evidencePath = join(artifactDirectory, "evidence.json");
		runObservation(
			root,
			language,
			"per-item-v1",
			baselinePath,
			expected,
			input.environment ?? process.env,
		);
		runObservation(
			root,
			language,
			"padded-array-batch-v1",
			candidatePath,
			expected,
			input.environment ?? process.env,
		);
		const evidence = analyzeMultilingualTrueBatchEquivalence(
			language,
			expected,
			readObservation(baselinePath, language, "per-item-v1"),
			readObservation(candidatePath, language, "padded-array-batch-v1"),
		);
		if (evidence.verdict !== "PASS")
			throw new Error("multilingual true-batch equivalence pilot failed");
		writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, {
			flag: "wx",
			mode: 0o600,
		});
		renameSync(artifactDirectory, outputDirectory);
		return evidence;
	} catch (error) {
		rmSync(artifactDirectory, { recursive: true, force: true });
		throw error;
	}
}
