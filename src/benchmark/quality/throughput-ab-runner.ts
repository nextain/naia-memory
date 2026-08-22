import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { isAbsolute } from "node:path";
import { parseProcStartTicks } from "./native-full-corpus-runtime-observation.js";
import {
	type ExecutionObservation,
	canonicalEnvironment,
} from "./throughput-ab-evidence.js";

export interface ThroughputRunSpec {
	label: string;
	policySha256: string;
	command: string[];
	cwd: string;
	env?: Record<string, string>;
	expectedEmbeddedDocuments: number;
	expectedCachedDocuments: number;
}

export interface ThroughputChildReceipt {
	schemaVersion: 1;
	label: string;
	policySha256: string;
	failures: number;
	embeddedDocuments: number;
	cachedDocuments: number;
}

const POLL_MILLISECONDS = 100;
const MAX_OUTPUT_BYTES = 4 * 1024 * 1024;
const SECRET_ENVIRONMENT_NAME =
	/(authorization|credential|password|secret|token|api.?key)/i;
const sleep = (milliseconds: number) =>
	new Promise((resolve) => setTimeout(resolve, milliseconds));

function sha256(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}

function readPositiveKilobytes(status: string, field: string): number {
	const match = new RegExp(`^${field}:\\s+(\\d+)\\s+kB$`, "m").exec(status);
	const kilobytes = Number(match?.[1]);
	if (!Number.isSafeInteger(kilobytes) || kilobytes <= 0) return 0;
	return kilobytes * 1024;
}

function childPids(pid: number): number[] {
	try {
		return readFileSync(`/proc/${pid}/task/${pid}/children`, "utf8")
			.trim()
			.split(/\s+/)
			.filter(Boolean)
			.map(Number)
			.filter(Number.isSafeInteger);
	} catch {
		return [];
	}
}

function aggregateResidentBytes(rootPid: number): number {
	let bytes = 0;
	const pending = [rootPid];
	const seen = new Set<number>();
	while (pending.length > 0) {
		const pid = pending.pop();
		if (pid === undefined || seen.has(pid)) continue;
		seen.add(pid);
		try {
			bytes += readPositiveKilobytes(
				readFileSync(`/proc/${pid}/status`, "utf8"),
				"VmRSS",
			);
		} catch {
			continue;
		}
		pending.push(...childPids(pid));
	}
	return bytes;
}

function parseChildReceipt(
	stdout: string,
	spec: ThroughputRunSpec,
): ThroughputChildReceipt {
	let parsed: unknown;
	try {
		parsed = JSON.parse(stdout);
	} catch {
		throw new Error(
			`${spec.label}: child stdout must be exactly one JSON receipt`,
		);
	}
	const receipt = parsed as Partial<ThroughputChildReceipt>;
	if (
		receipt.schemaVersion !== 1 ||
		receipt.label !== spec.label ||
		receipt.policySha256 !== spec.policySha256 ||
		!Number.isSafeInteger(receipt.failures) ||
		(receipt.failures ?? -1) < 0 ||
		!Number.isSafeInteger(receipt.embeddedDocuments) ||
		receipt.embeddedDocuments !== spec.expectedEmbeddedDocuments ||
		!Number.isSafeInteger(receipt.cachedDocuments) ||
		receipt.cachedDocuments !== spec.expectedCachedDocuments
	)
		throw new Error(`${spec.label}: child receipt identity mismatch`);
	return receipt as ThroughputChildReceipt;
}

export async function runThroughputObservation(
	inputSpec: ThroughputRunSpec,
): Promise<
	ExecutionObservation & { embeddedDocuments: number; cachedDocuments: number }
