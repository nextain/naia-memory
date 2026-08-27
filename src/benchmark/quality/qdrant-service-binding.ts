import { createHash } from "node:crypto";
import {
	constants,
	closeSync,
	fstatSync,
	openSync,
	realpathSync,
	statfsSync,
} from "node:fs";
import { isAbsolute, relative } from "node:path";

export const QDRANT_STORAGE_DESTINATION = "/qdrant/storage";
export const MIRACL_EN_QDRANT_CONTAINER_NAME = "naia-memory-qdrant-miracl-en";
export const MIRACL_EN_QDRANT_MINIMUM_FREE_BYTES = 500 * 1024 ** 3;
export const MIRACL_AR_QDRANT_PORT = "6334";

interface PodmanMount {
	Source: string;
	Destination: string;
	RW: boolean;
}

interface PodmanPortBinding {
	HostIp: string;
	HostPort: string;
}

export interface PodmanInspect {
	Id: string;
	ImageDigest: string;
	ImageName: string;
	Name: string;
	State: { Running: boolean; StartedAt: string };
	Mounts: PodmanMount[];
	HostConfig: {
		PortBindings: Record<string, PodmanPortBinding[] | null>;
	};
}

export interface QdrantServiceIdentity {
	version: string;
	commit: string;
}

export interface QdrantServiceBindingReceipt {
	schemaVersion: 1;
	capturedAt: string;
	qdrantUrl: string;
	container: {
		id: string;
		name: string;
		imageName: string;
		imageDigest: string;
		startedAt: string;
	};
	storage: {
		hostPath: string;
		destination: typeof QDRANT_STORAGE_DESTINATION;
		device: string;
		freeBytes: number;
		totalBytes: number;
		minimumFreeBytes: number;
	};
	service: QdrantServiceIdentity;
}

export function parseQdrantServiceBindingReceipt(
	value: unknown,
): QdrantServiceBindingReceipt {
	const receipt = value as Partial<QdrantServiceBindingReceipt>;
	if (
		receipt.schemaVersion !== 1 ||
		typeof receipt.capturedAt !== "string" ||
		typeof receipt.qdrantUrl !== "string" ||
		typeof receipt.container?.id !== "string" ||
		typeof receipt.container.name !== "string" ||
		typeof receipt.container.imageName !== "string" ||
		typeof receipt.container.imageDigest !== "string" ||
		typeof receipt.container.startedAt !== "string" ||
		typeof receipt.storage?.hostPath !== "string" ||
		receipt.storage.destination !== QDRANT_STORAGE_DESTINATION ||
		typeof receipt.storage.device !== "string" ||
		!Number.isSafeInteger(receipt.storage.freeBytes) ||
		!Number.isSafeInteger(receipt.storage.totalBytes) ||
		!Number.isSafeInteger(receipt.storage.minimumFreeBytes) ||
		typeof receipt.service?.version !== "string" ||
		typeof receipt.service.commit !== "string"
	)
		throw new Error("Qdrant service binding receipt shape is invalid");
	if (
		(receipt.storage.freeBytes as number) < 0 ||
		(receipt.storage.totalBytes as number) <
			(receipt.storage.freeBytes as number) ||
		(receipt.storage.minimumFreeBytes as number) < 1
	)
		throw new Error("Qdrant service binding receipt storage is invalid");
	assertHexDigest(receipt.container.imageDigest);
	exactLoopbackUrl(receipt.qdrantUrl);
	return receipt as QdrantServiceBindingReceipt;
}

function assertHexDigest(value: string): void {
	if (!/^sha256:[0-9a-f]{64}$/u.test(value))
		throw new Error("Qdrant container image digest is not immutable");
}

function exactLoopbackUrl(qdrantUrl: string): { port: string } {
	const parsed = new URL(qdrantUrl);
	if (
		parsed.protocol !== "http:" ||
		parsed.hostname !== "127.0.0.1" ||
		parsed.pathname !== "/" ||
		parsed.search !== "" ||
		parsed.hash !== "" ||
		!parsed.port
	)
		throw new Error("Qdrant URL must be an explicit loopback HTTP port");
	return { port: parsed.port };
}

