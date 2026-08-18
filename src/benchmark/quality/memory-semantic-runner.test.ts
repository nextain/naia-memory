import { describe, expect, it, vi } from "vitest";
import {
	type SemanticEngineBridge,
	runSemanticRawContract,
} from "./memory-semantic-runner.js";
import type { MemoryUpdateContract } from "./memory-update-contract.js";

function diagnosticContract(): MemoryUpdateContract {
	return {
		schemaVersion: "naia-memory-update-contract-v1",
		tier: "semantic-update-interpretation",
		construction: "generated-diagnostic",
		cases: [
			{
				id: "semantic-ko-1",
				familyId: "family-1",
				split: "diagnostic",
				language: "ko",
				turns: [
					{ content: "나는 서울에 살아.", at: "2026-01-01T00:00:00Z" },
					{ content: "이제 부산으로 이사했어.", at: "2026-01-02T00:00:00Z" },
				],
				query: "지금 어디에 살아?",
				expectedCurrentIds: ["current-home"],
				forbiddenStaleIds: ["stale-home"],
				expectedDeletedIds: [],
				noUpdateIds: [],
				expectedDecision: "update",
			},
		],
	};
}

describe("semantic raw runner", () => {
	it("passes only natural-language inputs to a fresh engine and captures native output", async () => {
		const ingestTurn = vi.fn(async () => ({ outcome: "opaque" as const }));
		const search = vi.fn(async () => [
			{ nativeId: "engine-2", content: "사용자는 부산에 산다." },
		]);
		const close = vi.fn(async () => undefined);
		const bridge: SemanticEngineBridge = {
			isolationPolicy: "fresh-case-state-v1",
			identityPolicy: "engine-native-memory-v1",
			ingestionPolicy: "sequential-turn-commit-v1",
			temporalInputPolicy: "engine-default-ingest-time-v1",
			retrievalSurface: "engine-native-semantic-memory-v1",
			ingestTurn,
			search,
			getNativeState: vi.fn(async () => [
				{ nativeId: "engine-2", content: "사용자는 부산에 산다." },
			]),
			close,
		};
		const factory = vi.fn(async (language: string) => {
			expect(language).toBe("ko");
			return bridge;
		});
		const [receipt] = await runSemanticRawContract(
			diagnosticContract(),
			factory,
			3,
		);
		expect(ingestTurn.mock.calls).toEqual([
			[{ content: "나는 서울에 살아." }],
			[{ content: "이제 부산으로 이사했어." }],
		]);
		expect(search).toHaveBeenCalledWith("지금 어디에 살아?", 3);
		expect(receipt?.retrieved[0]?.nativeId).toBe("engine-2");
		expect(receipt?.ingestionReceipts).toEqual([
			{ outcome: "opaque" },
			{ outcome: "opaque" },
		]);
		expect(receipt?.fixtureSha256).toMatch(/^[a-f0-9]{64}$/);
		expect(receipt?.engineInputSha256).toMatch(/^[a-f0-9]{64}$/);
		expect(receipt?.fixtureSha256).not.toBe(receipt?.engineInputSha256);
		expect(receipt?.outputSha256).toMatch(/^[a-f0-9]{64}$/);
		expect(close).toHaveBeenCalledOnce();
	});

	it("fails closed on duplicate engine-native IDs and still cleans up", async () => {
		const close = vi.fn(async () => undefined);
		const bridge: SemanticEngineBridge = {
			isolationPolicy: "fresh-case-state-v1",
			identityPolicy: "engine-native-memory-v1",
			ingestionPolicy: "sequential-turn-commit-v1",
			temporalInputPolicy: "engine-default-ingest-time-v1",
			retrievalSurface: "engine-native-semantic-memory-v1",
			ingestTurn: vi.fn(async () => ({ outcome: "opaque" as const })),
			search: vi.fn(async () => [
				{ nativeId: "same", content: "one" },
				{ nativeId: "same", content: "two" },
			]),
			getNativeState: vi.fn(async () => []),
			close,
		};
		await expect(
			runSemanticRawContract(diagnosticContract(), async () => bridge, 3),
		).rejects.toThrow("duplicate native IDs");
		expect(close).toHaveBeenCalledOnce();
	});

	it("rejects retrieval output that was not present in native state", async () => {
		const bridge: SemanticEngineBridge = {
			isolationPolicy: "fresh-case-state-v1",
			identityPolicy: "engine-native-memory-v1",
			ingestionPolicy: "sequential-turn-commit-v1",
			temporalInputPolicy: "engine-default-ingest-time-v1",
			retrievalSurface: "engine-native-semantic-memory-v1",
			ingestTurn: vi.fn(async () => ({ outcome: "opaque" as const })),
			search: vi.fn(async () => [
				{ nativeId: "fabricated", content: "사용자는 부산에 산다." },
			]),
			getNativeState: vi.fn(async () => [
				{ nativeId: "actual", content: "사용자는 부산에 산다." },
			]),
			close: vi.fn(async () => undefined),
		};
		await expect(
			runSemanticRawContract(diagnosticContract(), async () => bridge, 3),
		).rejects.toThrow("absent from native state");
	});
});
