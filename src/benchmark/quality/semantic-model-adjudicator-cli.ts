import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const LABELS = new Set([
	"current",
	"stale",
	"deleted",
	"irrelevant",
	"uncertain",
]);
const SYSTEM_PROMPT = `You are a blind memory-retrieval adjudicator. The engine identity is hidden. For every retrieved memory, label its relationship to the user's final state and query: current (valid and useful now), stale (superseded), deleted (the user explicitly requested forgetting/removal), irrelevant, or uncertain. Judge only from the supplied conversation, query, and retrieved text. Return strict JSON matching the requested schema, preserve every ID exactly, and do not omit items.`;

type Packet = {
	packetContentSha256: string;
	samples: Array<{
		sampleId: string;
		language: string;
		turns: Array<{ content: string }>;
		query: string;
		retrieved: Array<{ memoryId: string; rank: number; content: string }>;
	}>;
};

function sha256(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}

function parseArgs(args: string[]): Map<string, string> {
	const values = new Map<string, string>();
	for (const arg of args) {
		const match = /^--([^=]+)=(.+)$/.exec(arg);
		if (!match || values.has(match[1]))
			throw new Error(`invalid argument: ${arg}`);
		values.set(match[1], match[2]);
	}
	for (const key of ["packet", "output"])
		if (!values.get(key)?.trim()) throw new Error(`--${key} is required`);
	if (
		[...values.keys()].some(
			(key) => !["packet", "output", "model", "batch-size"].includes(key),
		)
	)
		throw new Error("unknown model adjudicator argument");
	return values;
}

async function judgeBatch(
	apiKey: string,
	model: string,
	samples: Packet["samples"],
) {
	const response = await fetch(
		`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
		{
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				contents: [
					{
						role: "user",
						parts: [
							{ text: `${SYSTEM_PROMPT}\n\n${JSON.stringify({ samples })}` },
						],
					},
				],
				generationConfig: {
					temperature: 0,
					responseMimeType: "application/json",
					responseSchema: {
						type: "OBJECT",
						properties: {
							samples: {
								type: "ARRAY",
								items: {
									type: "OBJECT",
									properties: {
										sampleId: { type: "STRING" },
										judgments: {
											type: "ARRAY",
											items: {
												type: "OBJECT",
												properties: {
													memoryId: { type: "STRING" },
													label: { type: "STRING", enum: [...LABELS] },
													notes: { type: "STRING" },
												},
												required: ["memoryId", "label", "notes"],
											},
										},
									},
									required: ["sampleId", "judgments"],
								},
							},
						},
						required: ["samples"],
					},
				},
			}),
		},
	);
	if (!response.ok)
		throw new Error(
			`Gemini adjudication failed: ${response.status} ${await response.text()}`,
		);
	const body = (await response.json()) as {
		candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
	};
	const text = body.candidates?.[0]?.content?.parts?.[0]?.text;
	if (!text) throw new Error("Gemini adjudication returned no JSON text");
	return JSON.parse(text) as {
		samples: Array<{
			sampleId: string;
			judgments: Array<{ memoryId: string; label: string; notes: string }>;
		}>;
	};
}

export async function runSemanticModelAdjudicatorCli(
	args: string[],
): Promise<void> {
	const values = parseArgs(args);
	const apiKey = process.env.GEMINI_API_KEY;
	if (!apiKey) throw new Error("GEMINI_API_KEY is required");
	const packetPath = resolve(values.get("packet") as string);
	const output = resolve(values.get("output") as string);
	if (existsSync(output))
		throw new Error(`judgment output already exists: ${output}`);
	const packet = JSON.parse(readFileSync(packetPath, "utf8")) as Packet;
	const model = values.get("model") ?? "gemini-2.5-flash-lite";
	const batchSize = Number(values.get("batch-size") ?? "9");
	if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 25)
		throw new Error("--batch-size must be an integer from 1 to 25");
	const judged: Array<{
		sampleId: string;
		judgments: Array<{ memoryId: string; label: string; notes: string }>;
	}> = [];
	for (let offset = 0; offset < packet.samples.length; offset += batchSize) {
		const batch = packet.samples.slice(offset, offset + batchSize);
		const result = await judgeBatch(apiKey, model, batch);
		judged.push(...result.samples);
		process.stderr.write(
			`judged ${Math.min(offset + batchSize, packet.samples.length)}/${packet.samples.length}\n`,
		);
	}
	const byId = new Map(judged.map((sample) => [sample.sampleId, sample]));
	const isComplete = (sample: Packet["samples"][number]) => {
		const result = byId.get(sample.sampleId);
		if (!result || result.judgments.length !== sample.retrieved.length)
			return false;
		const expected = new Set(sample.retrieved.map((memory) => memory.memoryId));
		return (
			result.judgments.every(
				(judgment) =>
					expected.delete(judgment.memoryId) &&
					LABELS.has(judgment.label) &&
					typeof judgment.notes === "string",
			) && expected.size === 0
		);
	};
	for (const sample of packet.samples.filter((item) => !isComplete(item))) {
		const retry = await judgeBatch(apiKey, model, [sample]);
		if (retry.samples.length === 1) byId.set(sample.sampleId, retry.samples[0]);
		process.stderr.write(`retried ${sample.sampleId}\n`);
	}
	for (const sample of packet.samples) {
		const result = byId.get(sample.sampleId);
		if (!result || result.judgments.length !== sample.retrieved.length)
			throw new Error(`incomplete model judgments for ${sample.sampleId}`);
		const expected = new Set(sample.retrieved.map((memory) => memory.memoryId));
		for (const judgment of result.judgments)
			if (
				!expected.delete(judgment.memoryId) ||
				!LABELS.has(judgment.label) ||
				typeof judgment.notes !== "string"
			)
				throw new Error(`invalid model judgment for ${sample.sampleId}`);
		if (expected.size)
			throw new Error(`missing model judgment for ${sample.sampleId}`);
	}
	const adjudicatorId = `google-ai-studio/${model}`;
	const result = {
		schemaVersion: "naia-memory-semantic-judgments-v2",
		packetContentSha256: packet.packetContentSha256,
		adjudicators: [
			{
				id: adjudicatorId,
				kind: "model",
				languageCoverage: [
					...new Set(packet.samples.map((sample) => sample.language)),
				].sort(),
				completedAt: new Date().toISOString(),
				independentFromEngineImplementers: true,
				provider: "google-ai-studio",
				model,
				promptSha256: sha256(SYSTEM_PROMPT),
			},
		],
		samples: packet.samples.map((sample) => ({
			...byId.get(sample.sampleId),
			adjudicatorId,
		})),
	};
	const temporary = `${output}.${randomUUID()}.tmp`;
	writeFileSync(temporary, `${JSON.stringify(result, null, 2)}\n`, {
		flag: "wx",
		mode: 0o600,
	});
	renameSync(temporary, output);
	process.stdout.write(`${output}\n`);
}

const invokedPath = process.argv[1]
	? pathToFileURL(resolve(process.argv[1])).href
	: undefined;
if (invokedPath === import.meta.url)
	runSemanticModelAdjudicatorCli(process.argv.slice(2)).catch((error) => {
		process.stderr.write(
			`${error instanceof Error ? error.message : "model adjudication failed"}\n`,
		);
		process.exitCode = 1;
	});
