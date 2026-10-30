/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { ConfirmResult } from '../../../../../platform/dialogs/common/dialogs.js';
import { SyncDescriptor } from '../../../../../platform/instantiation/common/descriptors.js';
import { Registry } from '../../../../../platform/registry/common/platform.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../../platform/storage/common/storage.js';
import { IEditorPartUIState } from '../../../../browser/parts/editor/editorPart.js';
import { EditorPartHooks } from '../../../../browser/parts/editor/editorPartHooks.js';
import { EditorExtensions, EditorsOrder, IEditorFactoryRegistry } from '../../../../common/editor.js';
import { Memento } from '../../../../common/memento.js';
import { EditorService } from '../../../../services/editor/browser/editorService.js';
import { GroupDirection, GroupsOrder, IEditorGroupsService } from '../../../../services/editor/common/editorGroupsService.js';
import { IEditorService } from '../../../../services/editor/common/editorService.js';
import { createEditorPart, ITestInstantiationService, registerTestEditor, registerTestResourceEditor, registerTestSideBySideEditor, TestEditorPart, TestFileEditorInput, TestServiceAccessor, workbenchInstantiationService, workbenchTeardown } from '../../../../test/browser/workbenchTestServices.js';
import { EditorPartSessions, IEditorPartSessions } from '../../browser/editorPartSessions.js';
import { terminalFirstStartup } from '../../../../services/terminalFirst/common/terminalFirstStartup.js';

