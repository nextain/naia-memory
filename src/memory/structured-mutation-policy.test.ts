import { describe, expect, it } from "vitest";
import { hasTrustedUserMutationSources } from "./structured-mutation-policy.js";
import type { Episode } from "./types.js";

function episode(id: string, role: Episode["role"]): Episode {
	return {
		id,
		role,
		content: id,
		summary: id,
		timestamp: 1,
		importance: { importance: 0.8, surprise: 0, emotion: 0, utility: 0 },
		encodingContext: {},
		consolidated: false,
		recallCount: 0,
		lastAccessed: 1,
		strength: 0.8,
	};
}

describe("structured mutation source trust", () => {
	it("accepts every declared source when all resolve to user episodes", () => {
		expect(
			hasTrustedUserMutationSources(
				["second", "first"],
				[episode("first", "user"), episode("second", "user")],
			),
		).toBe(true);
	});

	it("rejects mixed-role and unresolved source sets", () => {
		const episodes = [
			episode("user", "user"),
			episode("assistant", "assistant"),
		];
		expect(hasTrustedUserMutationSources(["user", "assistant"], episodes)).toBe(
			false,
		);
		expect(hasTrustedUserMutationSources(["user", "missing"], episodes)).toBe(
			false,
		);
	});
});
