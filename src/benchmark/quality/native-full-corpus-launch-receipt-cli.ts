#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { sha256Bytes } from "./native-full-corpus-evidence.js";
import {
	resolveFullCorpusLanguage,
	resolveFullCorpusLaunchReceiptOutput,
	resolveFullCorpusOutputPath,
} from "./native-full-corpus-launch-receipt.js";
import { parseProcStartTicks } from "./native-full-corpus-runtime-observation.js";
import {
	parseQdrantServiceBindingReceipt,
	qdrantServiceBindingSha256,
} from "./qdrant-service-binding.js";

const pid = Number(process.env.MIRACL_FULL_PID);
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
const language = resolveFullCorpusLanguage(environment);
const qdrantUrl = environment.get("QDRANT_URL");
if (language === "en" && !qdrantUrl)
	throw new Error("English launch requires an explicit QDRANT_URL");
if (language !== "en" && environment.get("MIRACL_QDRANT_SERVICE_RECEIPT"))
	throw new Error(
		"Qdrant service binding receipts are reserved for English launch",
	);
const output = resolveFullCorpusLaunchReceiptOutput(
	environment,
	process.env.MIRACL_FULL_LAUNCH_RECEIPT_OVERRIDE,
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
const serviceBindingPath = environment.get("MIRACL_QDRANT_SERVICE_RECEIPT");
let qdrantServiceReceiptSha256: string | null = null;
if (language === "en") {
	if (!serviceBindingPath)
		throw new Error("English launch requires a Qdrant service binding receipt");
	const binding = parseQdrantServiceBindingReceipt(
		JSON.parse(readFileSync(serviceBindingPath, "utf8")) as unknown,
	);
	if (binding.qdrantUrl !== qdrantUrl)
		throw new Error("Qdrant service binding URL does not match the benchmark");
	qdrantServiceReceiptSha256 = qdrantServiceBindingSha256(binding);
}
const receipt = {
	schemaVersion: 1,
	pid,
	capturedAt: new Date().toISOString(),
	procStartTicks: parseProcStartTicks(
		readFileSync(`/proc/${pid}/stat`, "utf8"),
	),
	bootId: readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim(),
	cmdline,
	cudaVisibleDevices: environment.get("CUDA_VISIBLE_DEVICES"),
	qdrantUrl: qdrantUrl ?? "http://127.0.0.1:6334",
	qdrantServiceReceiptSha256,
	language,
	outputPath: resolveFullCorpusOutputPath(environment),
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
