/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { KeyCode, KeyMod } from '../../../../base/common/keyCodes.js';
import { ContextKeyExpr } from '../../../../platform/contextkey/common/contextkey.js';
import { KeybindingsRegistry, KeybindingWeight } from '../../../../platform/keybinding/common/keybindingsRegistry.js';
import { TerminalFirstEnabledContext, TerminalFirstShellContext, TerminalFirstBrowserVisibleContext, TerminalFirstFloatingVisibleContext, TerminalFirstJumpListVisibleContext } from '../../../services/terminalFirst/common/terminalFirstPolicy.js';

/** The code workspace has keyboard focus and no floating tool or picker owns the keys. */
export const dockedNavigation = ContextKeyExpr.and(
	TerminalFirstEnabledContext,
	TerminalFirstShellContext.negate(),
	TerminalFirstBrowserVisibleContext.negate(),
	TerminalFirstFloatingVisibleContext.negate(),
	TerminalFirstJumpListVisibleContext.negate(),
	ContextKeyExpr.not('inQuickOpen'),
);

// Stay above extension defaults (including VSCodeVim), but below user overrides.
const weight = KeybindingWeight.ExternalExtension + 1000;
for (const [key, id] of [
	[KeyCode.KeyH, 'workbench.action.navigateLeft'],
	[KeyCode.KeyJ, 'workbench.action.navigateDown'],
	[KeyCode.KeyK, 'workbench.action.navigateUp'],
	[KeyCode.KeyL, 'workbench.action.navigateRight'],
] as const) {
	KeybindingsRegistry.registerKeybindingRule({
		id, weight, when: dockedNavigation,
		primary: KeyMod.CtrlCmd | key,
		mac: { primary: KeyMod.WinCtrl | key },
	});
}
