/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { KeyChord, KeyCode, KeyMod } from '../../../../base/common/keyCodes.js';
import { hasKey } from '../../../../base/common/types.js';
import { localize } from '../../../../nls.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { ContextKeyExpr, ContextKeyExpression } from '../../../../platform/contextkey/common/contextkey.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { IKeybindingService } from '../../../../platform/keybinding/common/keybinding.js';
import { KeybindingsRegistry, KeybindingWeight } from '../../../../platform/keybinding/common/keybindingsRegistry.js';
import { IListService, WorkbenchListFocusContextKey, WorkbenchListWidget, WorkbenchTreeFindOpen } from '../../../../platform/list/browser/listService.js';
import { IQuickInputService } from '../../../../platform/quickinput/common/quickInput.js';
import { IEditorGroupsService } from '../../../services/editor/common/editorGroupsService.js';
import { TerminalFirstViewTileContext, TerminalFirstVimEnabledContext } from '../../../services/terminalFirst/common/terminalFirstPolicy.js';
import { FilesExplorerFocusedContext } from '../../files/common/files.js';
import { VIEW_PANE_ID as SCM_VIEW_PANE_ID } from '../../scm/common/scm.js';
import { ITerminalFirstLeaderService } from './terminalFirstLeader.js';
import { ViewTileEditor } from './tileEditor.js';
import { runTileRowAction, showTileListActions } from './tileListActions.js';
import { dockedNavigation } from './terminalFirstNavigation.js';

/** A list inside a view tile has keyboard focus, native Vim is on, and no text input or find widget owns the keys. */
export const tileListFocus = ContextKeyExpr.and(dockedNavigation, TerminalFirstViewTileContext, TerminalFirstVimEnabledContext, WorkbenchListFocusContextKey, WorkbenchTreeFindOpen.negate());

/** Row action keys are opt-in because they act on files with a single keystroke. */
const listActionKeys = ContextKeyExpr.and(tileListFocus, ContextKeyExpr.equals('config.terminalFirst.vim.listActionKeys', true));

// Stay above extension defaults (including VSCodeVim), but below user overrides.
const weight = KeybindingWeight.ExternalExtension + 1000;

interface ITileListAction {
	readonly id: string;
	readonly label: string;
	/** Human-readable keys, shown when no keybinding resolves (chords). */
	readonly keys: string;
}

/** Every tile list action, in help order. */
export const tileListActions: ITileListAction[] = [];

function add(id: string, label: string, keys: string, bindings: readonly (number | { primary: number; mac: { primary: number } })[], handler: (accessor: ServicesAccessor, list: WorkbenchListWidget | undefined) => unknown, when: ContextKeyExpression | undefined = tileListFocus): void {
	tileListActions.push({ id, label, keys });
	const command = `terminalFirst.tileList.${id}`;
	KeybindingsRegistry.registerCommandAndKeybindingRule({ id: command, weight, when, primary: 0, handler: accessor => handler(accessor, accessor.get(IListService).lastFocusedList) });
	for (const binding of bindings) {
		KeybindingsRegistry.registerKeybindingRule({ id: command, weight, when, ...(typeof binding === 'number' ? { primary: binding } : binding) });
	}
}

/** Shift+F10 opens the row context menu through the list's own handler, so every view builds its own menu. */
function openContextMenu(list: WorkbenchListWidget | undefined): void {
	const element = list?.getHTMLElement();
	if (!element) {
		return;
	}
	const init: KeyboardEventInit = { key: 'F10', code: 'F10', keyCode: 121, shiftKey: true, bubbles: true, cancelable: true };
	element.dispatchEvent(new KeyboardEvent('keydown', init));
	element.dispatchEvent(new KeyboardEvent('keyup', init));
}

function hasCollapseApi(list: WorkbenchListWidget): list is WorkbenchListWidget & { isCollapsible(element: unknown): boolean; isCollapsed(element: unknown): boolean } {
	return hasKey(list, { isCollapsible: true, isCollapsed: true });
}

