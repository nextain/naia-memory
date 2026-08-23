import { createHash } from "node:crypto";

export const MIRACL_DATASET_REVISION =
	"5be20db9509754dadad47689368639fcec739c00";
export const MIRACL_CORPUS_REVISION =
	"d921ec7e349ce0d28daf30b2da9da5ee698bef0d";

export type MiraclEvidenceLanguage = "ko" | "en" | "ar";
export const MIRACL_PREREGISTERED_LANGUAGES = ["ko", "en", "ar"] as const;

export interface MiraclLanguageSelection {
	languages: MiraclEvidenceLanguage[];
	omittedPreregistered: MiraclEvidenceLanguage[];
	partial: boolean;
}

export function resolveMiraclLanguageSelection(
	args: readonly string[],
): MiraclLanguageSelection {
	const partial = args[0] === "--partial";
	const requested = partial ? args.slice(1) : args;
	if (partial && requested.length === 0)
		throw new Error("--partial requires at least one language");
	const languages =
		requested.length === 0
			? [...MIRACL_PREREGISTERED_LANGUAGES]
			: requested.map((language) => {
					if (
						!MIRACL_PREREGISTERED_LANGUAGES.includes(
							language as MiraclEvidenceLanguage,
						)
					)
						throw new Error(`unsupported MIRACL language: ${language}`);
					return language as MiraclEvidenceLanguage;
				});
	if (new Set(languages).size !== languages.length)
		throw new Error("duplicate MIRACL language");
	if (!partial && languages.length !== MIRACL_PREREGISTERED_LANGUAGES.length)
		throw new Error(
			"subset qualification requires --partial so omitted preregistered languages remain visible",
		);
	return {
		languages,
		omittedPreregistered: MIRACL_PREREGISTERED_LANGUAGES.filter(
			(language) => !languages.includes(language),
		),
		partial,
	};
}

export interface MiraclLanguageContract {
	language: MiraclEvidenceLanguage;
	role: "anchor" | "transfer";
	topics: { path: string; size: number; sha256: string; queryCount: number };
	qrels: { path: string; size: number; sha256: string };
	corpus: {
		directory: string;
		shardCount: number;
		manifestSha256: string;
		expectedDocumentCount?: number;
		expectedDocidsSha256?: string;
		expectedSourceLockSha256?: string;
	};
}

export const MIRACL_MULTILINGUAL_CONTRACT = {
	ko: {
		language: "ko",
		role: "anchor",
		topics: {
			path: "miracl-v1.0-ko/topics/topics.miracl-v1.0-ko-dev.tsv",
			size: 12_597,
			sha256:
				"a365552cfc997a8915e948a3b5994883f641e7c3f12b6af87bbfaf89729e32a8",
			queryCount: 213,
		},
		qrels: {
			path: "miracl-v1.0-ko/qrels/qrels.miracl-v1.0-ko-dev.tsv",
			size: 55_675,
			sha256:
				"88827ccc5b64e531b25f70eef30202d33daa9bfa3ac8cceadf5cdbd5ca5034df",
		},
		corpus: {
			directory: "miracl-corpus-v1.0-ko",
			shardCount: 3,
			expectedDocumentCount: 1_486_752,
			expectedDocidsSha256:
				"6024e30f6c7aed244a5451a9552163a86f74b4254775022f4d4829fcaa87e879",
			expectedSourceLockSha256:
				"742952715d6e31eaf9718f04c2bad0509c9d7c754210aa81d793a14430fbb69c",
			manifestSha256:
				"86a86e5958e106c2bb93ba0ea673fbf238bcf497397616db7657482279ba9d99",
		},
	},
	en: {
		language: "en",
		role: "transfer",
		topics: {
			path: "miracl-v1.0-en/topics/topics.miracl-v1.0-en-dev.tsv",
			size: 36_782,
			sha256:
				"25d9e6d17656674fd7aa3b67ee912c71545e664a842b147bfc17e9ff391db3da",
			queryCount: 799,
		},
		qrels: {
			path: "miracl-v1.0-en/qrels/qrels.miracl-v1.0-en-dev.tsv",
			size: 167_817,
			sha256:
				"a0af836c300e85088c4d73449492e2378280f967cac032853c9e11f3bc8a8d81",
		},
		corpus: {
			directory: "miracl-corpus-v1.0-en",
			shardCount: 66,
			manifestSha256:
				"1b75a8e0328c437c6cd89fd9d61a5fca2a4687bdda0dbea764ca6553e2cd707f",
		},
	},
	ar: {
		language: "ar",
		role: "transfer",
		topics: {
			path: "miracl-v1.0-ar/topics/topics.miracl-v1.0-ar-dev.tsv",
			size: 174_692,
			sha256:
				"10b534b889ec46e23df478eee09410ef2880d90d419644dfed5d05d39b57ece0",
			queryCount: 2_896,
		},
		qrels: {
			path: "miracl-v1.0-ar/qrels/qrels.miracl-v1.0-ar-dev.tsv",
			size: 572_724,
			sha256:
				"3670a7804dedd5a602dad0661f6adb1e65b197829d5571f428e0af7fc46aa313",
		},
		corpus: {
			directory: "miracl-corpus-v1.0-ar",
			shardCount: 5,
			expectedDocumentCount: 2_061_414,
			expectedDocidsSha256:
				"b81389dd2afad4d0273ec92c25f446b478cb41afb8327c162f8919d93b3c3659",
			expectedSourceLockSha256:
				"6f67a375d0bf8062fb6d591843052ab3555b1b5d69acdae164a83387dbaf71e1",
			manifestSha256:
				"935b72bf2efde49bf09132145d35137c6e442a19223c765795878464967da4a9",
		},
	},
} as const satisfies Record<MiraclEvidenceLanguage, MiraclLanguageContract>;

