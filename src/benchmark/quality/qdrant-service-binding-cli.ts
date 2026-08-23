#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import {
	MIRACL_EN_QDRANT_MINIMUM_FREE_BYTES,
	createQdrantServiceBindingReceipt,
	parsePodmanInspect,
} from "./qdrant-service-binding.js";

const PROBE_TIMEOUT_MS = 10_000;

const containerId = process.env.MIRACL_QDRANT_CONTAINER_ID;
const output = process.env.MIRACL_QDRANT_SERVICE_RECEIPT;
const qdrantUrl = process.env.QDRANT_URL;
if (!containerId || !output || !qdrantUrl)
	throw new Error(
		"MIRACL_QDRANT_CONTAINER_ID, MIRACL_QDRANT_SERVICE_RECEIPT, and QDRANT_URL are required",
	);
const inspect = parsePodmanInspect(
	JSON.parse(
		execFileSync("podman", ["inspect", containerId, "--format", "json"], {
			encoding: "utf8",
			timeout: PROBE_TIMEOUT_MS,
		}),
	) as unknown,
);
const response = await fetch(qdrantUrl, {
	redirect: "error",
	signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
});
if (!response.ok)
	throw new Error(`Qdrant identity request failed: ${response.status}`);
const service = (await response.json()) as {
	version?: unknown;
	commit?: unknown;
};
if (typeof service.version !== "string" || typeof service.commit !== "string")
	throw new Error("Qdrant identity response is incomplete");
const receipt = createQdrantServiceBindingReceipt({
	inspect,
	qdrantUrl,
	allowedStorageRoot: "/var/mnt/hdd",
	minimumFreeBytes: MIRACL_EN_QDRANT_MINIMUM_FREE_BYTES,
	service: { version: service.version, commit: service.commit },
	capturedAt: new Date().toISOString(),
});
const serialized = `${JSON.stringify(receipt, null, 2)}\n`;
writeFileSync(output, serialized, { flag: "wx", mode: 0o600 });
process.stdout.write(serialized);
