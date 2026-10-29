/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { deepStrictEqual, strictEqual } from 'assert';
import { DeferredPromise } from '../../../../../base/common/async.js';
import { Emitter, Event } from '../../../../../base/common/event.js';
import { URI } from '../../../../../base/common/uri.js';
import { upcastPartial } from '../../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { FileChangesEvent, IFileService, IFileStatWithMetadata } from '../../../../../platform/files/common/files.js';
import { FileBrowserModel, filterFileBrowserEntries } from '../../browser/fileBrowserModel.js';

suite('Floating File Browser Model', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();
	const stat = (path: string, directory = false): IFileStatWithMetadata => ({ resource: URI.file(path), name: path.split('/').pop()!, isDirectory: directory, isFile: !directory, isSymbolicLink: false, readonly: false, locked: false, executable: false, mtime: 0, ctime: 0, size: 0, etag: '', children: undefined });
	const settle = async () => { await Promise.resolve(); await Promise.resolve(); };

	test('folders first, dotfiles optional, fuzzy ranking and highlights', () => {
		const children = [stat('/root/z.ts'), stat('/root/src', true), stat('/root/.git', true), stat('/root/app.ts'), stat('/root/apt.ts')];
		const filtered = filterFileBrowserEntries(children, 'app', false);
		deepStrictEqual({ names: filterFileBrowserEntries(children, '', false).map(entry => entry.stat.name), hidden: filterFileBrowserEntries(children, '', true).map(entry => entry.stat.name), filtered: filtered.map(entry => [entry.stat.name, entry.matches]) }, {
			names: ['src', 'app.ts', 'apt.ts', 'z.ts'], hidden: ['.git', 'src', 'app.ts', 'apt.ts', 'z.ts'], filtered: [['app.ts', [{ start: 0, end: 3 }]]],
		});
	});

	test('navigation discards stale reads and dismissal disposes directory watcher', async () => {
		const first = new DeferredPromise<IFileStatWithMetadata>();
		const second = new DeferredPromise<IFileStatWithMetadata>();
		let disposed = 0;
		const model = store.add(new FileBrowserModel(upcastPartial<IFileService>({
			resolve: resource => resource.path === '/first' ? first.p : second.p,
			createWatcher: () => ({ onDidChange: Event.None, dispose: () => { disposed++; } }),
		})));
		model.show(URI.file('/first'));
		model.navigate(URI.file('/second'));
		await second.complete({ ...stat('/second', true), children: [stat('/second/new.ts')] });
		await first.complete({ ...stat('/first', true), children: [stat('/first/stale.ts')] });
		await settle();
		deepStrictEqual([model.directory?.path, model.entries.map(entry => entry.stat.name), disposed], ['/second', ['new.ts'], 1]);
		model.hide();
		deepStrictEqual([model.directory, model.entries, disposed], [undefined, [], 2]);
	});

	test('parent stops at filesystem root; every opening resets query and hidden files', async () => {
		const paths: string[] = [];
		const model = store.add(new FileBrowserModel(upcastPartial<IFileService>({
			resolve: async resource => { paths.push(resource.path); return { ...stat(resource.path, true), children: [] }; },
			createWatcher: () => ({ onDidChange: Event.None, dispose: () => { } }),
		})));
		model.show(URI.file('/root'));
		model.parent();
		model.parent();
		model.setQuery('test');
		model.toggleHidden();
		model.show(URI.file('/root'));
		await settle();
		deepStrictEqual([paths, model.query, model.hidden, model.root?.path], [['/root', '/', '/root'], '', false, '/root']);
	});

	test('filter preserves selection by URI and missing directory exposes recoverable error', async () => {
		const model = store.add(new FileBrowserModel(upcastPartial<IFileService>({
			resolve: async resource => {
				if (resource.path === '/missing') { throw new Error('Directory missing'); }
				return { ...stat('/root', true), children: [stat('/root/a.ts'), stat('/root/b.ts')] };
			},
			createWatcher: () => ({ onDidChange: Event.None, dispose: () => { } }),
		})));
		model.show(URI.file('/root'));
		await settle();
		model.selected = URI.file('/root/b.ts');
		model.setQuery('.ts');
		strictEqual(model.selected?.path, '/root/b.ts');
		model.navigate(URI.file('/missing'));
		await settle();
		deepStrictEqual([model.error, model.loading, model.entries], ['Directory missing', false, []]);
		model.navigate(URI.file('/root'));
		await settle();
		deepStrictEqual([model.error, model.entries.length], [undefined, 2]);
	});
	test('directory watcher refresh preserves the selected URI', async () => {
		const changes = store.add(new Emitter<FileChangesEvent>());
		let children = [stat('/root/a.ts'), stat('/root/b.ts')];
		const model = store.add(new FileBrowserModel(upcastPartial<IFileService>({
			resolve: async () => ({ ...stat('/root', true), children }),
			createWatcher: () => ({ onDidChange: changes.event, dispose: () => { } }),
		})));
		model.show(URI.file('/root'));
		await settle();
		model.selected = URI.file('/root/b.ts');
		children = [stat('/root/b.ts'), stat('/root/c.ts')];
		const refreshed = Event.toPromise(Event.filter(model.onDidChange, () => !model.loading));
		changes.fire(new FileChangesEvent([], false));
		await refreshed;
		deepStrictEqual([model.entries.map(entry => entry.stat.name), model.selected?.path], [['b.ts', 'c.ts'], '/root/b.ts']);
	});

});
