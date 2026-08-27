import { realpathSync, statSync } from "node:fs";
import { isAbsolute, relative } from "node:path";
import {
	MIRACL_AR_QDRANT_PORT,
	MIRACL_EN_QDRANT_CONTAINER_NAME,
	QDRANT_STORAGE_DESTINATION,
} from "./qdrant-service-binding.js";

export const MIRACL_EN_QDRANT_DEFAULT_PORT = "6344";
export const MIRACL_EN_QDRANT_IMAGE = `docker.io/qdrant/qdrant@sha256:${"0fb8897412abc81d1c0430a899b9a81eb8328aa634e7242d1bc804c1fe8fe863"}`;

export interface QdrantServiceLaunchPlan {
	schemaVersion: 1;
	claimBoundary: string;
	containerName: typeof MIRACL_EN_QDRANT_CONTAINER_NAME;
	qdrantUrl: string;
	storagePath: string;
	image: string;
	podmanArguments: string[];
}

function isStrictChild(path: string, root: string): boolean {
	const child = relative(root, path);
	return child !== "" && !child.startsWith("..") && !isAbsolute(child);
}

export function resolveEnglishQdrantLaunchStorage(
	storagePath: string,
	allowedStorageRoot = "/var/mnt/hdd",
): string {
	const root = realpathSync(allowedStorageRoot);
	const storage = realpathSync(storagePath);
	if (!statSync(storage).isDirectory() || !isStrictChild(storage, root))
		throw new Error(
			"English Qdrant storage must resolve to a directory inside the allowed root",
		);
	return storage;
}

export function createEnglishQdrantLaunchPlan(input: {
	storagePath: string;
	port?: string;
	image?: string;
	allowedStorageRoot?: string;
}): QdrantServiceLaunchPlan {
	const allowedStorageRoot = input.allowedStorageRoot ?? "/var/mnt/hdd";
	const port = input.port ?? MIRACL_EN_QDRANT_DEFAULT_PORT;
	const image = input.image ?? MIRACL_EN_QDRANT_IMAGE;
	if (
		!isAbsolute(input.storagePath) ||
		!isAbsolute(allowedStorageRoot) ||
		!isStrictChild(input.storagePath, allowedStorageRoot)
	)
		throw new Error(
			"English Qdrant storage must be an absolute child of the allowed root",
		);
	const numericPort = Number(port);
	if (
		!Number.isSafeInteger(numericPort) ||
		numericPort < 1 ||
		numericPort > 65_535 ||
		String(numericPort) !== port
	)
		throw new Error("English Qdrant port is invalid");
	if (port === MIRACL_AR_QDRANT_PORT)
		throw new Error("English Qdrant must not use the reserved Arabic port");
	if (!/^docker\.io\/qdrant\/qdrant@sha256:[0-9a-f]{64}$/u.test(image))
		throw new Error(
			"English Qdrant image must be an immutable official digest",
		);
	return {
		schemaVersion: 1,
		claimBoundary:
			"Launch plan only; does not prove the container was created, the service was bound, or retrieval was executed.",
		containerName: MIRACL_EN_QDRANT_CONTAINER_NAME,
		qdrantUrl: `http://127.0.0.1:${port}`,
		storagePath: input.storagePath,
		image,
		podmanArguments: [
			"run",
			"--detach",
			"--name",
			MIRACL_EN_QDRANT_CONTAINER_NAME,
			"--publish",
			`127.0.0.1:${port}:6333`,
			"--volume",
			`${input.storagePath}:${QDRANT_STORAGE_DESTINATION}:rw`,
			image,
		],
	};
}
