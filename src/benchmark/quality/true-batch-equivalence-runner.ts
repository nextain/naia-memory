import { spawnSync } from "node:child_process";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import {
	type EquivalenceObservation,
	analyzeTrueBatchEquivalence,
} from "./true-batch-equivalence.js";

export const EQUIVALENCE_OUTPUTS = {
	baseline: "reports/quality/miracl-ko-true-batch-equivalence-per-item.json",
	candidate: "reports/quality/miracl-ko-true-batch-equivalence-true-batch.json",
	evidence: "reports/quality/miracl-ko-true-batch-equivalence.evidence.json",
} as const;

type Mode = EquivalenceObservation["mode"];

function runObservation(
	root: string,
	mode: Mode,
	output: string,
	environment: NodeJS.ProcessEnv,
): void {
	const source = resolve(
		root,
		"src/benchmark/quality/true-batch-equivalence-observation-cli.ts",
	);
	const child = spawnSync(process.execPath, ["--import", "tsx", source], {
		cwd: root,
		env: {
			PATH: environment.PATH,
			HOME: environment.HOME,
			XDG_CACHE_HOME: environment.XDG_CACHE_HOME,
			HF_HOME: environment.HF_HOME,
			CUDA_VISIBLE_DEVICES: "",
			MIRACL_EMBEDDING_INFERENCE_MODE: mode,
			MIRACL_EQUIVALENCE_OBSERVATION: output,
			MIRACL_TRUE_BATCH_PLAN: environment.MIRACL_TRUE_BATCH_PLAN,
			MIRACL_BASELINE_EVIDENCE: environment.MIRACL_BASELINE_EVIDENCE,
			MIRACL_TRUE_BATCH_AUTHORIZATION:
				environment.MIRACL_TRUE_BATCH_AUTHORIZATION,
		},
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	});
	if (child.status !== 0)
		throw new Error(
			`${mode}: observation failed: ${child.stderr.trim() || `exit ${child.status}`}`,
		);
	let receipt: { mode?: string; output?: string };
	try {
		receipt = JSON.parse(child.stdout);
	} catch {
		throw new Error(`${mode}: observation receipt is invalid`);
	}
	if (receipt.mode !== mode || receipt.output !== output)
		throw new Error(`${mode}: observation receipt mismatch`);
}

export function runTrueBatchEquivalencePilot(
	input: {
		root?: string;
		environment?: NodeJS.ProcessEnv;
		observe?: (
			root: string,
			mode: Mode,
			output: string,
			environment: NodeJS.ProcessEnv,
		) => void;
	} = {},
) {
	const root = resolve(input.root ?? ".");
	const environment = input.environment ?? process.env;
	const observe = input.observe ?? runObservation;
	const final = Object.fromEntries(
		Object.entries(EQUIVALENCE_OUTPUTS).map(([key, path]) => [
			key,
			resolve(root, path),
		]),
	) as Record<keyof typeof EQUIVALENCE_OUTPUTS, string>;
	for (const path of Object.values(final)) {
		try {
			readFileSync(path);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
			throw error;
		}
		throw new Error(`equivalence output already exists: ${path}`);
	}
	mkdirSync(dirname(final.evidence), { recursive: true });
	const temporaryDirectory = mkdtempSync(
		join(dirname(final.evidence), ".true-batch-equivalence-"),
	);
	try {
		const temporary = {
			baseline: join(temporaryDirectory, "baseline.json"),
			candidate: join(temporaryDirectory, "candidate.json"),
			evidence: join(temporaryDirectory, "evidence.json"),
		};
		observe(root, "per-item-v1", temporary.baseline, environment);
		observe(root, "padded-array-batch-v1", temporary.candidate, environment);
		const evidence = analyzeTrueBatchEquivalence(
			JSON.parse(
				readFileSync(temporary.baseline, "utf8"),
			) as EquivalenceObservation,
			JSON.parse(
				readFileSync(temporary.candidate, "utf8"),
			) as EquivalenceObservation,
		);
		writeFileSync(
			temporary.evidence,
			`${JSON.stringify(evidence, null, 2)}\n`,
			{ flag: "wx", mode: 0o600 },
		);
		if (evidence.verdict !== "PASS")
			throw new Error("true-batch equivalence pilot failed");
		for (const key of ["baseline", "candidate", "evidence"] as const)
			renameSync(temporary[key], final[key]);
		return evidence;
	} finally {
		rmSync(temporaryDirectory, { recursive: true, force: true });
	}
}
