/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { SyncDescriptor } from '../../../../../platform/instantiation/common/descriptors.js';
import { Registry } from '../../../../../platform/registry/common/platform.js';
import { EditorExtensions, EditorInputCapabilities, IEditorFactoryRegistry } from '../../../../common/editor.js';
import { EditorService } from '../../../../services/editor/browser/editorService.js';
import { GroupDirection, IEditorGroupsService } from '../../../../services/editor/common/editorGroupsService.js';
import { IEditorService } from '../../../../services/editor/common/editorService.js';
import { createEditorPart, ITestInstantiationService, registerTestEditor, registerTestResourceEditor, registerTestSideBySideEditor, TestEditorPart, TestFileEditorInput, workbenchInstantiationService, workbenchTeardown } from '../../../../test/browser/workbenchTestServices.js';
import '../../browser/tileRouting.js';

suite('Terminal First - tile routing', () => {

	const TEST_EDITOR_ID = 'MyTestEditorForTileRouting';
	const TEST_EDITOR_INPUT_ID = 'testEditorInputForTileRouting';

	const disposables = new DisposableStore();
	let testLocalInstantiationService: ITestInstantiationService | undefined = undefined;

	setup(() => {
		disposables.add(registerTestEditor(TEST_EDITOR_ID, [new SyncDescriptor(TestFileEditorInput)], TEST_EDITOR_INPUT_ID));
		disposables.add(registerTestResourceEditor());
		disposables.add(registerTestSideBySideEditor());
	});

	teardown(async () => {
		if (testLocalInstantiationService) {
			await workbenchTeardown(testLocalInstantiationService);
			testLocalInstantiationService = undefined;
		}
		disposables.clear();
	});

	async function createEditorService(): Promise<[TestEditorPart, EditorService]> {
		const instantiationService = workbenchInstantiationService(undefined, disposables);
		instantiationService.invokeFunction(accessor => Registry.as<IEditorFactoryRegistry>(EditorExtensions.EditorFactory).start(accessor));
		const part = await createEditorPart(instantiationService, disposables);
		instantiationService.stub(IEditorGroupsService, part);
		const editorService = disposables.add(instantiationService.createInstance(EditorService, undefined));
		instantiationService.stub(IEditorService, editorService);
		testLocalInstantiationService = instantiationService;
		return [part, editorService];
	}

	function input(uri: string, dedicated = false): TestFileEditorInput {
		const editor = disposables.add(new TestFileEditorInput(URI.parse(uri), TEST_EDITOR_INPUT_ID));
		if (dedicated) {
			editor.capabilities = EditorInputCapabilities.RequiresDedicatedGroup;
		}
		return editor;
	}

	test('dedicated tool groups route files to the last editor group, including explicit targets', async () => {
		const [part, service] = await createEditorService();
		const editorGroup = part.activeGroup;
		const file = input('file:///tile-file');
		await service.openEditor(file, { pinned: true }, editorGroup);
		const tool = input('test:///tool-tile', true);
		const toolGroup = part.addGroup(editorGroup, GroupDirection.RIGHT);
		await service.openEditor(tool, { pinned: true }, toolGroup);
		const second = input('file:///tile-second');
		await service.openEditor(second, { pinned: true }, toolGroup);
		assert.deepStrictEqual({ tools: toolGroup.editors, files: editorGroup.editors }, { tools: [tool], files: [file, second] });
	});

	test('dedicated tool groups create an editor tile only when it fits', async () => {
		const [part, service] = await createEditorService();
		const tool = input('test:///only-tool', true);
		await service.openEditor(tool, { pinned: true });
		const file = input('file:///new-tile-file');
		part.layout(300, 250, 0, 0);
		await assert.rejects(service.openEditor(file), /not enough room/);
		assert.deepStrictEqual({ count: part.count, inputs: part.activeGroup.editors }, { count: 1, inputs: [tool] });
		part.layout(1080, 800, 0, 0);
		await service.openEditor(file);
		assert.deepStrictEqual(part.groups.map(group => group.editors), [[tool], [file]]);
	});

	test('dedicated tool groups reject tab moves and retain their input', async () => {
		const [part, service] = await createEditorService();
		const editorGroup = part.activeGroup;
		const file = input('file:///tile-file');
		await service.openEditor(file, { pinned: true }, editorGroup);
		const tool = input('test:///tool-tile', true);
		const toolGroup = part.addGroup(editorGroup, GroupDirection.RIGHT);
		await service.openEditor(tool, { pinned: true }, toolGroup);
		editorGroup.moveEditor(file, toolGroup);
		assert.deepStrictEqual({ tools: toolGroup.editors, files: editorGroup.editors }, { tools: [tool], files: [file] });
	});

	test('copying a dedicated group yields an empty split', async () => {
		const [part, service] = await createEditorService();
		const tool = input('test:///copy-tool', true);
		await service.openEditor(tool, { pinned: true });
		const copy = part.copyGroup(part.activeGroup, part.activeGroup, GroupDirection.RIGHT);
		assert.deepStrictEqual(copy.editors, []);
	});

	ensureNoDisposablesAreLeakedInTestSuite();
});
