/**
 * ContradictionFilterProvider — dual-process contradiction detection.
 *
 * Implements retrieval-rerank: a broad candidate set (entity / cosine match)
 * is narrowed down to actual contradictions by a small reasoning model.
 * Mirrors human ACC (conflict detection) → PFC (resolution) division of
 * labour, in line with naia-memory's brain-inspired architecture
 * (`types.ts` Tulving + CLS, importance.ts CraniMem, decay.ts Ebbinghaus).
 *
 * Implementations:
 * - HeuristicFilter        — keyword / state-verb patterns (existing logic)
 * - GeminiFlashLiteFilter  — small cloud LLM (default when GEMINI_API_KEY set)
 * - VllmReasoningFilter    — local Gemma via vLLM (future, GPU-bound)
 *
 * Selection priority (env, see `selectFilter`):
 *   VLLM_REASONING_BASE > GEMINI_API_KEY > heuristic
 *
 * Refs: nextain/naia-memory#14, plan-v3-anchor §4 R2.5
 */

import {
	type ReconsolidationResult,
	checkContradiction as heuristicCheckContradiction,
} from "./reconsolidation.js";
import type { Fact } from "./types.js";

export interface ContradictionCandidate {
	existing: Fact;
	newInfo: string;
}

export interface ContradictionVerdict {
	/** Index into the input candidates array (preserved for caller correlation). */
	index: number;
	result: ReconsolidationResult;
}

export interface ContradictionFilterProvider {
	readonly name: string;
	/** Inspect candidate (existing fact, new info) pairs and return non-"keep" verdicts.
	 *  "keep" verdicts may be filtered out — caller treats absent index as "keep". */
	filter(candidates: readonly ContradictionCandidate[]): Promise<ContradictionVerdict[]>;
}

// ─── Shared LLM prompt + parsing (used by Gemini and Vllm filters) ─────────

/** Build the contradiction-detection prompt for a batch of candidate pairs.
 *  Strengthened version (R2.5 follow-up): emphasises "same entity AND same
 *  attribute", requests an explicit `confidence` 0-1 per pair, and includes
 *  worked examples to reduce false positives that supersede unrelated facts.
 */
export function buildContradictionPrompt(
	batch: readonly ContradictionCandidate[],
): string {
	const pairsText = batch
		.map(
			(c, i) =>
				`[${i + 1}]\n  existing: ${JSON.stringify(c.existing.content)}\n  new:      ${JSON.stringify(c.newInfo)}\n  entities: ${JSON.stringify(c.existing.entities)}`,
		)
		.join("\n");

	return `You are a contradiction detector for a memory system. For each pair below, decide whether the "new" information SUPERSEDES the "existing" fact — i.e. the same entity, the same attribute, and a *different* value.

Output JSON only. For each pair index N from 1..${batch.length}, emit:
  {"N": {"contradiction": true|false, "confidence": <0.0-1.0>, "reason": "<short>"}}

contradiction = true ONLY when ALL of the following hold:
- existing and new are about the SAME entity (same person, same tool, same project, etc.)
- they describe the SAME attribute (location, tool used, preference, schedule, etc.)
- the new value REPLACES the old value — not adds, not refines, not reaffirms
- OR the new information unambiguously says that exact existing state has durably ended ("no longer", "stopped", "더 이상", "やめた"). In that case the negative state supersedes the old affirmative state.

contradiction = false (do NOT supersede) for:
- different attribute of the same entity (e.g. existing="uses Cursor", new="bought a MacBook" — same person, different attribute)
- additional/qualifying detail (e.g. existing="lives in Seoul", new="lives in Seoul, Gangnam-gu" — refinement, not replacement)
- reaffirmation (e.g. existing="prefers tabs", new="still prefers tabs over spaces")
- temporal continuation (e.g. existing="went to Kyoto last summer", new="going to Kyoto this winter" — separate events)
- uncertainty, inability, future intent, temporary exceptions, or scoped negation that does not durably end the existing state
- unrelated facts that share an entity by coincidence

Caution against false positives — common over-aggressive patterns:
- Same category but DIFFERENT attribute: "tool" is a category, but design-tool, documentation-tool, meeting-tool, IaC-tool are *different attributes*. Do not supersede across attributes.
- Parent-vs-instance: a parent service or platform and one of its sub-services are not the same attribute (a generic "cloud platform" attribute vs an attribute about a specific managed service under it).
- List-like attributes: hobbies, subscriptions, languages spoken, team members — these naturally hold MULTIPLE concurrent values. A new entry adds, not replaces.
- Different entities sharing an attribute name: "X's role" and "Y's role" are different entities even if both speak of "role". Verify entity identity before flagging.

confidence guidance:
- 0.9+ : explicit replacement language present ("switched", "instead of", "moved", "now …" with prior contradicted)
- 0.7-0.9 : same entity+attribute pair confirmed, different value, but no explicit cue
- 0.5-0.7 : entity match clear, attribute overlap uncertain (could be sibling attribute) — usually prefer false
- below 0.5 : ambiguous — prefer false

Pairs:
${pairsText}

Return ONLY a JSON object with keys "1".."${batch.length}". No prose.`;
}

