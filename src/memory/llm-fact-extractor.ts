/**
 * LLM-based atomic fact extractor for Naia Memory consolidation.
 *
 * Replaces heuristicFactExtractor (which copies episode content verbatim)
 * with a Gemini Flash call that distills each episode into 1-5 atomic facts.
 *
 * Goal: clean facts like "사용자 인덴트 스타일: 탭" instead of
 * "사용자가 코딩할 때 탭을 쓴다고 했다. 그리고 vim을 사용하며..."
 *
 * Tradeoffs:
 * - +latency: one API call per BATCH of episodes during consolidation
 * - +cost: ~100 tokens input + ~200 tokens output per episode
 * - +accuracy: atomic facts embed cleanly, improving vector search recall
 */

import { hasGroundedDeleteEvidence } from "./delete-grounding.js";
import type { ExtractedFact } from "./index.js";
import type { Episode, StructuredFact } from "./types.js";

export interface LLMFactExtractorOptions {
	/** Gemini (or OpenAI-compatible) API key */
	apiKey: string;
	/** Provider transport auth. Default bearer; Naia/AnyLLM gateway uses x-anyllm. */
	auth?: "bearer" | "x-anyllm";
	/** Base URL for the chat completions endpoint (without /chat/completions) */
	baseURL?: string;
	/** Model to use. Default: gemini-2.5-flash-lite (fast, cheap) */
	model?: string;
	/** Max episodes to send in a single API call. Default: 10 */
	batchSize?: number;
	/** Product default skips failed batches; benchmarks should use throw. */
	failurePolicy?: "skip" | "throw";
}

const GEMINI_DIRECT_BASE_URL =
	"https://generativelanguage.googleapis.com/v1beta/openai/";
/** When `GATEWAY_URL` is set, use it (Vertex AI gateway, no rate limits)
 *  in preference to direct Gemini API. Direct API hits 503 spikes during
 *  high-demand periods; gateway routes through Vertex which is rate-managed. */
const USE_GATEWAY = !!process.env.GATEWAY_URL;
const DEFAULT_BASE_URL = USE_GATEWAY
	? `${process.env.GATEWAY_URL?.replace(/\/+$/, "")}/v1/`
	: GEMINI_DIRECT_BASE_URL;
// Gateway routes via Vertex AI which requires `vertexai:` model prefix.
// Direct Gemini API uses bare model name.
const DEFAULT_MODEL = USE_GATEWAY
	? "vertexai:gemini-2.5-flash-lite"
	: "gemini-2.5-flash-lite";
const DEFAULT_BATCH_SIZE = 10;

const EXTRACTOR_SUBJECT_IDS = new Set(["person:self"]);
function normalizedDeleteQuote(value: string): string {
	return value.normalize("NFC").trim();
}

const EXTRACTOR_PROPERTY_IDS = new Set([
	"profile:name",
	"profile:pronouns",
	"profile:residence",
	"profile:occupation",
	"profile:organization",
	"profile:timezone",
	"profile:language",
	"profile:allergy",
	"profile:diet",
	"profile:medication",
	"profile:beverage-consumption",
	"profile:hobby",
	"plan:activity",
	"routine:morning",
	"preference:animal",
	"preference:book-genre",
	"preference:color",
	"preference:editor",
	"preference:food",
	"preference:music-genre",
	"preference:tool",
	"preference:travel-destination",
	"preference:communication",
]);

/**
 * Factory: returns a FactExtractor function that calls Gemini Flash.
 * Pass the result as `factExtractor` in MemorySystemOptions.
 *
 * @example
 * const system = new MemorySystem({
 *   adapter,
 *   factExtractor: buildLLMFactExtractor({ apiKey: process.env.GEMINI_API_KEY! }),
 * });
 */