function isWithin(path: string, root: string): boolean {
	const child = relative(root, path);
	return child !== "" && !child.startsWith("..") && !isAbsolute(child);
}

export function parsePodmanInspect(value: unknown): PodmanInspect {
	if (!Array.isArray(value) || value.length !== 1)
		throw new Error("Podman inspect must contain exactly one container");
	const inspect = value[0] as Partial<PodmanInspect>;
	if (
		typeof inspect.Id !== "string" ||
		!/^[0-9a-f]{64}$/u.test(inspect.Id) ||
		typeof inspect.ImageDigest !== "string" ||
		typeof inspect.ImageName !== "string" ||
		typeof inspect.Name !== "string" ||
		inspect.State?.Running !== true ||
		typeof inspect.State.StartedAt !== "string" ||
		!Array.isArray(inspect.Mounts) ||
		!inspect.HostConfig?.PortBindings
	)
		throw new Error("Podman inspect does not describe one live container");
	assertHexDigest(inspect.ImageDigest);
	return inspect as PodmanInspect;
}

function resolveStorageMount(
	inspect: PodmanInspect,
	allowedStorageRoot: string,
): { hostPath: string; device: string; freeBytes: number; totalBytes: number } {
	const mounts = inspect.Mounts.filter(
		(mount) => mount.Destination === QDRANT_STORAGE_DESTINATION,
	);
	if (mounts.length !== 1 || mounts[0]?.RW !== true)
		throw new Error(
			"Qdrant must have one read-write /qdrant/storage bind mount",
		);
	const hostPath = realpathSync(mounts[0].Source);
	const root = realpathSync(allowedStorageRoot);
	if (!isWithin(hostPath, root))
		throw new Error("Qdrant storage bind is outside the allowed storage root");
	const descriptor = openSync(
		hostPath,
		constants.O_RDONLY | constants.O_DIRECTORY,
	);
	try {
		const filesystem = statfsSync(`/proc/self/fd/${descriptor}`, {
			bigint: true,
		});
		const freeBytesBig = filesystem.bavail * filesystem.bsize;
		const totalBytesBig = filesystem.blocks * filesystem.bsize;
		if (
			freeBytesBig > BigInt(Number.MAX_SAFE_INTEGER) ||
			totalBytesBig > BigInt(Number.MAX_SAFE_INTEGER)
		)
			throw new Error("Qdrant filesystem size exceeds the safe integer range");
		return {
			hostPath,
			device: fstatSync(descriptor, { bigint: true }).dev.toString(),
			freeBytes: Number(freeBytesBig),
			totalBytes: Number(totalBytesBig),
		};
	} finally {
		closeSync(descriptor);
	}
}

function verifyPortBinding(inspect: PodmanInspect, qdrantUrl: string): void {
	const { port } = exactLoopbackUrl(qdrantUrl);
	if (port === MIRACL_AR_QDRANT_PORT)
		throw new Error("English Qdrant must not use the reserved Arabic port");
	const bindings = inspect.HostConfig.PortBindings["6333/tcp"];
	const exposedPorts = Object.entries(inspect.HostConfig.PortBindings).filter(
		([, portBindings]) => portBindings !== null && portBindings.length > 0,
	);
	if (
		exposedPorts.length !== 1 ||
		exposedPorts[0]?.[0] !== "6333/tcp" ||
		!bindings ||
		bindings.length !== 1 ||
		bindings[0]?.HostIp !== "127.0.0.1" ||
		bindings[0].HostPort !== port
	)
		throw new Error("Qdrant container port does not match the loopback URL");
}

export function verifyQdrantServiceReceiptChain(input: {
	language: string;
	launchReceiptSha256?: string | null;
	resultReceiptSha256?: string | null;
}): void {
	if (input.language !== "en") return;
	if (
		!input.launchReceiptSha256 ||
		!/^[0-9a-f]{64}$/u.test(input.launchReceiptSha256) ||
		input.resultReceiptSha256 !== input.launchReceiptSha256
	)
		throw new Error("English Qdrant service receipt chain mismatch");
}

