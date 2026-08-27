import { randomUUID } from "node:crypto";
import {
	constants,
	closeSync,
	fsyncSync,
	mkdirSync,
	openSync,
	renameSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";

interface AtomicFileOps {
	close(fd: number): void;
	fsync(fd: number): void;
	mkdir(path: string): void;
	open(path: string, flags: number, mode?: number): number;
	rename(from: string, to: string): void;
	unlink(path: string): void;
	write(fd: number, data: string): void;
}

const nodeFileOps: AtomicFileOps = {
	close: closeSync,
	fsync: fsyncSync,
	mkdir: (path) => mkdirSync(path, { recursive: true }),
	open: openSync,
	rename: renameSync,
	unlink: unlinkSync,
	write: (fd, data) => writeFileSync(fd, data, "utf8"),
};

export class AtomicReplaceCommittedError extends Error {
	readonly committed = true;

	constructor(cause: unknown) {
		super("File replacement committed but directory sync failed", { cause });
		this.name = "AtomicReplaceCommittedError";
	}
}

/**
 * Replace a file without exposing partial JSON at the target path.
 *
 * The temp file is data-synced before rename. On POSIX, the parent directory is
 * synced after rename so the new directory entry survives a power loss.
 */
export function atomicReplaceFileSync(
	targetPath: string,
	data: string,
	ops: AtomicFileOps = nodeFileOps,
	platform = process.platform,
): void {
	const directory = dirname(targetPath);
	ops.mkdir(directory);
	const temporaryPath = join(
		directory,
		`.${basename(targetPath)}.${randomUUID()}.tmp`,
	);
	let temporaryFd: number | undefined;
	let renamed = false;

	try {
		temporaryFd = ops.open(
			temporaryPath,
			constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL,
			0o600,
		);
		ops.write(temporaryFd, data);
		ops.fsync(temporaryFd);
		ops.close(temporaryFd);
		temporaryFd = undefined;
		ops.rename(temporaryPath, targetPath);
		renamed = true;

		if (platform !== "win32") {
			let directoryFd: number | undefined;
			let directorySyncError: unknown;
			try {
				directoryFd = ops.open(
					directory,
					constants.O_RDONLY | (constants.O_DIRECTORY ?? 0),
				);
				ops.fsync(directoryFd);
			} catch (error) {
				directorySyncError = error;
			} finally {
				if (directoryFd !== undefined) {
					try {
						ops.close(directoryFd);
					} catch (error) {
						directorySyncError ??= error;
					}
				}
			}
			if (directorySyncError !== undefined)
				throw new AtomicReplaceCommittedError(directorySyncError);
		}
	} finally {
		if (temporaryFd !== undefined) {
			try {
				ops.close(temporaryFd);
			} catch {
				// Preserve the original write/sync failure.
			}
		}
		if (!renamed) {
			try {
				ops.unlink(temporaryPath);
			} catch {
				// The temp may not have been created; never mask the primary failure.
			}
		}
	}
}

export type { AtomicFileOps };
