import { describe, expect, it } from "vitest";
import {
	exactBinomialUpperTail,
	holmRejectedCount,
} from "./semantic-sign-test.js";

describe("semantic sign-test primitives", () => {
	it("computes known exact upper tails and Holm step-down counts", () => {
		expect(exactBinomialUpperTail(0, 0)).toBe(1);
		expect(exactBinomialUpperTail(6, 10)).toBe(0.376953125);
		expect(exactBinomialUpperTail(6, 6)).toBe(1 / 64);
		expect(holmRejectedCount([0.016, 0.024, 0.2], 0.05)).toBe(2);
		expect(holmRejectedCount([], 0.05)).toBe(0);
	});

	it("fails closed on invalid counts, p-values, alpha, and numerical range", () => {
		expect(() => exactBinomialUpperTail(2, 1)).toThrow("counts are invalid");
		expect(() => exactBinomialUpperTail(-1, 1)).toThrow("counts are invalid");
		expect(() => exactBinomialUpperTail(1, 1024)).toThrow("numerical range");
		expect(() => holmRejectedCount([Number.NaN], 0.05)).toThrow(
			"Holm inputs are invalid",
		);
		expect(() => holmRejectedCount([0.01], 1)).toThrow(
			"Holm inputs are invalid",
		);
	});
});
