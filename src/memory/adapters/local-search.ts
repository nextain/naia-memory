import { tokenize as koTokenize } from "../ko-normalize.js";

export function assocKey(a: string, b: string): string {
	const sorted = [a.toLowerCase(), b.toLowerCase()].sort();
	return `${sorted[0]}::${sorted[1]}`;
}

export function tokenize(text: string): string[] {
	if (/[가-힣]/.test(text)) return koTokenize(text);
	return text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter((t) => t.length > 1);
}

/** Cosine similarity with guards for malformed or degenerate vectors. */
export function cosineSimilarity(a: number[], b: number[]): number {
	if (a.length !== b.length || a.length === 0) return 0;
	let dot = 0;
	let normA = 0;
	let normB = 0;
	for (let i = 0; i < a.length; i++) {
		dot += a[i] * b[i];
		normA += a[i] * a[i];
		normB += b[i] * b[i];
	}
	const denom = Math.sqrt(normA) * Math.sqrt(normB);
	if (!Number.isFinite(denom) || denom === 0) return 0;
	const similarity = dot / denom;
	return Number.isNaN(similarity) ? 0 : similarity;
}

export class BM25 {
	private k1 = 1.2;
	private b = 0.75;
	private docTokens = new Map<string, string[]>();
	private avgDl = 0;
	private N = 0;
	private df = new Map<string, number>();

	index(docs: Map<string, string>): void {
		this.docTokens.clear(); this.df.clear(); this.N = docs.size;
		let totalLen = 0;
		for (const [id, text] of docs) {
			const tokens = tokenize(text); this.docTokens.set(id, tokens); totalLen += tokens.length;
			const seen = new Set<string>();
			for (const token of tokens) if (!seen.has(token)) { seen.add(token); this.df.set(token, (this.df.get(token) ?? 0) + 1); }
		}
		this.avgDl = this.N > 0 ? totalLen / this.N : 1;
	}

	score(query: string, docId: string): number {
		const queryTokens = tokenize(query); const docTokens = this.docTokens.get(docId);
		if (!docTokens || queryTokens.length === 0) return 0;
		const tfMap = new Map<string, number>();
		for (const token of docTokens) tfMap.set(token, (tfMap.get(token) ?? 0) + 1);
		let total = 0; const docLower = docTokens.join(" ");
		for (const queryToken of queryTokens) {
			let tf = tfMap.get(queryToken) ?? 0;
			if (tf === 0 && docLower.includes(queryToken)) tf = 0.8;
			if (tf === 0) continue;
			const df = this.df.get(queryToken) ?? 0;
			const idf = Math.log(1 + (this.N - df + 0.5) / (df + 0.5));
			total += idf * (tf * (this.k1 + 1)) / (tf + this.k1 * (1 - this.b + this.b * docTokens.length / this.avgDl));
		}
		return total;
	}
}

export function keywordScore(query: string, document: string): number {
	const queryTokens = tokenize(query); if (queryTokens.length === 0) return 0;
	const documentTokens = new Set(tokenize(document)); const lower = document.toLowerCase(); let hits = 0;
	for (const token of queryTokens) hits += documentTokens.has(token) ? 1 : lower.includes(token) ? 0.8 : 0;
	return hits / queryTokens.length;
}
