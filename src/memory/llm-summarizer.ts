// LLM-based compaction summarizer (CompactionSummarizer). small LLM(라이트 모델)이 예산 압박
// 압축 시 결정론 recap(seedSummary)을 자연어로 polish 한다. 어떤 실패(비-OK 응답/네트워크/abort)에도
// seedSummary 로 폴백 → 무손실(MemorySystem.compact 는 summarizer 미주입 시와 동일 동작 보장).
//
// OpenAI-compat chat/completions(llm-fact-extractor 와 동형 엔드포인트). naia-agent 가 메모리 small-LLM
// 설정(provider/baseUrl/apiKey/model)으로 빌드해 MemorySystem({ summarizer }) 로 주입한다.
import type { CompactionSummarizer } from "./index.js";

export interface LLMSummarizerOptions {
	/** OpenAI-compat API key(로컬 서버는 빈 값 허용). */
	apiKey: string;
	/** Provider transport auth. 기본 bearer, Naia/AnyLLM gateway는 x-anyllm. */
	auth?: "bearer" | "x-anyllm";
	/** chat/completions base URL(끝 슬래시 포함 — fact-extractor 와 동형). 미지정 = Gemini direct. */
	baseURL?: string;
	/** 요약 모델. 미지정 = gemini-2.5-flash-lite(빠르고 저렴). */
	model?: string;
}

const DEFAULT_BASE_URL =
	"https://generativelanguage.googleapis.com/v1beta/openai/";
const DEFAULT_MODEL = "gemini-2.5-flash-lite";

/** small-LLM 설정 → CompactionSummarizer. 실패 시 seedSummary 폴백(무손실). */
export function buildLLMSummarizer(
	options: LLMSummarizerOptions,
): CompactionSummarizer {
	// fact-extractor 와 동일: caller 가 baseURL 명시 안 하면 게이트웨이 키 우선(direct Gemini 503 회피).
	const callerOverrodeBaseURL = options.baseURL !== undefined;
	const apiKey = callerOverrodeBaseURL
		? options.apiKey
		: process.env.GATEWAY_MASTER_KEY || options.apiKey;
	const baseURL = options.baseURL ?? DEFAULT_BASE_URL;
	const model = options.model ?? DEFAULT_MODEL;
	const auth = options.auth ?? "bearer";

	return async (input) => {
		const seed = (input.seedSummary ?? "").trim();
		const transcript = input.messages
			.map((m) => `${m.role}: ${m.content}`)
			.join("\n");
		if (!transcript.trim()) return seed;

		const prompt = `다음 대화를 이후 맥락 유지에 필요한 핵심만 간결히 요약하라. 사실·결정·미해결 항목은 보존하고, 인사·잡담·메타발화는 제외한다. 한국어 대화는 한국어로 요약한다.${
			seed ? `\n\n참고(결정론 초안): ${seed}` : ""
		}\n\n대화:\n${transcript}\n\n요약(평문, 군더더기 없이):`;

		try {
			const res = await fetch(`${baseURL}chat/completions`, {
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
					max_tokens: 1024,
					temperature: 0.2,
				}),
				...(input.signal ? { signal: input.signal } : {}),
			});
			if (!res.ok) return seed; // 비-OK → 결정론 recap 폴백
			const data = (await res.json()) as {
				choices?: Array<{ message?: { content?: unknown } }>;
			};
			const content = data?.choices?.[0]?.message?.content;
			const polished = typeof content === "string" ? content.trim() : "";
			return polished || seed;
		} catch {
			return seed; // 네트워크/abort 실패 = 무손실 폴백
		}
	};
}
