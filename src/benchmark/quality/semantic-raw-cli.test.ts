import { describe, expect, it } from "vitest";
import { parseSemanticRawCliArgs } from "./semantic-raw-cli.js";

describe("semantic raw CLI", () => {
	it("parses an explicit reproducible execution request", () => {
		expect(
			parseSemanticRawCliArgs([
				"--engine=naia",
				"--contract=contract.json",
				"--output=receipt.json",
				"--top-k=7",
			]),
		).toEqual({
			engine: "naia",
			contractPath: "contract.json",
			outputPath: "receipt.json",
			topK: 7,
		});
	});

	it("rejects unknown engines, malformed arguments, and invalid top-k", () => {
		expect(() =>
			parseSemanticRawCliArgs([
				"--engine=other",
				"--contract=x",
				"--output=y",
			]),
		).toThrow("--engine");
		expect(() => parseSemanticRawCliArgs(["engine=naia"])).toThrow(
			"invalid argument",
		);
		expect(() =>
			parseSemanticRawCliArgs([
				"--engine=mem0",
				"--contract=x",
				"--output=y",
				"--top-k=0",
			]),
		).toThrow("--top-k");
		expect(() =>
			parseSemanticRawCliArgs([
				"--engine=mem0",
				"--engine=naia",
				"--contract=x",
				"--output=y",
			]),
		).toThrow("duplicate argument: --engine");
		expect(() =>
			parseSemanticRawCliArgs([
				"--engine=mem0",
				"--contract=x",
				"--output=y",
				"--provider=hidden-default",
			]),
		).toThrow("unknown argument: --provider");
	});
});
