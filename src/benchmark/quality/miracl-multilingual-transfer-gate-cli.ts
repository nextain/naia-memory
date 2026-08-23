import { open, readFile } from "node:fs/promises";
import { createMiraclMultilingualTransferGate } from "./miracl-multilingual-transfer-gate.js";

export async function runMiraclMultilingualTransferGateCli(args: string[]) {
	if (args.length !== 8 || args[0] !== "--output") {
		process.stderr.write(
			"Usage: pnpm benchmark:miracl-multilingual-transfer-gate --output <gate.json> <ko-evidence.json> <ko-comparison.json> <en-evidence.json> <en-comparison.json> <ar-evidence.json> <ar-comparison.json>\n",
		);
		return 2;
	}
	const inputs = [];
	for (let index = 2; index < args.length; index += 2) {
		inputs.push({
			completionEvidenceText: await readFile(args[index], "utf8"),
			comparisonText: await readFile(args[index + 1], "utf8"),
		});
	}
	const gate = createMiraclMultilingualTransferGate(inputs);
	const handle = await open(args[1], "wx");
	try {
		await handle.writeFile(`${JSON.stringify(gate, null, 2)}\n`);
	} finally {
		await handle.close();
	}
	return 0;
}

if (import.meta.url === `file://${process.argv[1]}`)
	process.exitCode = await runMiraclMultilingualTransferGateCli(
		process.argv.slice(2),
	);
