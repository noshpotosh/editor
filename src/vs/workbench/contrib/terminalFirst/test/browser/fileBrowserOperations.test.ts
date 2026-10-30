/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { deepStrictEqual, rejects } from 'assert';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { IBulkEditOptions, IBulkEditService, ResourceEdit, ResourceFileEdit } from '../../../../../editor/browser/services/bulkEditService.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { upcastPartial } from '../../../../../base/test/common/mock.js';
import { IWorkingCopy } from '../../../../services/workingCopy/common/workingCopy.js';
import { IConfirmation, IDialogService } from '../../../../../platform/dialogs/common/dialogs.js';
import { IFileService, IFileStat } from '../../../../../platform/files/common/files.js';
import { IQuickInputService } from '../../../../../platform/quickinput/common/quickInput.js';
import { IFilesConfigurationService } from '../../../../services/filesConfiguration/common/filesConfigurationService.js';
import { IWorkingCopyFileService } from '../../../../services/workingCopy/common/workingCopyFileService.js';
import { workbenchInstantiationService } from '../../../../test/browser/workbenchTestServices.js';
import { FileBrowserOperations } from '../../browser/fileBrowserOperations.js';

suite('Floating File Browser Operations', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();
	const stat = (path: string, folder = false): IFileStat => ({ resource: URI.file(path), name: path.split('/').pop()!, isDirectory: folder, isFile: !folder, isSymbolicLink: false, children: undefined });
	function fixture() {
		const instantiation = workbenchInstantiationService(undefined, store);
		const applied: ResourceFileEdit[] = [];
		const groups: (number | undefined)[] = [];
		const answers: (string | undefined)[] = [];
		const existing = new Set<string>();
		const confirmations: string[] = [];
		let failAt = -1;
		let confirm = true;
		instantiation.stub(IFileService, 'exists', async (resource: URI) => existing.has(resource.path));
		instantiation.stub(IFileService, 'hasCapability', () => false);
		instantiation.stub(IQuickInputService, 'input', async () => answers.shift());
		instantiation.stub(IFilesConfigurationService, 'isReadonly', () => false);
		instantiation.stub(IWorkingCopyFileService, 'getDirty', () => []);
		instantiation.stub(IDialogService, 'confirm', async (confirmation: IConfirmation) => { confirmations.push(confirmation.message); return { confirmed: confirm }; });
		instantiation.stub(IBulkEditService, { apply: async (edit: ResourceEdit[], options?: IBulkEditOptions) => {
			if (applied.length === failAt) { throw new Error('Permission denied'); }
			groups.push(options?.undoRedoGroupId);
			applied.push(...edit.map(change => ResourceFileEdit.lift(change as ResourceFileEdit)));
			return { isApplied: true, ariaSummary: '' };
		} });
		const operations = instantiation.createInstance(FileBrowserOperations);
		return { operations, instantiation, answers, existing, applied, confirmations, groups, failAt: (index: number) => { failAt = index; }, cancel: () => { confirm = false; } };
	}

	test('create uses a non-overwriting bulk edit and trailing slash creates folders', async () => {
		const f = fixture();
		await f.operations.run('create', URI.file('/root'), [], false, 'new/');
		deepStrictEqual(f.applied.map(edit => [edit.newResource?.path, edit.options.folder, edit.options.overwrite]), [['/root/new', true, false]]);
	});

	test('batch rename cancellation and destination collision apply nothing', async () => {
		const f = fixture();
		f.answers.push('renamed', undefined);
		await f.operations.run('rename', URI.file('/root'), [stat('/root/a'), stat('/root/b')], true);
		f.existing.add('/root/new');
		await rejects(f.operations.run('create', URI.file('/root'), [], false, 'new'), /already exists/);
		deepStrictEqual(f.applied, []);
	});

	test('move rejects recursive destinations and overlapping batch targets', async () => {
		const f = fixture();
		await rejects(f.operations.run('move', URI.file('/root/a/child'), [stat('/root/a', true)], true), /outside the source/);
		await rejects(f.operations.run('copy', URI.file('/target'), [stat('/one/a'), stat('/two/a')], true), /overlapping/);
		deepStrictEqual(f.applied, []);
	});

	test('copy normalizes nested selections and preserves the copy flag', async () => {
		const f = fixture();
		await f.operations.run('copy', URI.file('/target'), [stat('/root/a', true), stat('/root/a/b')], true);
		deepStrictEqual(f.applied.map(edit => [edit.oldResource?.path, edit.newResource?.path, edit.options.copy]), [['/root/a', '/target/a', true]]);
	});

	test('permanent deletion is explicitly confirmed and cancellation applies nothing', async () => {
		const f = fixture();
		f.cancel();
		await f.operations.run('delete', URI.file('/root'), [stat('/root/a')], false);
		deepStrictEqual([f.confirmations.length, f.confirmations[0].includes('Permanently'), f.applied], [1, true, []]);
	});

	test('read-only resources are rejected before mutation', async () => {
		const f = fixture();
		f.instantiation.stub(IFilesConfigurationService, 'isReadonly', () => true);
		await rejects(f.operations.run('delete', URI.file('/root'), [stat('/root/a')], false), /read-only/);
		deepStrictEqual(f.applied, []);
	});

	test('partial failure reports completed operations and acknowledges only completed sources', async () => {
		const f = fixture();
		f.failAt(1);
		const completed: string[] = [];
		await rejects(f.operations.run('move', URI.file('/target'), [stat('/root/a'), stat('/root/b')], true, undefined, () => false, resource => completed.push(resource.path)), /Completed 1 of 2/);
		deepStrictEqual([completed, f.applied.length], [['/root/a'], 1]);
	});

	test('dismissal while collecting input prevents mutation', async () => {
		const f = fixture();
		f.answers.push('new');
		await f.operations.run('create', URI.file('/root'), [], false, undefined, () => true);
		deepStrictEqual(f.applied, []);
	});
	test('Trash respects confirmation preferences but dirty files still require confirmation', async () => {
		const f = fixture();
		f.instantiation.stub(IFileService, 'hasCapability', () => true);
		f.instantiation.stub(IConfigurationService, 'getValue', (key: string) => key === 'files.enableTrash');
		await f.operations.run('delete', URI.file('/root'), [stat('/root/a')], false);
		f.instantiation.stub(IWorkingCopyFileService, 'getDirty', () => [upcastPartial<IWorkingCopy>({ resource: URI.file('/root/b') })]);
		f.cancel();
		await f.operations.run('delete', URI.file('/root'), [stat('/root/b')], false);
		deepStrictEqual([f.applied.length, f.applied[0].options.skipTrashBin, f.confirmations.length], [1, false, 1]);
	});

	test('batch edits share an undo group', async () => {
		const f = fixture();
		await f.operations.run('move', URI.file('/target'), [stat('/root/a'), stat('/root/b')], true);
		deepStrictEqual([f.groups.length, typeof f.groups[0], f.groups[0] === f.groups[1]], [2, 'number', true]);
	});

});
