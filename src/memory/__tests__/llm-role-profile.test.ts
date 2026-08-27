import { describe, expect, it } from "vitest";
import { resolveMemoryLlmProfile } from "../llm-role-profile.js";
describe("memory LLM role profile", () => {
	const sub = {
		provider: "codex",
		model: "gpt-5.6-terra",
		baseUrl: "https://example.test/v1",
		credentialRef: "credential:sub",
	};
	it("uses sub as the default memory worker", () => {
		expect(resolveMemoryLlmProfile({ sub })).toEqual({
			sourceRole: "sub",
			...sub,
		});
	});
	it("uses an explicit functional memory override", () => {
		expect(
			resolveMemoryLlmProfile({
				sub,
				memory: {
					provider: "claude",
					model: "haiku",
					credentialRef: "credential:memory",
				},
			}),
		).toEqual({
			sourceRole: "memory",
			provider: "claude",
			model: "haiku",
			credentialRef: "credential:memory",
		});
	});
	it("resolves memory inheritance from sub", () => {
		expect(
			resolveMemoryLlmProfile({
				sub,
				memory: { inherit: "sub", model: "smaller-model" },
			}),
		).toEqual({
			sourceRole: "memory",
			provider: "codex",
			model: "smaller-model",
			baseUrl: "https://example.test/v1",
			credentialRef: "credential:sub",
		});
	});
	it("rejects an incomplete explicit override", () => {
		expect(() =>
			resolveMemoryLlmProfile({ sub, memory: { provider: "claude" } }),
		).toThrow(/provider and model/);
	});
	it("rejects inheritance cycles", () => {
		expect(() =>
			resolveMemoryLlmProfile({ sub, memory: { inherit: "memory" } }),
		).toThrow(/cycle/);
	});
	it("does not copy unknown credential values", () => {
		const resolved = resolveMemoryLlmProfile({
			sub: { ...sub, apiKey: "must-not-leak" } as typeof sub,
		});
		expect(resolved).not.toHaveProperty("apiKey");
	});
});
