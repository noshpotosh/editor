/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../../base/common/event.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';

export interface ITerminalFirstSession {
	readonly id: string;
	readonly title: string;
	readonly mode: 'shell' | 'editor';
	readonly dirty?: boolean;
	readonly active: boolean;
}

export const ITerminalFirstService = createDecorator<ITerminalFirstService>('terminalFirstService');
export interface ITerminalFirstService {
	readonly _serviceBrand: undefined;
	readonly onDidChangeSessions: Event<void>;
	readonly sessions: readonly ITerminalFirstSession[];
	initialize(): Promise<void>;
	readonly floatingJumpListVisible: boolean;
	addToJumpList(): Promise<void>;
	toggleFloatingJumpList(): Promise<void>;
	/** Opens the jump list entry at a 1-based slot. */
	jumpToSlot(slot: number): Promise<void>;
	hideFloatingJumpList(focusEditor?: boolean): Promise<void>;
	readonly floatingFileBrowserVisible: boolean;
	toggleFloatingFileBrowser(): Promise<void>;
	hideFloatingFileBrowser(focusEditor?: boolean): Promise<void>;
	readonly floatingTerminalVisible: boolean;
	toggleFloatingTerminal(): Promise<void>;
	hideFloatingTerminal(focusEditor?: boolean): Promise<void>;
	toggle(): Promise<void>;
	showShell(): Promise<void>;
	showEditor(focus?: boolean): Promise<void>;
	newTerminal(): Promise<void>;
	/** Resolves `false` without opening anything when the session can no longer host the tile. */
	openTerminalTile(groupId: number): Promise<boolean>;
	selectSession(id: string): Promise<void>;
	closeSession(id: string): Promise<void>;
	switchTerminal(offset: number): Promise<void>;
	pickTerminal(): Promise<void>;
	openFiles(fileURIs: string[], terminalSession: string, wait: boolean, cwd?: string): Promise<void>;
}
