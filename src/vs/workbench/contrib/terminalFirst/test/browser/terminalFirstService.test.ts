/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { deepStrictEqual, rejects, strictEqual } from 'assert';
import { DeferredPromise } from '../../../../../base/common/async.js';
import { IExtensionService } from '../../../../services/extensions/common/extensions.js';
import { Emitter, Event } from '../../../../../base/common/event.js';
import { toDisposable } from '../../../../../base/common/lifecycle.js';
import { URI } from '../../../../../base/common/uri.js';
import { upcastPartial } from '../../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
import { IPath } from '../../../../../platform/window/common/window.js';
import { EditorCloseContext, EditorInputWithOptions, IEditorCloseEvent, IEditorPane, IUntypedEditorInput, isResourceEditorInput } from '../../../../common/editor.js';
import { ITextResourceEditorInput } from '../../../../../platform/editor/common/editor.js';
import { IEditorService } from '../../../../services/editor/common/editorService.js';
import { IEditorGroupsService, IEditorPart, IEditorGroup } from '../../../../services/editor/common/editorGroupsService.js';
import { IWorkbenchEnvironmentService } from '../../../../services/environment/common/environmentService.js';
import { IWorkbenchLayoutService, Parts } from '../../../../services/layout/browser/layoutService.js';
import { TestEditorInput, TestEditorService, workbenchInstantiationService } from '../../../../test/browser/workbenchTestServices.js';
import { ITerminalEditorService, ITerminalGroupService, ITerminalInstance, ITerminalService } from '../../../terminal/browser/terminal.js';
import { IWorkspaceEditingService } from '../../../../services/workspaces/common/workspaceEditing.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../../platform/storage/common/storage.js';
import { IWorkspaceContextService, IWorkspace } from '../../../../../platform/workspace/common/workspace.js';
import { IDialogService } from '../../../../../platform/dialogs/common/dialogs.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { TestDialogService } from '../../../../../platform/dialogs/test/common/testDialogService.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { terminalFirstPolicy } from '../../../../services/terminalFirst/common/terminalFirstPolicy.js';
import { TerminalFirstService } from '../../browser/terminalFirstService.js';

