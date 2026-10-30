/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { deepStrictEqual } from 'assert';
import { List } from '../../../../../base/browser/ui/list/listWidget.js';
import { toDisposable } from '../../../../../base/common/lifecycle.js';
import { upcastPartial } from '../../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { ContextKeyService } from '../../../../../platform/contextkey/browser/contextKeyService.js';
import { workbenchInstantiationService } from '../../../../test/browser/workbenchTestServices.js';
import { focusFirstRowIfNone } from '../../browser/tileEditor.js';
import { IContextKeyService } from '../../../../../platform/contextkey/common/contextkey.js';
import { TileContextMenuCapture, tileContextMenuCapture } from '../../browser/tileContextMenu.js';
import { flattenMenuActions, showTileListActions } from '../../browser/tileListActions.js';
import { TileListFocusTracker } from '../../browser/tileListNavigation.js';
import { IWorkbenchLayoutService } from '../../../../services/layout/browser/layoutService.js';
import { Action, Separator, SubmenuAction } from '../../../../../base/common/actions.js';
import { IListService } from '../../../../../platform/list/browser/listService.js';
import { IEditorGroupsService } from '../../../../services/editor/common/editorGroupsService.js';
import { IQuickInputService, IQuickPickItem, IQuickPickSeparator } from '../../../../../platform/quickinput/common/quickInput.js';
import { IContextMenuDelegate } from '../../../../../base/browser/contextmenu.js';

