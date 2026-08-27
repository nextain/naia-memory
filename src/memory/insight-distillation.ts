import crypto from "node:crypto";
import type { Fact, MemoryAdapter } from "./types.js";

type HubMap = Record<string, { frequency?: number }>;
type InsightAdapter = MemoryAdapter & {
	getHubs?: () => Promise<HubMap>;
	getStore?: () => { knowledgeGraph?: { nodes?: HubMap } };
};

/** Distill highly connected active facts into durable semantic insights. */
export async function distillInsights(
	adapter: MemoryAdapter,
	now: number,
): Promise<number> {
	let insightsCreated = 0;
	try {
		const allFacts = await adapter.semantic.getAll();
		const activeFacts = allFacts.filter(
			(f) =>
				f.status === "active" &&
				!(f.topics?.includes("system:insight") ?? false),
		);

		const insightAdapter = adapter as InsightAdapter;
		const hubs = insightAdapter.getHubs
			? await insightAdapter.getHubs()
			: (insightAdapter.getStore?.().knowledgeGraph?.nodes ?? {});
		const hubNames = Object.keys(hubs).sort(
			(a, b) => (hubs[b].frequency ?? 0) - (hubs[a].frequency ?? 0),
		);

		for (const hubName of hubNames.slice(0, 10)) {
			const related = activeFacts.filter((f) =>
				f.entities.some((e) => e.toLowerCase() === hubName.toLowerCase()),
			);
			if (related.length < 3) continue;

			const themes = [...new Set(related.flatMap((f) => f.topics ?? []))].join(
				", ",
			);
			const distilledContent = `Consolidated Insight on '${hubName}': Observed consistent patterns regarding ${themes}. Key observations include: ${related.map((f) => f.content).join("; ")}`;
			const hashHex = crypto
				.createHash("sha256")
				.update(
					`insight:${hubName}${related
						.map((f) => f.id)
						.sort()
						.join(",")}`,
				)
				.digest("hex")
				.slice(0, 32);
			const deterministicId = `insight-${hashHex.slice(0, 8)}-${hashHex.slice(8, 12)}-${hashHex.slice(12, 16)}-${hashHex.slice(16, 20)}-${hashHex.slice(20, 32)}`;
			const insightFact: Fact = {
				id: deterministicId,
				content: distilledContent,
				entities: [hubName],
				topics: [
					"system:insight",
					...new Set(related.flatMap((f) => f.topics ?? [])),
				],
				createdAt: now,
				updatedAt: now,
				importance: 0.95,
				maxEmotion: Math.max(...related.map((f) => f.maxEmotion ?? 0), 0.5),
				recallCount: 0,
				lastAccessed: now,
				strength: 1,
				status: "active",
				sourceEpisodes: [...new Set(related.flatMap((f) => f.sourceEpisodes))],
				encodingContext: { category: "insight" },
			};

			await adapter.semantic.upsert(insightFact);
			insightsCreated++;
			for (const fact of related) {
				fact.status = "archived";
				fact.strength *= 0.5;
				await adapter.semantic.upsert(fact);
			}
		}
	} catch (error: unknown) {
		const message = error instanceof Error ? error.message : String(error);
		console.warn(`[MemorySystem] insight distillation failed: ${message}`);
	}
	return insightsCreated;
}