suite('Terminal First', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();
	teardown(() => { terminalFirstPolicy.mode = 'starting'; });

	/** Creates real controller behavior with terminal and layout boundaries replaced by small fakes. */
	function fixture(filesToOpenOrCreate?: IPath[]) {
		const instantiationService = workbenchInstantiationService(undefined, store);
		const activeChanged = store.add(new Emitter<void>());
		const closed = store.add(new Emitter<IEditorCloseEvent>());
		const focused = store.add(new Emitter<ITerminalInstance>());
		const created: ITerminalInstance[] = [];
		const terminals: ITerminalInstance[] = [];
		const allTerminals: ITerminalInstance[] = [];
		const disposed = store.add(new Emitter<ITerminalInstance>());
		const dialog = new TestDialogService();
		const config = new TestConfigurationService();
		let failCreation = false;
		let editorFocusCount = 0;
		let cancelEditorClose = false;
		const disposedIds: number[] = [];
		let active: ITerminalInstance | undefined;
		let maximized = false;
		const hidden = new Map<Parts, boolean>();
		const commands: string[] = [];
		const mainContainer = document.createElement('div');
		mainContainer.classList.add('terminal-first-starting');
		const opened: ITextResourceEditorInput[][] = [];

		class Editors extends TestEditorService {
			override readonly onDidActiveEditorChange = activeChanged.event;
			override readonly onDidCloseEditor = closed.event;
			override async openEditors(inputs: (IUntypedEditorInput | EditorInputWithOptions)[]): Promise<IEditorPane[]> {
				const resources = inputs.map(input => {
					if (!isResourceEditorInput(input)) {
						throw new Error('Expected a resource editor input');
					}
					return input;
				});
				opened.push(resources);
				this.editors = resources.map(input => store.add(new TestEditorInput(input.resource, 'test')));
				this.activeEditor = this.editors[0];
				activeChanged.fire();
				return [];
			}
		}
		const editors = store.add(new Editors());
		const addTerminal = (floating = false) => {
			const id = allTerminals.length + 1;
			const terminal = upcastPartial<ITerminalInstance>({
				instanceId: id,
				shellLaunchConfig: { terminalFirstFloating: floating },
				onTitleChanged: Event.None,
				attachToElement: () => { },
				detachFromElement: () => { },
				setVisible: () => { },
				layout: () => { },
				dispose: () => {
					disposedIds.push(id);
					const index = terminals.indexOf(terminal);
					if (index >= 0) { terminals.splice(index, 1); }
					disposed.fire(terminal);
				},
				title: `Shell ${id}`,
				capabilities: upcastPartial<ITerminalInstance['capabilities']>({ get: () => undefined }),
				shellIntegrationNonce: `session-${id}`,
				focusWhenReady: async () => { focused.fire(terminal); },
			});
			allTerminals.push(terminal);
			if (!floating) { terminals.push(terminal); }
			active = terminal;
			return terminal;
		};
		instantiationService.stub(IEditorService, editors);
		instantiationService.stub(ITerminalEditorService, upcastPartial<ITerminalEditorService>({ openEditor: async () => { } }));
		instantiationService.stub(ITerminalService, upcastPartial<ITerminalService>({
			whenConnected: Promise.resolve(),
			instances: allTerminals,
			onDidDisposeInstance: disposed.event,
			onAnyInstanceTitleChange: Event.None,
			createTerminal: async options => { if (failCreation) { throw new Error('launch failed'); } const terminal = addTerminal(options?.terminalFirstFloating); created.push(terminal); return terminal; },
			setActiveInstance: terminal => { active = terminal; },
		}));
		instantiationService.stub(ITerminalGroupService, upcastPartial<ITerminalGroupService>({
			instances: terminals,
			get activeInstance() { return active && terminals.includes(active) ? active : undefined; },
			showPanel: async () => { hidden.set(Parts.PANEL_PART, false); },
		}));
		instantiationService.stub(IWorkbenchLayoutService, upcastPartial<IWorkbenchLayoutService>({
			whenRestored: Promise.resolve(),
			mainContainer,
			onDidLayoutMainContainer: Event.None,
			getContainer: () => document.createElement('div'),
			setPartHidden: (value, part) => { hidden.set(part, value); },
			isPanelMaximized: () => maximized,
			toggleMaximizedPanel: () => { maximized = !maximized; },
			setPanelPosition: () => { },
			setPanelAlignment: () => { },
			layout: () => { },
		}));
		instantiationService.stub(IEditorGroupsService, upcastPartial<IEditorGroupsService>({ mainPart: upcastPartial<IEditorPart>({ groups: [upcastPartial<IEditorGroup>({ id: 0 })], count: 1, onDidAddGroup: Event.None, onDidRemoveGroup: Event.None, onDidLayout: Event.None, sessions: { activate: () => { }, owns: () => true, ids: () => [], close: async () => !cancelEditorClose } }), activeGroup: upcastPartial<IEditorGroup>({ focus: () => { editorFocusCount++; } }), enforcePartOptions: () => toDisposable(() => { }) }));
		instantiationService.stub(ICommandService, upcastPartial<ICommandService>({ executeCommand: async id => { commands.push(id); return undefined; } }));
		instantiationService.stub(IWorkbenchEnvironmentService, upcastPartial<IWorkbenchEnvironmentService>({ filesToOpenOrCreate, workspaceStorageHome: URI.file('/managed') }));
		instantiationService.stub(IFileService, 'exists', async (resource: URI) => !resource.path.endsWith('new.ts'));
		instantiationService.stub(IWorkspaceEditingService, upcastPartial<IWorkspaceEditingService>({}));
		const managed = URI.file('/managed/vs-nosh.code-workspace');
		const workspace = { id: 'test', folders: [] as IWorkspace['folders'], configuration: managed };
		instantiationService.stub(IWorkspaceContextService, 'getWorkspace', () => workspace);
		instantiationService.stub(IWorkspaceEditingService, upcastPartial<IWorkspaceEditingService>({ updateFolders: async (_index, _count, folders) => { workspace.folders = (folders ?? []).map((folder, index) => ({ uri: folder.uri, name: 'test', index, toResource: (path: string) => URI.joinPath(folder.uri, path) })); } }));
		instantiationService.get(IStorageService).store('terminalFirst.sessions', { managedWorkspace: managed.toString(), sessions: [] }, StorageScope.WORKSPACE, StorageTarget.MACHINE);
		instantiationService.stub(IDialogService, dialog);
		instantiationService.stub(IConfigurationService, config);
		const service = store.add(instantiationService.createInstance(TerminalFirstService));
		return { instantiationService, service, mainContainer, disposedIds, cancelEditorClose: () => { cancelEditorClose = true; }, dialog, config, storage: instantiationService.get(IStorageService), failCreation: () => { failCreation = true; }, get editorFocusCount() { return editorFocusCount; }, editors, addTerminal, terminals, created, hidden, commands, opened, focused, closed, workspace, get active() { return active; }, get maximized() { return maximized; } };
	}

	test('presents the shell before extension registration completes', async () => {
		const state = fixture();
		const registered = new DeferredPromise<boolean>();
		state.instantiationService.stub(IExtensionService, 'whenInstalledExtensionsRegistered', () => registered.p);
		await state.service.initialize();
		deepStrictEqual({ shell: state.mainContainer.classList.contains('terminal-first-shell'), cli: state.commands.includes('terminalFirst.initializeShell') }, { shell: true, cli: false });
		await registered.complete(true);
	});

	test('reveals the settled shell after startup', async () => {
		const state = fixture();
		const pending = state.service.initialize();
		strictEqual(state.mainContainer.classList.contains('terminal-first-starting'), true);
		await pending;
		deepStrictEqual([state.mainContainer.classList.contains('terminal-first-starting'), state.mainContainer.classList.contains('terminal-first-shell'), state.maximized], [false, true, true]);
	});

	test('startup failure reveals the workbench for recovery', async () => {
		const state = fixture();
		state.failCreation();
		await rejects(state.service.initialize(), /launch failed/);
		strictEqual(state.mainContainer.classList.contains('terminal-first-starting'), false);
	});

	test('bare code enters the editor in the supplied directory without opening files', async () => {
		const state = fixture();
		await state.service.initialize();
		await state.service.openFiles([], state.active!.shellIntegrationNonce, false, 'file:///project/nested');
		deepStrictEqual({
			mode: state.service.sessions[0].mode,
			folders: state.workspace.folders.map(folder => folder.uri.path),
			opened: state.opened,
			focused: state.editorFocusCount,
		}, { mode: 'editor', folders: ['/project/nested'], opened: [], focused: 1 });
	});

	test('file browser is editor-only, excludes terminal overlay, and leaves session directory unchanged', async () => {
		const state = fixture();
		await state.service.initialize();
		await state.service.toggleFloatingFileBrowser();
		strictEqual(state.service.floatingFileBrowserVisible, false);
		await state.service.openFiles(['file:///project/app.ts'], state.active!.shellIntegrationNonce, false, 'file:///project');
		await state.service.toggleFloatingTerminal();
		await state.service.toggleFloatingFileBrowser();
		deepStrictEqual([state.service.floatingFileBrowserVisible, state.service.floatingTerminalVisible, state.workspace.folders.map(folder => folder.uri.path)], [true, false, ['/project']]);
		await state.service.toggleFloatingTerminal();
		deepStrictEqual([state.service.floatingFileBrowserVisible, state.service.floatingTerminalVisible], [false, true]);
		await state.service.toggleFloatingFileBrowser();
		const count = state.editorFocusCount;
		await state.service.hideFloatingFileBrowser();
		strictEqual(state.editorFocusCount, count + 1);
		await state.service.toggleFloatingFileBrowser();
		await state.service.newTerminal();
		strictEqual(state.service.floatingFileBrowserVisible, false);
		await state.service.selectSession(state.service.sessions[0].id);
		await state.service.toggleFloatingFileBrowser();
		await state.service.showShell();
		strictEqual(state.service.floatingFileBrowserVisible, false);
	});

	test('jump list can resolve a directly launched file before the session directory is available', async () => {
		const state = fixture();
		await state.service.initialize();
		await state.service.showEditor();
		state.editors.activeEditor = store.add(new TestEditorInput(URI.file('/project/file.ts'), 'test'));
		await state.service.addToJumpList();
		await state.service.toggleFloatingJumpList();
		strictEqual(state.service.floatingJumpListVisible, true);
	});

	test('jump list shares a Git project across sessions, persists, and excludes other overlays', async () => {
		const state = fixture();
		document.body.appendChild(state.mainContainer);
		store.add(toDisposable(() => state.mainContainer.remove()));
		state.instantiationService.stub(IFileService, 'exists', async (resource: URI) => !resource.path.endsWith('/.git') || resource.path === '/project/.git');
		await state.service.initialize();
		await state.service.toggleFloatingJumpList();
		strictEqual(state.service.floatingJumpListVisible, false);
		await state.service.openFiles(['file:///project/a'], state.active!.shellIntegrationNonce, false, 'file:///project/src');
		await state.service.addToJumpList();
		await state.service.addToJumpList();
		await state.service.toggleFloatingTerminal();
		await state.service.toggleFloatingJumpList();
		deepStrictEqual([state.service.floatingJumpListVisible, state.service.floatingTerminalVisible, state.mainContainer.querySelectorAll('.jump-list-row').length], [true, false, 1]);
		await state.service.toggleFloatingFileBrowser();
		deepStrictEqual([state.service.floatingJumpListVisible, state.service.floatingFileBrowserVisible], [false, true]);
		await state.service.toggleFloatingJumpList();
		strictEqual(state.service.floatingFileBrowserVisible, false);
		const focusBefore = state.editorFocusCount;
		await state.service.hideFloatingJumpList();
		strictEqual(state.editorFocusCount, focusBefore + 1);
		await state.service.newTerminal();
		await state.service.openFiles(['file:///project/b'], state.active!.shellIntegrationNonce, false, 'file:///project/other');
		await state.service.addToJumpList();
		await state.service.toggleFloatingJumpList();
		strictEqual(state.mainContainer.querySelectorAll('.jump-list-row').length, 2);
		await state.service.showShell();
		strictEqual(state.service.floatingJumpListVisible, false);
	});

	test('jump list failed open retains entries and session switch rejects a queued stale open', async () => {
		const state = fixture();
		document.body.appendChild(state.mainContainer);
		store.add(toDisposable(() => state.mainContainer.remove()));
		await state.service.initialize();
		const first = state.active!.shellIntegrationNonce;
		await state.service.openFiles(['file:///project/new.ts'], first, false, 'file:///project');
		// Supply a saved-file input: CLI opens a missing file as untitled.
		state.editors.activeEditor = store.add(new TestEditorInput(URI.file('/project/new.ts'), 'test'));
		await state.service.addToJumpList();
		await state.service.toggleFloatingJumpList();
		document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
		// Flush the serialized open without hiding the overlay.
		await state.service.addToJumpList();
		strictEqual(state.mainContainer.querySelector('.jump-list-status')?.textContent?.includes('no longer exists'), true);
		strictEqual(state.service.floatingJumpListVisible, true);
		const switching = state.service.newTerminal();
		document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
		await switching;
		await state.service.addToJumpList();
		deepStrictEqual([state.service.floatingJumpListVisible, state.service.sessions.filter(session => session.active).map(session => session.mode)], [false, ['shell']]);
	});

	test('floating shell is lazy, independent, and reused through rapid toggles', async () => {
		const state = fixture();
		await state.service.initialize();
		await state.service.toggleFloatingTerminal();
		strictEqual(state.created.length, 1);
		await state.service.showEditor();
		await Promise.all([state.service.toggleFloatingTerminal(), state.service.toggleFloatingTerminal(), state.service.toggleFloatingTerminal()]);
		deepStrictEqual([state.created.length, state.terminals.length, state.service.sessions.length, state.service.floatingTerminalVisible, state.active === state.created[1]], [2, 1, 1, true, true]);
		await state.service.hideFloatingTerminal(false);
		const focusCount = state.editorFocusCount;
		await state.service.toggleFloatingTerminal();
		await state.service.hideFloatingTerminal();
		deepStrictEqual([state.created.length, state.editorFocusCount - focusCount, state.active === state.created[0]], [2, 1, true]);
	});

	test('session and surface switches hide floats and retain separate companion shells', async () => {
		const state = fixture();
		await state.service.initialize();
		const first = state.service.sessions[0].id;
		await state.service.showEditor();
		await state.service.toggleFloatingTerminal();
		const companion = state.active;
		await state.service.newTerminal();
		await state.service.showEditor();
		await state.service.toggleFloatingTerminal();
		await state.service.selectSession(first);
		strictEqual(state.service.floatingTerminalVisible, false);
		await state.service.toggleFloatingTerminal();
		strictEqual(state.active, companion);
		await state.service.showShell();
		deepStrictEqual([state.service.floatingTerminalVisible, state.created.length, state.service.sessions.length], [false, 4, 2]);
	});

	test('companion CLI requests reveal their owning editor and preserve waits', async () => {
		const state = fixture();
		await state.service.initialize();
		await state.service.showEditor();
		await state.service.toggleFloatingTerminal();
		const companion = state.active!;
		const owner = state.service.sessions[0].id;
		await state.service.newTerminal();
		let completed = false;
		const pending = state.service.openFiles(['file:///companion/file.ts'], companion.shellIntegrationNonce, true, 'file:///companion').then(() => { completed = true; });
		await state.service.showEditor(false);
		await state.service.toggleFloatingTerminal();
		await state.service.hideFloatingTerminal();
		deepStrictEqual([state.service.sessions.find(session => session.active)?.id, state.workspace.folders[0].uri.toString(), completed], [owner, 'file:///companion', false]);
		const editor = state.editors.editors[0];
		state.editors.editors = [];
		state.closed.fire({ editor, groupId: 0, context: EditorCloseContext.UNKNOWN, index: 0, sticky: false });
		await pending;
	});

	test('exited companion is recreated only on the next toggle', async () => {
		const state = fixture();
		await state.service.initialize();
		await state.service.showEditor();
		await state.service.toggleFloatingTerminal();
		state.active!.dispose();
		deepStrictEqual([state.service.floatingTerminalVisible, state.created.length], [false, 2]);
		await state.service.toggleFloatingTerminal();
		deepStrictEqual([state.service.floatingTerminalVisible, state.created.length], [true, 3]);
	});

	test('creation failure leaves the editor usable and the float hidden', async () => {
		const state = fixture();
		await state.service.initialize();
		await state.service.showEditor();
		state.failCreation();
		await rejects(state.service.toggleFloatingTerminal(), /launch failed/);
		deepStrictEqual([state.service.floatingTerminalVisible, state.service.sessions[0].mode, state.created.length], [false, 'editor', 1]);
	});

	test('restores the companion without adding an outer tab or reopening the overlay', async () => {
		const state = fixture();
		const shell = state.addTerminal();
		const companion = state.addTerminal(true);
		state.storage.store('terminalFirst.sessions', { managedWorkspace: 'file:///managed/vs-nosh.code-workspace', sessions: [{ id: shell.shellIntegrationNonce, nonce: shell.shellIntegrationNonce, title: 'Shell', mode: 'editor', floatingNonce: companion.shellIntegrationNonce }] }, StorageScope.WORKSPACE, StorageTarget.MACHINE);
		await state.service.initialize();
		deepStrictEqual([state.service.sessions.length, state.service.floatingTerminalVisible, state.created.length], [1, false, 0]);
		await state.service.showEditor();
		await state.service.toggleFloatingTerminal();
		strictEqual(state.active, companion);
	});

	test('closing a session checks companion processes and cancellation preserves both shells', async () => {
		const state = fixture();
		await state.service.initialize();
		await state.service.showEditor();
		await state.service.toggleFloatingTerminal();
		Object.defineProperty(state.active!, 'hasChildProcesses', { value: true });
		await state.config.setUserConfiguration('terminal.integrated.confirmOnKill', 'always');
		state.dialog.setConfirmResult({ confirmed: false });
		const id = state.service.sessions[0].id;
		await state.service.closeSession(id);
		deepStrictEqual([state.service.sessions.length, state.service.floatingTerminalVisible, state.created.length], [1, true, 2]);
		state.dialog.setConfirmResult({ confirmed: true });
		await state.service.closeSession(id);
		deepStrictEqual([state.service.sessions.length, state.service.floatingTerminalVisible, state.created.length, state.disposedIds], [1, false, 3, [2, 1]]);
	});

	test('cancelled dirty-editor close preserves both shells and the visible float', async () => {
		const state = fixture();
		await state.service.initialize();
		await state.service.showEditor();
		await state.service.toggleFloatingTerminal();
		state.cancelEditorClose();
		await state.service.closeSession(state.service.sessions[0].id);
		deepStrictEqual([state.disposedIds, state.service.floatingTerminalVisible, state.service.sessions.length], [[], true, 1]);
	});

	test('starts in a shell and reuses a restored terminal', async () => {
		const state = fixture();
		const restored = state.addTerminal();
		await state.service.initialize();
		deepStrictEqual([state.active === restored, state.created.length, state.maximized], [true, 0, true]);
	});

	test('starts explicit file launches in an editor session with its shell', async () => {
		const state = fixture([{ fileUri: URI.file('/project/file.ts') }]);
		await state.service.initialize();
		deepStrictEqual([state.created.length, state.hidden.get(Parts.PANEL_PART)], [1, true]);
	});

	test('switches surfaces repeatedly without closing buffers or replacing the shell', async () => {
		const state = fixture();
		await state.service.initialize();
		const terminal = state.active;
		const buffer = store.add(new TestEditorInput(URI.file('/project/file.ts'), 'test'));
		state.editors.editors = [buffer];
		state.editors.activeEditor = buffer;
		for (let index = 0; index < 5; index++) {
			await state.service.toggle();
			await state.service.toggle();
		}
		deepStrictEqual([state.active === terminal, state.created.length, state.editors.editors[0] === buffer], [true, 1, true]);
	});

	test('returns file opens to their originating session and opens missing files as untitled', async () => {
		const state = fixture();
		const origin = state.addTerminal();
		state.addTerminal();
		await state.service.initialize();
		await state.service.openFiles(['file:///project/file.ts', 'file:///project/new.ts'], origin.shellIntegrationNonce, false);
		await state.service.showShell();
		deepStrictEqual([state.active === origin, state.opened[0].map(input => input.forceUntitled)], [true, [false, true]]);
	});


	test('selecting a tab restores its remembered editor surface', async () => {
		const state = fixture();
		await state.service.initialize();
		const first = state.service.sessions[0].id;
		await state.service.showEditor(false);
		await state.service.newTerminal();
		const second = state.service.sessions[1].id;
		await state.service.selectSession(first);
		deepStrictEqual(state.service.sessions.map(session => [session.mode, session.active]), [['editor', true], ['shell', false]]);
		await state.service.selectSession(second);
		deepStrictEqual([state.maximized, state.created.length], [true, 2]);
	});

	test('CLI directories switch the active workspace without replacing shells', async () => {
		const state = fixture();
		await state.service.initialize();
		const first = state.active!;
		await state.service.openFiles(['file:///one/file.ts'], first.shellIntegrationNonce, false, 'file:///one');
		await state.service.newTerminal();
		const second = state.active!;
		await state.service.openFiles(['file:///two/file.ts'], second.shellIntegrationNonce, false, 'file:///two');
		await state.service.selectSession(first.shellIntegrationNonce);
		deepStrictEqual([state.workspace.folders[0].uri.toString(), state.created.length, state.active === first], ['file:///one', 2, true]);
	});
	test('rapid toggle requests are applied in order', async () => {
		const state = fixture();
		await state.service.initialize();
		await Promise.all([state.service.toggle(), state.service.toggle()]);
		deepStrictEqual([state.maximized, state.hidden.get(Parts.PANEL_PART), state.created.length], [true, false, 1]);
	});

	test('rejects stale sessions rather than opening files in an unrelated session', async () => {
		const state = fixture();
		await state.service.initialize();
		await rejects(state.service.openFiles(['file:///project/file.ts'], 'expired-session', false), /no longer attached/);
		deepStrictEqual(state.opened, []);
	});

	test('cycles sessions, wraps around, and creates a replacement if the return session closed', async () => {
		const state = fixture();
		const first = state.addTerminal();
		state.addTerminal();
		await state.service.initialize();
		await state.service.switchTerminal(1);
		strictEqual(state.active, first);
		await state.service.showEditor(false);
		state.terminals.splice(0, state.terminals.length);
		await state.service.showShell();
		deepStrictEqual([state.created.length, state.terminals.length], [1, 1]);
	});

	test('reveals tools in the editor and hides them while the shell fills the window', async () => {
		const state = fixture();
		await state.service.initialize();
		await state.service.showEditor();
		strictEqual(state.hidden.get(Parts.STATUSBAR_PART), false);
		await state.service.showShell();
		strictEqual(state.hidden.get(Parts.STATUSBAR_PART), true);
		await state.service.showEditor(false);
		strictEqual(state.hidden.get(Parts.STATUSBAR_PART), false);
	});

	test('editor has no sidebar, secondary sidebar, or activity bar', async () => {
		const state = fixture();
		await state.service.initialize();
		await state.service.showEditor();
		deepStrictEqual([state.hidden.get(Parts.SIDEBAR_PART), state.hidden.get(Parts.AUXILIARYBAR_PART), state.hidden.get(Parts.ACTIVITYBAR_PART), state.commands.includes('workbench.view.explorer')], [true, true, true, false]);
	});

	test('terminal tile CLI requests return to their owning session', async () => {
		const state = fixture();
		await state.service.initialize();
		await state.service.showEditor();
		const ownerId = state.service.sessions.find(session => session.active)!.id;
		await state.service.openTerminalTile(0);
		const tile = state.created[state.created.length - 1];
		await state.service.newTerminal();
		await state.service.openFiles(['file:///project/from-tile.ts'], tile.shellIntegrationNonce, false);
		deepStrictEqual({ active: state.service.sessions.find(session => session.active)?.id, opened: state.opened.at(-1)?.map(input => input.resource.path) }, { active: ownerId, opened: ['/project/from-tile.ts'] });
	});

	test('closed terminal tiles stop routing CLI requests to their session', async () => {
		const state = fixture();
		await state.service.initialize();
		await state.service.showEditor();
		await state.service.openTerminalTile(0);
		const tile = state.created[state.created.length - 1];
		const tileNonces = () => state.storage.getObject<{ sessions: { tileNonces?: string[] }[] }>('terminalFirst.sessions', StorageScope.WORKSPACE)?.sessions.flatMap(session => session.tileNonces ?? []);
		const open = tileNonces();
		tile.dispose();
		deepStrictEqual({ open, closed: tileNonces() }, { open: [tile.shellIntegrationNonce], closed: [] });
	});

	test('terminal tile launch failure preserves its owning session', async () => {
		const state = fixture();
		await state.service.initialize();
		await state.service.showEditor();
		const before = state.service.sessions;
		state.failCreation();
		await rejects(state.service.openTerminalTile(0), /launch failed/);
		deepStrictEqual(state.service.sessions, before);
	});

	test('closing the last file preserves the empty tiling workspace', async () => {
		const state = fixture();
		await state.service.initialize();
		await state.service.openFiles(['file:///project/file.ts'], state.active!.shellIntegrationNonce, false);
		const editor = state.editors.editors[0];
		state.editors.editors = [];
		state.closed.fire({ editor, groupId: 0, context: EditorCloseContext.UNKNOWN, index: 0, sticky: false });
		await state.service.showEditor(false);
		deepStrictEqual([state.service.sessions[0].mode, state.maximized], ['editor', false]);
	});

	test('--wait survives mode switches and releases only on file close', async () => {
		const state = fixture();
		await state.service.initialize();
		let completed = false;
		const pending = state.service.openFiles(['file:///project/file.ts'], state.active!.shellIntegrationNonce, true).then(() => { completed = true; });
		// Drain the mode queue and file-open continuation before switching back to the shell.
		await state.service.showEditor(false);
		await state.service.showShell();
		strictEqual(completed, false);
		const editor = state.editors.editors[0];
		state.editors.editors = [];
		state.closed.fire({ editor, groupId: 0, context: EditorCloseContext.UNKNOWN, index: 0, sticky: false });
		await pending;
		strictEqual(completed, true);
	});
});
