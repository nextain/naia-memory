import type { BackupCapable } from "./types.js";
import { MemorySystemCore } from "./memory-system-core.js";

/** Adapter-capability backup API, kept separate from consolidation policy. */
export abstract class MemorySystemBackup extends MemorySystemCore {
	/** Returns true if the current adapter supports encrypted backup. */
	supportsBackup(): boolean {
		return "export" in this.adapter && "import" in this.adapter;
	}

	async exportBackup(password: string): Promise<Uint8Array> {
		if (!this.supportsBackup()) {
			throw new Error("Current memory adapter does not support backup export");
		}
		return (this.adapter as unknown as BackupCapable).export(password);
	}

	async importBackup(blob: Uint8Array, password: string): Promise<void> {
		if (!this.supportsBackup()) {
			throw new Error("Current memory adapter does not support backup import");
		}
		return (this.adapter as unknown as BackupCapable).import(blob, password);
	}
}
