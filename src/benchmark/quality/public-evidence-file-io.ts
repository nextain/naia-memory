import { constants } from "node:fs";
import { open } from "node:fs/promises";

export class PublicEvidenceFileTooLargeError extends Error {}

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
		const buffer = Buffer.allocUnsafe(maxBytes + 1);
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
