import type { PublicDatasetCase } from "./public-evidence-types.js";

export type PublicEngineBridge = {
	readonly identityPolicy: "dataset-id-round-trip-v1";
	addMemory(memory: PublicDatasetCase["memories"][number]): Promise<void>;
	searchIds(query: string, topK: number): Promise<string[]>;
	close(): Promise<void>;
};

export type PublicEngineBridgeFactory = () => Promise<PublicEngineBridge>;

/**
 * Runs one sealed case in an isolated engine state. Bridges must preserve the
 * dataset memory IDs through native metadata instead of inferring IDs from text.
 */
export async function runPublicDatasetCase(
	createBridge: PublicEngineBridgeFactory,
	benchmarkCase: PublicDatasetCase,
	topK: number,
): Promise<string[]> {
	if (!Number.isInteger(topK) || topK < 1) throw new Error("topK is invalid");
	const bridge = await createBridge();
	try {
		if (bridge.identityPolicy !== "dataset-id-round-trip-v1")
			throw new Error("engine bridge does not preserve dataset memory IDs");
		for (const memory of benchmarkCase.memories) await bridge.addMemory(memory);
		const ids = await bridge.searchIds(benchmarkCase.input, topK);
		if (
			!Array.isArray(ids) ||
			ids.some((id) => typeof id !== "string" || !id.trim())
		)
			throw new Error("engine bridge returned invalid retrieval IDs");
		return ids.slice(0, topK);
	} finally {
		await bridge.close();
	}
}
