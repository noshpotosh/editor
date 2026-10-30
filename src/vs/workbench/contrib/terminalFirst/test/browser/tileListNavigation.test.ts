/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { deepStrictEqual } from 'assert';
import { List } from '../../../../../base/browser/ui/list/listWidget.js';
import { Emitter, Event } from '../../../../../base/common/event.js';
import { toDisposable } from '../../../../../base/common/lifecycle.js';
import { upcastPartial } from '../../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { IContextKeyService, IScopedContextKeyService } from '../../../../../platform/contextkey/common/contextkey.js';
import { ContextKeyService } from '../../../../../platform/contextkey/browser/contextKeyService.js';
import { IInstantiationService } from '../../../../../platform/instantiation/common/instantiation.js';
import { INativeVimService } from '../../../../../editor/contrib/nativeVim/common/nativeVimService.js';
import { PaneComposite, PaneCompositeDescriptor } from '../../../../browser/panecomposite.js';
import { ViewContainer, ViewContainerLocation, IViewDescriptorService } from '../../../../common/views.js';
import { IPaneCompositePartService } from '../../../../services/panecomposite/browser/panecomposite.js';
import { workbenchInstantiationService } from '../../../../test/browser/workbenchTestServices.js';
import { focusFirstRowIfNone, ViewTileComposites } from '../../browser/tileEditor.js';
import { TileContextMenuCapture, tileContextMenuCapture, TileContextMenuService } from '../../browser/tileContextMenu.js';
import { flattenMenuActions, showTileListActions } from '../../browser/tileListActions.js';
import { Action, Separator, SubmenuAction } from '../../../../../base/common/actions.js';
import { IContextMenuService } from '../../../../../platform/contextview/browser/contextView.js';
import { IMenuService } from '../../../../../platform/actions/common/actions.js';
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
			{ focusedInside: true, cursor: [1], keptExisting: true, ignoredOutside: false, elsewhereCursor: [], handledEmpty: true, emptyCursor: [], undefinedList: false });
	});

	test('view tile composites mark their scope and switch list type navigation with the Vim engine', () => {
		const instantiation = workbenchInstantiationService(undefined, store);
		const contexts = store.add(instantiation.createInstance(ContextKeyService));
		instantiation.stub(IContextKeyService, contexts);
		let vimEnabled = true;
		const vimChanged = store.add(new Emitter<void>());
		instantiation.stub(INativeVimService, upcastPartial<INativeVimService>({ get enabled() { return vimEnabled; }, onDidChange: vimChanged.event }));
		instantiation.stub(IContextMenuService, upcastPartial<IContextMenuService>({ onDidShowContextMenu: Event.None, onDidHideContextMenu: Event.None, showContextMenu: () => { } }));
		instantiation.stub(IViewDescriptorService, upcastPartial<IViewDescriptorService>({
			onDidChangeViewContainers: Event.None,
			getViewContainerById: id => upcastPartial<ViewContainer>({ id }),
			getViewContainerLocation: () => ViewContainerLocation.Sidebar,
		}));
		let scoped: IScopedContextKeyService | undefined;
		instantiation.stub(IPaneCompositePartService, upcastPartial<IPaneCompositePartService>({
			getPaneComposite: () => upcastPartial<PaneCompositeDescriptor>({
				instantiate: (services: IInstantiationService) => {
					scoped = services.invokeFunction(accessor => accessor.get(IContextKeyService)) as IScopedContextKeyService;
					let visible = false;
					return upcastPartial<PaneComposite>({ getId: () => 'workbench.view.sample', create: () => { }, isVisible: () => visible, setVisible: value => { visible = value; }, getViewPaneContainer: () => undefined, dispose: () => { } });
				},
			}),
		}));
		const composites = store.add(instantiation.createInstance(ViewTileComposites));
		composites.retain('workbench.view.sample');
		composites.acquire('workbench.view.sample', { detach: () => { } });
		const read = () => ({ tile: scoped?.getContextKeyValue('terminalFirstViewTile'), typeNavigation: scoped?.getContextKeyValue('listTypeNavigationMode') });
		const withVim = read();
		vimEnabled = false;
		vimChanged.fire();
		deepStrictEqual({ withVim, withoutVim: read() }, { withVim: { tile: true, typeNavigation: 'trigger' }, withoutVim: { tile: true, typeNavigation: undefined } });
	});

	test('the tile context menu service passes menus through unless the picker has armed a capture', async () => {
		const shown: IContextMenuDelegate[] = [];
		const capture = new TileContextMenuCapture();
		const real = upcastPartial<IContextMenuService>({ onDidShowContextMenu: Event.None, onDidHideContextMenu: Event.None, showContextMenu: delegate => { shown.push(delegate as IContextMenuDelegate); } });
		const instantiation = workbenchInstantiationService(undefined, store);
		const service = new TileContextMenuService(real, upcastPartial<IMenuService>({}), store.add(instantiation.createInstance(ContextKeyService)));
		const delegate: IContextMenuDelegate = { getAnchor: () => document.body, getActions: () => [] };
		service.showContextMenu(delegate);
		const passedThrough = shown.length;
		const timedOut = await capture.arm(10);
		const armed = capture.arm(1000);
		const captured = capture.capture(delegate);
		deepStrictEqual({ passedThrough, timedOut, captured, armedResolved: (await armed) === delegate, stillPassesThrough: (service.showContextMenu(delegate), shown.length) }, { passedThrough: 1, timedOut: undefined, captured: true, armedResolved: true, stillPassesThrough: 2 });
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
