import { describe, expect, it } from "vitest";
import {
	MAX_MESSAGES_PER_REQUEST,
	parseMemoryRequest,
	parseOptionalTimestamp,
	validateMessageBatchSize,
} from "./request-validation.js";

describe("parseMemoryRequest", () => {
	it("preserves supported roles and a finite timestamp", () => {
		const messages = [
			{ role: "user" as const, content: "one" },
			{ role: "assistant" as const, content: "two" },
			{ role: "tool" as const, content: "three" },
		];
		expect(
			parseMemoryRequest({ messages, user_id: "person-1", timestamp: 42 }),
		).toEqual({ messages, userId: "person-1", timestamp: 42 });
	});

	it.each([
		{ messages: [], user_id: "person-1" },
		{ messages: [{ role: "system", content: "bad" }], user_id: "person-1" },
		{ messages: [{ role: ["user"], content: "bad" }], user_id: "person-1" },
		{ messages: [{ role: "user", content: 1 }], user_id: "person-1" },
		{
			messages: [{ role: "user", content: "bad timestamp" }],
			user_id: "person-1",
			timestamp: Number.NaN,
		},
		{
			messages: Array.from({ length: MAX_MESSAGES_PER_REQUEST + 1 }, () => ({
				role: "user",
				content: "too many",
			})),
			user_id: "person-1",
		},
	])("rejects an invalid HTTP memory payload", (body) => {
		expect(() => parseMemoryRequest(body)).toThrow();
	});
});

describe("parseOptionalTimestamp", () => {
	it("accepts an omitted or finite numeric timestamp", () => {
		expect(parseOptionalTimestamp(undefined)).toBeUndefined();
		expect(parseOptionalTimestamp(0)).toBe(0);
		expect(parseOptionalTimestamp(1_700_000_000_000)).toBe(1_700_000_000_000);
	});

	it.each([Number.NaN, Number.POSITIVE_INFINITY, "1700000000000", null])(
		"rejects malformed timestamp %s",
		(value) => {
			expect(() => parseOptionalTimestamp(value)).toThrow(
				"timestamp must be a finite number",
			);
		},
	);
});

describe("validateMessageBatchSize", () => {
	it("accepts the request limit and rejects larger batches", () => {
		expect(() =>
			validateMessageBatchSize(Array(MAX_MESSAGES_PER_REQUEST)),
		).not.toThrow();
		expect(() =>
			validateMessageBatchSize(Array(MAX_MESSAGES_PER_REQUEST + 1)),
		).toThrow(
			`messages must contain at most ${MAX_MESSAGES_PER_REQUEST} items`,
		);
	});
});
