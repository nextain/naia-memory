import { randomUUID } from "node:crypto";
import type { MemoryAdapter, Reflection, Skill } from "../types.js";
import type { MemoryStore } from "./local-model.js";
import { keywordScore } from "./local-search.js";

interface LocalProceduralHost {
	getStore(): MemoryStore;
	markDirty(): void;
	save(): void;
}

export function createLocalProceduralMemory(
	host: LocalProceduralHost,
): MemoryAdapter["procedural"] {
	return {
		getSkill: async (name: string): Promise<Skill | null> =>
			host.getStore().skills.find((skill) => skill.name === name) ?? null,

		recordOutcome: async (name: string, success: boolean): Promise<void> => {
			const store = host.getStore();
			const skill = store.skills.find((candidate) => candidate.name === name);
			if (skill) {
				if (success) skill.successCount++;
				else skill.failureCount++;
				skill.confidence =
					skill.successCount / (skill.successCount + skill.failureCount);
			} else {
				store.skills.push({
					id: randomUUID(),
					name,
					description: "",
					learnedAt: Date.now(),
					successCount: success ? 1 : 0,
					failureCount: success ? 0 : 1,
					confidence: success ? 1.0 : 0.0,
				});
			}
			host.markDirty();
			host.save();
		},

		learnFromFailure: async (reflection: Reflection): Promise<void> => {
			host.getStore().reflections.push(reflection);
			host.markDirty();
			host.save();
		},

		getReflections: async (task: string, topK: number): Promise<Reflection[]> =>
			host
				.getStore()
				.reflections.map((reflection) => ({
					reflection,
					score: keywordScore(
						task,
						`${reflection.task} ${reflection.failure} ${reflection.analysis}`,
					),
				}))
				.filter((candidate) => candidate.score > 0)
				.sort((a, b) => b.score - a.score)
				.slice(0, topK)
				.map((candidate) => candidate.reflection),
	};
}
