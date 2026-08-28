import { describe, expect, it } from "vitest";
import {
	DEFAULT_SEMANTIC_ENGINES,
	DIAGNOSTIC_SEMANTIC_ENGINES,
	resolveSemanticCampaignMatrix,
} from "./semantic-campaign-matrix.js";
import {
	parseSemanticCampaignCliArgs,
	semanticComparisonLaneDisclosure,
} from "./semantic-campaign-cli.js";

describe("semantic campaign matrix", () => {
	it("preserves signed legacy v5 comparison-lane extensions verbatim", () => {
		const comparisonLanes = {
			directLifecycle: ["hindsight", "mem0"],
			nativeTemporalCharacterization: ["graphiti-historical"],
			agentManagedCharacterization: ["letta"],
			productIntegrationDiagnostic: [],
			futureSignedLane: ["future-engine"],
		};
		const analysisPlan = {
			schemaVersion: "naia-memory-semantic-analysis-plan-v5",
			comparisonLanes,
		} as unknown as Parameters<typeof semanticComparisonLaneDisclosure>[0];
		expect(semanticComparisonLaneDisclosure(analysisPlan)).toEqual({
			comparisonLanes,
			comparisonLaneInterpretationPolicy:
				"signed-v5-extensions-preserved-uninterpreted-v1",
		});
	});

	it("requires a signed plan for plain-vector and selects six competitive lanes", () => {
		const base = ["--contract=c.json", "--output-dir=out", "--seed=frozen"];
		expect(() =>
			parseSemanticCampaignCliArgs([
				...base,
				"--engines=naia,plain-vector",
			]),
		).toThrow("require a signed v6 --analysis-plan");
		expect(parseSemanticCampaignCliArgs(base).engines).toEqual(
			DIAGNOSTIC_SEMANTIC_ENGINES,
		);
		const competitive = parseSemanticCampaignCliArgs([
			...base,
			"--analysis-plan=plan.json",
			"--analysis-plan-trust-policy=trust.json",
		]);
		expect(competitive.engines).toEqual(DEFAULT_SEMANTIC_ENGINES);
		expect(competitive.engines).not.toContain("graphiti");
	});

	it("derives a balanced omitted matrix from a legacy v5 plan", () => {
		const args = [
			"--contract=c.json",
			"--output-dir=out",
			"--seed=frozen",
			"--analysis-plan=plan.json",
			"--analysis-plan-trust-policy=trust.json",
		];
		const legacyEngines = [
			"hindsight",
			"mem0",
			"graphiti-historical",
			"letta",
			"naia",
		];
		expect(
			resolveSemanticCampaignMatrix(args, parseSemanticCampaignCliArgs(args), {
				engines: legacyEngines,
			}),
		).toEqual({ engines: legacyEngines, repetitions: 5 });
		const unbalanced = [...args, "--repetitions=6"];
		expect(() =>
			resolveSemanticCampaignMatrix(
				unbalanced,
				parseSemanticCampaignCliArgs(unbalanced),
				{ engines: legacyEngines },
			),
		).toThrow("5-engine matrix");
	});
});
