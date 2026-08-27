#!/usr/bin/env node
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { sha256Bytes } from "./native-full-corpus-evidence.js";
import {
	resolveFullCorpusRuntimeMonitorPaths,
	verifyFullCorpusRuntimeMonitorLanguage,
} from "./native-full-corpus-runtime-monitor-config.js";
import {
	type FullCorpusLaunchIdentity,
	observeLiveProcess,
} from "./native-full-corpus-runtime-observation.js";

const { language, launchPath, outputPath } =
	resolveFullCorpusRuntimeMonitorPaths();
const pollMilliseconds = 5_000;

const sleep = (milliseconds: number) =>
	new Promise((resolve) => setTimeout(resolve, milliseconds));

async function main() {
	if (existsSync(outputPath))
		throw new Error("runtime observation already exists");
	const launchBytes = readFileSync(launchPath);
	const launch = JSON.parse(
		launchBytes.toString("utf8"),
	) as FullCorpusLaunchIdentity & { language?: unknown };
	verifyFullCorpusRuntimeMonitorLanguage(language, launch);
	if (existsSync(launch.outputPath))
		throw new Error(
			"declared benchmark output already exists before monitoring",
		);
	const startedAt = new Date().toISOString();
	let samples = 0;
	let peakRssBytes = 0;
	let identity: ReturnType<typeof observeLiveProcess> | undefined;
	while (existsSync(`/proc/${launch.pid}`)) {
		const observation = observeLiveProcess(launch);
		identity ??= observation;
		peakRssBytes = Math.max(peakRssBytes, observation.peakRssBytes);
		samples += 1;
		await sleep(pollMilliseconds);
	}
	if (!identity || samples < 1)
		throw new Error("benchmark process was not observed while live");
	for (
		let retries = 0;
		!existsSync(launch.outputPath) && retries < 12;
		retries += 1
	)
		await sleep(pollMilliseconds);
	if (!existsSync(launch.outputPath))
		throw new Error("benchmark exited without its declared output");
	const receipt = {
		schemaVersion: 1,
		monitor: {
			source: resolve(
				"src/benchmark/quality/native-full-corpus-runtime-monitor-cli.ts",
			),
			sourceSha256: sha256Bytes(
				readFileSync(
					resolve(
						"src/benchmark/quality/native-full-corpus-runtime-monitor-cli.ts",
					),
				),
			),
		},
		launchReceipt: { path: launchPath, sha256: sha256Bytes(launchBytes) },
		process: {
			pid: launch.pid,
			bootId: identity.bootId,
			procStartTicks: identity.procStartTicks,
			cmdlineSha256: identity.cmdlineSha256,
		},
		observation: {
			startedAt,
			completedAt: new Date().toISOString(),
			pollMilliseconds,
			samples,
			peakRssBytes,
		},
		result: {
			path: launch.outputPath,
			sha256: sha256Bytes(readFileSync(launch.outputPath)),
		},
	};
	const temporary = `${outputPath}.${process.pid}.tmp`;
	writeFileSync(temporary, `${JSON.stringify(receipt, null, 2)}\n`, {
		flag: "wx",
		mode: 0o600,
	});
	renameSync(temporary, outputPath);
	process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
}

await main();
