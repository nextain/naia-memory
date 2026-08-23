#!/usr/bin/env node
import { writeFileSync } from "node:fs";
import {
	createEnglishQdrantLaunchPlan,
	resolveEnglishQdrantLaunchStorage,
} from "./qdrant-service-launch-plan.js";

const storagePath = process.env.MIRACL_EN_QDRANT_STORAGE;
const output = process.env.MIRACL_EN_QDRANT_LAUNCH_PLAN;
if (!storagePath || !output)
	throw new Error(
		"MIRACL_EN_QDRANT_STORAGE and MIRACL_EN_QDRANT_LAUNCH_PLAN are required",
	);
const plan = createEnglishQdrantLaunchPlan({
	storagePath: resolveEnglishQdrantLaunchStorage(storagePath),
	port: process.env.MIRACL_EN_QDRANT_PORT,
	image: process.env.MIRACL_EN_QDRANT_IMAGE,
});
const serialized = `${JSON.stringify(plan, null, 2)}\n`;
writeFileSync(output, serialized, { flag: "wx", mode: 0o600 });
process.stdout.write(serialized);
