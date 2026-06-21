import { readFileSync } from "node:fs";
import { join } from "node:path";

async function embed(text: string, provider: "google" | "vllm") {
	// ⚠️ 시크릿/내부 URL 은 env 로만 — 공개 레포에 하드코딩 금지(보안 리뷰 HIGH). 미설정 시 빈 값.
	const gwUrl = process.env.GATEWAY_EMBED_URL ?? "";
	const gwKey = process.env.GATEWAY_MASTER_KEY ?? "";

	if (provider === "google") {
		const res = await fetch(gwUrl, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${gwKey}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				model: "vertexai:text-embedding-004",
				input: [text],
			}),
		});
		const data = (await res.json()) as any;
		return data.data[0].embedding;
	} else {
		const base = process.env.VLLM_EMBED_BASE ?? "http://localhost:8001";
		const res = await fetch(`${base}/v1/embeddings`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				model: "Qwen/Qwen3-Embedding-0.6B",
				input: [text],
			}),
		});
		const data = (await res.json()) as any;
		return data.data[0].embedding;
	}
}

function cosineSimilarity(a: number[], b: number[]) {
	let dot = 0,
		normA = 0,
		normB = 0;
	for (let i = 0; i < a.length; i++) {
		dot += a[i] * b[i];
		normA += a[i] * a[i];
		normB += b[i] * b[i];
	}
	return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

async function runTest() {
	const facts = [
		"나는 김하늘이야. 스타트업 대표고 풀스택 개발자야",
		"에디터는 Neovim 쓰고 있어",
		"요즘은 주로 TypeScript로 개발하고 있어",
	];

	const queries = ["내 이름이 뭐야?", "나 뭐하는 사람이야?", "내 에디터 뭐야?"];

	console.log("🚀 Comparing Embedders: Google vs vLLM(qwen3-embedding)");

	for (let i = 0; i < queries.length; i++) {
		const q = queries[i];
		const f = facts[i];

		const simGoogle = cosineSimilarity(
			await embed(q, "google"),
			await embed(f, "google"),
		);
		const simVllm = cosineSimilarity(
			await embed(q, "vllm"),
			await embed(f, "vllm"),
		);

		console.log(`\nQuery: "${q}"`);
		console.log(`Fact : "${f}"`);
		console.log(
			` - Google Similarity: ${simGoogle.toFixed(4)} ${simGoogle >= 0.7 ? "✅" : "❌ (Blocked at 0.7)"}`,
		);
		console.log(
			` - vLLM Similarity: ${simVllm.toFixed(4)} ${simVllm >= 0.7 ? "✅" : "❌ (Blocked at 0.7)"}`,
		);
	}
}

runTest().catch(console.error);
