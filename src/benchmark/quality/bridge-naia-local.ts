import { existsSync } from "node:fs";
import {
	LocalAdapter,
	type LocalAdapterOptions,
} from "../../memory/adapters/local.js";
import type { MemoryAdapter } from "../../memory/types.js";
import type { PublicEngineBridge } from "./public-engine-runner.js";

const DEFAULT_IMPORTANCE = 0.5;
const DEFAULT_STRENGTH = 1;

export type NaiaLocalPublicEngineFactoryOptions = LocalAdapterOptions & {
	/** A case-scoped path. Reusing a populated store would invalidate isolation. */
	storePath: string;
};

/** Construct the real Naia local backend for one isolated public case. */
export async function createNaiaLocalPublicEngineBridge(
	options: NaiaLocalPublicEngineFactoryOptions,
): Promise<NaiaLocalPublicEngineBridge> {
	if (!options.storePath.trim())
		throw new Error("Naia benchmark store path is invalid");
	if (existsSync(options.storePath))
		throw new Error("Naia benchmark store path must not already exist");
	const adapter = new LocalAdapter(options);
	return new NaiaLocalPublicEngineBridge(adapter, () => adapter.close());
}

/** Public benchmark bridge for Naia's semantic-memory adapter surface. */
export class NaiaLocalPublicEngineBridge implements PublicEngineBridge {
	readonly identityPolicy = "dataset-id-round-trip-v1" as const;

	constructor(
		private readonly adapter: MemoryAdapter,
		private readonly closeAdapter: () => Promise<void> = async () => {},
	) {}

	async addMemory(memory: Parameters<PublicEngineBridge["addMemory"]>[0]) {
		const timestamp = memory.date ? Date.parse(memory.date) : 0;
		if (!Number.isFinite(timestamp))
			throw new Error("dataset memory date is invalid");
		await this.adapter.semantic.upsert({
			id: memory.id,
			content: memory.content,
			entities: [],
			topics: [],
			createdAt: timestamp,
			updatedAt: timestamp,
			importance: DEFAULT_IMPORTANCE,
			recallCount: 0,
			lastAccessed: timestamp,
			strength: DEFAULT_STRENGTH,
			status: "active",
			validFrom: timestamp,
			validTo: null,
			sourceEpisodes: [],
			encodingContext: { project: "public-benchmark" },
		});
	}

	async searchIds(query: string, topK: number) {
		const facts = await this.adapter.semantic.search(query, topK, true, {
			project: "public-benchmark",
		});
		return facts.map((fact) => fact.id);
	}

	async close() {
		await this.closeAdapter();
	}
}