function activeTileEditor(accessor: ServicesAccessor): ViewTileEditor | undefined {
	const pane = accessor.get(IEditorGroupsService).activeGroup.activeEditorPane;
	return pane instanceof ViewTileEditor ? pane : undefined;
}

const ctrl = { ctrlCmd: KeyMod.CtrlCmd, mac: KeyMod.WinCtrl };
const ctrlKey = (key: KeyCode) => ({ primary: ctrl.ctrlCmd | key, mac: { primary: ctrl.mac | key } });

add('down', localize('tileListDown', "Next Row"), 'j', [KeyCode.KeyJ], accessor => accessor.get(ICommandService).executeCommand('list.focusDown'));
add('up', localize('tileListUp', "Previous Row"), 'k', [KeyCode.KeyK], accessor => accessor.get(ICommandService).executeCommand('list.focusUp'));
add('collapse', localize('tileListCollapse', "Collapse or Go to Parent"), 'h', [KeyCode.KeyH], accessor => accessor.get(ICommandService).executeCommand('list.collapse'));
add('expand', localize('tileListExpand', "Expand, or Open Keeping Focus"), 'l', [KeyCode.KeyL], (accessor, list) => {
	const focused = list?.getFocus()[0];
	const collapsed = list && hasCollapseApi(list) && focused !== undefined && list.isCollapsible(focused) && list.isCollapsed(focused);
	return accessor.get(ICommandService).executeCommand(collapsed ? 'list.expand' : 'list.selectAndPreserveFocus');
});
add('open', localize('tileListOpen', "Open Keeping Focus"), 'o', [KeyCode.KeyO], accessor => accessor.get(ICommandService).executeCommand('list.selectAndPreserveFocus'));
add('first', localize('tileListFirst', "First Row"), 'gg', [KeyChord(KeyCode.KeyG, KeyCode.KeyG)], accessor => accessor.get(ICommandService).executeCommand('list.focusFirst'));
add('last', localize('tileListLast', "Last Row"), 'G', [KeyMod.Shift | KeyCode.KeyG], accessor => accessor.get(ICommandService).executeCommand('list.focusLast'));
add('pageDown', localize('tileListPageDown', "Page Down"), 'Ctrl+D', [ctrlKey(KeyCode.KeyD)], accessor => accessor.get(ICommandService).executeCommand('list.focusPageDown'));
add('pageUp', localize('tileListPageUp', "Page Up"), 'Ctrl+U', [ctrlKey(KeyCode.KeyU)], accessor => accessor.get(ICommandService).executeCommand('list.focusPageUp'));
add('toggleFold', localize('tileListToggleFold', "Toggle Fold"), 'za', [KeyChord(KeyCode.KeyZ, KeyCode.KeyA)], accessor => accessor.get(ICommandService).executeCommand('list.toggleExpand'));
add('unfold', localize('tileListUnfold', "Expand"), 'zo', [KeyChord(KeyCode.KeyZ, KeyCode.KeyO)], accessor => accessor.get(ICommandService).executeCommand('list.expand'));
add('fold', localize('tileListFold', "Collapse"), 'zc', [KeyChord(KeyCode.KeyZ, KeyCode.KeyC)], accessor => accessor.get(ICommandService).executeCommand('list.collapse'));
add('find', localize('tileListFind', "Find in List"), '/', [KeyCode.Slash], (accessor, list) => accessor.get(ICommandService).executeCommand(list && hasKey(list, { openFind: true }) ? 'list.find' : 'list.triggerTypeNavigation'));
add('leader', localize('tileListLeader', "Leader Menu"), 'Space', [KeyCode.Space], accessor => accessor.get(ITerminalFirstLeaderService).start());
add('actions', localize('tileListActions', "Row and View Actions"), '.', [KeyCode.Period], accessor => showTileListActions(accessor));
add('contextMenu', localize('tileListContextMenu', "Context Menu"), 'm', [KeyCode.KeyM], (_accessor, list) => openContextMenu(list));
add('focusNext', localize('tileListFocusNext', "Focus Toolbar or List"), 'F6', [KeyCode.F6], accessor => activeTileEditor(accessor)?.cycleFocus(true));
add('focusPrevious', localize('tileListFocusPrevious', "Focus Previous Toolbar or List"), 'Shift+F6', [KeyMod.Shift | KeyCode.F6], accessor => activeTileEditor(accessor)?.cycleFocus(false));
add('escape', localize('tileListEscape', "Keep Cursor, Clear Selection"), 'Esc', [KeyCode.Escape], (_accessor, list) => {
	const focus = list?.getFocus() ?? [];
	if (list && focus.length) {
		list.setSelection(focus.slice(0, 1));
	}
});
add('help', localize('tileListHelp', "Keyboard Help"), '?', [KeyMod.Shift | KeyCode.Slash], async accessor => {
	const keybindings = accessor.get(IKeybindingService);
	const picked = await accessor.get(IQuickInputService).pick(tileListActions.map(action => ({
		label: action.label,
		description: keybindings.lookupKeybindings(`terminalFirst.tileList.${action.id}`).map(binding => binding.getLabel()).filter(Boolean).join(' / ') || action.keys,
		id: action.id,
	})), { placeHolder: localize('tileListHelpPlaceholder', "Search tile list actions"), matchOnDescription: true });
	if (picked) {
		await accessor.get(ICommandService).executeCommand(`terminalFirst.tileList.${picked.id}`);
	}
});

