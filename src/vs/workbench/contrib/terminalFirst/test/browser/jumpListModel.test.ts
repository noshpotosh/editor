/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { deepStrictEqual } from 'assert';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../../platform/storage/common/storage.js';
import { IUriIdentityService } from '../../../../../platform/uriIdentity/common/uriIdentity.js';
import { workbenchInstantiationService } from '../../../../test/browser/workbenchTestServices.js';
import { JumpListModel } from '../../browser/jumpListModel.js';

suite('Jump List Model', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();
	function fixture() {
		const instantiation = workbenchInstantiationService(undefined, store);
		const model = instantiation.createInstance(JumpListModel);
		model.load(URI.file('/project'));
		return { instantiation, model, paths: () => model.entries.map(item => item.path) };
	}

	test('unique additions, delete/put ordering, undo and redo persist immediately', () => {
		const f = fixture();
		for (const name of ['a', 'b', 'c']) { f.model.add(URI.file(`/project/${name}`)); }
		const duplicate = f.model.add(URI.file('/project/a'));
		f.model.remove(0);
		const selected = f.model.put(1, false);
		f.model.put(0, true);
		const moved = f.paths();
		f.model.undo();
		const undone = f.paths();
		f.model.redo();
		const redone = f.paths();
		f.model.load(URI.file('/project'));
		f.model.undo();
		const undoneAfterReload = f.paths();
		f.model.redo();
		const movedDown = f.model.move(0, 1);
		const movedPast = f.model.move(2, 5);
		deepStrictEqual({ duplicate, selected, moved, undone, redone, undoneAfterReload, movedDown, movedPast, reordered: f.paths() }, {
			duplicate: false, selected: 2, moved: ['/project/b', '/project/c', '/project/a'], undone: ['/project/b', '/project/c'],
			redone: ['/project/b', '/project/c', '/project/a'], undoneAfterReload: ['/project/b', '/project/c'], movedDown: 1, movedPast: 2, reordered: ['/project/c', '/project/b', '/project/a'],
		});
	});

	test('empty list operations, put before, branch after undo and project isolation', () => {
		const f = fixture();
		f.model.remove(0); f.model.put(0, false); f.model.undo(); f.model.redo();
		f.model.add(URI.file('/project/a'));
		f.model.remove(0); f.model.put(0, true);
		f.model.undo(); f.model.add(URI.file('/project/b')); f.model.redo();
		const first = f.paths();
		f.model.load(URI.file('/other'));
		const other = f.paths();
		f.model.add(URI.file('/other/c'));
		f.model.load(URI.file('/project'));
		deepStrictEqual([first, other, f.paths()], [['/project/b'], [], ['/project/b']]);
	});

	test('malformed storage, invalid URIs and duplicate entries are ignored', () => {
		const f = fixture();
		const key = `terminalFirst.jumpList.v1.${f.instantiation.get(IUriIdentityService).extUri.getComparisonKey(URI.file('/project'))}`;
		const storage = f.instantiation.get(IStorageService);
		const results: string[][] = [];
		for (const value of ['bad json', { version: 2, entries: ['file:///project/a'] }, { version: 1, entries: [null, 42, 'invalid', 'untitled:test', 'file:///project/a', 'file:///project/a', 'file:///missing'] }]) {
			storage.store(key, value, StorageScope.PROFILE, StorageTarget.MACHINE);
			f.model.load(URI.file('/project'));
			results.push(f.paths());
		}
		deepStrictEqual(results, [[], [], ['/project/a', '/missing']]);
	});

	test('nearest Git marker handles nested roots and worktrees; no marker falls back to session directory', async () => {
		const f = fixture();
		f.instantiation.stub(IFileService, 'exists', async (resource: URI) => ['/repo/.git', '/repo/nested/.git', '/worktree/.git'].includes(resource.path));
		const roots = [];
		for (const path of ['/repo/src/deep', '/repo/nested/src', '/worktree/src', '/plain/src']) {
			roots.push((await f.model.resolveProject(URI.file(path))).path);
		}
		deepStrictEqual(roots, ['/repo', '/repo/nested', '/worktree', '/plain/src']);
	});
});
