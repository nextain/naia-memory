#!/usr/bin/env node
/**
 * M4 — Completion Evidence Guard (PreToolUse on Bash). 판정은 공통 코어(checkCompletion)에 위임.
 * 키워드·증거패턴은 설정 외부화(다국어). enforcement_level: off/advisory/enforced.
 * 커밋 메시지 추출: -m / heredoc / -F·--file(파일). 한계: 로컬은 1차 마찰 — 진짜 강제는 CI.
 * ESM.
 */
import fs from "fs";
import path from "path";
import { loadConfig, checkCompletion } from "./lib/self-trust-core.mjs";

function extractCommitMessage(cmd, root) {
	let msg = "";
	const flags = cmd.match(/-m\s+(["'])([\s\S]*?)\1/g);
	if (flags) msg += flags.join("\n");
	const here = cmd.match(/<<-?\s*['"]?(\w+)['"]?\s*\n([\s\S]*?)\n\1/);
	if (here) msg += "\n" + here[2];
	// -F <file> / --file <file> / --file=<file> (opencode 지적: -F 우회 차단)
	const fm = cmd.match(/(?:-F|--file)(?:=|\s+)(["']?)([^\s"']+)\1/);
	if (fm) {
		try {
			msg += "\n" + fs.readFileSync(path.resolve(root, fm[2]), "utf8");
		} catch {
			/* 파일 못 읽으면 무시 — CI가 최종 검증 */
		}
	}
	return msg;
}

async function main() {
	let input = "";
	for await (const c of process.stdin) input += c;
	let d;
	try {
		d = JSON.parse(input);
	} catch {
		process.exit(0);
	}
	if ((d.tool_name || "") !== "Bash") process.exit(0);
	const cmd = d.tool_input?.command || "";
	if (!/\bgit\s+commit\b/.test(cmd)) process.exit(0);

	const root = process.env.M4_PROJECT_ROOT || process.cwd();
	let cfg;
	try {
		cfg = loadConfig(root);
	} catch {
		process.exit(0); // fail-open
	}
	if (cfg.level === "off") process.exit(0);

	const r = checkCompletion(extractCommitMessage(cmd, root), cfg);
	if (r.ok) process.exit(0);

	const reason =
		"[M4] " + r.reason + " — AI 자가-완료 선언 금지. 완료는 증거로 증명하세요.\n" +
		"커밋 메시지에 'Verified: <테스트로그>' / 'Evidence: <산출물>' / 'Closes #<issue>' 중 하나를 포함.\n" +
		"(로컬 차단은 1차 마찰 — 최종 판정은 CI가 산출물을 재계산.)";

	if (cfg.level === "advisory") {
		process.stdout.write(JSON.stringify({ systemMessage: reason }));
		process.exit(0);
	}
	process.stdout.write(JSON.stringify({ decision: "block", reason }));
	process.exit(0);
}

main().catch(() => process.exit(0));
