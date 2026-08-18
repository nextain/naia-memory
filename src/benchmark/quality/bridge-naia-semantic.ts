import { randomUUID } from "node:crypto";
import { existsSync, rmSync } from "node:fs";
import {
	LocalAdapter,
	type LocalAdapterOptions,
} from "../../memory/adapters/local.js";
import type { ContradictionFilterProvider } from "../../memory/contradiction-filter.js";
import type { FactExtractor } from "../../memory/memory-system-api.js";
import { NaiaMemoryProvider } from "../../memory/provider.js";
import type { Fact, MemoryAdapter } from "../../memory/types.js";
import type {
	SemanticEngineBridge,
	SemanticIngestReceipt,
	SemanticNativeMemory,
} from "./memory-semantic-runner.js";

const ISOLATED_PROJECT = "semantic-memory-evaluation";

export type NaiaSemanticFactoryOptions = LocalAdapterOptions & {
	storePath: string;
	factExtractor: FactExtractor;
	contradictionFilter: ContradictionFilterProvider;
};

export type NaiaSemanticProvider = {
	encode(
		input: { content: string; role: "user" },
		options: { project: string },
	): Promise<void>;
	consolidate(): Promise<unknown>;
	close(): Promise<void>;
};

export async function createNaiaSemanticBridge(
	options: NaiaSemanticFactoryOptions,
): Promise<NaiaSemanticBridge> {
	if (!options.storePath.trim())
		throw new Error("Naia semantic store path is invalid");
	const isolatedStorePath = `${options.storePath}-${randomUUID()}`;
	if (existsSync(isolatedStorePath))
		throw new Error("Naia semantic isolated store path already exists");
	const adapter = new LocalAdapter({
		...options,
		storePath: isolatedStorePath,
	});
	const provider = new NaiaMemoryProvider({
		adapter,
		factExtractor: options.factExtractor,
		contradictionFilter: options.contradictionFilter,
	});
	return new NaiaSemanticBridge(provider, adapter, isolatedStorePath);
}

/** Runs Naia's encode/consolidate path and exposes only its semantic facts. */
export class NaiaSemanticBridge implements SemanticEngineBridge {
	readonly isolationPolicy = "fresh-case-state-v1" as const;
	readonly identityPolicy = "engine-native-memory-v1" as const;
	readonly ingestionPolicy = "sequential-turn-commit-v1" as const;
	readonly temporalInputPolicy = "engine-default-ingest-time-v1" as const;
	readonly retrievalSurface = "engine-native-semantic-memory-v1" as const;

	constructor(
		private readonly provider: NaiaSemanticProvider,
		private readonly adapter: MemoryAdapter,
		private readonly ownedStorePath?: string,
	) {}

	async ingestTurn(turn: { content: string }): Promise<SemanticIngestReceipt> {
		await this.provider.encode(
			{ content: turn.content, role: "user" },
			{ project: ISOLATED_PROJECT },
		);
		await this.provider.consolidate();
		return { outcome: "opaque" };
	}

	async search(query: string, topK: number): Promise<SemanticNativeMemory[]> {
		const facts = await this.adapter.semantic.search(query, topK, false, {
			project: ISOLATED_PROJECT,
			scopeMode: "strict",
		});
		return facts.map(toNativeMemory);
	}

	async getNativeState(): Promise<SemanticNativeMemory[]> {
		const facts = await this.adapter.semantic.getAll();
		return facts
			.filter((fact) => fact.encodingContext?.project === ISOLATED_PROJECT)
			.map(toNativeMemory);
	}

	async close(): Promise<void> {
		try {
			await this.provider.close();
		} finally {
			if (this.ownedStorePath) {
				rmSync(this.ownedStorePath, { force: true });
				rmSync(`${this.ownedStorePath}.tmp`, { force: true });
			}
		}
	}
}

function toNativeMemory(fact: Fact): SemanticNativeMemory {
	return { nativeId: fact.id, content: fact.content };
}