/** Parse the LLM's JSON response and emit verdicts that pass the
 *  confidence threshold. Strips code fences (small models often wrap JSON). */
export function parseContradictionVerdicts(
	rawContent: string,
	batch: readonly ContradictionCandidate[],
	offset: number,
	confidenceThreshold: number,
	modelLabel: string,
): ContradictionVerdict[] {
	const cleaned = rawContent
		.replace(/^```(?:json)?\s*/i, "")
		.replace(/\s*```\s*$/i, "")
		.trim();
	const parsed = JSON.parse(cleaned) as Record<
		string,
		{ contradiction?: boolean; confidence?: number; reason?: string }
	>;

	const verdicts: ContradictionVerdict[] = [];
	const debug = process.env.NAIA_FILTER_DEBUG === "1";
	for (let i = 0; i < batch.length; i++) {
		const entry = parsed[String(i + 1)];
		if (!entry) {
			if (debug) console.error(`[FILTER_DEBUG]   LLM no entry for idx=${offset + i}`);
			continue;
		}
		const conf = typeof entry.confidence === "number" ? entry.confidence : 0;
		if (debug) {
			console.error(
				`[FILTER_DEBUG]   LLM idx=${offset + i} contradiction=${entry.contradiction} conf=${conf.toFixed(2)} reason="${(entry.reason ?? "").slice(0, 50)}"`,
			);
		}
		if (!entry.contradiction) continue;
		if (conf < confidenceThreshold) continue;
		verdicts.push({
			index: offset + i,
			result: {
				action: "update",
				updatedContent: batch[i]!.newInfo,
				reason: `LLM (${modelLabel}, conf=${conf.toFixed(2)}): ${entry.reason ?? "contradiction"}`,
			},
		});
	}
	return verdicts;
}

// ─── Heuristic ─────────────────────────────────────────────────────────────

/** Wraps the existing keyword-pattern `checkContradiction` for contract parity.
 *  Acts as both the offline default and the fallback for cloud-LLM unavailable. */
export class HeuristicContradictionFilter implements ContradictionFilterProvider {
	readonly name = "heuristic";

	async filter(
		candidates: readonly ContradictionCandidate[],
	): Promise<ContradictionVerdict[]> {
		const verdicts: ContradictionVerdict[] = [];
		for (let i = 0; i < candidates.length; i++) {
			const c = candidates[i]!;
			const result = heuristicCheckContradiction(c.existing, c.newInfo);
			if (result.action !== "keep") verdicts.push({ index: i, result });
		}
		return verdicts;
	}
}

// ─── Gemini Flash Lite ─────────────────────────────────────────────────────

export interface GeminiFlashLiteFilterOptions {
	apiKey: string;
	baseURL?: string;
	model?: string;
	/** Per-call candidate cap (large batches degrade JSON adherence). Default: 10 */
	batchSize?: number;
	/** Minimum confidence (0-1) required to accept the LLM's contradiction verdict.
	 *  Below this threshold, the verdict is dropped (caller treats as "keep").
	 *  Default 0.7 — empirically reduces false-positive supersede that damages
	 *  current-state recall (issue #14 measurement showed -3pp on contradiction_direct
	 *  when threshold was effectively 0). */
	confidenceThreshold?: number;
}

const GEMINI_DIRECT_BASE_URL =
	"https://generativelanguage.googleapis.com/v1beta/openai/";
/** Prefer Vertex AI gateway when GATEWAY_URL is set — no rate limits,
 *  routes Gemini calls without 503 spikes. Caller can still pass an
 *  explicit baseURL to override. */
