import { createHash } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";

interface VectorCacheManifest {
	version: 1;
	corpusSha256: string;
	embeddingSpaceId: string;
	dims: number;
	vectorCount: number;
	binarySha256: string;
}

export function vectorCacheKey(options: {
	corpusSha256: string;
	embeddingSpaceId: string;
	dims: number;
}): string {
	const identity = {
		corpusSha256: options.corpusSha256,
		embeddingSpaceId: options.embeddingSpaceId,
		dims: options.dims,
	};
	return createHash("sha256")
		.update(JSON.stringify(identity))
		.digest("hex")
		.slice(0, 24);
}

export function loadVectorCache(options: {
	directory: string;
	language: string;
	corpusSha256: string;
	embeddingSpaceId: string;
	dims: number;
	vectorCount: number;
}): Float32Array | null {
	const key = vectorCacheKey(options);
	const prefix = join(options.directory, `${options.language}-${key}`);
	const manifestPath = `${prefix}.json`;
	const binaryPath = `${prefix}.f32`;
	if (!existsSync(manifestPath) || !existsSync(binaryPath)) return null;
	const manifest = JSON.parse(
		readFileSync(manifestPath, "utf8"),
	) as VectorCacheManifest;
	if (
		manifest.version !== 1 ||
		manifest.corpusSha256 !== options.corpusSha256 ||
		manifest.embeddingSpaceId !== options.embeddingSpaceId ||
		manifest.dims !== options.dims ||
		manifest.vectorCount !== options.vectorCount
	) {
		return null;
	}
	const binary = readFileSync(binaryPath);
	if (binary.byteLength !== options.vectorCount * options.dims * 4) return null;
	if (
		createHash("sha256").update(binary).digest("hex") !== manifest.binarySha256
	) {
		return null;
	}
	const vectors = new Float32Array(options.vectorCount * options.dims);
	new Uint8Array(vectors.buffer).set(binary);
	return vectors;
}

export function saveVectorCache(options: {
	directory: string;
	language: string;
	corpusSha256: string;
	embeddingSpaceId: string;
	dims: number;
	vectorCount: number;
	vectors: Float32Array;
}): void {
	if (options.vectors.length !== options.vectorCount * options.dims) {
		throw new Error("vector cache shape mismatch");
	}
	mkdirSync(options.directory, { recursive: true });
	const key = vectorCacheKey(options);
	const prefix = join(options.directory, `${options.language}-${key}`);
	const binaryPath = `${prefix}.f32`;
	const manifestPath = `${prefix}.json`;
	const binaryTemporary = `${binaryPath}.${process.pid}.tmp`;
	const manifestTemporary = `${manifestPath}.${process.pid}.tmp`;
	const binary = Buffer.from(
		options.vectors.buffer,
		options.vectors.byteOffset,
		options.vectors.byteLength,
	);
	writeFileSync(binaryTemporary, binary, { mode: 0o600 });
	renameSync(binaryTemporary, binaryPath);
	const manifest: VectorCacheManifest = {
		version: 1,
		corpusSha256: options.corpusSha256,
		embeddingSpaceId: options.embeddingSpaceId,
		dims: options.dims,
		vectorCount: options.vectorCount,
		binarySha256: createHash("sha256").update(binary).digest("hex"),
	};
	writeFileSync(manifestTemporary, `${JSON.stringify(manifest, null, 2)}\n`, {
		mode: 0o600,
	});
	renameSync(manifestTemporary, manifestPath);
}
