import { randomUUID } from "node:crypto";
import { existsSync, rmSync } from "node:fs";
import {
	LocalAdapter,
	type LocalAdapterOptions,
} from "../../memory/adapters/local.js";
import type { ContradictionFilterProvider } from "../../memory/contradiction-filter.js";
import type {
	DeleteVerifier,
	FactExtractor,
} from "../../memory/memory-system-api.js";
import { NaiaMemoryProvider } from "../../memory/provider.js";
import type { Fact, MemoryAdapter } from "../../memory/types.js";
import { getUsage } from "../../memory/usage-tracker.js";
import type {
	SemanticEngineBridge,
	SemanticIngestReceipt,
	SemanticNativeMemory,
} from "./memory-semantic-runner.js";

const ISOLATED_PROJECT = "semantic-memory-evaluation";

export type NaiaSemanticFactoryOptions = LocalAdapterOptions & {
	storePath: string;
	factExtractor: FactExtractor;
	deleteVerifier: DeleteVerifier;
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
		deleteVerifier: options.deleteVerifier,
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
		const before = deleteOutcomeCounters();
		const mutationBefore = mutationOutcomeCounters();
		await this.provider.encode(
			{ content: turn.content, role: "user" },
			{ project: ISOLATED_PROJECT },
		);
		await this.provider.consolidate();
		const after = deleteOutcomeCounters();
		const mutationAfter = mutationOutcomeCounters();
		return {
			outcome: "opaque",
			deleteOutcomeDelta: {
				authorized: after.authorized - before.authorized,
				denied: after.denied - before.denied,
				verifier_failed: after.verifier_failed - before.verifier_failed,
				oversized: after.oversized - before.oversized,
			},
			mutationOutcomeDelta: Object.fromEntries(
				Object.keys(mutationAfter).map((key) => [
					key,
					mutationAfter[key as keyof typeof mutationAfter] -
						mutationBefore[key as keyof typeof mutationBefore],
				]),
			) as SemanticIngestReceipt["mutationOutcomeDelta"],
		};
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

function mutationOutcomeCounters() {
	const outcomes = getUsage().mutationOutcomes;
	return {
		untrusted_contradiction_denied:
			outcomes?.untrusted_contradiction_denied ?? 0,
		structured_conflict_denied: outcomes?.structured_conflict_denied ?? 0,
		structured_duplicate_noop: outcomes?.structured_duplicate_noop ?? 0,
		structured_duplicate_reconciled:
			outcomes?.structured_duplicate_reconciled ?? 0,
		structured_supersession_applied:
			outcomes?.structured_supersession_applied ?? 0,
		structured_fact_created: outcomes?.structured_fact_created ?? 0,
	};
}

function deleteOutcomeCounters() {
	const outcomes = getUsage().deleteOutcomes;
	return {
		authorized: outcomes?.authorized ?? 0,
		denied: outcomes?.denied ?? 0,
		verifier_failed: outcomes?.verifier_failed ?? 0,
		oversized: outcomes?.oversized ?? 0,
	};
}

function toNativeMemory(fact: Fact): SemanticNativeMemory {
	return { nativeId: fact.id, content: fact.content };
}
