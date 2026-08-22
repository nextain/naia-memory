import { readFileSync } from "node:fs";
import { sha256Bytes } from "./native-full-corpus-evidence.js";

export interface FullCorpusLaunchIdentity {
	pid: number;
	procStartTicks: string;
	bootId: string;
	cmdline: string[];
	outputPath: string;
}

export function parseProcStartTicks(stat: string): string {
	const commandEnd = stat.lastIndexOf(")");
	if (commandEnd < 0) throw new Error("invalid proc stat command");
	const fields = stat
		.slice(commandEnd + 1)
		.trim()
		.split(/\s+/);
	const startTicks = fields[19];
	if (!startTicks || !/^\d+$/.test(startTicks))
		throw new Error("invalid proc stat start ticks");
	return startTicks;
}

export function parseVmHwmBytes(status: string): number {
	const match = /^VmHWM:\s+(\d+)\s+kB$/m.exec(status);
	if (!match?.[1]) throw new Error("VmHWM is missing from proc status");
	const bytes = Number(match[1]) * 1024;
	if (!Number.isSafeInteger(bytes) || bytes <= 0)
		throw new Error("VmHWM is outside the safe positive range");
	return bytes;
}

export function observeLiveProcess(
	launch: FullCorpusLaunchIdentity,
	procRoot = "/proc",
) {
	const bootId = readFileSync(
		`${procRoot}/sys/kernel/random/boot_id`,
		"utf8",
	).trim();
	const processRoot = `${procRoot}/${launch.pid}`;
	const procStartTicks = parseProcStartTicks(
		readFileSync(`${processRoot}/stat`, "utf8"),
	);
	const cmdline = readFileSync(`${processRoot}/cmdline`, "utf8")
		.split("\0")
		.filter(Boolean);
	if (
		bootId !== launch.bootId ||
		procStartTicks !== launch.procStartTicks ||
		JSON.stringify(cmdline) !== JSON.stringify(launch.cmdline)
	)
		throw new Error("live process identity does not match launch receipt");
	return {
		bootId,
		procStartTicks,
		cmdlineSha256: sha256Bytes(cmdline.join("\0")),
		peakRssBytes: parseVmHwmBytes(
			readFileSync(`${processRoot}/status`, "utf8"),
		),
	};
}
