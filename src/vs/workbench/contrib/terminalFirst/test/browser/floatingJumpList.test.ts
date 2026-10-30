/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { deepStrictEqual, strictEqual } from 'assert';
import { Event } from '../../../../../base/common/event.js';
import { IReference, toDisposable } from '../../../../../base/common/lifecycle.js';
import { URI } from '../../../../../base/common/uri.js';
import { upcastPartial } from '../../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { IModelService } from '../../../../../editor/common/services/model.js';
import { IResolvedTextEditorModel, ITextModelService } from '../../../../../editor/common/services/resolverService.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
import { TestInstantiationService } from '../../../../../platform/instantiation/test/common/instantiationServiceMock.js';
import { IUserInteractionService, MockUserInteractionService } from '../../../../../platform/userInteraction/browser/userInteractionService.js';
import { IEditorGroupsService, IEditorPart } from '../../../../services/editor/common/editorGroupsService.js';
import { IWorkbenchLayoutService } from '../../../../services/layout/browser/layoutService.js';
import { workbenchInstantiationService } from '../../../../test/browser/workbenchTestServices.js';
import { FloatingJumpList } from '../../browser/floatingJumpList.js';
import { JumpListModel } from '../../browser/jumpListModel.js';

suite('Floating Jump List', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();
	function fixture(setup?: (instantiation: TestInstantiationService) => void) {
		const instantiation = workbenchInstantiationService(undefined, store);
		const container = document.createElement('div');
		const editor = container.appendChild(document.createElement('div'));
		// A wide editor area keeps the preview pane visible, so previews load.
		Object.assign(editor.style, { width: '1200px', height: '800px' });
		document.body.appendChild(container);
		store.add(toDisposable(() => container.remove()));
		instantiation.stub(IWorkbenchLayoutService, upcastPartial<IWorkbenchLayoutService>({ mainContainer: container, getContainer: () => editor, onDidLayoutMainContainer: Event.None }));
		instantiation.stub(IEditorGroupsService, upcastPartial<IEditorGroupsService>({ mainPart: upcastPartial<IEditorPart>({ onDidLayout: Event.None }) }));
		const model = instantiation.createInstance(JumpListModel);
		const project = URI.file('/project');
		model.load(project);
		for (const name of ['a', 'b', 'c']) { model.add(URI.file(`/project/${name}`)); }
		// Previews resolve no real text file models unless a test stubs them in; those release asynchronously and would read as leaks.
		instantiation.stub(ITextModelService, 'createModelReference', async () => { throw new Error('No preview'); });
		setup?.(instantiation);
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

	test('Shift+J/K move the focused entry and digits open slots', async () => {
		const f = fixture();
		f.key('J');
		const movedDown = f.model.entries.map(item => item.path);
		f.key('K'); f.key('K');
		const movedTop = f.model.entries.map(item => item.path);
		f.key('3');
		await f.settle();
		f.key('9');
		await f.settle();
		deepStrictEqual({ movedDown, movedTop, opened: f.opened, focused: f.container.querySelector('.focused')?.getAttribute('aria-label') }, { movedDown: ['/project/a', '/project/c', '/project/b'], movedTop: ['/project/b', '/project/a', '/project/c'], opened: ['/project/c'], focused: 'b' });
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

	test('the focused row previews readable files, keeps the last preview while the next loads, and explains unreadable ones', async () => {
		let references = 0;
		const f = fixture(instantiation => {
			// Attaching a model to the preview editor needs a focus tracker factory the workbench test services do not provide.
			instantiation.stub(IUserInteractionService, new MockUserInteractionService(false));
			const model = store.add(instantiation.get(IModelService).createModel('alpha', null, URI.file('/project/a')));
			instantiation.stub(IFileService, 'stat', async (resource: URI) => { if (resource.path === '/project/a') { return { resource, size: 5 }; } throw new Error('Missing'); });
			instantiation.stub(ITextModelService, 'createModelReference', async (): Promise<IReference<IResolvedTextEditorModel>> => { references++; return { object: upcastPartial<IResolvedTextEditorModel>({ textEditorModel: model }), dispose: () => { } }; });
		});
		const message = f.container.querySelector<HTMLElement>('.terminal-first-preview-message')!;
		const editor = f.container.querySelector<HTMLElement>('.terminal-first-preview-editor')!;
		const state = () => ({ message: message.hidden ? undefined : message.textContent, editor: !editor.hidden });
		await f.settle();
		const missing = state();
		f.key('k');
		const switching = state();
		await f.settle();
		const readable = state();
		// Removing and restoring the row previews it again; an unchanged row is not reloaded.
		f.key('d'); f.key('d'); f.key('u');
		await f.settle();
		f.key('j');
		const leaving = state();
		await f.settle();
		f.host.hideList();
		deepStrictEqual({ missing, switching, readable, leaving, hidden: state(), references }, {
			missing: { message: 'Preview unavailable: this file is binary, missing, or cannot be read. Press Enter to open.', editor: false },
			switching: { message: 'Preview unavailable: this file is binary, missing, or cannot be read. Press Enter to open.', editor: false },
			readable: { message: undefined, editor: true },
			leaving: { message: undefined, editor: true },
			hidden: { message: '', editor: false },
			references: 2,
		});
	});
});
