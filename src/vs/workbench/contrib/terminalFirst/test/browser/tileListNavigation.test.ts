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
});