// Opt-in single-key row actions. Changes: stage, unstage, discard. Explorer: rename, create, delete, clipboard.
const scmList = ContextKeyExpr.and(listActionKeys, ContextKeyExpr.equals('view', SCM_VIEW_PANE_ID));
add('stage', localize('tileListStage', "Stage (Changes)"), 's', [KeyCode.KeyS], accessor => runTileRowAction(accessor, ['git.stage', 'git.stageAll']), scmList);
add('unstage', localize('tileListUnstage', "Unstage (Changes)"), 'u', [KeyCode.KeyU], accessor => runTileRowAction(accessor, ['git.unstage', 'git.unstageAll']), scmList);
add('discard', localize('tileListDiscard', "Discard Changes (Changes)"), 'd', [KeyCode.KeyD], accessor => runTileRowAction(accessor, ['git.clean', 'git.cleanAll']), scmList);
const explorerList = ContextKeyExpr.and(listActionKeys, FilesExplorerFocusedContext);
for (const [id, label, keys, key, command] of [
	['rename', localize('tileListRename', "Rename (Explorer)"), 'r', KeyCode.KeyR, 'renameFile'],
	['newFile', localize('tileListNewFile', "New File (Explorer)"), 'a', KeyCode.KeyA, 'explorer.newFile'],
	['newFolder', localize('tileListNewFolder', "New Folder (Explorer)"), 'A', KeyMod.Shift | KeyCode.KeyA, 'explorer.newFolder'],
	['trash', localize('tileListTrash', "Move to Trash (Explorer)"), 'd', KeyCode.KeyD, 'moveFileToTrash'],
	['delete', localize('tileListDelete', "Delete Permanently (Explorer)"), 'D', KeyMod.Shift | KeyCode.KeyD, 'deleteFile'],
	['copy', localize('tileListCopy', "Copy (Explorer)"), 'y', KeyCode.KeyY, 'filesExplorer.copy'],
	['cut', localize('tileListCut', "Cut (Explorer)"), 'x', KeyCode.KeyX, 'filesExplorer.cut'],
	['paste', localize('tileListPaste', "Paste (Explorer)"), 'p', KeyCode.KeyP, 'filesExplorer.paste'],
] as const) {
	add(id, label, keys, [key], accessor => accessor.get(ICommandService).executeCommand(command), explorerList);
}