suite('Terminal First - editor part sessions', () => {

	const TEST_EDITOR_ID = 'MyFileEditorForEditorPartSessions';
	const TEST_EDITOR_INPUT_ID = 'testEditorInputForEditorPartSessions';

	const disposables = new DisposableStore();
	let testLocalInstantiationService: ITestInstantiationService | undefined = undefined;

	setup(() => {
		disposables.add(registerTestEditor(TEST_EDITOR_ID, [new SyncDescriptor(TestFileEditorInput)], TEST_EDITOR_INPUT_ID));
		disposables.add(registerTestResourceEditor());
		disposables.add(registerTestSideBySideEditor());
	});

	teardown(async () => {
		terminalFirstStartup.reset();
		if (testLocalInstantiationService) {
			await workbenchTeardown(testLocalInstantiationService);
			testLocalInstantiationService = undefined;
		}
		disposables.clear();
	});

	async function createPart(): Promise<[TestEditorPart, IEditorPartSessions, ITestInstantiationService]> {
		const instantiationService = workbenchInstantiationService(undefined, disposables);
		instantiationService.invokeFunction(accessor => Registry.as<IEditorFactoryRegistry>(EditorExtensions.EditorFactory).start(accessor));
		const part = await createEditorPart(instantiationService, disposables);
		instantiationService.stub(IEditorGroupsService, part);
		testLocalInstantiationService = instantiationService;
		const sessions = EditorPartSessions.for(part);
		assert.ok(sessions, 'the sessions extension registers with every editor part');
		return [part, sessions, instantiationService];
	}

	async function createEditorService(): Promise<[TestEditorPart, IEditorPartSessions, EditorService]> {
		const [part, sessions, instantiationService] = await createPart();
		const editorService = disposables.add(instantiationService.createInstance(EditorService, undefined));
		instantiationService.stub(IEditorService, editorService);
		return [part, sessions, editorService];
	}

	function createTestFileEditorInput(resource: URI, typeId: string): TestFileEditorInput {
		return disposables.add(new TestFileEditorInput(resource, typeId));
	}

	test('retained sessions restore only after the shell is presented', async () => {
		const [part, sessions, instantiationService] = await createPart();
		await part.whenRestored;
		await part.activeGroup.openEditor(createTestFileEditorInput(URI.file('/one/file.txt'), TEST_EDITOR_INPUT_ID), { pinned: true });
		const state = part.createState();
		await sessions.close('one');
		part.clearState();
		// The next part restores these sessions from the shared memento.
		const memento = new Memento<{ 'editorpart.sessions': { active: string; states: Record<string, IEditorPartUIState> } }>(part.getId(), instantiationService.invokeFunction(accessor => accessor.get(IStorageService)));
		memento.getMemento(StorageScope.WORKSPACE, StorageTarget.USER)['editorpart.sessions'] = { active: 'one', states: { one: state, two: structuredClone(state) } };
		terminalFirstStartup.begin();
		const restoredPart = await createEditorPart(instantiationService, disposables);
		const restoredSessions = EditorPartSessions.for(restoredPart)!;
		const restoredEarly = await Promise.race([restoredPart.whenRestored.then(() => true), new Promise<boolean>(resolve => setTimeout(() => resolve(false), 50))]);
		const idsBefore = [...restoredSessions.ids()];
		terminalFirstStartup.presented();
		await restoredPart.whenRestored;
		assert.deepStrictEqual({ restoredEarly, idsBefore, idsAfter: [...restoredSessions.ids()].sort() }, { restoredEarly: false, idsBefore: [], idsAfter: ['one', 'two'] });
		await restoredSessions.close('one');
		await restoredSessions.close('two');
		restoredPart.clearState();
	});

	test('recover colliding persisted group IDs without losing live groups', async () => {
		const [part, sessions, instantiationService] = await createPart();
		await part.whenRestored;
		const first = part.activeGroup;
		const input = createTestFileEditorInput(URI.file('/one/file.txt'), TEST_EDITOR_INPUT_ID);
		await first.openEditor(input, { pinned: true });
		const state = part.createState();
		const memento = new Memento<{ 'editorpart.sessions': { active: string; states: Record<string, IEditorPartUIState> } }>(part.getId(), instantiationService.invokeFunction(accessor => accessor.get(IStorageService)));
		memento.getMemento(StorageScope.WORKSPACE, StorageTarget.USER)['editorpart.sessions'] = { active: 'one', states: { one: state, two: structuredClone(state) } };
		sessions.activate('one');
		sessions.activate('two');
		const second = part.activeGroup;
		assert.notStrictEqual(second.id, first.id);
		sessions.activate('one');
		part.layout(1080, 800, 0, 0);
		part.testSaveState();
		assert.deepStrictEqual({ first: part.activeGroup === first, input: first.activeEditor === input, retained: part.getGroup(second.id) === second }, { first: true, input: true, retained: true });
		sessions.activate('two');
		part.layout(1080, 800, 0, 0);
		part.testSaveState();
		assert.strictEqual(part.activeGroup, second);
		await sessions.close('one');
		await sessions.close('two');
		part.clearState();
	});

	test('retain live dirty groups without exposing them in active navigation', async () => {
		const [part, sessions] = await createPart();
		sessions.activate('one');
		const first = part.activeGroup;
		const input = createTestFileEditorInput(URI.file('/one/file.txt'), TEST_EDITOR_INPUT_ID);
		await first.openEditor(input);
		input.setDirty();
		let closed = 0;
		disposables.add(first.onDidCloseEditor(() => closed++));
		sessions.activate('two');
		const second = part.activeGroup;
		await second.openEditor(createTestFileEditorInput(URI.file('/two/file.txt'), TEST_EDITOR_INPUT_ID));
		assert.deepStrictEqual({ active: part.groups.map(group => group.id), retained: part.getGroup(first.id) === first, dirty: input.isDirty(), closed }, { active: [second.id], retained: true, dirty: true, closed: 0 });
		sessions.activate('one');
		assert.deepStrictEqual({ active: part.activeGroup === first, input: first.activeEditor === input, closed, groups: part.getGroups(GroupsOrder.GRID_APPEARANCE).map(group => group.id) }, { active: true, input: true, closed: 0, groups: [first.id] });
		await input.revert(first.id);
	});

	test('preserve split layouts on repeated switching', async () => {
		const [part, sessions] = await createPart();
		sessions.activate('one');
		const first = part.activeGroup;
		const right = part.addGroup(first, GroupDirection.RIGHT);
		part.activateGroup(right);
		const ids = part.getGroups(GroupsOrder.GRID_APPEARANCE).map(group => group.id);
		for (let i = 0; i < 3; i++) {
			sessions.activate('two');
			sessions.activate('one');
		}
		assert.deepStrictEqual({ groups: part.getGroups(GroupsOrder.GRID_APPEARANCE).map(group => group.id), active: part.activeGroup.id }, { groups: ids, active: right.id });
	});

	test('preserve unequal four-tile heights when switching and saving spaces with the editor collapsed', async () => {
		if (!EditorPartHooks.layout) {
			// Match tile focus behavior without registering the product's global styling hook.
			disposables.add(EditorPartHooks.setLayoutHook({ expandMinimizedGroupOnActivate: false }));
		}
		const [part, sessions, instantiationService] = await createPart();
		sessions.activate('one');
		part.layout(1080, 800, 0, 0);
		const topLeft = part.activeGroup;
		const topRight = part.addGroup(topLeft, GroupDirection.RIGHT);
		const bottomLeft = part.addGroup(topLeft, GroupDirection.DOWN);
		const bottomRight = part.addGroup(topRight, GroupDirection.DOWN);
		part.activateGroup(bottomRight);
		part.setSize(topLeft, { width: 540, height: 700 });
		part.setSize(topRight, { width: 540, height: 700 });
		const groups = [topLeft, topRight, bottomLeft, bottomRight];
		const before = groups.map(group => part.getSize(group));
		const gridBefore = part.createState().serializedGrid;
		// Shell mode maximizes the panel, leaving no height for the editor grid.
		part.layout(1080, 0, 0, 0);
		sessions.activate('two');
		part.testSaveState();
		const memento = new Memento<{ 'editorpart.sessions': { states: Record<string, IEditorPartUIState> } }>(part.getId(), instantiationService.invokeFunction(accessor => accessor.get(IStorageService)));
		const savedGrid = memento.getMemento(StorageScope.WORKSPACE, StorageTarget.USER)['editorpart.sessions']!.states.one.serializedGrid;
		sessions.activate('one');
		part.layout(1080, 800, 0, 0);
		for (let i = 0; i < 3; i++) {
			sessions.activate('two');
			sessions.activate('one');
		}
		assert.deepStrictEqual({ sizes: groups.map(group => part.getSize(group)), savedGrid }, { sizes: before, savedGrid: gridBefore });
		part.clearState();
	});

	test('cancelling a session close preserves all of its editor groups', async () => {
		const [part, sessions, instantiationService] = await createPart();
		sessions.activate('one');
		const left = part.activeGroup;
		const right = part.addGroup(left, GroupDirection.RIGHT);
		const clean = createTestFileEditorInput(URI.file('/one/clean.txt'), TEST_EDITOR_INPUT_ID);
		const dirty = createTestFileEditorInput(URI.file('/one/dirty.txt'), TEST_EDITOR_INPUT_ID);
		await left.openEditor(clean);
		await right.openEditor(dirty);
		dirty.setDirty();
		const accessor = instantiationService.createInstance(TestServiceAccessor);
		accessor.fileDialogService.setConfirmResult(ConfirmResult.CANCEL);
		const closed = await sessions.close('one');
		assert.deepStrictEqual([closed, left.contains(clean), right.contains(dirty), part.groups.length], [false, true, true, 2]);
		await dirty.revert(right.id);
	});

	test('swap exchanges the grid cells of two groups', async () => {
		const [part, sessions] = await createPart();
		const left = part.activeGroup;
		const right = part.addGroup(left, GroupDirection.RIGHT);
		part.setSize(left, { width: 700, height: 800 });
		const before = [part.getSize(left).width, part.getSize(right).width];
		sessions.swapGroups(left, right);
		assert.deepStrictEqual({ order: part.getGroups(GroupsOrder.GRID_APPEARANCE).map(group => group.id), sizes: [part.getSize(left).width, part.getSize(right).width] }, { order: [right.id, left.id], sizes: [before[1], before[0]] });
	});

	test('closing a shared input leaves its retained session alive', async () => {
		const [part, sessions, service] = await createEditorService();
		sessions.activate('one');
		const input = createTestFileEditorInput(URI.file('/shared/file.txt'), TEST_EDITOR_INPUT_ID);
		await service.openEditor(input);
		sessions.activate('two');
		await service.openEditor(input);
		await part.activeGroup.closeAllEditors();
		assert.strictEqual(input.isDisposed(), false);
		sessions.activate('one');
		assert.strictEqual(service.activeEditor, input);
	});

	test('retained session editors are excluded from navigation but included in Save All', async () => {
		const [, sessions, service] = await createEditorService();
		sessions.activate('one');
		const input = createTestFileEditorInput(URI.file('/one/file.txt'), TEST_EDITOR_INPUT_ID);
		await service.openEditor(input);
		input.setDirty();
		sessions.activate('two');
		assert.deepStrictEqual(service.getEditors(EditorsOrder.MOST_RECENTLY_ACTIVE), []);
		assert.deepStrictEqual(service.getEditors(EditorsOrder.MOST_RECENTLY_ACTIVE, { includeInactive: true }).map(({ editor }) => editor), [input]);
		await service.saveAll();
		assert.deepStrictEqual([input.gotSaved, input.isDirty()], [true, false]);
		sessions.activate('one');
		assert.strictEqual(service.activeEditor, input);
	});

	ensureNoDisposablesAreLeakedInTestSuite();
});
