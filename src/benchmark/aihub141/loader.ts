/**
 * AI Hub 141 loader — zip file → AIHub141Conversation[].
 *
 * Reads the user-side AI Hub data path (env `AIHUB_141_PATH`) and unzips on
 * demand into a tmp scratch dir. Raw json is never committed to this repo.
 *
 * Usage:
 *   const conversations = await loadAIHub141({ split: "validation", level: 4, limit: 100 });
 */
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { AIHub141Conversation, AIHub141Session } from "./types.js";

export interface LoadOptions {
	/** "validation" or "training". Default: validation (smaller, fits 1-day budget). */
	split?: "validation" | "training";
	/** Session level: 2/3/4. Default: 4 (best for R2.3 multi-session). */
	level?: 2 | 3 | 4;
	/** Max conversations to return (random sample, deterministic seed). Default: 100. */
	limit?: number;
	/** Random seed for sampling. Default: 42. */
	seed?: number;
}

// Default location of the (user-supplied, never-committed) AI Hub 141 dataset.
// Override with env `AIHUB_141_PATH`. The dataset itself is licensed separately
// and must be downloaded by the user from AI Hub.
const DEFAULT_AIHUB_PATH = join(
	homedir(),
	"data/aihub/141.한국어멀티세션대화/141.한국어_멀티세션_대화/01-1.정식개방데이터",
);

function resolveZipPath(split: "validation" | "training", level: number): string {
	const root = process.env.AIHUB_141_PATH || DEFAULT_AIHUB_PATH;
	const dir =
		split === "validation"
			? "Validation/02.라벨링데이터"
			: "Training/02.라벨링데이터";
	const file =
		split === "validation"
			? `VL_session${level}.zip`
			: `TL_session${level}.zip`;
	return join(root, dir, file);
}

function resolveScratchDir(split: string, level: number): string {
	return join(tmpdir(), `aihub141-${split}-s${level}`);
}

function unzipIfNeeded(zipPath: string, scratchDir: string): void {
	if (existsSync(scratchDir) && readdirSync(scratchDir).length > 0) return;
	mkdirSync(scratchDir, { recursive: true });
	if (!existsSync(zipPath)) {
		throw new Error(
			`AI Hub 141 zip not found: ${zipPath}\nSet AIHUB_141_PATH env var to your AI Hub root.`,
		);
	}
	// AI Hub zip entries have leading `/` → unzip strips them and exits 1
	// (warning, not error). Tolerate exit 1 if files were actually extracted.
	try {
		execSync(`unzip -q -o "${zipPath}" -d "${scratchDir}"`, {
			stdio: ["ignore", "ignore", "ignore"],
		});
	} catch (e) {
		if (readdirSync(scratchDir).length === 0) throw e;
	}
}

/** Deterministic shuffle (seedable). */
function shuffle<T>(arr: T[], seed: number): T[] {
	const result = [...arr];
	let s = seed;
	for (let i = result.length - 1; i > 0; i--) {
		s = (s * 9301 + 49297) % 233280;
		const j = Math.floor((s / 233280) * (i + 1));
		[result[i], result[j]] = [result[j], result[i]];
	}
	return result;
}

function parseConversation(jsonPath: string): AIHub141Conversation | null {
	try {
		const raw = readFileSync(jsonPath, "utf-8");
		const d = JSON.parse(raw);
		const msID = d.multisessionInfo?.multisessionID;
		if (!msID) return null;
		const cl = d.personaInfo?.clInfo;
		const cp = d.personaInfo?.cpInfo;
		if (!cl || !cp) return null;
		const sessionsRaw: unknown = d.sessionInfo;
		if (!Array.isArray(sessionsRaw)) return null;
		const sessions: AIHub141Session[] = sessionsRaw.map((s: any) => ({
			prevSessionID: s.prevSessionID ?? null,
			prevTimeInfo: s.prevTimeInfo ?? { timeNum: null, timeUnit: null },
			nthSession: String(s.nthSession),
			numberOfUtterances: String(s.numberOfUtterances ?? "0"),
			numberOfTurns: String(s.numberOfTurns ?? "0"),
			sessionID: String(s.sessionID),
			dialog: Array.isArray(s.dialog) ? s.dialog : [],
			sessionPersonaSummary: s.sessionPersonaSummary ?? {
				speaker1: [],
				speaker2: [],
			},
			prevAggregatedpersonaSummary: s.prevAggregatedpersonaSummary ?? {
				speaker1: [],
				speaker2: [],
			},
		}));
		return {
			multisessionID: msID,
			topicType: d.topicInfo?.topicType ?? "",
			topicTitle: d.topicInfo?.topicTitle ?? "",
			speaker1Persona: {
				personaID: cl.personaID ?? "",
				personaFeatures: Array.isArray(cl.personaFeatures)
					? cl.personaFeatures
					: [],
				speakerType: cl.speakerType ?? "speaker1",
			},
			speaker2Persona: {
				personaID: cp.personaID ?? "",
				personaFeatures: Array.isArray(cp.personaFeatures)
					? cp.personaFeatures
					: [],
				speakerType: cp.speakerType ?? "speaker2",
			},
			sessions,
			sourceFile: jsonPath.split("/").pop() ?? "",
		};
	} catch {
		return null;
	}
}

export async function loadAIHub141(
	opts: LoadOptions = {},
): Promise<AIHub141Conversation[]> {
	const split = opts.split ?? "validation";
	const level = opts.level ?? 4;
	const limit = opts.limit ?? 100;
	const seed = opts.seed ?? 42;

	const zipPath = resolveZipPath(split, level);
	const scratch = resolveScratchDir(split, level);
	unzipIfNeeded(zipPath, scratch);

	const files = readdirSync(scratch)
		.filter((f) => f.endsWith(".json"))
		.map((f) => join(scratch, f));
	const sampled = shuffle(files, seed).slice(0, limit);

	const conversations: AIHub141Conversation[] = [];
	for (const f of sampled) {
		const conv = parseConversation(f);
		if (conv && conv.sessions.length >= 2) conversations.push(conv);
	}
	return conversations;
}
