import type { Request, Response } from "express";
import { describe, expect, it, vi } from "vitest";
import { createMemoryPostHandler } from "./memory-post-handler.js";

function responseDouble() {
	const response = {
		status: vi.fn(),
		json: vi.fn(),
	} as unknown as Response;
	vi.mocked(response.status).mockReturnValue(response);
	return response;
}

describe("POST /memories handler", () => {
	it("encodes each message with its asserted role, timestamp, and project", async () => {
		const encode = vi.fn().mockResolvedValue(undefined);
		const afterEncoded = vi.fn();
		const throttle = vi.fn().mockResolvedValue(undefined);
		const handler = createMemoryPostHandler({
			system: { encode } as never,
			throttle,
			afterEncoded,
		});
		const request = {
			body: {
				messages: [
					{ role: "user", content: "one" },
					{ role: "assistant", content: "two" },
					{ role: "tool", content: "three" },
				],
				user_id: "person-1",
				timestamp: 42,
			},
		} as Request;
		const response = responseDouble();

		await handler(request, response, vi.fn());

		expect(encode.mock.calls).toEqual([
			[
				{ content: "one", role: "user", timestamp: 42 },
				{ project: "person-1" },
			],
			[
				{ content: "two", role: "assistant", timestamp: 42 },
				{ project: "person-1" },
			],
			[
				{ content: "three", role: "tool", timestamp: 42 },
				{ project: "person-1" },
			],
		]);
		expect(throttle).toHaveBeenCalledTimes(3);
		expect(afterEncoded).toHaveBeenCalledOnce();
		expect(response.json).toHaveBeenCalledWith({ results: [] });
	});

	it("returns 400 only for malformed input and does not encode", async () => {
		const encode = vi.fn();
		const handler = createMemoryPostHandler({
			system: { encode } as never,
			throttle: vi.fn().mockResolvedValue(undefined),
			afterEncoded: vi.fn(),
		});
		const response = responseDouble();

		await handler({ body: { messages: [] } } as Request, response, vi.fn());

		expect(response.status).toHaveBeenCalledWith(400);
		expect(encode).not.toHaveBeenCalled();
	});

	it("returns a bounded 500 after a partial batch encode failure", async () => {
		const encode = vi
			.fn()
			.mockResolvedValueOnce(undefined)
			.mockRejectedValueOnce(new Error("x".repeat(250)));
		const afterEncoded = vi.fn();
		const handler = createMemoryPostHandler({
			system: { encode } as never,
			throttle: vi.fn().mockResolvedValue(undefined),
			afterEncoded,
		});
		const response = responseDouble();

		await handler(
			{
				body: {
					messages: [
						{ role: "user", content: "stored" },
						{ role: "user", content: "fails" },
					],
					user_id: "person-1",
				},
			} as Request,
			response,
			vi.fn(),
		);

		expect(encode).toHaveBeenCalledTimes(2);
		expect(afterEncoded).toHaveBeenCalledOnce();
		expect(response.status).toHaveBeenCalledWith(500);
		expect(response.json).toHaveBeenCalledWith({ error: "x".repeat(200) });
	});
});
