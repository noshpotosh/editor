/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { deepStrictEqual, strictEqual } from 'assert';
import { Event } from '../../../../../base/common/event.js';
import { toDisposable } from '../../../../../base/common/lifecycle.js';
import { URI } from '../../../../../base/common/uri.js';
import { upcastPartial } from '../../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { IEditorGroupsService, IEditorPart } from '../../../../services/editor/common/editorGroupsService.js';
import { IWorkbenchLayoutService } from '../../../../services/layout/browser/layoutService.js';
import { workbenchInstantiationService } from '../../../../test/browser/workbenchTestServices.js';
import { FloatingJumpList } from '../../browser/floatingJumpList.js';
import { JumpListModel } from '../../browser/jumpListModel.js';

suite('Floating Jump List', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();
	function fixture() {
		const instantiation = workbenchInstantiationService(undefined, store);
		const container = document.createElement('div');
		const editor = container.appendChild(document.createElement('div'));
		document.body.appendChild(container);
		store.add(toDisposable(() => container.remove()));
		instantiation.stub(IWorkbenchLayoutService, upcastPartial<IWorkbenchLayoutService>({ mainContainer: container, getContainer: () => editor, onDidLayoutMainContainer: Event.None }));
		instantiation.stub(IEditorGroupsService, upcastPartial<IEditorGroupsService>({ mainPart: upcastPartial<IEditorPart>({ onDidLayout: Event.None }) }));
		const model = instantiation.createInstance(JumpListModel);
		const project = URI.file('/project');
		model.load(project);
		for (const name of ['a', 'b', 'c']) { model.add(URI.file(`/project/${name}`)); }
		const hidden: boolean[] = [];
		const opened: string[] = [];
		const host = store.add(instantiation.createInstance(FloatingJumpList, model, focus => { hidden.push(focus); host.hideList(); }, async resource => { opened.push(resource.path); throw new Error('Open failed'); }));
		const key = (key: string, options: KeyboardEventInit = {}) => document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...options }));
		const settle = async () => { for (let i = 0; i < 8; i++) { await Promise.resolve(); } };
		host.show(project, URI.file('/project/b'));
		return { host, model, container, editor, key, settle, hidden, opened };
	}

	test('initial selection, Vim navigation, delete/put and undo/redo', () => {
		const f = fixture();
		f.key('d'); f.key('d'); f.key('G'); f.key('p');
		const moved = f.model.entries.map(item => item.path);
		f.key('u');
		const undone = f.model.entries.map(item => item.path);
		f.key('r', { ctrlKey: true });
		f.key('g'); f.key('g');
		const selected = f.container.querySelector('.selected')?.getAttribute('aria-label');
		f.key('q');
		deepStrictEqual([moved, undone, f.model.entries.map(item => item.path), selected, f.hidden], [
			['/project/a', '/project/c', '/project/b'], ['/project/a', '/project/c'], ['/project/a', '/project/c', '/project/b'], 'a', [true],
		]);
	});

	test('IME and modifiers do not remove rows; failed opens stay visible; outside click dismisses', async () => {
		const f = fixture();
		f.key('d', { isComposing: true }); f.key('d'); f.key('j', { metaKey: true }); f.key('d'); f.key('ArrowDown');
		f.key('Enter'); await f.settle();
		deepStrictEqual([f.model.entries.length, f.opened, f.container.querySelector('.jump-list-status')?.textContent], [3, ['/project/c'], 'Open failed']);
		strictEqual(f.container.querySelector<HTMLElement>('.terminal-first-jump-list')?.hidden, false);
		f.editor.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
		deepStrictEqual(f.hidden, [false]);
	});
});
