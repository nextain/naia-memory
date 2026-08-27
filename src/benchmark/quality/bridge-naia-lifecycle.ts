import { existsSync } from "node:fs";
import {
	LocalAdapter,
	type LocalAdapterOptions,
} from "../../memory/adapters/local.js";
import type { Fact, MemoryAdapter } from "../../memory/types.js";
import type { LifecycleOperation } from "./memory-update-contract.js";
import type {
	LifecycleEngineBridge,
	LifecycleState,
} from "./memory-update-runner.js";

export type NaiaLifecycleFactoryOptions = LocalAdapterOptions & {
	storePath: string;
};

export async function createNaiaLifecycleBridge(
	options: NaiaLifecycleFactoryOptions,
): Promise<NaiaLifecycleBridge> {
	if (!options.storePath.trim())
		throw new Error("Naia lifecycle store path is invalid");
	if (existsSync(options.storePath))
		throw new Error("Naia lifecycle store path must not already exist");
	const adapter = new LocalAdapter(options);
	return new NaiaLifecycleBridge(adapter, () => adapter.close());
}

/** Executes fixture-owned CRUD operations through Naia's real semantic store. */
export class NaiaLifecycleBridge implements LifecycleEngineBridge {
	readonly isolationPolicy = "fresh-case-state-v1" as const;
	private readonly properties = new Map<string, string>();

	constructor(
		private readonly adapter: MemoryAdapter,
		private readonly closeAdapter: () => Promise<void> = async () => {},
	) {}

	async apply(operation: LifecycleOperation): Promise<void> {
		if (operation.op === "delete") {
			await this.adapter.semantic.delete(operation.logicalId);
			this.properties.delete(operation.logicalId);
			return;
		}
		let property = operation.logicalId;
		let predecessor: Fact | undefined;
		if (operation.op === "replace") {
			const predecessorProperty = this.properties.get(
				operation.replacesLogicalId,
			);
			if (!predecessorProperty)
				throw new Error("Naia lifecycle predecessor mapping is missing");
			property = predecessorProperty;
			predecessor = (await this.adapter.semantic.getAll()).find(
				(fact) => fact.id === operation.replacesLogicalId,
			);
			if (!predecessor)
				throw new Error("Naia lifecycle predecessor fact is missing");
		}
		const timestamp = Date.parse(operation.at);
		if (predecessor) {
			await this.adapter.semantic.upsert({
				...predecessor,
				updatedAt: timestamp,
				status: "superseded",
				validTo: timestamp,
				successorId: operation.logicalId,
			});
		}
		const fact: Fact = {
			id: operation.logicalId,
			content: operation.content,
			entities: [],
			topics: [],
			createdAt: timestamp,
			updatedAt: timestamp,
			importance: 0.5,
			recallCount: 0,
			lastAccessed: timestamp,
			strength: 1,
			status: "active",
			validFrom: timestamp,
			validTo: null,
			supersedes:
				operation.op === "replace" ? operation.replacesLogicalId : null,
			sourceEpisodes: [],
			encodingContext: { project: "memory-update-lifecycle" },
			structured: {
				subject: "benchmark-case",
				subjectId: "benchmark-case",
				property,
				propertyId: property,
				value: operation.content,
				polarity: "affirmed",
				cardinality: "single",
				provenance: "caller",
			},
		};
		await this.adapter.semantic.upsert(fact);
		if (operation.op === "replace")
			this.properties.delete(operation.replacesLogicalId);
		this.properties.set(operation.logicalId, property);
	}

	async getActiveState(): Promise<LifecycleState[]> {
		const facts = await this.adapter.semantic.getAll();
		return facts
			.filter((fact) => fact.status === "active" && fact.validTo == null)
			.map((fact) => ({ logicalId: fact.id, content: fact.content }));
	}

	async close(): Promise<void> {
		await this.closeAdapter();
	}
}