export function buildLLMFactExtractor(
	options: LLMFactExtractorOptions,
): (episodes: Episode[]) => Promise<ExtractedFact[]> {
	// When GATEWAY_URL is set, prefer the Vertex AI gateway which has no
	// rate limits — direct Gemini API hits 503 spikes during high-demand
	// periods. The gateway requires its own credential (GATEWAY_MASTER_KEY)
	// so we override apiKey too unless the caller passed an explicit
	// non-default baseURL.
	const callerOverrodeBaseURL = options.baseURL !== undefined;
	const apiKey = callerOverrodeBaseURL
		? options.apiKey
		: process.env.GATEWAY_MASTER_KEY || options.apiKey;
	const {
		baseURL = DEFAULT_BASE_URL,
		model = DEFAULT_MODEL,
		batchSize = DEFAULT_BATCH_SIZE,
		auth = "bearer",
		failurePolicy = "skip",
	} = options;

	return async (episodes: Episode[]): Promise<ExtractedFact[]> => {
		const results: ExtractedFact[] = [];

		for (let i = 0; i < episodes.length; i += batchSize) {
			const batch = episodes.slice(i, i + batchSize);
			const extracted = await extractBatch(batch, {
				apiKey,
				baseURL,
				model,
				auth,
				failurePolicy,
			});
			results.push(...extracted);
		}

		return results;
	};
}

/**
 * Extract atomic facts from a batch of episodes in a single API call.
 * Sends all episodes together → one set of facts per episode index.
 */
