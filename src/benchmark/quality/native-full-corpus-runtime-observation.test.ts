import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	observeLiveProcess,
	parseProcStartTicks,
	parseVmHwmBytes,
} from "./native-full-corpus-runtime-observation.js";

describe("full-corpus runtime observation", () => {
	it("parses start ticks despite spaces in the process command", () => {
		const prefix = "42 (node worker) S";
		const fields = Array.from({ length: 18 }, (_, index) => String(index + 4));
		expect(
			parseProcStartTicks(`${prefix} ${fields.join(" ")} 987654 0 0`),
		).toBe("987654");
	});

	it("parses VmHWM as bytes and rejects missing evidence", () => {
		expect(parseVmHwmBytes("Name:\tnode\nVmHWM:\t2048 kB\n")).toBe(
			2 * 1024 * 1024,
		);
		expect(() => parseVmHwmBytes("Name:\tnode\n")).toThrow("missing");
	});

	it("binds boot, start ticks, and exact command line", () => {
		const root = mkdtempSync(join(tmpdir(), "naia-proc-"));
		mkdirSync(join(root, "sys/kernel/random"), { recursive: true });
		mkdirSync(join(root, "42"));
		writeFileSync(join(root, "sys/kernel/random/boot_id"), "boot-a\n");
		writeFileSync(
			join(root, "42/stat"),
			`42 (node worker) S ${Array.from({ length: 18 }, (_, i) => i + 4).join(" ")} 987654 0`,
		);
		writeFileSync(join(root, "42/cmdline"), "node\0worker.ts\0");
		writeFileSync(join(root, "42/status"), "VmHWM:\t4096 kB\n");
		const launch = {
			pid: 42,
			procStartTicks: "987654",
			bootId: "boot-a",
			cmdline: ["node", "worker.ts"],
			outputPath: "result.json",
		};
		expect(observeLiveProcess(launch, root).peakRssBytes).toBe(4 * 1024 * 1024);
		expect(() =>
			observeLiveProcess({ ...launch, procStartTicks: "1" }, root),
		).toThrow("identity");
	});
});
