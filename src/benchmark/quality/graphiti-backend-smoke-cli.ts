import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { runGraphitiBackendSmoke } from "./graphiti-backend-smoke.js";
import { GraphitiRestSemanticClient } from "./graphiti-rest-semantic-client.js";

const baseUrl = process.env.GRAPHITI_BENCHMARK_URL;
if (!baseUrl) throw new Error("GRAPHITI_BENCHMARK_URL is required");

const result = await runGraphitiBackendSmoke(
	new GraphitiRestSemanticClient({ baseUrl }),
);
const serialized = `${JSON.stringify(result, null, 2)}\n`;
const outputPath = process.argv[2];
if (outputPath) await writeFile(resolve(outputPath), serialized, "utf8");
process.stdout.write(serialized);
if (!result.passed) process.exitCode = 1;
