import { describe, expect, it, vi } from "vitest";
import {
	GraphitiSemanticBridge,
	type GraphitiSemanticClient,
	createGraphitiSemanticBridge,
} from "./bridge-graphiti-semantic.js";

function client(
	overrides: Partial<GraphitiSemanticClient> = {},
): GraphitiSemanticClient {
	return {
		addEpisode: vi.fn(async () => undefined),
		hasEpisode: vi.fn(async () => true),
		searchFacts: vi.fn(async () => []),
		listCurrentFacts: vi.fn(async () => []),
		deleteGroup: vi.fn(async () => undefined),
		...overrides,
	};
}

describe("GraphitiSemanticBridge", () => {
	it("creates a fresh native namespace for every benchmark case", async () => {
		const deleteGroup = vi.fn(async () => undefined);
		const graphiti = client({ deleteGroup });
		const first = await createGraphitiSemanticBridge(graphiti, "heldout");
		const second = await createGraphitiSemanticBridge(graphiti, "heldout");

		await first.close();
		await second.close();
		const deleted = deleteGroup.mock.calls.map(([groupId]) => groupId);
		expect(deleted).toHaveLength(2);
		expect(deleted[0]).toMatch(/^heldout-/);
		expect(deleted[1]).toMatch(/^heldout-/);
		expect(deleted[0]).not.toBe(deleted[1]);
	});

	it("waits for each queued episode before allowing the next turn", async () => {
		const events: string[] = [];
		let checks = 0;
		const graphiti = client({
			addEpisode: vi.fn(async ({ content }) => events.push(`add:${content}`)),
			hasEpisode: vi.fn(async () => {
				events.push("check");
				checks += 1;
				return checks === 2;
			}),
		});
		const bridge = new GraphitiSemanticBridge(graphiti, "case-ko", {
			pollIntervalMs: 0,
			wait: async () => events.push("wait"),
		});

		await expect(
			bridge.ingestTurn({ content: "부산으로 이사했어요" }),
		).resolves.toEqual({
			outcome: "opaque",
		});
		expect(events).toEqual([
			"add:부산으로 이사했어요",
			"check",
			"wait",
			"check",
		]);
	});

	it("uses native fact identity for both retrieval and complete current state", async () => {
		const searchFacts = vi.fn(async () => [
			{ uuid: "edge-new", fact: "사용자는 부산에 산다" },
		]);
		const listCurrentFacts = vi.fn(async () => [
			{ uuid: "edge-new", fact: "사용자는 부산에 산다" },
			{ uuid: "edge-food", fact: "사용자는 비빔밥을 좋아한다" },
		]);
		const bridge = new GraphitiSemanticBridge(
			client({ searchFacts, listCurrentFacts }),
			"case-ko",
		);

		await expect(bridge.search("어디에 살아요?", 1)).resolves.toEqual([
			{ nativeId: "edge-new", content: "사용자는 부산에 산다" },
		]);
		await expect(bridge.getNativeState()).resolves.toHaveLength(2);
		expect(searchFacts).toHaveBeenCalledWith({
			query: "어디에 살아요?",
			groupIds: ["case-ko"],
			maxFacts: 1,
		});
		expect(listCurrentFacts).toHaveBeenCalledWith("case-ko");
	});

	it("deletes only the isolated group", async () => {
		const deleteGroup = vi.fn(async () => undefined);
		const bridge = new GraphitiSemanticBridge(
			client({ deleteGroup }),
			"case-ko",
		);
		await bridge.close();
		expect(deleteGroup).toHaveBeenCalledWith("case-ko");
	});
});