export interface MiraclCorpusManifestEntry {
	path: string;
	size: number;
	sha256: string;
}

export function parseHuggingFaceCorpusTree(
	language: MiraclEvidenceLanguage,
	value: unknown,
): MiraclCorpusManifestEntry[] {
	if (!Array.isArray(value))
		throw new Error(`MIRACL-${language} corpus tree is not an array`);
	const entries = value.map((item, index) => {
		if (typeof item !== "object" || item === null)
			throw new Error(`MIRACL-${language} corpus tree row ${index} is invalid`);
		const row = item as {
			path?: unknown;
			size?: unknown;
			lfs?: { oid?: unknown } | null;
		};
		if (
			typeof row.path !== "string" ||
			typeof row.size !== "number" ||
			typeof row.lfs?.oid !== "string"
		)
			throw new Error(
				`MIRACL-${language} corpus tree row ${index} lacks LFS identity`,
			);
		return { path: row.path, size: row.size, sha256: row.lfs.oid };
	});
	verifyMiraclCorpusManifest(language, entries);
	return entries.sort((left, right) =>
		left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
	);
}

export async function collectHuggingFaceTreePages(
	initialUrl: string,
	fetchPage: typeof fetch = fetch,
): Promise<unknown[]> {
	const rows: unknown[] = [];
	let next: string | null = initialUrl;
	const expectedOrigin = new URL(initialUrl).origin;
	const visited = new Set<string>();
	while (next) {
		const pageUrl = new URL(next);
		if (pageUrl.origin !== expectedOrigin)
			throw new Error(`corpus tree pagination left ${expectedOrigin}`);
		if (visited.has(pageUrl.href))
			throw new Error("corpus tree pagination cycle detected");
		visited.add(pageUrl.href);
		const response = await fetchPage(pageUrl, {
			signal: AbortSignal.timeout(60_000),
		});
		if (!response.ok)
			throw new Error(`${pageUrl.href}: HTTP ${response.status}`);
		const page = (await response.json()) as unknown;
		if (!Array.isArray(page))
			throw new Error(`${pageUrl.href}: tree page is not an array`);
		rows.push(...page);
		const match = response.headers
			.get("link")
			?.match(/<([^>]+)>;\s*rel="next"/);
		next = match ? new URL(match[1], pageUrl).href : null;
	}
	return rows;
}

export function canonicalMiraclCorpusManifest(
	entries: readonly MiraclCorpusManifestEntry[],
): string {
	return JSON.stringify(
		[...entries]
			.sort((left, right) =>
				left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
			)
			.map(({ path, size, sha256 }) => ({ path, size, sha256 })),
	);
}

export function verifyMiraclCorpusManifest(
	language: MiraclEvidenceLanguage,
	entries: readonly MiraclCorpusManifestEntry[],
): void {
	const contract = MIRACL_MULTILINGUAL_CONTRACT[language];
	if (entries.length !== contract.corpus.shardCount)
		throw new Error(`MIRACL-${language} corpus shard count mismatch`);
	const prefix = `${contract.corpus.directory}/docs-`;
	if (
		entries.some(
			(entry) =>
				!entry.path.startsWith(prefix) ||
				!entry.path.endsWith(".jsonl.gz") ||
				!Number.isSafeInteger(entry.size) ||
				entry.size <= 0 ||
				!/^[a-f0-9]{64}$/.test(entry.sha256),
		)
	)
		throw new Error(`MIRACL-${language} corpus manifest shape mismatch`);
	const digest = createHash("sha256")
		.update(canonicalMiraclCorpusManifest(entries))
		.update("\n")
		.digest("hex");
	if (digest !== contract.corpus.manifestSha256)
		throw new Error(`MIRACL-${language} corpus manifest digest mismatch`);
}

export function miraclExecutionNamespace(
	language: MiraclEvidenceLanguage,
	sourceLockSha256: string,
	embeddingPolicySha256: string,
): string {
	if (!/^[a-f0-9]{64}$/.test(sourceLockSha256))
		throw new Error("source lock SHA-256 is invalid");
	if (!/^[a-f0-9]{64}$/.test(embeddingPolicySha256))
		throw new Error("embedding policy SHA-256 is invalid");
	return `naia_miracl_${language}_${sourceLockSha256.slice(0, 8)}_${embeddingPolicySha256.slice(0, 8)}`;
}
