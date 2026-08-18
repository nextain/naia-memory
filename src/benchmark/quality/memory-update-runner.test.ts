import { describe, expect, it, vi } from "vitest";
import type { MemoryUpdateContract } from "./memory-update-contract.js";
import {
	type LifecycleEngineBridge,
	runLifecycleContract,
} from "./memory-update-runner.js";

function contract(): MemoryUpdateContract {
	return {
		schemaVersion: "naia-memory-update-contract-v1",
		tier: "lifecycle-conformance",
		construction: "generated-diagnostic",
		cases: [
			{
				id: "replace-and-delete",
				familyId: "basic-crud",
				split: "diagnostic",
				language: "ko",
				turns: [
					{
						content: "서울에서 부산으로 이사했다.",
						at: "2026-01-01T00:00:00Z",
					},
				],
				query: "현재 거주지는?",
				expectedCurrentIds: ["residence-v2"],
				forbiddenStaleIds: ["residence-v1"],
				expectedDeletedIds: ["temporary"],
				noUpdateIds: ["favorite-color"],
				expectedDecision: "update",
				lifecycleOperations: [
					{
						op: "add",
						logicalId: "residence-v1",
						content: "서울 거주",
						at: "2026-01-01T00:00:01Z",
					},
					{
						op: "add",
						logicalId: "favorite-color",
						content: "파란색 선호",
						at: "2026-01-01T00:00:02Z",
					},
					{
						op: "add",
						logicalId: "temporary",
						content: "임시 메모",
						at: "2026-01-01T00:00:03Z",
					},
					{
						op: "replace",
						logicalId: "residence-v2",
						replacesLogicalId: "residence-v1",
						content: "부산 거주",
						at: "2026-01-01T00:00:04Z",
					},
					{ op: "delete", logicalId: "temporary", at: "2026-01-01T00:00:05Z" },
				],
			},
		],
	};
}

describe("memory update lifecycle runner", () => {
	it("records exact current, stale, deleted, and untouched state", async () => {
		const state = new Map<string, string>();
		const close = vi.fn(async () => {});
		const bridge: LifecycleEngineBridge = {
			isolationPolicy: "fresh-case-state-v1",
			async apply(operation) {
				if (operation.op === "replace")
					state.delete(operation.replacesLogicalId);
				if (operation.op === "delete") state.delete(operation.logicalId);
				else state.set(operation.logicalId, operation.content);
			},
			async getActiveState() {
				return [...state].map(([logicalId, content]) => ({
					logicalId,
					content,
				}));
			},
			close,
		};
		const receipts = await runLifecycleContract(contract(), async () => bridge);
		expect(receipts).toEqual([
			{
				caseId: "replace-and-delete",
				activeIds: ["favorite-color", "residence-v2"],
				missingExpectedIds: [],
				forbiddenVisibleIds: [],
				passed: true,
			},
		]);
		expect(close).toHaveBeenCalledOnce();
	});

	it("fails closed when a bridge does not guarantee case isolation", async () => {
		const bridge = {
			isolationPolicy: "shared",
			apply: vi.fn(),
			getActiveState: vi.fn(),
			close: vi.fn(async () => {}),
		};
		await expect(
			runLifecycleContract(contract(), async () => bridge as never),
		).rejects.toThrow("fresh case state");
		expect(bridge.close).toHaveBeenCalledOnce();
	});
});
