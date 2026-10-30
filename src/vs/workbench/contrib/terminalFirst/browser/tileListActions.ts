/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IContextMenuDelegate } from '../../../../base/browser/contextmenu.js';
import { isAncestorOfActiveElement } from '../../../../base/browser/dom.js';
import { IAction, Separator, SubmenuAction } from '../../../../base/common/actions.js';
import { localize } from '../../../../nls.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { IKeybindingService } from '../../../../platform/keybinding/common/keybinding.js';
import { IListService } from '../../../../platform/list/browser/listService.js';
import { IQuickInputService, IQuickPickItem, IQuickPickSeparator } from '../../../../platform/quickinput/common/quickInput.js';
import { IEditorGroupsService } from '../../../services/editor/common/editorGroupsService.js';
import { tileContextMenuCapture } from './tileContextMenu.js';
import { ViewTileEditor } from './tileEditor.js';

/** A list widget as far as the picker needs it: a DOM node to address and a focused element to act on. */
interface IFocusedList {
	getHTMLElement(): HTMLElement;
	getFocus(): readonly unknown[];
	domFocus(): void;
}

/** A group of actions shown together in the picker, each run with its own context. */
interface IActionGroup {
	readonly label: string;
	readonly actions: readonly IAction[];
	readonly run: (action: IAction) => unknown;
	/** Called once the picker closes, so the view that produced a menu can clean up. */
	readonly onHide?: (cancelled: boolean) => void;
}

interface IActionPick extends IQuickPickItem {
	readonly action: IAction;
	readonly group: IActionGroup;
}

/** Shift+F10 opens the row context menu through the list's own handler, so every view builds its own menu. */
export function openContextMenu(list: IFocusedList | undefined): void {
	const element = list?.getHTMLElement();
	if (!element) {
		return;
	}
	const init: KeyboardEventInit = { key: 'F10', code: 'F10', keyCode: 121, shiftKey: true, bubbles: true, cancelable: true };
	element.dispatchEvent(new KeyboardEvent('keydown', init));
	element.dispatchEvent(new KeyboardEvent('keyup', init));
}

/** Enabled actions in display order, with one level of submenus flattened as "Submenu › Action". */
export function flattenMenuActions(actions: readonly IAction[]): IAction[] {
	const result: IAction[] = [];
	for (const action of actions) {
		if (action instanceof Separator || !action.enabled) {
			continue;
		}
		if (action instanceof SubmenuAction) {
			for (const child of action.actions) {
				if (!(child instanceof Separator) && child.enabled) {
					result.push(new LabelledAction(child, localize('submenuAction', "{0} › {1}", action.label, child.label)));
				}
			}
			continue;
		}
		result.push(action);
	}
	return result;
}

/** Runs another action under a different label. */
class LabelledAction implements IAction {
	readonly id: string;
	readonly tooltip: string;
	readonly class: string | undefined;
	readonly enabled = true;
	readonly checked: boolean | undefined;
	constructor(private readonly action: IAction, readonly label: string) {
		this.id = action.id;
		this.tooltip = action.tooltip;
		this.class = action.class;
		this.checked = action.checked;
	}
	run(...args: unknown[]): unknown { return this.action.run(...args); }
}

/** Borrows the focused row's context menu from whichever view owns the list, without knowing the view. */
async function rowActions(list: IFocusedList): Promise<IActionGroup | undefined> {
	if (!list.getFocus().length) {
		return undefined;
	}
	const captured = tileContextMenuCapture.arm();
	openContextMenu(list);
	const delegate: IContextMenuDelegate | undefined = await captured;
	if (!delegate) {
		return undefined;
	}
	const context = delegate.getActionsContext?.();
	return {
		label: localize('rowActions', "Row"),
		actions: flattenMenuActions(delegate.getActions()),
		run: action => delegate.actionRunner ? delegate.actionRunner.run(action, context) : action.run(context),
		onHide: cancelled => delegate.onHide?.(cancelled),
	};
}

function collectGroups(accessor: ServicesAccessor): Promise<{ groups: IActionGroup[]; list: IFocusedList | undefined }> {
	const list: IFocusedList | undefined = accessor.get(IListService).lastFocusedList;
	const pane = accessor.get(IEditorGroupsService).activeGroup.activeEditorPane;
	return collectGroupsFor(list, pane instanceof ViewTileEditor ? pane : undefined);
}

async function collectGroupsFor(list: IFocusedList | undefined, tile: ViewTileEditor | undefined): Promise<{ groups: IActionGroup[]; list: IFocusedList | undefined }> {
	const groups: IActionGroup[] = [];
	if (list) {
		const row = await rowActions(list);
		if (row) {
			groups.push(row);
		}
	}
	const composite = tile?.viewContainer;
	const panes = composite?.getViewPaneContainer()?.panes ?? [];
	const viewPane = panes.find(pane => isAncestorOfActiveElement(pane.element)) ?? panes.find(pane => pane.isExpanded());
	if (viewPane) {
		const context = viewPane.getActionsContext();
		groups.push({ label: viewPane.title, actions: flattenMenuActions([...viewPane.menuActions.getPrimaryActions(), ...viewPane.menuActions.getSecondaryActions()]), run: action => action.run(context) });
	}
	if (composite) {
		const context = composite.getActionsContext();
		groups.push({ label: composite.getTitle() ?? localize('tile', "Tile"), actions: flattenMenuActions([...composite.getActions(), ...composite.getSecondaryActions()]), run: action => action.run(context) });
	}
	return { groups, list };
}

/** Shows every action of the focused row, the focused view header, and the tile toolbar in one picker. */
export async function showTileListActions(accessor: ServicesAccessor): Promise<void> {
	const keybindings = accessor.get(IKeybindingService);
	const quickInput = accessor.get(IQuickInputService);
	const { groups, list } = await collectGroups(accessor);
	const picks: (IActionPick | IQuickPickSeparator)[] = [];
	for (const group of groups) {
		if (!group.actions.length) {
			continue;
		}
		picks.push({ type: 'separator', label: group.label });
		for (const action of group.actions) {
			picks.push({ label: action.label, description: keybindings.lookupKeybinding(action.id)?.getLabel() ?? undefined, action, group });
		}
	}
	let picked: IActionPick | undefined;
	try {
		if (picks.length) {
			picked = await quickInput.pick(picks, { placeHolder: localize('tileActionsPlaceholder', "Search actions for the focused row, view, and tile"), matchOnDescription: true });
		}
	} finally {
		for (const group of groups) {
			group.onHide?.(group !== picked?.group);
		}
	}
	list?.domFocus();
	if (picked) {
		await picked.group.run(picked.action);
	}
}

/** Runs the first of `ids` offered for the focused row; false when none applies. Used by the opt-in single-key actions. */
export async function runTileRowAction(accessor: ServicesAccessor, ids: readonly string[]): Promise<boolean> {
	const { groups } = await collectGroups(accessor);
	let chosen: { group: IActionGroup; action: IAction } | undefined;
	for (const group of groups) {
		for (const id of ids) {
			const action = group.actions.find(action => action.id === id);
			if (action) {
				chosen = { group, action };
				break;
			}
		}
		if (chosen) {
			break;
		}
	}
	for (const group of groups) {
		group.onHide?.(group !== chosen?.group);
	}
	if (chosen) {
		await chosen.group.run(chosen.action);
	}
	return !!chosen;
}