async function extractBatch(
	episodes: Episode[],
	opts: {
		apiKey: string;
		baseURL: string;
		model: string;
		auth: "bearer" | "x-anyllm";
		failurePolicy: "skip" | "throw";
	},
	retries = 3,
): Promise<ExtractedFact[]> {
	const { apiKey, baseURL, model, auth, failurePolicy } = opts;

	const episodeList = episodes
		.map((ep, i) => {
			// LoCoMo dataset uses Unix seconds; JS Date expects ms.
			// Heuristic: timestamps below 1e12 are seconds, otherwise ms.
			const ts = ep.timestamp;
			const tsMs = ts && ts < 1e12 ? ts * 1000 : ts;
			const dateStr = tsMs ? new Date(tsMs).toISOString().split("T")[0] : "";
			const dateTag = dateStr ? ` [Date: ${dateStr}]` : "";
			return `[${i + 1}]${dateTag} ${ep.content}`;
		})
		.join("\n");

	const prompt = `You are a memory fact extractor. Given conversation turns, extract atomic facts about the user and any actionable information (preferences, constraints, environment details, tool results).

Rules:
- Each fact = ONE self-contained statement
- Each fact MUST match the language of its specific episode, not the batch as a whole
- Be specific: "User occupation: software engineer" not "User mentioned their occupation"
- 1-5 facts per episode. If no extractable facts exist, return []
- Skip greetings, meta-commentary, questions without answers
- Do NOT invent facts not present in the input
- CRITICAL: When the turn mentions relative time ("yesterday", "last week", "last night"), resolve it using the [Date: YYYY-MM-DD] tag. Example: if tagged [Date: 2023-05-08] and text says "yesterday", write the fact as "User went to the LGBTQ support group on 2023-05-07" or "on 7 May 2023".

DO NOT capture transient or environment-dependent failures as facts (negative-capture policy). These harden into durable self-imposed constraints that bite later when the environment changes:
- Environment-dependent failures: missing binaries, "command not found", not-installed packages, unconfigured credentials, fresh-install or post-migration path mismatches. The user can fix these — they are NOT durable facts.
- Negative claims about tools/features ("X tool is broken", "browser tools don't work", "cannot use Y"). NEVER store these — they become refusals the agent cites against itself for months after the problem is fixed.
- Transient errors that resolved on retry (timeouts, 5xx, 429, connection refused). If retrying worked, there is no durable fact — at most the retry pattern.
- One-off task narratives ("summarized today's news") — not a durable fact about the user.
If a failure was caused by setup state, capture the FIX (the install/config/env step) as the fact — never the failure itself.

CRITICAL — UPDATE / CHANGE / REPLACEMENT statements:
Update statements (where the speaker signals that a previously-true value
has been replaced — e.g. "switched to X", "changed to Y", "now using Z",
"moved to W", "X로 바꿨어", "이제 X 쓰기로", "X로 이사해") MUST also be
extracted as atomic facts. Do NOT skip them as "no extractable fact".
The new value MUST be paired with the SAME attribute key the prior fact
would have used (so downstream contradiction detection can pair the old
and new values on the same entity + attribute).

Anti-pattern (do NOT do):
- Skipping the update as "no fact extractable"
- Inventing a new attribute key that does not match the prior fact —
  the new fact must use the same attribute *category* as a hypothetical
  earlier statement of the same fact (e.g. for a residence change, use
  the residence/location key, not a one-off "이사 사실:" key).
- Padding with relationship verbs ("switched", "changed") in the value;
  the value should be the new state alone.
- Treat contrastive replacements equivalently across languages. Preserve the
  replaced attribute even when the new activity could also fit a broader
  category. For example, "In the evenings I now stretch instead of running",
  "저녁에는 달리기 대신 스트레칭을 해요", and "夜は走る代わりにストレッチをしています"
  all describe a replacement of the evening routine; do not relabel the new
  value as a generic hobby.
CRITICAL — DELETE / DURABLE CESSATION statements:
When the speaker explicitly asks to remove a previously stored fact, or
unambiguously says a previously durable state no longer holds in the present
without a temporary qualifier (for example
"forget my peanut allergy", "I no longer play chess", "이제 재즈를 듣지
않아요", or "もう紅茶は飲みません"), return an object with
"operation":"delete" and the exact affirmative structured fact to remove.
Do not turn the request into a new negated fact. Delete requires complete
subject, property, value, polarity="affirmed", and cardinality. Never infer a
delete from uncertainty, correction, inability, future intent, temporary
exceptions, or ambiguous/ordinary negation. If a durable new negative preference
is itself useful, emit it as a separate upsert in addition to deleting the old
affirmative fact.

Every delete object MUST include "deleteEvidenceKind" with exactly one of:
- "explicit_removal_request": the speaker directly asks this memory to be
  forgotten, removed, or deleted.
- "durable_cessation": the speaker unambiguously says their own durable state
  has ended, with no temporary or historical scope.
Do NOT emit delete for quoted speech, another person's state, a past-only
narrative, a temporary exception, a hypothetical, uncertainty, or a correction
that does not itself establish cessation. Those contexts are upserts or no fact.
Every delete object MUST also include "deleteEvidenceQuote" as machine-checkable
grounding: the exact full text of the current episode, including punctuation. The
full episode must directly demonstrate the selected evidence kind. It MUST also include
"deleteTargetQuote": an exact, non-empty verbatim substring from the current
episode that names the target being removed. The evidence quote
grounds current authority; the target quote grounds a current target mention.
The model remains responsible for mapping that mention to the structured value.
Do not emit a delete if either quote is unavailable.

Durable cessation is language-independent. Phrases equivalent to "no longer",
"더 이상 ... 않다", and "もう ... ではない" must delete the exact prior
affirmative value when the statement is explicit and durable, even if the same
turn also states a new negative preference.
Treat an unqualified present-state ending as durable for memory-update purposes;
words such as "permanently" or "forever" are not required. Temporal qualifiers
such as "today", "this week", or "for now" still make the statement temporary
and must not authorize deletion. Examples with unrelated attributes:
- "I no longer use Vim." deletes the affirmative editor preference "Vim".
- "이제 재즈를 듣지 않아요." deletes the affirmative music preference "재즈".
- "もう紅茶は飲みません。" deletes the affirmative beverage preference "紅茶".
For each example, use the complete current episode as deleteEvidenceQuote and
the exact target mention ("Vim", "재즈", or "紅茶") as deleteTargetQuote.

Language-preservation rules (apply independently to every episode):
- Never translate the fact, structured labels, or value into another language.
- Korean: omit particles when a compact noun phrase is natural, and preserve
  mixed English product names. Example: "사용자 거주지: 서울".
- English: use English labels and values. Example: "User residence: London".
- Japanese: use Japanese labels and values. Example: "ユーザーの居住地: 東京".
- Preserve proper nouns and product names exactly in every language.

Conversation turns:
${episodeList}

For a fact whose subject, property, and single-vs-multi value are explicit,
you MUST attach structure. Never guess a missing field. Keep all labels and
values in the episode's original language. Use "single" only for one current
value; use "multi" for lists, skills, or preferences that can coexist.

When the identity is unambiguous and belongs to this vocabulary, you MUST
attach BOTH language-independent IDs from
the closed vocabulary below. Never invent an ID, attach only one ID, or force
an unknown concept into the nearest category. Omit both IDs when uncertain.
- subjectId: "person:self" only for the speaker/user
- propertyId: "profile:name", "profile:pronouns", "profile:residence",
  "profile:occupation", "profile:organization", "profile:timezone",
  "profile:language", "profile:allergy", "profile:diet",
  "profile:medication", "profile:beverage-consumption",
  "profile:hobby", "plan:activity", "routine:morning",
  "preference:animal", "preference:book-genre", "preference:color",
  "preference:editor", "preference:food", "preference:music-genre",
  "preference:tool", "preference:travel-destination", or
  "preference:communication"

Respond with ONLY a JSON object mapping episode number to fact array. No other text.
Backward-compatible format: {"1": ["fact", ...], "2": ["fact", ...], ...}
Structured format: {"1": [{"content":"사용자 거주지: 서울","operation":"upsert","structured":{"subject":"사용자","subjectId":"person:self","property":"거주지","propertyId":"profile:residence","value":"서울","polarity":"affirmed","cardinality":"single"}}], ...}
Delete format: {"1": [{"content":"사용자 알레르기: 땅콩","operation":"delete","deleteEvidenceKind":"explicit_removal_request","deleteEvidenceQuote":"땅콩 알레르기 기억을 삭제해 줘.","deleteTargetQuote":"땅콩 알레르기","structured":{"subject":"사용자","subjectId":"person:self","property":"알레르기","propertyId":"profile:allergy","value":"땅콩","polarity":"affirmed","cardinality":"multi"}}]}`;

	const call = () =>
		fetch(`${baseURL}chat/completions`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				...(apiKey
					? auth === "x-anyllm"
						? { "X-AnyLLM-Key": `Bearer ${apiKey}` }
						: { Authorization: `Bearer ${apiKey}` }
					: {}),
			},
			body: JSON.stringify({
				model,
				messages: [{ role: "user", content: prompt }],
				// Gemini 2.5 may spend part of this budget on internal reasoning. A
				// 2K ceiling can therefore truncate even a short JSON payload.
				max_tokens: Math.max(8192, episodes.length * 400),
				// Extraction is a contract parse, not creative generation. Zero reduces
				// multilingual key/cardinality drift across repeated benchmark runs.
				temperature: 0,
				response_format: { type: "json_object" },
			}),
		});

	let response: Response | undefined;
	for (let attempt = 1; attempt <= retries; attempt++) {
		try {
			response = await call();
			if (response.ok || response.status < 500) break;
			const delay = Math.min(2000 * attempt, 10000);
			console.warn(
				`[LLMFactExtractor] API ${response.status}, retry ${attempt}/${retries} in ${delay}ms`,
			);
			await new Promise((r) => setTimeout(r, delay));
		} catch (err: unknown) {
			if (attempt === retries) {
				if (failurePolicy === "throw") {
					throw new Error(
						`LLM fact extraction transport failed after ${retries} attempts`,
						{ cause: err },
					);
				}
				console.warn(
					`[LLMFactExtractor] Batch failed after ${retries} retries (${episodes.length} episodes), skipping`,
				);
				return [];
			}
			await new Promise((r) => setTimeout(r, 2000 * attempt));
		}
	}

	if (!response || !response.ok) {
		if (failurePolicy === "throw") {
			throw new Error(
				`LLM fact extraction failed with HTTP ${response?.status ?? "unavailable"}`,
			);
		}
		console.warn(
			`[LLMFactExtractor] API ${response?.status ?? "timeout"}, skipping ${episodes.length} episodes`,
		);
		return [];
	}

	try {
		const data = await response.json();
		// Track usage for benchmark cost reporting (no-op if tracker not used).
		try {
			const { recordLLM } = await import("./usage-tracker.js");
			recordLLM(
				data?.usage?.prompt_tokens ?? 0,
				data?.usage?.completion_tokens ?? 0,
			);
		} catch {}
		let raw = data.choices?.[0]?.message?.content ?? "{}";
		raw = raw
			.replace(/^```(?:json)?\s*\n?/i, "")
			.replace(/\n?```\s*$/i, "")
			.trim();
		const parsed: Record<string, unknown> = JSON.parse(raw);

		return episodes.flatMap((ep, i) => {
			const rawFacts = parsed[String(i + 1)] ?? [];
			if (!Array.isArray(rawFacts) && Object.keys(parsed).length > 0) {
				console.warn(
					`[LLMFactExtractor] Unexpected value for key "${i + 1}": ${typeof rawFacts}. Keys: ${Object.keys(parsed).join(", ")}`,
				);
			}
			const facts: Array<{
				content: string;
				structured?: StructuredFact;
				operation?: "upsert" | "delete";
				deleteEvidence?: {
					kind: "explicit_removal_request" | "durable_cessation";
					evidenceQuote: string;
					targetQuote: string;
				};
			}> = Array.isArray(rawFacts)
				? rawFacts.flatMap((fact) => {
						if (typeof fact === "string") return [{ content: fact }];
						if (!fact || typeof fact !== "object") return [];
						const candidate = fact as {
							content?: unknown;
							structured?: unknown;
							operation?: unknown;
							deleteEvidenceKind?: unknown;
							deleteEvidenceQuote?: unknown;
							deleteTargetQuote?: unknown;
						};
						if (typeof candidate.content !== "string") return [];
						const structured = parseStructuredFact(candidate.structured);
						const normalizedEpisode = normalizedDeleteQuote(ep.content);
						const normalizedEvidence =
							typeof candidate.deleteEvidenceQuote === "string"
								? normalizedDeleteQuote(candidate.deleteEvidenceQuote)
								: "";
						const normalizedTarget =
							typeof candidate.deleteTargetQuote === "string"
								? normalizedDeleteQuote(candidate.deleteTargetQuote)
								: "";
						const hasDeleteEvidence = hasGroundedDeleteEvidence({
							episodeContent: normalizedEpisode,
							episodeRole: ep.role,
							evidenceKind: candidate.deleteEvidenceKind,
							evidenceQuote: normalizedEvidence,
							targetQuote: normalizedTarget,
							subject: structured?.subject,
							property: structured?.property,
							value: structured?.value,
							subjectId: structured?.subjectId,
							propertyId: structured?.propertyId,
							polarity: structured?.polarity,
						});
						if (
							candidate.operation === "delete" &&
							(structured?.polarity !== "affirmed" || !hasDeleteEvidence)
						) {
							return [];
						}
						return [
							{
								content: candidate.content,
								structured,
								operation:
									candidate.operation === "delete" ? "delete" : "upsert",
								...(candidate.operation === "delete"
									? {
											deleteEvidence: {
												kind: candidate.deleteEvidenceKind as
													| "explicit_removal_request"
													| "durable_cessation",
												evidenceQuote: normalizedEvidence,
												targetQuote: normalizedTarget,
											},
										}
									: {}),
							},
						];
					})
				: [];
			if (facts.length === 0) return [];
			return facts.map((fact) => ({
				content: fact.content,
				entities: [],
				topics: ep.encodingContext.project ? [ep.encodingContext.project] : [],
				importance: ep.importance.utility,
				maxEmotion: ep.importance.emotion ?? 0,
				sourceEpisodeIds: [ep.id],
				structured: fact.structured,
				operation: fact.operation,
				...(fact.deleteEvidence ? { deleteEvidence: fact.deleteEvidence } : {}),
			}));
		});
	} catch (err) {
		if (failurePolicy === "throw") {
			throw new Error("LLM fact extraction returned an invalid response", {
				cause: err,
			});
		}
		console.warn("[LLMFactExtractor] Parse error, skipping batch:", err);
		return [];
	}
}

function parseStructuredFact(value: unknown): StructuredFact | undefined {
	if (!value || typeof value !== "object") return undefined;
	const candidate = value as Record<string, unknown>;
	if (
		typeof candidate.subject !== "string" ||
		typeof candidate.property !== "string" ||
		typeof candidate.value !== "string" ||
		(candidate.polarity !== "affirmed" && candidate.polarity !== "negated") ||
		(candidate.cardinality !== "single" && candidate.cardinality !== "multi")
	)
		return undefined;
	const subjectId =
		typeof candidate.subjectId === "string" &&
		EXTRACTOR_SUBJECT_IDS.has(candidate.subjectId)
			? candidate.subjectId
			: undefined;
	const propertyId =
		typeof candidate.propertyId === "string" &&
		EXTRACTOR_PROPERTY_IDS.has(candidate.propertyId)
			? candidate.propertyId
			: undefined;
	const identityIds = subjectId && propertyId ? { subjectId, propertyId } : {};
	return {
		subject: candidate.subject,
		property: candidate.property,
		...identityIds,
		value: candidate.value,
		polarity: candidate.polarity,
		cardinality: candidate.cardinality,
		provenance: "extractor",
	};
}