const GEMINI_DEFAULT_BASE_URL = process.env.GATEWAY_URL
	? `${process.env.GATEWAY_URL.replace(/\/+$/, "")}/v1/`
	: GEMINI_DIRECT_BASE_URL;
// Gateway routes via Vertex AI which requires `vertexai:` model prefix.
const GEMINI_DEFAULT_MODEL = process.env.GATEWAY_URL
	? "vertexai:gemini-2.5-flash-lite"
	: "gemini-2.5-flash-lite";
const GEMINI_DEFAULT_BATCH_SIZE = 10;
const DEFAULT_CONFIDENCE_THRESHOLD = 0.7;

/** LLM-based contradiction filter using Gemini Flash Lite (cloud).
 *  Sends candidate pairs in a structured prompt and asks the model to
 *  decide, per pair, whether the new info contradicts the existing fact
 *  *for the same entity / attribute*.
 */
export class GeminiFlashLiteContradictionFilter
	implements ContradictionFilterProvider
{
	readonly name = "gemini-flash-lite";
	private readonly apiKey: string;
	private readonly baseURL: string;
	private readonly model: string;
	private readonly batchSize: number;
	private readonly confidenceThreshold: number;

	constructor(options: GeminiFlashLiteFilterOptions) {
		// When the caller didn't pin a baseURL, auto-route via gateway when
		// GATEWAY_URL is set (gateway needs its own credential).
		const callerOverrodeBaseURL = options.baseURL !== undefined;
		this.apiKey = callerOverrodeBaseURL
			? options.apiKey
			: (process.env.GATEWAY_MASTER_KEY || options.apiKey);
		this.baseURL = options.baseURL ?? GEMINI_DEFAULT_BASE_URL;
		this.model = options.model ?? GEMINI_DEFAULT_MODEL;
		this.batchSize = options.batchSize ?? GEMINI_DEFAULT_BATCH_SIZE;
		this.confidenceThreshold =
			options.confidenceThreshold ?? DEFAULT_CONFIDENCE_THRESHOLD;
	}

	async filter(
		candidates: readonly ContradictionCandidate[],
	): Promise<ContradictionVerdict[]> {
		if (candidates.length === 0) return [];
		const verdicts: ContradictionVerdict[] = [];
		for (let i = 0; i < candidates.length; i += this.batchSize) {
			const batch = candidates.slice(i, i + this.batchSize);
			const batchResults = await this.callLLMOrFallback(batch, i);
			verdicts.push(...batchResults);
		}
		return verdicts;
	}

	private async callLLMOrFallback(
		batch: readonly ContradictionCandidate[],
		offset: number,
	): Promise<ContradictionVerdict[]> {
		try {
			return await this.callLLM(batch, offset);
		} catch (err) {
			console.warn(
				`[GeminiFlashLiteContradictionFilter] API failure, falling back to heuristic: ${(err as Error).message}`,
			);
			const fallback = new HeuristicContradictionFilter();
			const local = await fallback.filter(batch);
			return local.map((v) => ({ ...v, index: v.index + offset }));
		}
	}

	private async callLLM(
		batch: readonly ContradictionCandidate[],
		offset: number,
	): Promise<ContradictionVerdict[]> {
		const prompt = buildContradictionPrompt(batch);
		const url = `${this.baseURL.replace(/\/$/, "")}/chat/completions`;
		const response = await fetch(url, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${this.apiKey}`,
			},
			body: JSON.stringify({
				model: this.model,
				messages: [{ role: "user", content: prompt }],
				temperature: 0,
				response_format: { type: "json_object" },
			}),
		});

		if (!response.ok) {
			throw new Error(`HTTP ${response.status}: ${await response.text()}`);
		}

		const data = (await response.json()) as {
			choices?: Array<{ message?: { content?: string } }>;
		};
		const content = data.choices?.[0]?.message?.content ?? "";
		return parseContradictionVerdicts(
			content,
			batch,
			offset,
			this.confidenceThreshold,
			this.model,
		);
	}
}

// ─── Vllm reasoning (local Gemma) ──────────────────────────────────────────

export interface VllmReasoningFilterOptions {
	/** Base URL of the vLLM OpenAI-compatible server. Defaults to
	 *  `VLLM_REASONING_BASE` env. Example: `http://localhost:8002/v1`. */
	baseURL?: string;
	/** Model name as served by vLLM. Defaults to
	 *  `VLLM_REASONING_MODEL` env. */
	model?: string;
	/** Per-call candidate cap. Default: 10 */
	batchSize?: number;
	/** Minimum confidence (0-1) required to accept a contradiction verdict.
	 *  Default 0.7 — same threshold as Gemini filter. */
	confidenceThreshold?: number;
}

const VLLM_DEFAULT_MODEL = "local-reasoning-model";
const VLLM_DEFAULT_BATCH_SIZE = 10;

/** Local vLLM-served instruct model contradiction filter.
 *  Same prompt structure as `GeminiFlashLiteContradictionFilter`; the only
 *  difference is the endpoint and model. Privacy-preserving and free at the
 *  margin — limited only by GPU throughput. */
export class VllmReasoningContradictionFilter
	implements ContradictionFilterProvider
{
	readonly name = "vllm-reasoning";
	private readonly baseURL: string;
	private readonly model: string;
	private readonly batchSize: number;
	private readonly confidenceThreshold: number;

	constructor(options: VllmReasoningFilterOptions = {}) {
		this.baseURL =
			options.baseURL ??
			process.env.VLLM_REASONING_BASE ??
			"http://localhost:8002/v1";
		this.model =
			options.model ?? process.env.VLLM_REASONING_MODEL ?? VLLM_DEFAULT_MODEL;
		this.batchSize = options.batchSize ?? VLLM_DEFAULT_BATCH_SIZE;
		this.confidenceThreshold =
			options.confidenceThreshold ?? DEFAULT_CONFIDENCE_THRESHOLD;
	}

	async filter(
		candidates: readonly ContradictionCandidate[],
	): Promise<ContradictionVerdict[]> {
		if (candidates.length === 0) return [];
		const verdicts: ContradictionVerdict[] = [];
		for (let i = 0; i < candidates.length; i += this.batchSize) {
			const batch = candidates.slice(i, i + this.batchSize);
			try {
				const batchResults = await this.callVllm(batch, i);
				verdicts.push(...batchResults);
			} catch (err) {
				console.warn(
					`[VllmReasoningContradictionFilter] vLLM call failed at offset ${i}, falling back to heuristic for this batch: ${(err as Error).message}`,
				);
				const fallback = new HeuristicContradictionFilter();
				const local = await fallback.filter(batch);
				verdicts.push(...local.map((v) => ({ ...v, index: v.index + i })));
			}
		}
		return verdicts;
	}

	private async callVllm(
		batch: readonly ContradictionCandidate[],
		offset: number,
	): Promise<ContradictionVerdict[]> {
		const prompt = buildContradictionPrompt(batch);
		const url = `${this.baseURL.replace(/\/$/, "")}/chat/completions`;
		const response = await fetch(url, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				model: this.model,
				messages: [{ role: "user", content: prompt }],
				temperature: 0,
				max_tokens: 1024,
			}),
		});

		if (!response.ok) {
			throw new Error(`HTTP ${response.status}: ${await response.text()}`);
		}

		const data = (await response.json()) as {
			choices?: Array<{ message?: { content?: string } }>;
		};
		const content = data.choices?.[0]?.message?.content ?? "";
		return parseContradictionVerdicts(
			content,
			batch,
			offset,
			this.confidenceThreshold,
			`vllm:${this.model}`,
		);
	}
}

// ─── Provider selection ────────────────────────────────────────────────────

/** Pick a contradiction filter from environment.
 *  Priority: VLLM_REASONING_BASE > GEMINI_API_KEY > heuristic.
 *  Override via `CONTRADICTION_FILTER` (heuristic | gemini | vllm).
 */
export function selectFilter(
	env: NodeJS.ProcessEnv = process.env,
): ContradictionFilterProvider {
	const override = env.CONTRADICTION_FILTER?.toLowerCase();
	if (override === "heuristic") return new HeuristicContradictionFilter();
	if (override === "vllm") return new VllmReasoningContradictionFilter();
	if (override === "gemini") {
		if (!env.GEMINI_API_KEY) {
			throw new Error("CONTRADICTION_FILTER=gemini set but GEMINI_API_KEY missing");
		}
		return new GeminiFlashLiteContradictionFilter({ apiKey: env.GEMINI_API_KEY });
	}

	if (env.VLLM_REASONING_BASE) return new VllmReasoningContradictionFilter();
	if (env.GEMINI_API_KEY) {
		return new GeminiFlashLiteContradictionFilter({ apiKey: env.GEMINI_API_KEY });
	}
	return new HeuristicContradictionFilter();
}
