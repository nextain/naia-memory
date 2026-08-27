import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LocalAdapter } from "../adapters/local.js";
import type { EmbeddingProvider } from "../embeddings.js";
import type { Episode } from "../types.js";

const QUERY = "CONNECTION_OK prior response";

class BroadNoiseEmbedder implements EmbeddingProvider {
	readonly dims = 2;
	readonly name = "broad-noise-test";
	readonly embeddingSpaceId = "broad-noise-test-v1";

	async embed(text: string): Promise<number[]> {
		if (text === QUERY) return [1, 0];
		if (text === "CONNECTION_OK") return [0.8, 0.6];
		return [1, 0];
	}

	async embedBatch(texts: string[]): Promise<number[][]> {
		return Promise.all(texts.map((text) => this.embed(text)));
	}
}

function episode(
	id: string,
	content: string,
	role: "user" | "assistant",
	utility: number,
): Episode {
	const now = Date.now();
	return {
		id,
		content,
		role,
		summary: content.slice(0, 200),
		timestamp: now,
		importance: { importance: utility, surprise: 0, emotion: 0.5, utility },
		encodingContext: { project: "ranking" },
		consolidated: false,
		recallCount: 0,
		lastAccessed: now,
		strength: utility,
	};
}

describe("LocalAdapter episodic hybrid ranking", () => {
	it("keeps a compact exact episode in top-5 despite broad high-strength assistant noise", async () => {
		const storePath = join(
			tmpdir(),
			`naia-episode-hybrid-${randomUUID()}.json`,
		);
		const adapter = new LocalAdapter({
			storePath,
			embeddingProvider: new BroadNoiseEmbedder(),
		});
		const target = episode("target", "CONNECTION_OK", "user", 0.2);
		await adapter.episode.store(target);
		await adapter.episode.store(episode("repeated-query", QUERY, "user", 1));
		for (let i = 0; i < 12; i++) {
			await adapter.episode.store(
				episode(
					`noise-${i}`,
					`SYSTEM_ECHO diagnostic prior response ${"unrelated system prompt ".repeat(300)} CONNECTION_OK`,
					"assistant",
					1,
				),
			);
		}

		const recalled = await adapter.episode.recall(QUERY, {
			project: "ranking",
			scopeMode: "strict",
			topK: 5,
		});
		expect(recalled.map((item) => item.id)).toContain(target.id);
		expect(recalled.map((item) => item.id)).not.toContain("repeated-query");
		expect(
			recalled.some((item) => item.content.startsWith("SYSTEM_ECHO:")),
		).toBe(false);
		await adapter.close();
		await rm(storePath, { force: true });
	});
});
