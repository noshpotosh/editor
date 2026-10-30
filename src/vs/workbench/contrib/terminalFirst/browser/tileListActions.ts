/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { isAncestorOfActiveElement } from '../../../../base/browser/dom.js';
import { IAction, Separator } from '../../../../base/common/actions.js';
import { localize } from '../../../../nls.js';
import { getFlatContextMenuActions } from '../../../../platform/actions/browser/menuEntryActionViewItem.js';
import { IMenu, IMenuService, MenuId } from '../../../../platform/actions/common/actions.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { IKeybindingService } from '../../../../platform/keybinding/common/keybinding.js';
import { IListService, WorkbenchListWidget } from '../../../../platform/list/browser/listService.js';
import { IQuickInputService, IQuickPickItem, IQuickPickSeparator } from '../../../../platform/quickinput/common/quickInput.js';
import { IEditorGroupsService } from '../../../services/editor/common/editorGroupsService.js';
import { ExplorerItem } from '../../files/common/explorerModel.js';
import { isSCMRepository, isSCMResource, isSCMResourceGroup, isSCMResourceNode } from '../../scm/browser/util.js';
import { ISCMViewService } from '../../scm/common/scm.js';
import { ViewTileEditor } from './tileEditor.js';

/** A group of actions shown together in the picker, each run with its own context. */
interface IActionGroup {
	readonly label: string;
	readonly actions: readonly IAction[];
	readonly context: unknown;
}

interface IActionPick extends IQuickPickItem {
	readonly action: IAction;
	readonly context: unknown;
}

function flatten(menu: IMenu, arg: unknown): IAction[] {
	// Include the inline group too: those are the row buttons (stage, discard, open) users want by keyboard.
	return getFlatContextMenuActions(menu.getActions({ arg, shouldForwardArgs: true }));
}

/** The actions of the focused row, resolved the way the Changes and Explorer views build their menus. */
function rowActions(accessor: ServicesAccessor, list: WorkbenchListWidget, element: unknown): IActionGroup | undefined {
	if (isSCMResource(element)) {
		const menus = accessor.get(ISCMViewService).menus.getRepositoryMenus(element.resourceGroup.provider);
		return { label: localize('scmResource', "File"), actions: flatten(menus.getResourceMenu(element), element), context: element };
	}
	if (isSCMResourceGroup(element)) {
		const menus = accessor.get(ISCMViewService).menus.getRepositoryMenus(element.provider);
		return { label: element.label, actions: flatten(menus.getResourceGroupMenu(element), element), context: element };
	}
	if (isSCMResourceNode(element)) {
		const menus = accessor.get(ISCMViewService).menus.getRepositoryMenus(element.context.provider);
		return { label: element.name, actions: flatten(menus.getResourceFolderMenu(element.context), element), context: element };
	}
	if (isSCMRepository(element)) {
		const menus = accessor.get(ISCMViewService).menus.getRepositoryMenus(element.provider);
		return { label: element.provider.label, actions: flatten(menus.getRepositoryContextMenu(element), element.provider), context: element.provider };
	}
	if (element instanceof ExplorerItem) {
		const menu = accessor.get(IMenuService).createMenu(MenuId.ExplorerContext, list.contextKeyService);
		try {
			return { label: element.name, actions: flatten(menu, element.resource), context: element.resource };
		} finally {
			menu.dispose();
		}
	}
	return undefined;
}

function collectGroups(accessor: ServicesAccessor): { groups: IActionGroup[]; list: WorkbenchListWidget | undefined } {
	const list = accessor.get(IListService).lastFocusedList;
	const pane = accessor.get(IEditorGroupsService).activeGroup.activeEditorPane;
	const tile = pane instanceof ViewTileEditor ? pane : undefined;
	const groups: IActionGroup[] = [];
	const focused = list?.getFocus()[0];
	if (list && focused !== undefined) {
		const row = rowActions(accessor, list, focused);
		if (row) {
			groups.push(row);
		}
	}
	const composite = tile?.viewContainer;
	const panes = composite?.getViewPaneContainer()?.panes ?? [];
	const viewPane = panes.find(pane => isAncestorOfActiveElement(pane.element)) ?? panes.find(pane => pane.isExpanded());
	if (viewPane) {
		groups.push({ label: viewPane.title, actions: [...viewPane.menuActions.getPrimaryActions(), ...viewPane.menuActions.getSecondaryActions()], context: viewPane.getActionsContext() });
	}
	if (composite) {
		groups.push({ label: composite.getTitle() ?? localize('tile', "Tile"), actions: [...composite.getActions(), ...composite.getSecondaryActions()], context: composite.getActionsContext() });
	}
	return { groups, list };
}

/** Shows every action of the focused row, the focused view header, and the tile toolbar in one picker. */
export async function showTileListActions(accessor: ServicesAccessor): Promise<void> {
	const { groups, list } = collectGroups(accessor);
	const keybindings = accessor.get(IKeybindingService);
	const picks: (IActionPick | IQuickPickSeparator)[] = [];
	for (const group of groups) {
		const actions = group.actions.filter(action => action.enabled && !(action instanceof Separator));
		if (!actions.length) {
			continue;
		}
		picks.push({ type: 'separator', label: group.label });
		for (const action of actions) {
			picks.push({ label: action.label, description: keybindings.lookupKeybinding(action.id)?.getLabel() ?? undefined, action, context: group.context });
		}
	}
	if (!picks.length) {
		return;
	}
	const picked = await accessor.get(IQuickInputService).pick(picks, { placeHolder: localize('tileActionsPlaceholder', "Search actions for the focused row, view, and tile"), matchOnDescription: true });
	list?.domFocus();
	if (picked) {
		await picked.action.run(picked.context);
	}
}

/** Runs the first of `ids` offered for the focused row; false when none applies. Used by the opt-in single-key actions. */
export async function runTileRowAction(accessor: ServicesAccessor, ids: readonly string[]): Promise<boolean> {
	const { groups } = collectGroups(accessor);
	for (const group of groups) {
		for (const id of ids) {
			const action = group.actions.find(action => action.id === id && action.enabled);
			if (action) {
				await action.run(group.context);
				return true;
			}
		}
	}
	return false;
}
