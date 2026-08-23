import { describe, expect, it, vi } from "vitest";
import type { GraphitiSemanticClient } from "./bridge-graphiti-semantic.js";
import { runGraphitiBackendSmoke } from "./graphiti-backend-smoke.js";

describe("runGraphitiBackendSmoke", () => {
	it("requires isolation, native supersession, and search/state identity", async () => {
		const groups = new Map<string, { uuid: string; fact: string }[]>();
		const client: GraphitiSemanticClient = {
			addEpisode: vi.fn(async ({ groupId, content }) => {
				if (content.includes("부산"))
					groups.set(groupId, [{ uuid: "a-new", fact: "부산에 산다" }]);
				else if (content.includes("서울"))
					groups.set(groupId, [{ uuid: "a-old", fact: "서울에 산다" }]);
				else
					groups.set(groupId, [
						{ uuid: "b-only", fact: "제주에서 농장을 운영한다" },
					]);
			}),
			hasEpisode: vi.fn(async () => true),
			listCurrentFacts: vi.fn(async (groupId) => [
				...(groups.get(groupId) ?? []),
			]),
			searchCurrentFacts: vi.fn(async ({ groupIds }) => [
				...(groups.get(groupIds[0]) ?? []),
			]),
			deleteGroup: vi.fn(async (groupId) => void groups.delete(groupId)),
		};

		const result = await runGraphitiBackendSmoke(client, { pollIntervalMs: 0 });
		expect(result.passed).toBe(true);
		expect(result.checks).toEqual({
			episodeCommit: true,
			namespaceIsolation: true,
			supersessionObserved: true,
			searchStateIdentity: true,
		});
		expect(client.deleteGroup).toHaveBeenCalledTimes(2);
		expect(result.counts.committedEpisodes).toBe(3);
	});

	it("audits unprojected search output instead of accepting projected identity", async () => {
		let current = [{ uuid: "old", fact: "서울" }];
		const client: GraphitiSemanticClient & {
			searchFactsRaw: GraphitiSemanticClient["searchCurrentFacts"];
		} = {
			addEpisode: vi.fn(async ({ content }) => {
				if (content.includes("부산")) current = [{ uuid: "new", fact: "부산" }];
			}),
			hasEpisode: vi.fn(async () => true),
			listCurrentFacts: vi.fn(async () => [...current]),
			searchCurrentFacts: vi.fn(async () => [...current]),
			searchFactsRaw: vi.fn(async () => [
				...current,
				{ uuid: "old", fact: "서울" },
			]),
			deleteGroup: vi.fn(async () => undefined),
		};
		const result = await runGraphitiBackendSmoke(client, { pollIntervalMs: 0 });
		expect(result.passed).toBe(false);
		expect(result.counts.staleRawSearchResults).toBe(1);
	});

	it("fails closed when search returns an expired edge", async () => {
		let current = [{ uuid: "old", fact: "서울" }];
		const client: GraphitiSemanticClient = {
			addEpisode: vi.fn(async ({ content }) => {
				if (content.includes("부산")) current = [{ uuid: "new", fact: "부산" }];
			}),
			hasEpisode: vi.fn(async () => true),
			listCurrentFacts: vi.fn(async () => [...current]),
			searchCurrentFacts: vi.fn(async () => [{ uuid: "old", fact: "서울" }]),
			deleteGroup: vi.fn(async () => undefined),
		};
		const result = await runGraphitiBackendSmoke(client, { pollIntervalMs: 0 });
		expect(result.passed).toBe(false);
		expect(result.checks.searchStateIdentity).toBe(false);
	});

	it("fails closed when an isolated group cannot be deleted", async () => {
		let current = [{ uuid: "old", fact: "서울" }];
		const client: GraphitiSemanticClient = {
			addEpisode: vi.fn(async ({ content }) => {
				if (content.includes("부산")) current = [{ uuid: "new", fact: "부산" }];
			}),
			hasEpisode: vi.fn(async () => true),
			listCurrentFacts: vi.fn(async () => [...current]),
			searchCurrentFacts: vi.fn(async () => [...current]),
			deleteGroup: vi.fn(async () => {
				throw new Error("backend unavailable");
			}),
		};

		await expect(
			runGraphitiBackendSmoke(client, { pollIntervalMs: 0 }),
		).rejects.toThrow(/cleanup failed/);
	});
});
