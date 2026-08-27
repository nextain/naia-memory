import {
	type LifecycleOperation,
	type MemoryUpdateCase,
	type MemoryUpdateContract,
	validateMemoryUpdateContract,
} from "./memory-update-contract.js";

export type LifecycleState = {
	logicalId: string;
	content: string;
};

export type LifecycleEngineBridge = {
	readonly isolationPolicy: "fresh-case-state-v1";
	apply(operation: LifecycleOperation): Promise<void>;
	getActiveState(): Promise<LifecycleState[]>;
	close(): Promise<void>;
};

export type LifecycleEngineBridgeFactory = (
	benchmarkCase: MemoryUpdateCase,
) => Promise<LifecycleEngineBridge>;

export type LifecycleCaseReceipt = {
	caseId: string;
	activeIds: string[];
	missingExpectedIds: string[];
	forbiddenVisibleIds: string[];
	passed: boolean;
};

export async function runLifecycleContract(
	contract: MemoryUpdateContract,
	createBridge: LifecycleEngineBridgeFactory,
): Promise<LifecycleCaseReceipt[]> {
	validateMemoryUpdateContract(contract);
	if (contract.tier !== "lifecycle-conformance")
		throw new Error("lifecycle runner requires lifecycle-conformance tier");

	const receipts: LifecycleCaseReceipt[] = [];
	for (const benchmarkCase of contract.cases) {
		const bridge = await createBridge(benchmarkCase);
		try {
			if (bridge.isolationPolicy !== "fresh-case-state-v1")
				throw new Error("lifecycle bridge does not guarantee fresh case state");
			for (const operation of benchmarkCase.lifecycleOperations ?? [])
				await bridge.apply(operation);
			const state = await bridge.getActiveState();
			const activeIds = state.map((entry) => entry.logicalId);
			if (
				new Set(activeIds).size !== activeIds.length ||
				state.some((entry) => !entry.logicalId.trim() || !entry.content.trim())
			)
				throw new Error("lifecycle bridge returned invalid active state");
			const active = new Set(activeIds);
			const expected = [
				...benchmarkCase.expectedCurrentIds,
				...benchmarkCase.noUpdateIds,
			];
			const forbidden = [
				...benchmarkCase.forbiddenStaleIds,
				...benchmarkCase.expectedDeletedIds,
			];
			const missingExpectedIds = expected.filter((id) => !active.has(id));
			const forbiddenVisibleIds = forbidden.filter((id) => active.has(id));
			receipts.push({
				caseId: benchmarkCase.id,
				activeIds: [...activeIds].sort(),
				missingExpectedIds,
				forbiddenVisibleIds,
				passed:
					missingExpectedIds.length === 0 && forbiddenVisibleIds.length === 0,
			});
		} finally {
			await bridge.close();
		}
	}
	return receipts;
}
