/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { terminalFirstEnabled } from './terminalFirst.js';

/**
 * Lifecycle phase values as the workbench contributions registry uses them
 * (`WorkbenchPhase.BlockRestore` is `LifecyclePhase.Ready`, `AfterRestored` is `LifecyclePhase.Restored`).
 * Mirrored here because the platform layer cannot import the workbench enums.
 */
const READY_PHASE = 2;
const RESTORED_PHASE = 3;

/**
 * Contributions that upstream creates synchronously before the workbench restores (BlockRestore)
 * but that a shell launch does not need before the first prompt. They are created after restore
 * instead. Only contributions whose work is self-contained belong here: nothing that registers
 * editor resolvers, content providers, or extension-point handlers that restore depends on.
 */
const DEFERRED_BLOCK_RESTORE_CONTRIBUTIONS = new Set<string>([
	'workbench.contrib.agentHostChatDebug',
	'workbench.contrib.codexStatusBarEntry',
	'workbench.contrib.chatPetContext',
]);

/**
 * Returns the phase a contribution is created in for this product. Identity outside VS NOSH.
 */
export function deferStartupContribution(id: string | undefined, phase: number): number {
	if (terminalFirstEnabled && id !== undefined && phase === READY_PHASE && DEFERRED_BLOCK_RESTORE_CONTRIBUTIONS.has(id)) {
		return RESTORED_PHASE;
	}
	return phase;
}

/** The contributions this product defers, for tests that pin the ids to their classes. */
export function deferredStartupContributionIds(): readonly string[] {
	return [...DEFERRED_BLOCK_RESTORE_CONTRIBUTIONS];
}