> {
	const spec: ThroughputRunSpec = {
		...inputSpec,
		command: [...inputSpec.command],
		env: inputSpec.env ? { ...inputSpec.env } : undefined,
	};
	if (
		spec.command.length < 1 ||
		spec.command.some((argument) => argument.length < 1)
	)
		throw new Error(`${spec.label}: command argv is invalid`);
	const executable = spec.command[0];
	if (!executable) throw new Error(`${spec.label}: executable is missing`);
	if (!/^[a-f0-9]{64}$/.test(spec.policySha256))
		throw new Error(`${spec.label}: policy hash is invalid`);
	if (!isAbsolute(executable))
		throw new Error(`${spec.label}: executable must be an absolute path`);
	const environmentEntries = Object.entries(spec.env ?? {});
	if (environmentEntries.some(([name]) => SECRET_ENVIRONMENT_NAME.test(name)))
		throw new Error(
			`${spec.label}: secret-bearing environment names are forbidden`,
		);
	if (
		!Number.isSafeInteger(spec.expectedEmbeddedDocuments) ||
		spec.expectedEmbeddedDocuments < 0 ||
		!Number.isSafeInteger(spec.expectedCachedDocuments) ||
		spec.expectedCachedDocuments < 0
	)
		throw new Error(`${spec.label}: expected document counts are invalid`);
	const cwd = realpathSync(spec.cwd);
	const hostBootId = readFileSync(
		"/proc/sys/kernel/random/boot_id",
		"utf8",
	).trim();
	const startedAt = new Date();
	const monotonicStart = process.hrtime.bigint();
	const child = spawn(executable, spec.command.slice(1), {
		cwd,
		env: spec.env ?? {},
		shell: false,
		stdio: ["ignore", "pipe", "pipe"],
	});
	if (!child.pid) throw new Error(`${spec.label}: child PID was not assigned`);
	const pid = child.pid;
	let procStartTicks = "";
	let cmdline: string[] = [];
	let peakRssBytes = 0;
	let samples = 0;
	let stdout = "";
	let stderr = "";
	let overflow = false;
	const append = (current: string, chunk: Buffer) => {
		const next = current + chunk.toString("utf8");
		if (Buffer.byteLength(next) > MAX_OUTPUT_BYTES) {
			overflow = true;
			child.kill("SIGTERM");
		}
		return next.slice(0, MAX_OUTPUT_BYTES);
	};
	child.stdout.on("data", (chunk: Buffer) => {
		stdout = append(stdout, chunk);
	});
	child.stderr.on("data", (chunk: Buffer) => {
		stderr = append(stderr, chunk);
	});
	let processCompletedAt: Date | undefined;
	let monotonicEnd: bigint | undefined;
	child.once("exit", () => {
		processCompletedAt = new Date();
		monotonicEnd = process.hrtime.bigint();
	});
	const close = new Promise<{
		code: number | null;
		signal: NodeJS.Signals | null;
	}>((resolve, reject) => {
		child.once("error", reject);
		child.once("close", (code, signal) => resolve({ code, signal }));
	});
	while (child.exitCode === null && child.signalCode === null) {
		try {
			procStartTicks ||= parseProcStartTicks(
				readFileSync(`/proc/${pid}/stat`, "utf8"),
			);
			if (cmdline.length < 1) {
				cmdline = readFileSync(`/proc/${pid}/cmdline`, "utf8")
					.split("\0")
					.filter(Boolean);
			}
			peakRssBytes = Math.max(peakRssBytes, aggregateResidentBytes(pid));
			samples += 1;
		} catch {
			// The exit promise below decides whether a process that vanished succeeded.
		}
		await sleep(POLL_MILLISECONDS);
	}
	const result = await close;
	if (!processCompletedAt || monotonicEnd === undefined)
		throw new Error(`${spec.label}: child exit was not observed`);
	const completedAt = processCompletedAt;
	const milliseconds = Number(monotonicEnd - monotonicStart) / 1_000_000;
	if (overflow)
		throw new Error(
			`${spec.label}: child output exceeded ${MAX_OUTPUT_BYTES} bytes`,
		);
	if (result.code !== 0 || result.signal)
		throw new Error(
			`${spec.label}: child failed (code=${result.code}, signal=${result.signal}, stderrSha256=${sha256(stderr)})`,
		);
	if (!procStartTicks || cmdline.length < 1 || samples < 1 || peakRssBytes <= 0)
		throw new Error(`${spec.label}: child process was not observed`);
	const receipt = parseChildReceipt(stdout, spec);
	const environment = Object.fromEntries(
		Object.entries(spec.env ?? {}).sort(([left], [right]) =>
			left.localeCompare(right),
		),
	);
	return {
		label: spec.label,
		policySha256: spec.policySha256,
		hostBootId,
		cwd,
		command: [...spec.command],
		commandSha256: sha256(JSON.stringify(spec.command)),
		environment,
		environmentSha256: sha256(canonicalEnvironment(environment)),
		stdout,
		stdoutSha256: sha256(stdout),
		startedAt: startedAt.toISOString(),
		completedAt: completedAt.toISOString(),
		milliseconds,
		peakRssBytes,
		failures: receipt.failures,
		embeddedDocuments: receipt.embeddedDocuments,
		cachedDocuments: receipt.cachedDocuments,
		process: {
			pid,
			procStartTicks,
			cmdline,
			cmdlineSha256: sha256(JSON.stringify(cmdline)),
			pollMilliseconds: POLL_MILLISECONDS,
			samples,
			rssObservation: "100ms-sampled-process-tree-aggregate-vmrss-v1",
		},
	};
}
