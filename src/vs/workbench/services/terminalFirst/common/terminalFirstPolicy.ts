/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { isMacintosh, isNative } from '../../../../base/common/platform.js';
import product from '../../../../platform/product/common/product.js';
import { RawContextKey } from '../../../../platform/contextkey/common/contextkey.js';

export const terminalFirstEnabled = isNative && isMacintosh && product.urlProtocol === 'terminal-first';
export const TerminalFirstFloatingEnabledContext = new RawContextKey<boolean>('terminalFirstFloatingEnabled', false);
export const TerminalFirstFloatingVisibleContext = new RawContextKey<boolean>('terminalFirstFloatingVisible', false);
export const TerminalFirstFloatingFocusedContext = new RawContextKey<boolean>('terminalFirstFloatingFocused', false);

export const TerminalFirstBrowserVisibleContext = new RawContextKey<boolean>('terminalFirstBrowserVisible', false);
export const TerminalFirstBrowserFocusedContext = new RawContextKey<boolean>('terminalFirstBrowserFocused', false);
export const TerminalFirstBrowserModeContext = new RawContextKey<string>('terminalFirstBrowserMode', '');

export const TerminalFirstJumpListVisibleContext = new RawContextKey<boolean>('terminalFirstJumpListVisible', false);
export const TerminalFirstJumpListFocusedContext = new RawContextKey<boolean>('terminalFirstJumpListFocused', false);

export const TerminalFirstShellContext = new RawContextKey<boolean>('terminalFirstShell', false);
export const TerminalFirstEnabledContext = new RawContextKey<boolean>('terminalFirstEnabled', terminalFirstEnabled);

/** Window-local presentation policy. Only the session controller changes the active surface. */
export const terminalFirstPolicy = {
	floatingVisible: false,
	mode: 'starting' as 'starting' | 'shell' | 'editor',
	get shell(): boolean { return terminalFirstEnabled && this.mode === 'shell'; },
};

/** Terminal interactions that do not create, split, move, or reveal workbench surfaces. */
export function isTerminalFirstInteraction(id: string): boolean {
	return /^workbench\.action\.terminal\.(copySelection|copyAndClearSelection|paste|pasteSelection|selectAll|clear|focusFind|findNext|findPrevious|hideFind|scroll|sendSequence|sizeToContentWidth)/.test(id);
}

export function isTerminalFirstCommandAllowed(id: string, mode = terminalFirstPolicy.mode, enabled = terminalFirstEnabled): boolean {
	if (!enabled) { return true; }
	if (id.startsWith('workbench.action.terminal.')) {
		return (mode !== 'editor' || terminalFirstPolicy.floatingVisible) && isTerminalFirstInteraction(id);
	}
	if (mode !== 'shell') { return true; }
	return !id.startsWith('workbench.') || ['workbench.action.reloadWindow', 'workbench.action.closeWindow', 'workbench.action.quit', 'workbench.action.toggleFullScreen', 'workbench.action.zoomIn', 'workbench.action.zoomOut', 'workbench.action.zoomReset'].includes(id);
}

// Creation permission is tied to one launch configuration, never a global async flag.
const sessionLaunches = new WeakSet<object>();
export function authorizeTerminalFirstLaunch(config: object): void { sessionLaunches.add(config); }
export function consumeTerminalFirstLaunch(config: object): boolean { return sessionLaunches.delete(config); }
