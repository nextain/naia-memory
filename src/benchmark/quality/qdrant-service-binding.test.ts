import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	MIRACL_EN_QDRANT_CONTAINER_NAME,
	createQdrantServiceBindingReceipt,
	parsePodmanInspect,
	parseQdrantServiceBindingReceipt,
	verifyLiveQdrantServiceBinding,
	verifyQdrantServiceCompletionBinding,
	verifyQdrantServiceReceiptChain,
} from "./qdrant-service-binding.js";

function fixture(storage: string) {
	return parsePodmanInspect([
		{
			Id: "a".repeat(64),
			ImageDigest: `sha256:${"b".repeat(64)}`,
			ImageName: "docker.io/qdrant/qdrant:v1.15.5",
			Name: MIRACL_EN_QDRANT_CONTAINER_NAME,
			State: { Running: true, StartedAt: "2026-08-23T00:00:00Z" },
			Mounts: [{ Source: storage, Destination: "/qdrant/storage", RW: true }],
			HostConfig: {
				PortBindings: {
					"6333/tcp": [{ HostIp: "127.0.0.1", HostPort: "6344" }],
				},
			},
		},
	]);
}

describe("Qdrant service storage binding", () => {
	it("binds a live immutable container, loopback port, and mounted filesystem", () => {
		const root = mkdtempSync(join(tmpdir(), "qdrant-binding-"));
		const storage = join(root, "en");
		mkdirSync(storage);
		const inspect = fixture(storage);
		const service = { version: "1.15.5", commit: "locked-commit" };
		const receipt = createQdrantServiceBindingReceipt({
			inspect,
			qdrantUrl: "http://127.0.0.1:6344",
			allowedStorageRoot: root,
			minimumFreeBytes: 1,
			service,
			capturedAt: "2026-08-23T00:00:01Z",
		});
		expect(receipt.storage.hostPath).toBe(storage);
		expect(() =>
			verifyLiveQdrantServiceBinding({
				receipt,
				inspect,
				allowedStorageRoot: root,
				service,
				requiredMinimumFreeBytes: 1,
			}),
		).not.toThrow();
	});

	it("rejects overlay storage, public ports, mutable images, and restart drift", () => {
		const root = mkdtempSync(join(tmpdir(), "qdrant-binding-"));
		const storage = join(root, "en");
		mkdirSync(storage);
		const service = { version: "1.15.5", commit: "locked-commit" };
		const make = () =>
			createQdrantServiceBindingReceipt({
				inspect: fixture(storage),
				qdrantUrl: "http://127.0.0.1:6344",
				allowedStorageRoot: root,
				minimumFreeBytes: 1,
				service,
				capturedAt: "2026-08-23T00:00:01Z",
			});
		expect(() =>
			createQdrantServiceBindingReceipt({
				inspect: fixture(storage),
				qdrantUrl: "http://0.0.0.0:6344",
				allowedStorageRoot: root,
				minimumFreeBytes: 1,
				service,
				capturedAt: "2026-08-23T00:00:01Z",
			}),
		).toThrow("loopback");
		const overlay = fixture(storage);
		overlay.Mounts = [];
		expect(() =>
			createQdrantServiceBindingReceipt({
				inspect: overlay,
				qdrantUrl: "http://127.0.0.1:6344",
				allowedStorageRoot: root,
				minimumFreeBytes: 1,
				service,
				capturedAt: "2026-08-23T00:00:01Z",
			}),
		).toThrow("read-write");
		const readOnly = fixture(storage);
		readOnly.Mounts[0].RW = false;
		expect(() =>
			createQdrantServiceBindingReceipt({
				inspect: readOnly,
				qdrantUrl: "http://127.0.0.1:6344",
				allowedStorageRoot: root,
				minimumFreeBytes: 1,
				service,
				capturedAt: "2026-08-23T00:00:01Z",
			}),
		).toThrow("read-write");
		const outsideRoot = mkdtempSync(join(tmpdir(), "qdrant-outside-"));
		expect(() =>
			createQdrantServiceBindingReceipt({
				inspect: fixture(outsideRoot),
				qdrantUrl: "http://127.0.0.1:6344",
				allowedStorageRoot: root,
				minimumFreeBytes: 1,
				service,
				capturedAt: "2026-08-23T00:00:01Z",
			}),
		).toThrow("outside the allowed storage root");
		const mutable = JSON.parse(JSON.stringify(fixture(storage)));
		mutable.ImageDigest = "latest";
		expect(() => parsePodmanInspect([mutable])).toThrow("immutable");
		const digestPinned = fixture(storage);
		digestPinned.ImageName = `docker.io/qdrant/qdrant@sha256:${"b".repeat(64)}`;
		expect(() =>
			createQdrantServiceBindingReceipt({
				inspect: digestPinned,
				qdrantUrl: "http://127.0.0.1:6344",
				allowedStorageRoot: root,
				minimumFreeBytes: 1,
				service,
				capturedAt: "2026-08-23T00:00:01Z",
			}),
		).not.toThrow();
		const receipt = make();
		const restarted = fixture(storage);
		restarted.State.StartedAt = "2026-08-23T00:02:00Z";
		expect(() =>
			verifyLiveQdrantServiceBinding({
				receipt,
				inspect: restarted,
				allowedStorageRoot: root,
				service,
				requiredMinimumFreeBytes: 1,
			}),
		).toThrow("does not match");
		const replaced = fixture(storage);
		replaced.Id = "replacement-container";
		expect(() =>
			verifyLiveQdrantServiceBinding({
				receipt,
				inspect: replaced,
				allowedStorageRoot: root,
				service,
				requiredMinimumFreeBytes: 1,
			}),
		).toThrow("does not match");
		const rerouted = fixture(storage);
		rerouted.HostConfig.PortBindings["6333/tcp"] = [
			{ HostIp: "127.0.0.1", HostPort: "6345" },
		];
		expect(() =>
			verifyLiveQdrantServiceBinding({
				receipt,
				inspect: rerouted,
				allowedStorageRoot: root,
				service,
				requiredMinimumFreeBytes: 1,
			}),
		).toThrow("port does not match");
		expect(() =>
			verifyLiveQdrantServiceBinding({
				receipt,
				inspect: fixture(storage),
				allowedStorageRoot: root,
				service: { ...service, commit: "different-commit" },
				requiredMinimumFreeBytes: 1,
			}),
		).toThrow("does not match");
		const sharedPort = fixture(storage);
		sharedPort.HostConfig.PortBindings["6333/tcp"] = [
			{ HostIp: "127.0.0.1", HostPort: "6334" },
		];
		expect(() =>
			createQdrantServiceBindingReceipt({
				inspect: sharedPort,
				qdrantUrl: "http://127.0.0.1:6334",
				allowedStorageRoot: root,
				minimumFreeBytes: 1,
				service,
				capturedAt: "2026-08-23T00:00:01Z",
			}),
		).toThrow("Arabic port");
		const extraExposure = fixture(storage);
		extraExposure.HostConfig.PortBindings["6334/tcp"] = [
			{ HostIp: "0.0.0.0", HostPort: "7334" },
		];
		expect(() =>
			createQdrantServiceBindingReceipt({
				inspect: extraExposure,
				qdrantUrl: "http://127.0.0.1:6344",
				allowedStorageRoot: root,
				minimumFreeBytes: 1,
				service,
				capturedAt: "2026-08-23T00:00:01Z",
			}),
		).toThrow("does not match");
		const tamperedFloor = {
			...receipt,
			storage: { ...receipt.storage, minimumFreeBytes: 0 },
		};
		expect(() =>
			verifyLiveQdrantServiceBinding({
				receipt: tamperedFloor,
				inspect: fixture(storage),
				allowedStorageRoot: root,
				service,
				requiredMinimumFreeBytes: 1,
			}),
		).toThrow("policy was changed");
	});

	it("requires the English launch and result to bind the same receipt", () => {
		const digest = "d".repeat(64);
		expect(() =>
			verifyQdrantServiceReceiptChain({
				language: "en",
				launchReceiptSha256: digest,
				resultReceiptSha256: digest,
			}),
		).not.toThrow();
		expect(() =>
			verifyQdrantServiceReceiptChain({
				language: "en",
				launchReceiptSha256: digest,
				resultReceiptSha256: "e".repeat(64),
			}),
		).toThrow("chain mismatch");
		expect(() =>
			verifyQdrantServiceReceiptChain({ language: "ar" }),
		).not.toThrow();
	});

	it("rejects a different service at completion even when the receipt chain hashes match", () => {
		const root = mkdtempSync(join(tmpdir(), "qdrant-binding-"));
		const storage = join(root, "en");
		mkdirSync(storage);
		const receipt = createQdrantServiceBindingReceipt({
			inspect: fixture(storage),
			qdrantUrl: "http://127.0.0.1:6344",
			allowedStorageRoot: root,
			minimumFreeBytes: 1,
			service: { version: "1.15.5", commit: "locked-commit" },
			capturedAt: "2026-08-23T00:00:01Z",
		});
		expect(() =>
			verifyQdrantServiceCompletionBinding({
				receipt,
				qdrantUrl: "http://127.0.0.1:6344",
				service: { version: "1.15.5", commit: "locked-commit" },
			}),
		).not.toThrow();
		expect(() =>
			verifyQdrantServiceCompletionBinding({
				receipt,
				qdrantUrl: "http://127.0.0.1:6345",
				service: receipt.service,
			}),
		).toThrow("completion URL");
		expect(() =>
			verifyQdrantServiceCompletionBinding({
				receipt,
				qdrantUrl: receipt.qdrantUrl,
				service: { ...receipt.service, commit: "replacement-service" },
			}),
		).toThrow("completion identity");
	});

	it("rejects incomplete or impossible storage evidence at the parse boundary", () => {
		const root = mkdtempSync(join(tmpdir(), "qdrant-binding-"));
		const storage = join(root, "en");
		mkdirSync(storage);
		const receipt = createQdrantServiceBindingReceipt({
			inspect: fixture(storage),
			qdrantUrl: "http://127.0.0.1:6344",
			allowedStorageRoot: root,
			minimumFreeBytes: 1,
			service: { version: "1.15.5", commit: "locked-commit" },
			capturedAt: "2026-08-23T00:00:01Z",
		});
		expect(() =>
			parseQdrantServiceBindingReceipt({
				...receipt,
				storage: { ...receipt.storage, device: undefined },
			}),
		).toThrow("shape is invalid");
		expect(() =>
			parseQdrantServiceBindingReceipt({
				...receipt,
				storage: {
					...receipt.storage,
					totalBytes: receipt.storage.freeBytes - 1,
				},
			}),
		).toThrow("storage is invalid");
	});
});
