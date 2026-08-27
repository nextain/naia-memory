import type { Epoch } from "../types.js";
import type { MemoryStore } from "./local-model.js";

export function upsertLocalEpoch(store: MemoryStore, epoch: Epoch): void {
	store.epochs ??= [];
	const index = store.epochs.findIndex(
		(candidate) => candidate.id === epoch.id || candidate.name === epoch.name,
	);
	if (index >= 0) store.epochs[index] = epoch;
	else store.epochs.push(epoch);
}

export function getLocalEpochs(store: MemoryStore): Epoch[] {
	return store.epochs ?? [];
}
