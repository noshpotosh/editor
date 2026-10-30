/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../../base/common/event.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';

/** A named tile layout inside a session; every space shares the session's directory and shell. */
export interface ITerminalFirstSpace {
	readonly id: string;
	readonly name: string;
	readonly active: boolean;
	readonly dirty?: boolean;
}

export interface ITerminalFirstSession {
	readonly id: string;
	readonly title: string;
	readonly mode: 'shell' | 'editor';
	readonly dirty?: boolean;
	readonly active: boolean;
	readonly spaces: readonly ITerminalFirstSpace[];
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
	/** Prompts for a title for the active session. */
	renameSession(): Promise<void>;
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
	/** Asks for a directory and a space preset, then opens a new session in that directory with the preset applied. */
	newSessionFromPreset(): Promise<void>;
	/** Resolves `false` without opening anything when the session can no longer host the tile. */
	openTerminalTile(groupId: number): Promise<boolean>;
	selectSession(id: string): Promise<void>;
	closeSession(id: string): Promise<void>;
	switchTerminal(offset: number): Promise<void>;
	pickTerminal(): Promise<void>;
	/** Asks for a name, adds an empty space to the active session, shows it, and opens the New Tile picker. */
	newSpace(): Promise<void>;
	selectSpace(id: string): Promise<void>;
	/** Shows the active session's space at a 1-based index; out-of-range indexes do nothing. */
	selectSpaceAt(index: number): Promise<void>;
	/** Cycles the active session's spaces, wrapping around. */
	switchSpace(offset: number): Promise<void>;
	renameSpace(): Promise<void>;
	/** Closes a space (the active one by default) after save, discard, or cancel decisions; closing the last space leaves one empty space. */
	closeSpace(id?: string): Promise<void>;
	pickSpace(): Promise<void>;
	openFiles(fileURIs: string[], terminalSession: string, wait: boolean, cwd?: string): Promise<void>;
}
