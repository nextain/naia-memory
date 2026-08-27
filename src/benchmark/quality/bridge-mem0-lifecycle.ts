import { randomUUID } from "node:crypto";
import type {
	LifecycleEngineBridge,
	MemoryUpdateActiveItem,
} from "./memory-update-runner.js";
import type { LifecycleOperation } from "./memory-update-contract.js";

export type Mem0LifecycleFactoryOptions = {
	mem0Config: Record<string, unknown>;
	userIdPrefix: string;
};

export type Mem0LifecycleClient = {
	add(
		messages: Array<{ role: "user"; content: string }>,
		options: {
			userId: string;
			infer: false;
			metadata: Record<string, string>;
		},
	): Promise<{ results?: Array<{ id?: string }> }>;
	update(memoryId: string, data: string): Promise<unknown>;
	delete(memoryId: string): Promise<unknown>;
	getAll(options: { userId: string }): Promise<{
		results?: Array<{ id: string; memory: string }>;
	}>;
	deleteAll(options: { userId: string }): Promise<unknown>;
};

export async function createMem0LifecycleBridge(
	options: Mem0LifecycleFactoryOptions,
): Promise<Mem0LifecycleBridge> {
	if (!options.userIdPrefix.trim())
		throw new Error("mem0 benchmark user ID prefix is invalid");
	const { Memory } = await import("mem0ai/oss");
	const client = new Memory(
		options.mem0Config as ConstructorParameters<typeof Memory>[0],
	);
	return new Mem0LifecycleBridge(
		client as unknown as Mem0LifecycleClient,
		`${options.userIdPrefix}-${randomUUID()}`,
	);
}

/** CRUD lifecycle adapter. It does not exercise mem0's inferred update decisions. */
export class Mem0LifecycleBridge implements LifecycleEngineBridge {
	readonly isolationPolicy = "fresh-case-state-v1" as const;
	private readonly nativeIdByLogicalId = new Map<string, string>();
	private readonly logicalIdByNativeId = new Map<string, string>();

	constructor(
		private readonly client: Mem0LifecycleClient,
		private readonly userId: string,
	) {
		if (!userId.trim()) throw new Error("mem0 benchmark user ID is invalid");
	}

	async apply(operation: LifecycleOperation): Promise<void> {
		if (operation.op === "add") {
			this.assertLogicalIdAvailable(operation.logicalId);
			const response = await this.client.add(
				[{ role: "user", content: operation.content }],
				{
					userId: this.userId,
					infer: false,
					metadata: { benchmarkLogicalId: operation.logicalId },
				},
			);
			const ids = (response.results ?? [])
				.map((result) => result.id)
				.filter((id): id is string => typeof id === "string" && id.length > 0);
			if (ids.length !== 1)
				throw new Error("mem0 add did not return exactly one native memory ID");
			this.bind(operation.logicalId, ids[0]);
			return;
		}

		const nativeId = this.nativeIdByLogicalId.get(
			operation.op === "replace"
				? operation.replacesLogicalId
				: operation.logicalId,
		);
		if (!nativeId) throw new Error("mem0 lifecycle predecessor is not active");

		if (operation.op === "replace") {
			this.assertLogicalIdAvailable(operation.logicalId);
			await this.client.update(nativeId, operation.content);
			this.nativeIdByLogicalId.delete(operation.replacesLogicalId);
			this.bind(operation.logicalId, nativeId);
			return;
		}

		await this.client.delete(nativeId);
		this.nativeIdByLogicalId.delete(operation.logicalId);
		this.logicalIdByNativeId.delete(nativeId);
	}

	async getActiveState(): Promise<MemoryUpdateActiveItem[]> {
		const response = await this.client.getAll({ userId: this.userId });
		return (response.results ?? []).map((item) => {
			const logicalId = this.logicalIdByNativeId.get(item.id);
			if (!logicalId)
				throw new Error("mem0 returned an untracked native memory ID");
			return { logicalId, content: item.memory };
		});
	}

	async close(): Promise<void> {
		await this.client.deleteAll({ userId: this.userId });
	}

	private bind(logicalId: string, nativeId: string) {
		this.assertLogicalIdAvailable(logicalId);
		this.nativeIdByLogicalId.set(logicalId, nativeId);
		this.logicalIdByNativeId.set(nativeId, logicalId);
	}

	private assertLogicalIdAvailable(logicalId: string) {
		if (this.nativeIdByLogicalId.has(logicalId))
			throw new Error("mem0 logical memory ID is already active");
	}
}
