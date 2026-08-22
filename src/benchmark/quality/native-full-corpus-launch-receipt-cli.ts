#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { sha256Bytes } from "./native-full-corpus-evidence.js";

const pid = Number(process.env.MIRACL_FULL_PID);
const output =
	process.env.MIRACL_FULL_LAUNCH_RECEIPT ??
	"reports/quality/miracl-ko-full-corpus-launch-receipt.json";
if (!Number.isSafeInteger(pid) || pid < 1)
	throw new Error("MIRACL_FULL_PID must identify the live benchmark process");

const cmdline = readFileSync(`/proc/${pid}/cmdline`, "utf8")
	.split("\0")
	.filter(Boolean);
const environment = new Map(
	readFileSync(`/proc/${pid}/environ`, "utf8")
		.split("\0")
		.filter(Boolean)
		.map((entry) => {
			const separator = entry.indexOf("=");
			return [entry.slice(0, separator), entry.slice(separator + 1)];
		}),
);
if (
	environment.get("CUDA_VISIBLE_DEVICES") !== "" ||
	!cmdline.some((argument) =>
		argument.endsWith("native-full-corpus-evaluation-cli.ts"),
	)
)
	throw new Error("live process is not the locked CPU-only benchmark");
const evaluationSource = resolve(
	"src/benchmark/quality/native-full-corpus-evaluation-cli.ts",
);
const receipt = {
	schemaVersion: 1,
	pid,
	capturedAt: new Date().toISOString(),
	procStartTicks: readFileSync(`/proc/${pid}/stat`, "utf8").split(" ")[21],
	bootId: readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim(),
	cmdline,
	cudaVisibleDevices: environment.get("CUDA_VISIBLE_DEVICES"),
	qdrantUrl: environment.get("QDRANT_URL") ?? "http://127.0.0.1:6334",
	outputPath:
		environment.get("MIRACL_FULL_OUTPUT") ??
		"reports/quality/miracl-ko-full-corpus-vector-exact.json",
	evaluationSource,
	evaluationSourceSha256: sha256Bytes(readFileSync(evaluationSource)),
	embeddingInferenceMode:
		environment.get("MIRACL_EMBEDDING_INFERENCE_MODE") ?? "per-item-v1",
};
writeFileSync(output, `${JSON.stringify(receipt, null, 2)}\n`, {
	flag: "wx",
	mode: 0o600,
});
process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
