import { describe, expect, it, vi } from "vitest";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Fact, MemoryAdapter } from "../../memory/types.js";
import {
	NaiaSemanticBridge,
	type NaiaSemanticProvider,
} from "./bridge-naia-semantic.js";

function activeFact(overrides: Partial<Fact> = {}): Fact {
	return {
		id: "naia-2",
		content: "사용자는 부산에 산다.",
		entities: [],
		topics: [],
		createdAt: 1,
		updatedAt: 1,
		importance: 0.5,
		recallCount: 0,
		lastAccessed: 1,
		strength: 1,
		status: "active",
		validTo: null,
		sourceEpisodes: [],
		encodingContext: { project: "semantic-memory-evaluation" },
		...overrides,
	};
}

function mocks(facts: Fact[]) {
	const provider: NaiaSemanticProvider = {
		encode: vi.fn(async () => undefined),
		consolidate: vi.fn(async () => undefined),
		close: vi.fn(async () => undefined),
	};
	const adapter = {
		semantic: {
			search: vi.fn(async () => facts),
			getAll: vi.fn(async () => facts),
		},
	} as unknown as MemoryAdapter;
	return { provider, adapter };
}

describe("Naia semantic bridge", () => {
	it("commits each natural-language turn through production encode and consolidation", async () => {
		const { provider, adapter } = mocks([activeFact()]);
		const bridge = new NaiaSemanticBridge(provider, adapter);
		await bridge.ingestTurn({
			content: "이제 부산으로 이사했어.",
		});
		expect(provider.encode).toHaveBeenCalledWith(
			{
				content: "이제 부산으로 이사했어.",
				role: "user",
			},
			{ project: "semantic-memory-evaluation" },
		);
		expect(provider.consolidate).toHaveBeenCalledOnce();
	});

	it("preserves inactive native facts so stale retrieval remains measurable", async () => {
		const facts = [
			activeFact(),
			activeFact({ id: "old", status: "superseded", validTo: 2 }),
			activeFact({
				id: "other-project",
				encodingContext: { project: "unrelated" },
			}),
		];
		const { provider, adapter } = mocks(facts);
		const bridge = new NaiaSemanticBridge(provider, adapter);
		expect(await bridge.getNativeState()).toEqual([
			{ nativeId: "naia-2", content: "사용자는 부산에 산다." },
			{ nativeId: "old", content: "사용자는 부산에 산다." },
		]);
		await bridge.search("어디 살아?", 3);
		expect(adapter.semantic.search).toHaveBeenCalledWith(
			"어디 살아?",
			3,
			false,
			{ project: "semantic-memory-evaluation", scopeMode: "strict" },
		);
	});

	it("removes only the isolated store file it owns", async () => {
		const { provider, adapter } = mocks([]);
		const ownedStorePath = join(
			tmpdir(),
			`naia-semantic-bridge-${process.pid}-${Date.now()}.json`,
		);
		writeFileSync(ownedStorePath, "{}");
		const bridge = new NaiaSemanticBridge(provider, adapter, ownedStorePath);

		await bridge.close();

		expect(provider.close).toHaveBeenCalledOnce();
		expect(existsSync(ownedStorePath)).toBe(false);
	});
});
