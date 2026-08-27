import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LocalAdapter } from "../adapters/local.js";
import { MemorySystem } from "../index.js";
import type { EncodingContext, StructuredFact } from "../index.js";

const directories: string[] = [];
afterEach(async () => {
	await Promise.all(
		directories
			.splice(0)
			.map((path) => rm(path, { recursive: true, force: true })),
	);
});

describe("lifecycle batch integrity", () => {
	it("uses the batch path and preserves the target when an authorized deletion fails", async () => {
		const root = await mkdtemp(join(tmpdir(), "naia-lifecycle-batch-"));
		directories.push(root);
		const storedContent = "사용자 알레르기: 땅콩";
		const deleteContent = "땅콩 알레르기 기억은 지워줘";
		const structured: StructuredFact = {
			subject: "사용자",
			property: "알레르기",
			value: "땅콩",
			polarity: "affirmed",
			cardinality: "multi",
		};
		const adapter = new LocalAdapter(join(root, "memory.json"));
		const system = new MemorySystem({
			adapter,
			consolidationIntervalMs: 0,
			deleteVerifier: async (_episode, _fact, candidates) => ({
				authorized: true,
				targetFactId: candidates[0]?.id,
			}),
			factExtractor: async (episodes) =>
				episodes.map((episode) => ({
					content: episode.content.includes("지워줘")
						? storedContent
						: episode.content,
					entities: [],
					topics: [],
					importance: 0.8,
					sourceEpisodeIds: [episode.id],
					structured,
					operation: episode.content.includes("지워줘") ? "delete" : "upsert",
					...(episode.content.includes("지워줘")
						? {
								deleteEvidence: {
									kind: "explicit_removal_request" as const,
									evidenceQuote: episode.content,
									targetQuote: "땅콩 알레르기",
								},
							}
						: {}),
				})),
		});
		const context: EncodingContext = {};
		const timestamp = Date.now() - 10 * 60 * 1000;
		await system.encode(
			{ content: storedContent, role: "user", timestamp },
			context,
		);
		await system.consolidateNow(true);
		await system.encode(
			{ content: deleteContent, role: "user", timestamp: timestamp + 1 },
			context,
		);
		const batchFailure = new Error("injected semantic batch failure");
		const upsertMany = vi
			.spyOn(adapter.semantic, "upsertMany")
			.mockRejectedValueOnce(batchFailure);

		await expect(system.consolidateNow(true)).rejects.toBe(batchFailure);
		expect(upsertMany).toHaveBeenCalledOnce();
		expect(upsertMany.mock.calls[0]?.[0]).toHaveLength(1);
		expect((await adapter.semantic.getAll())[0]?.status).toBe("active");
		await system.close();
	});
});
