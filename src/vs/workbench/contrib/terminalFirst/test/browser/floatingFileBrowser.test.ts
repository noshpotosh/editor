/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { deepStrictEqual, strictEqual } from 'assert';
import { DeferredPromise } from '../../../../../base/common/async.js';
import { IModelService } from '../../../../../editor/common/services/model.js';
import { ITextModelService, IResolvedTextEditorModel } from '../../../../../editor/common/services/resolverService.js';
import { Event } from '../../../../../base/common/event.js';
import { IReference, toDisposable } from '../../../../../base/common/lifecycle.js';
import { URI } from '../../../../../base/common/uri.js';
import { upcastPartial } from '../../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
import { IEditorGroupsService, IEditorPart } from '../../../../services/editor/common/editorGroupsService.js';
import { ITextFileService } from '../../../../services/textfile/common/textfiles.js';
import { IWorkbenchLayoutService } from '../../../../services/layout/browser/layoutService.js';
import { workbenchInstantiationService } from '../../../../test/browser/workbenchTestServices.js';
import { FloatingFileBrowser } from '../../browser/floatingFileBrowser.js';

suite('Floating File Browser Host', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();
	function fixture() {
		const instantiation = workbenchInstantiationService(undefined, store);
		const container = document.createElement('div');
		const editor = container.appendChild(document.createElement('div'));
		document.body.appendChild(container);
		store.add(toDisposable(() => container.remove()));
		instantiation.stub(IWorkbenchLayoutService, upcastPartial<IWorkbenchLayoutService>({ mainContainer: container, getContainer: () => editor, onDidLayoutMainContainer: Event.None }));
		instantiation.stub(IEditorGroupsService, upcastPartial<IEditorGroupsService>({ mainPart: upcastPartial<IEditorPart>({ onDidLayout: Event.None }) }));
		const paths: string[] = [];
		instantiation.stub(IFileService, 'resolve', async (resource: URI) => {
			paths.push(resource.path);
			return { resource, name: 'root', isDirectory: true, isFile: false, isSymbolicLink: false, children: [
				{ resource: URI.joinPath(resource, 'src'), name: 'src', isDirectory: true, isFile: false, isSymbolicLink: false },
				{ resource: URI.joinPath(resource, 'app.ts'), name: 'app.ts', isDirectory: false, isFile: true, isSymbolicLink: false },
			] };
		});
		const hidden: boolean[] = [];
		const opened: string[] = [];
		const host = store.add(instantiation.createInstance(FloatingFileBrowser, focus => { hidden.push(focus); host.hideBrowser(); }, async resource => { opened.push(resource.path); throw new Error('Open failed'); }));
		const input = container.querySelector('input')!;
		const key = (key: string, options: KeyboardEventInit = {}) => {
			const target = container.ownerDocument.activeElement ?? input;
			target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...options }));
		};
		const settle = async () => { for (let i = 0; i < 8; i++) { await Promise.resolve(); } };
		return { instantiation, host, container, editor, input, key, settle, paths, hidden, opened };
	}

	test('insert/normal navigation, IME, folder entry and double Escape dismissal', async () => {
		const f = fixture();
		f.host.show(URI.file('/root'));
		await f.settle();
		f.key('Escape', { isComposing: true });
		strictEqual(f.input.readOnly, false);
		f.key('Enter');
		await f.settle();
		f.key('Escape');
		strictEqual(f.input.readOnly, true);
		f.key('h');
		await f.settle();
		f.key('i');
		f.key('Escape');
		f.key('Escape');
		deepStrictEqual([f.paths, f.hidden], [['/root', '/root/src', '/root'], [true]]);
	});

	test('failed opening remains visible; outside editor click dismisses without focus restoration', async () => {
		const f = fixture();
		f.host.show(URI.file('/root'));
		await f.settle();
		f.key('ArrowDown');
		strictEqual(f.container.querySelector('.file-browser-list .selected')?.getAttribute('aria-label'), 'app.ts');
		f.key('Enter');
		await f.settle();
		strictEqual(f.container.querySelector('.file-browser-status')?.textContent, 'Open failed');
		f.editor.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
		deepStrictEqual([f.opened, f.hidden], [['/root/app.ts'], [false]]);
	});
	test('preview uses the existing unsaved model and releases a late reference after dismissal', async () => {
		const f = fixture();
		const resource = URI.file('/root/app.ts');
		const model = store.add(f.instantiation.get(IModelService).createModel('unsaved text', null, resource));
		const pending = new DeferredPromise<IReference<IResolvedTextEditorModel>>();
		let disposed = 0;
		f.instantiation.stub(ITextModelService, 'createModelReference', () => pending.p);
		f.host.show(URI.file('/root'));
		await f.settle();
		f.key('ArrowDown');
		await f.settle();
		f.host.hideBrowser();
		await pending.complete({ object: upcastPartial<IResolvedTextEditorModel>({ textEditorModel: model }), dispose: () => { disposed++; } });
		await f.settle();
		deepStrictEqual([disposed, model.getValue(), f.container.querySelector<HTMLElement>('.terminal-first-file-browser')?.hidden], [1, 'unsaved text', true]);
	});

	test('large and binary files skip text models but remain openable', async () => {
		const f = fixture();
		let size = 2 * 1024 * 1024;
		let references = 0;
		f.instantiation.stub(IFileService, 'stat', async (resource: URI) => ({ resource, size }));
		f.instantiation.stub(ITextFileService, 'read', async () => { throw new Error('Binary'); });
		f.instantiation.stub(ITextModelService, 'createModelReference', async () => { references++; throw new Error('Unexpected preview'); });
		f.host.show(URI.file('/root'));
		await f.settle();
		f.key('ArrowDown');
		await f.settle();
		strictEqual(f.container.querySelector('.file-browser-preview-message')?.textContent?.includes('1 MiB'), true);
		f.key('Enter');
		await f.settle();
		size = 10;
		f.key('ArrowUp');
		f.key('ArrowDown');
		await f.settle();
		deepStrictEqual([references, f.opened, f.container.querySelector('.file-browser-preview-message')?.textContent?.includes('binary')], [0, ['/root/app.ts'], true]);
	});

});
