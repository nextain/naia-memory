import {
	createCipheriv,
	createDecipheriv,
	pbkdf2,
	randomBytes,
} from "node:crypto";
import { promisify } from "node:util";
import { type MemoryStore, normalizeMemoryStore } from "./local-model.js";

const pbkdf2Async = promisify(pbkdf2);
const HEADER_SIZE = 4 + 1 + 16 + 12 + 16;

export async function encodeLocalBackup(
	store: MemoryStore,
	password: string,
): Promise<Uint8Array> {
	if (!password) throw new Error("Password must not be empty");
	const plaintext = Buffer.from(JSON.stringify(store), "utf-8");
	const salt = randomBytes(16);
	const iv = randomBytes(12);
	const key = await pbkdf2Async(password, salt, 200_000, 32, "sha256");
	const cipher = createCipheriv("aes-256-gcm", key, iv, { authTagLength: 16 });
	const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
	return new Uint8Array(
		Buffer.concat([
			Buffer.from("NAIA", "ascii"),
			Buffer.from([0x01]),
			salt,
			iv,
			cipher.getAuthTag(),
			encrypted,
		]),
	);
}

export async function decodeLocalBackup(
	blob: Uint8Array,
	password: string,
): Promise<MemoryStore> {
	if (!password) throw new Error("Password must not be empty");
	const buf = Buffer.from(blob);
	if (buf.length <= HEADER_SIZE)
		throw new Error("Invalid backup blob: too short");
	if (buf.subarray(0, 4).toString("ascii") !== "NAIA") {
		throw new Error("Invalid backup blob: bad magic");
	}
	if (buf[4] !== 0x01) throw new Error(`Unsupported backup version: ${buf[4]}`);

	const key = await pbkdf2Async(
		password,
		buf.subarray(5, 21),
		200_000,
		32,
		"sha256",
	);
	let plaintext: Buffer;
	try {
		const decipher = createDecipheriv(
			"aes-256-gcm",
			key,
			buf.subarray(21, 33),
			{
				authTagLength: 16,
			},
		);
		decipher.setAuthTag(buf.subarray(33, 49));
		plaintext = Buffer.concat([
			decipher.update(buf.subarray(HEADER_SIZE)),
			decipher.final(),
		]);
	} catch {
		throw new Error("Decryption failed: wrong password or corrupted blob");
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(plaintext.toString("utf-8"));
	} catch {
		throw new Error("Invalid backup: JSON parse failed");
	}
	if (
		typeof parsed === "object" &&
		parsed !== null &&
		"version" in parsed &&
		parsed.version !== 1
	) {
		throw new Error(`Unsupported store version: ${parsed.version}`);
	}
	const store = normalizeMemoryStore(parsed);
	if (!store) {
		throw new Error("Invalid backup: store shape mismatch");
	}
	return store;
}
