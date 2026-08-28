import type { SemanticAnalysisPlan } from "./semantic-analysis-plan.js";
import type { SemanticEngine } from "./semantic-raw-cli.js";

export const DEFAULT_SEMANTIC_ENGINES = [
	"graphiti-historical",
	"hindsight",
	"letta",
	"mem0",
	"naia",
	"plain-vector",
] as const;

export const DIAGNOSTIC_SEMANTIC_ENGINES = [
	"graphiti",
	"graphiti-historical",
	"hindsight",
	"letta",
	"mem0",
	"naia",
] as const;

export const SUPPORTED_SEMANTIC_ENGINES = [
	"graphiti",
	...DEFAULT_SEMANTIC_ENGINES,
] as const;

export function resolveSemanticCampaignMatrix(
	args: readonly string[],
	parsed: { engines: SemanticEngine[]; repetitions: number },
	analysisPlan?: Pick<SemanticAnalysisPlan, "engines">,
) {
	const enginesExplicit = args.some((arg) => arg.startsWith("--engines="));
	const repetitionsExplicit = args.some((arg) =>
		arg.startsWith("--repetitions="),
	);
	const engines = enginesExplicit
		? parsed.engines
		: ((analysisPlan?.engines as SemanticEngine[] | undefined) ??
			parsed.engines);
	const repetitions = repetitionsExplicit ? parsed.repetitions : engines.length;
	if (repetitions < engines.length || repetitions % engines.length !== 0)
		throw new Error(
			`--repetitions must be a positive multiple of the ${engines.length}-engine matrix of at least ${engines.length}`,
		);
	return { engines, repetitions };
}
