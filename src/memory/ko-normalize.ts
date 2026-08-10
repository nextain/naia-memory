/**
 * Korean tokenizer / normalizer (enhanced lite, no external dependency).
 *
 * R3.1: Expanded particles + verb ending normalization.
 * Used by BM25 in LocalAdapter for Korean-aware search.
 */

const KO_PARTICLES = new Set([
	"으므로", "으로써", "로써", "으로서", "로서",
	"에서부터", "까지도", "부터라도",
	"에게서", "한테서", "께서",
	"입니다", "이에요", "예요", "이야", "야",
	"습니다", "ㅂ니다",
	"에서", "에게", "한테", "께",
	"으로", "로서", "조차", "마저",
	"처럼", "보다", "까지", "부터",
	"이랑", "만이", "밖에", "뿐이",
	"지만", "면서", "고요",
	"은", "는", "이", "가", "을", "를",
	"에", "의", "와", "과", "랑",
	"도", "만", "부터", "까지",
	"으로", "로",
	"이다", "하고", "이며", "며",
	"마다", "이야",
	"고", "면", "어요", "아요", "지요",
]);

const ENDING_PATTERNS: [RegExp, string][] = [
	[/했어요$/, "하다"],
	[/했습니다$/, "하다"],
	[/했었어요$/, "하다"],
	[/했어$/, "하다"],
	[/했다$/, "하다"],
	[/하자$/, "하다"],
	[/할게$/, "하다"],
	[/해봐$/, "하다"],
	[/해요$/, "하다"],
	[/해$/, "하다"],
	[/먹었어요$/, "먹다"],
	[/먹었어$/, "먹다"],
	[/먹었다$/, "먹다"],
	[/먹어$/, "먹다"],
	[/갔어요$/, "가다"],
	[/갔어$/, "가다"],
	[/갔다$/, "가다"],
	[/가자$/, "가다"],
	[/왔어요$/, "오다"],
	[/왔어$/, "오다"],
	[/왔다$/, "오다"],
	[/봤어요$/, "보다"],
	[/봤어$/, "보다"],
	[/봤다$/, "보다"],
	[/였어요$/, "이다"],
	[/이었다$/, "이다"],
	[/있다$/, "있다"],
	[/없다$/, "없다"],
	[/니다$/, "다"],
];

const STOPWORDS = new Set([
	"것", "그", "이", "저", "그것", "이것",
	"있다", "없다", "되다", "하다", "있는",
	"같다", "그리고", "또는", "그런데",
	"어떤", "무슨", "어디", "언제", "누가",
	"매우", "정말", "진짜", "아주", "좀",
	"그냥", "아마", "항상", "보통",
	"이런", "저런", "그런", "어떤",
	"여기", "거기", "저기",
	"내", "네", "우리", "저희",
	"이", "그", "저",
]);

const PUNCT = /[.,!?;:'"`~()\[\]{}<>@#$%^&*+=\\/|~]/g;

export function stripParticle(token: string): string {
	for (const p of KO_PARTICLES) {
		if (token.endsWith(p) && token.length > p.length + 1) {
			return token.slice(0, -p.length);
		}
	}
	return token;
}

export function normalizeEnding(token: string): string {
	for (const [pattern, base] of ENDING_PATTERNS) {
		if (pattern.test(token)) {
			return token.replace(pattern, base);
		}
	}
	return token;
}

/**
 * Preserve a productive Korean compound while also exposing its searchable stem.
 *
 * Preference queries commonly use the noun form ("매운맛") while conversational
 * memories use the attributive form ("매운 거"). Keeping both tokens avoids
 * sacrificing exact compound matches and gives keyword-only recall a shared term.
 */
function expandCompound(token: string): string[] {
	if (token.endsWith("맛")) {
		const stem = token.slice(0, -1);
		if (stem.length >= 2) return [token, stem];
	}
	return [token];
}

export function tokenize(text: string): string[] {
	if (!text) return [];
	const cleaned = text.replace(PUNCT, " ").replace(/\s+/g, " ").trim();
	const raw = cleaned.split(" ");
	return raw
		.map((w) => w.toLowerCase())
		.map(stripParticle)
		.map(normalizeEnding)
		.flatMap(expandCompound)
		.filter((w) => w.length >= 2 && !STOPWORDS.has(w));
}

export function normalize(text: string): string {
	return tokenize(text).join(" ");
}
