import { randomBytes } from "node:crypto";
import { constants } from "node:fs";
import { link, open, unlink } from "node:fs/promises";
import { dirname } from "node:path";

export class PublicEvidenceFileTooLargeError extends Error {}

async function syncParentDirectory(path: string): Promise<void> {
	const directory = await open(dirname(path), constants.O_RDONLY);
	try {
		await directory.sync();
	} finally {
		await directory.close();
	}
}

/**
 * Publishes exact evidence bytes without replacing an existing final path.
 *
 * File and parent-directory fsync provide the intended crash-durability on
 * Linux/POSIX filesystems that implement directory fsync. Other platforms and
 * filesystems may provide weaker persistence guarantees and must not be
 * described as independently durable without qualification.
 */
export async function writeExclusiveEvidenceFile(
	path: string,
	bytes: Buffer,
	dependencies: {
		syncDirectory?: (path: string) => Promise<void>;
	} = {},
): Promise<void> {
	const temporary = `${path}.tmp-${randomBytes(12).toString("hex")}`;
	let created = false;
	try {
		const handle = await open(
			temporary,
			constants.O_WRONLY |
				constants.O_CREAT |
				constants.O_EXCL |
				constants.O_NOFOLLOW,
			0o600,
		);
		created = true;
		try {
			await handle.writeFile(bytes);
			await handle.sync();
		} finally {
			await handle.close();
		}
		await link(temporary, path);
		await (dependencies.syncDirectory ?? syncParentDirectory)(path);
	} finally {
		if (created) await unlink(temporary).catch(() => undefined);
	}
}

/** Reads at most maxBytes from one regular file without following a final symlink. */
export async function readBoundedEvidenceFile(
	path: string,
	maxBytes: number,
): Promise<Buffer> {
	const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
	try {
		const metadata = await handle.stat();
		if (!metadata.isFile())
			throw new Error("evidence path is not a regular file");
		if (metadata.size > maxBytes) throw new PublicEvidenceFileTooLargeError();
		const buffer = Buffer.alloc(maxBytes + 1);
		let offset = 0;
		while (offset <= maxBytes) {
			const { bytesRead } = await handle.read(
				buffer,
				offset,
				maxBytes + 1 - offset,
				null,
			);
			if (bytesRead === 0) break;
			offset += bytesRead;
		}
		if (offset > maxBytes) throw new PublicEvidenceFileTooLargeError();
		return Buffer.from(buffer.subarray(0, offset));
	} finally {
		await handle.close();
	}
}
