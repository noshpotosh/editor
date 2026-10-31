/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { joinPath } from '../../../base/common/resources.js';
import { URI } from '../../../base/common/uri.js';

/** Identifies a speculative shell that the renderer can assign to its active session. */
export const TERMINAL_FIRST_PRESPAWN_OWNER = 'vs-nosh.prespawn';

/** Shared CLI environment; the renderer may pass resolver expressions in place of literal values. */
export function terminalFirstShellEnvironment(binPath: string, globalStorageHome: URI, windowId: number, execPath: string, path: string): Record<string, string> {
	return {
		PATH: `${binPath}:${path}`,
		TERMINAL_FIRST_NODE: execPath,
		TERMINAL_FIRST_CLI_POINTER: joinPath(globalStorageHome, 'vscode.terminal-first', `window-${windowId}.json`).fsPath,
	};
}
