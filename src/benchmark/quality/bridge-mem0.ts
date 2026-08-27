import { randomUUID } from "node:crypto";
import type { PublicEngineBridge } from "./public-engine-runner.js";

const DATASET_ID_KEY = "publicBenchmarkMemoryId";

export type Mem0PublicEngineFactoryOptions = {
	mem0Config: Record<string, unknown>;
	/** Auditable prefix; the factory appends a fresh nonce for case isolation. */
	userIdPrefix: string;
};

export type Mem0PublicClient = {
	add(
		messages: Array<{ role: "user"; content: string }>,
		options: {
			userId: string;
			infer: false;
			metadata: Record<string, string>;
		},
	): Promise<unknown>;
	search(
		query: string,
		options: { userId: string; limit: number },
	): Promise<{ results?: Array<{ metadata?: Record<string, unknown> }> }>;
	deleteAll(options: { userId: string }): Promise<void>;
};

/** Construct the real mem0 OSS backend for one isolated public case. */
export async function createMem0PublicEngineBridge(
	options: Mem0PublicEngineFactoryOptions,
): Promise<Mem0PublicEngineBridge> {
	const { Memory } = await import("mem0ai/oss");
	if (!options.userIdPrefix.trim())
		throw new Error("mem0 benchmark user ID prefix is invalid");
	const client = new Memory(
		options.mem0Config as ConstructorParameters<typeof Memory>[0],
	);
	return new Mem0PublicEngineBridge(
		client as unknown as Mem0PublicClient,
		`${options.userIdPrefix}-${randomUUID()}`,
	);
}

/** mem0 OSS bridge using its native metadata to round-trip dataset IDs. */
export class Mem0PublicEngineBridge implements PublicEngineBridge {
	readonly identityPolicy = "dataset-id-round-trip-v1" as const;

	constructor(
		private readonly client: Mem0PublicClient,
		private readonly userId: string,
	) {
		if (!userId.trim()) throw new Error("mem0 benchmark user ID is invalid");
	}

	async addMemory(memory: Parameters<PublicEngineBridge["addMemory"]>[0]) {
		const metadata: Record<string, string> = { [DATASET_ID_KEY]: memory.id };
		if (memory.date) metadata.publicBenchmarkDate = memory.date;
		await this.client.add([{ role: "user", content: memory.content }], {
			userId: this.userId,
			infer: false,
			metadata,
		});
	}

	async searchIds(query: string, topK: number) {
		const response = await this.client.search(query, {
			userId: this.userId,
			limit: topK,
		});
		return (response.results ?? []).map((result) => {
			const id = result.metadata?.[DATASET_ID_KEY];
			if (typeof id !== "string" || !id.trim())
				throw new Error("mem0 result did not preserve the dataset memory ID");
			return id;
		});
	}

	async close() {
		await this.client.deleteAll({ userId: this.userId });
	}
}