suite('Terminal First - tile list navigation', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	function createList(parent: HTMLElement, items: string[]): List<string> {
		const container = document.createElement('div');
		container.style.height = '200px';
		parent.appendChild(container);
		const list = store.add(new List<string>('tileListTest', container, { getHeight: () => 22, getTemplateId: () => 'row' }, [{
			templateId: 'row',
			renderTemplate: (template: HTMLElement) => template,
			renderElement: (element: string, _index: number, template: HTMLElement) => { template.textContent = element; },
			disposeTemplate: () => { },
		}]));
		list.splice(0, 0, items);
		list.layout(200, 200);
		return list;
	}

	test('a focused list without a cursor gets its first row; other lists and empty lists are left alone', () => {
		const tile = document.createElement('div');
		document.body.appendChild(tile);
		store.add(toDisposable(() => tile.remove()));
		const outside = document.createElement('div');
		document.body.appendChild(outside);
		store.add(toDisposable(() => outside.remove()));
		const inside = createList(tile, ['a', 'b']);
		const elsewhere = createList(outside, ['x']);
		const empty = createList(tile, []);

		inside.domFocus();
		const focusedInside = focusFirstRowIfNone(inside, tile);
		inside.setFocus([1]);
		const keptExisting = focusFirstRowIfNone(inside, tile);
		elsewhere.domFocus();
		const ignoredOutside = focusFirstRowIfNone(elsewhere, tile);
		empty.domFocus();
		const handledEmpty = focusFirstRowIfNone(empty, tile);
		deepStrictEqual({ focusedInside, cursor: inside.getFocus(), keptExisting, ignoredOutside, elsewhereCursor: elsewhere.getFocus(), handledEmpty, emptyCursor: empty.getFocus(), undefinedList: focusFirstRowIfNone(undefined, tile) },
			{ focusedInside: 'focused', cursor: [1], keptExisting: 'focused', ignoredOutside: 'none', elsewhereCursor: [], handledEmpty: 'empty', emptyCursor: [], undefinedList: 'none' });
	});

	test('the tile focus tracker follows keyboard focus into and out of view tiles', () => {
		const instantiation = workbenchInstantiationService(undefined, store);
		const contexts = store.add(instantiation.createInstance(ContextKeyService));
		instantiation.stub(IContextKeyService, contexts);
		const main = document.createElement('div');
		document.body.appendChild(main);
		store.add(toDisposable(() => main.remove()));
		instantiation.stub(IWorkbenchLayoutService, upcastPartial<IWorkbenchLayoutService>({ mainContainer: main }));
		const tile = main.appendChild(document.createElement('div'));
		tile.className = 'terminal-first-tool-tile';
		const inside = tile.appendChild(document.createElement('button'));
		const outside = main.appendChild(document.createElement('button'));
		store.add(instantiation.createInstance(TileListFocusTracker));
		const key = () => contexts.getContextKeyValue('terminalFirstViewTile');
		// Focus events are not guaranteed in a background test window, so drive the tracker the way a keystroke does.
		const press = (element: HTMLElement) => { element.focus(); element.dispatchEvent(new KeyboardEvent('keydown', { key: 'j', bubbles: true })); return key(); };
		const whileInside = press(inside);
		const whileOutside = press(outside);
		inside.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
		const afterFocusIn = key();
		inside.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: outside }));
		deepStrictEqual({ whileInside, whileOutside, afterFocusIn, afterFocusOut: key() }, { whileInside: true, whileOutside: false, afterFocusIn: true, afterFocusOut: false });
	});

	test('a capture hands over the next menu only while armed, and times out otherwise', async () => {
		const capture = new TileContextMenuCapture();
		const delegate: IContextMenuDelegate = { getAnchor: () => document.body, getActions: () => [] };
		const unarmed = capture.capture(delegate);
		const timedOut = await capture.arm(10);
		const armed = capture.arm(1000);
		const captured = capture.capture(delegate);
		deepStrictEqual({ unarmed, timedOut, captured, armedResolved: (await armed) === delegate, afterwards: capture.capture(delegate) }, { unarmed: false, timedOut: undefined, captured: true, armedResolved: true, afterwards: false });
	});

	test('flattening keeps enabled actions in order and expands one level of submenus', () => {
		const run = () => Promise.resolve();
		const disabled = store.add(new Action('disabled', 'Disabled', undefined, false, run));
		const first = store.add(new Action('first', 'First', undefined, true, run));
		const child = store.add(new Action('child', 'Child', undefined, true, run));
		const flattened = flattenMenuActions([first, new Separator(), disabled, new SubmenuAction('more', 'More', [child, new Separator()])]);
		deepStrictEqual(flattened.map(action => [action.id, action.label]), [['first', 'First'], ['child', 'More › Child']]);
	});

	test('the actions picker borrows the focused list\'s own context menu and runs the choice with its context', async () => {
		const instantiation = workbenchInstantiationService(undefined, store);
		const tile = document.createElement('div');
		document.body.appendChild(tile);
		store.add(toDisposable(() => tile.remove()));
		const list = createList(tile, ['row']);
		list.setFocus([0]);
		const ran: unknown[] = [];
		const hidden: boolean[] = [];
		const action = store.add(new Action('view.doIt', 'Do It', undefined, true, context => { ran.push(context); }));
		// The list's view asks the tile's context menu service for its row menu, as every view does on Shift+F10.
		store.add(list.onContextMenu(() => {
			const delegate: IContextMenuDelegate = { getAnchor: () => tile, getActions: () => [action], getActionsContext: () => 'row-context', onHide: cancelled => hidden.push(cancelled) };
			if (!tileContextMenuCapture.capture(delegate)) { throw new Error('not captured'); }
		}));
		instantiation.stub(IListService, upcastPartial<IListService>({ lastFocusedList: list as unknown as IListService['lastFocusedList'] }));
		instantiation.stub(IEditorGroupsService, upcastPartial<IEditorGroupsService>({ activeGroup: upcastPartial<IEditorGroupsService['activeGroup']>({ activeEditorPane: undefined }) }));
		let shownPicks: (IQuickPickItem | IQuickPickSeparator)[] = [];
		instantiation.stub(IQuickInputService, 'pick', (async (items: (IQuickPickItem | IQuickPickSeparator)[]) => { shownPicks = items; return items.find(item => item.type !== 'separator'); }) as IQuickInputService['pick']);
		await instantiation.invokeFunction(accessor => showTileListActions(accessor));
		deepStrictEqual({ picks: shownPicks.map(item => item.type === 'separator' ? `-- ${item.label}` : item.label), ran, hidden }, { picks: ['-- Row', 'Do It'], ran: ['row-context'], hidden: [false] });
	});
});