export function createQdrantServiceBindingReceipt(input: {
	inspect: PodmanInspect;
	qdrantUrl: string;
	allowedStorageRoot: string;
	minimumFreeBytes: number;
	service: QdrantServiceIdentity;
	capturedAt: string;
}): QdrantServiceBindingReceipt {
	if (
		!Number.isSafeInteger(input.minimumFreeBytes) ||
		input.minimumFreeBytes < 1
	)
		throw new Error("minimum free bytes must be a positive safe integer");
	if (input.inspect.Name !== MIRACL_EN_QDRANT_CONTAINER_NAME)
		throw new Error("Qdrant container is not reserved for MIRACL English");
	if (!/^(?:docker\.io\/)?qdrant\/qdrant[:@]/u.test(input.inspect.ImageName))
		throw new Error(
			"Qdrant container does not use the official image repository",
		);
	verifyPortBinding(input.inspect, input.qdrantUrl);
	const storage = resolveStorageMount(input.inspect, input.allowedStorageRoot);
	if (storage.freeBytes < input.minimumFreeBytes)
		throw new Error(
			"Qdrant storage does not meet the minimum free-space floor",
		);
	if (!input.service.version || !input.service.commit)
		throw new Error("Qdrant service identity is incomplete");
	return {
		schemaVersion: 1,
		capturedAt: input.capturedAt,
		qdrantUrl: input.qdrantUrl,
		container: {
			id: input.inspect.Id,
			name: input.inspect.Name,
			imageName: input.inspect.ImageName,
			imageDigest: input.inspect.ImageDigest,
			startedAt: input.inspect.State.StartedAt,
		},
		storage: {
			...storage,
			destination: QDRANT_STORAGE_DESTINATION,
			minimumFreeBytes: input.minimumFreeBytes,
		},
		service: input.service,
	};
}

export function verifyLiveQdrantServiceBinding(input: {
	receipt: QdrantServiceBindingReceipt;
	inspect: PodmanInspect;
	allowedStorageRoot: string;
	service: QdrantServiceIdentity;
	requiredMinimumFreeBytes: number;
}): void {
	if (input.receipt.storage.minimumFreeBytes !== input.requiredMinimumFreeBytes)
		throw new Error("Qdrant service binding free-space policy was changed");
	const recreated = createQdrantServiceBindingReceipt({
		inspect: input.inspect,
		qdrantUrl: input.receipt.qdrantUrl,
		allowedStorageRoot: input.allowedStorageRoot,
		minimumFreeBytes: input.requiredMinimumFreeBytes,
		service: input.service,
		capturedAt: input.receipt.capturedAt,
	});
	if (
		recreated.container.id !== input.receipt.container.id ||
		recreated.container.name !== input.receipt.container.name ||
		recreated.container.imageName !== input.receipt.container.imageName ||
		recreated.container.imageDigest !== input.receipt.container.imageDigest ||
		recreated.container.startedAt !== input.receipt.container.startedAt ||
		recreated.storage.hostPath !== input.receipt.storage.hostPath ||
		recreated.storage.device !== input.receipt.storage.device ||
		recreated.service.version !== input.receipt.service.version ||
		recreated.service.commit !== input.receipt.service.commit
	)
		throw new Error("live Qdrant service does not match its binding receipt");
}

export function verifyQdrantServiceCompletionBinding(input: {
	receipt: QdrantServiceBindingReceipt;
	qdrantUrl: string;
	service: QdrantServiceIdentity;
}): void {
	if (input.receipt.qdrantUrl !== input.qdrantUrl)
		throw new Error("Qdrant completion URL does not match its service receipt");
	if (
		input.receipt.service.version !== input.service.version ||
		input.receipt.service.commit !== input.service.commit
	)
		throw new Error(
			"Qdrant completion identity does not match its service receipt",
		);
}

export function qdrantServiceBindingSha256(
	receipt: QdrantServiceBindingReceipt,
): string {
	return createHash("sha256")
		.update(`${JSON.stringify(receipt, null, 2)}\n`)
		.digest("hex");
}
