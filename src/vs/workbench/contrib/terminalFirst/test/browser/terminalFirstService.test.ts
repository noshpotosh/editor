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
import { IQuickInputService } from '../../../../../platform/quickinput/common/quickInput.js';
import { IViewDescriptorService } from '../../../../common/views.js';
import { ITextResourceEditorInput } from '../../../../../platform/editor/common/editor.js';
import { IEditorService } from '../../../../services/editor/common/editorService.js';
import { IEditorGroupsService, IEditorPart, IEditorGroup } from '../../../../services/editor/common/editorGroupsService.js';
import { IWorkbenchEnvironmentService } from '../../../../services/environment/common/environmentService.js';
import { IWorkbenchLayoutService, Parts } from '../../../../services/layout/browser/layoutService.js';
import { TestEditorInput, TestEditorService, TestFileEditorInput, workbenchInstantiationService } from '../../../../test/browser/workbenchTestServices.js';
import { ICreateTerminalOptions, ITerminalEditorService, ITerminalGroupService, ITerminalInstance, ITerminalService, TerminalConnectionState } from '../../../terminal/browser/terminal.js';
import { IWorkspaceEditingService } from '../../../../services/workspaces/common/workspaceEditing.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../../platform/storage/common/storage.js';
import { IWorkspaceContextService, IWorkspace } from '../../../../../platform/workspace/common/workspace.js';
import { IDialogService } from '../../../../../platform/dialogs/common/dialogs.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { TestDialogService } from '../../../../../platform/dialogs/test/common/testDialogService.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { terminalFirstPolicy } from '../../../../services/terminalFirst/common/terminalFirstPolicy.js';
import { TerminalFirstService } from '../../browser/terminalFirstService.js';
import { createTerminalFirstTerminalPolicy, TerminalFirstLaunch } from '../../browser/terminalPolicy.js';
import { ILocalPtyService, IShellLaunchConfig, TerminalLocation } from '../../../../../platform/terminal/common/terminal.js';
import { runWithFakedTimers } from '../../../../../base/test/common/timeTravelScheduler.js';
import { terminalFirstStartup } from '../../../../services/terminalFirst/common/terminalFirstStartup.js';
import { EditorPartSessions } from '../../browser/editorPartSessions.js';
import { ITimerService } from '../../../../services/timer/browser/timerService.js';
import { IStartupPerfArgs } from '../../browser/startupTimings.js';
import { clearMarks, getMarks, PerformanceMark } from '../../../../../base/common/performance.js';
import { VSBuffer } from '../../../../../base/common/buffer.js';
import { TERMINAL_FIRST_PRESPAWN_OWNER } from '../../../../../platform/terminalFirst/common/terminalFirstEnvironment.js';

suite('Terminal First', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();
	teardown(() => { terminalFirstPolicy.mode = 'starting'; terminalFirstStartup.reset(); });
	// Marks are global to the test window; keep the startup marks of one test out of the next.
	setup(() => { for (const name of ['prompt', 'input']) { clearMarks(`code/terminalFirst/${name}`); } });
	const countMarks = (name: string) => getMarks().filter(entry => entry.name === `code/terminalFirst/${name}`).length;

	/** Creates real controller behavior with terminal and layout boundaries replaced by small fakes. */
	function fixture(filesToOpenOrCreate?: IPath[], args?: IStartupPerfArgs, options?: { connected?: boolean; editorPartReady?: Promise<void>; panelReady?: Promise<void>; creationReady?: Promise<void> }) {
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
		/** Retained-layout keys the controller activated and closed, in order, plus the keys a restored editor part reports. */
		const activated: string[] = [];
		const closedKeys: string[] = [];
		const restoredKeys: string[] = [];
		let owns: (key: string, groupId: number) => boolean = () => true;
		let spaceName: string | undefined = 'Review';
		const disposedIds: number[] = [];
		const shutdownIds: number[] = [];
		const panelShown = store.add(new Emitter<void>());
		const creationStarted = store.add(new Emitter<void>());
		const panelReady = options?.panelReady;
		const creationReady = options?.creationReady;
		let active: ITerminalInstance | undefined;
		let maximized = false;
		const hidden = new Map<Parts, boolean>();
		const commands: string[] = [];
		const mainContainer = document.createElement('div');
		mainContainer.classList.add('terminal-first-starting');
		const opened: ITextResourceEditorInput[][] = [];
		/** Marks the controller published, text it sent to shells, and perf files it wrote. */
		const published: PerformanceMark[][] = [];
		const sent: string[] = [];
		const written: string[] = [];
		const didPublish = store.add(new Emitter<void>());
		const didSend = store.add(new Emitter<void>());
		const didWrite = store.add(new Emitter<void>());
		const dataEmitters = new Map<ITerminalInstance, Emitter<string>>();
		let connectionState = options?.connected === false ? TerminalConnectionState.Connecting : TerminalConnectionState.Connected;
		const connectionChanged = store.add(new Emitter<void>());
		const instanceCreated = store.add(new Emitter<ITerminalInstance>());

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
		const policy = createTerminalFirstTerminalPolicy();
		const addTerminal = (options?: ICreateTerminalOptions, reconnected?: { nonce: string; prespawnCwd?: string }) => {
			const id = allTerminals.length + 1;
			const shellLaunchConfig: IShellLaunchConfig = reconnected ? { attachPersistentProcess: upcastPartial<NonNullable<IShellLaunchConfig['attachPersistentProcess']>>({ id, shellIntegrationNonce: reconnected.nonce, cwd: reconnected.prespawnCwd, reconnectionProperties: reconnected.prespawnCwd ? { ownerId: TERMINAL_FIRST_PRESPAWN_OWNER } : undefined }) } : {};
			policy.prepareLaunchConfig(shellLaunchConfig, options);
			const floating = shellLaunchConfig.hideFromUser === true;
			const data = store.add(new Emitter<string>());
			const terminal = upcastPartial<ITerminalInstance>({
				instanceId: id,
				shellLaunchConfig,
				get isDisposed() { return disposedIds.includes(id); },
				initialCwd: typeof options?.cwd === 'string' ? options.cwd : undefined,
				onTitleChanged: Event.None,
				onData: data.event,
				onProcessReplayComplete: Event.None,
				processReady: Promise.resolve(),
				sendText: async text => { sent.push(text); didSend.fire(); },
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
				capabilities: upcastPartial<ITerminalInstance['capabilities']>({ get: () => undefined, onDidAddCapability: Event.None }),
				shellIntegrationNonce: reconnected?.nonce ?? `session-${id}`,
				target: TerminalLocation.Panel,
				focusWhenReady: async () => { focused.fire(terminal); },
			});
			allTerminals.push(terminal);
			dataEmitters.set(terminal, data);
			if (!floating) { terminals.push(terminal); }
			active = terminal;
			return terminal;
		};
		instantiationService.stub(IEditorService, editors);
		instantiationService.stub(ITerminalEditorService, upcastPartial<ITerminalEditorService>({ openEditor: async () => { } }));
		instantiationService.stub(ITerminalService, upcastPartial<ITerminalService>({
			whenConnected: Promise.resolve(),
			get connectionState() { return connectionState; },
			onDidChangeConnectionState: connectionChanged.event,
			onDidCreateInstance: instanceCreated.event,
			instances: allTerminals,
			onDidDisposeInstance: disposed.event,
			onAnyInstanceTitleChange: Event.None,
			createTerminal: async options => { creationStarted.fire(); await creationReady; if (failCreation) { throw new Error('launch failed'); } const terminal = addTerminal(options); created.push(terminal); return terminal; },
			setActiveInstance: terminal => { active = terminal; },
		}));
		instantiationService.stub(ITerminalGroupService, upcastPartial<ITerminalGroupService>({
			instances: terminals,
			get activeInstance() { return active && terminals.includes(active) ? active : undefined; },
			showPanel: async () => { panelShown.fire(); await panelReady; hidden.set(Parts.PANEL_PART, false); },
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
		const mainPart = upcastPartial<IEditorPart>({ groups: [upcastPartial<IEditorGroup>({ id: 0 })], count: 1, onDidAddGroup: Event.None, onDidRemoveGroup: Event.None, onDidLayout: Event.None });
		store.add(EditorPartSessions.attach(mainPart, { activate: key => { activated.push(key); }, owns: (key, groupId) => owns(key, groupId), ids: () => restoredKeys, close: async key => { closedKeys.push(key); return !cancelEditorClose; }, swapGroups: () => { } }));
		/** Answers for the quick inputs in order of appearance: the preset pick (by label) and text prompts. */
		let presetPick: string | undefined = 'Empty';
		const presetPicks: string[][] = [];
		instantiationService.stub(IQuickInputService, 'input', async () => spaceName);
		instantiationService.stub(IQuickInputService, 'pick', (async (items: { label: string }[]) => { presetPicks.push(items.map(item => item.label)); return items.find(item => item.label === presetPick); }) as IQuickInputService['pick']);
		instantiationService.stub(IFileService, 'stat', async (resource: URI) => ({ isDirectory: !resource.path.endsWith('.txt') }));
		instantiationService.stub(IViewDescriptorService, upcastPartial<IViewDescriptorService>({ getViewContainerById: () => null, getViewDescriptorById: () => null }));
		instantiationService.stub(IEditorGroupsService, upcastPartial<IEditorGroupsService>({ mainPart, whenReady: options?.editorPartReady ?? Promise.resolve(), activeGroup: upcastPartial<IEditorGroup>({ focus: () => { editorFocusCount++; } }), enforcePartOptions: () => toDisposable(() => { }) }));
		instantiationService.stub(ICommandService, upcastPartial<ICommandService>({ executeCommand: async id => { commands.push(id); return undefined; } }));
		const environment = { filesToOpenOrCreate, workspaceStorageHome: URI.file('/managed'), args };
		instantiationService.stub(IWorkbenchEnvironmentService, upcastPartial<IWorkbenchEnvironmentService>(environment));
		instantiationService.stub(ITimerService, upcastPartial<ITimerService>({ setPerformanceMarks: (_source, marks) => { published.push(marks); didPublish.fire(); }, getPerformanceMarks: () => [], whenReady: async () => true, startupMetrics: upcastPartial<ITimerService['startupMetrics']>({ didUseCachedData: true }) }));
		instantiationService.stub(IFileService, 'writeFile', async (resource: URI, _contents: VSBuffer) => { written.push(resource.path); didWrite.fire(); return undefined; });
		instantiationService.stub(IFileService, 'exists', async (resource: URI) => !resource.path.endsWith('new.ts'));
		instantiationService.stub(IWorkspaceEditingService, upcastPartial<IWorkspaceEditingService>({}));
		const managed = URI.file('/managed/vs-nosh.code-workspace');
		const workspace = { id: 'test', folders: [] as IWorkspace['folders'], configuration: managed };
		instantiationService.stub(IWorkspaceContextService, 'getWorkspace', () => workspace);
		instantiationService.stub(IWorkspaceEditingService, upcastPartial<IWorkspaceEditingService>({ updateFolders: async (_index, _count, folders) => { workspace.folders = (folders ?? []).map((folder, index) => ({ uri: folder.uri, name: 'test', index, toResource: (path: string) => URI.joinPath(folder.uri, path) })); } }));
		instantiationService.get(IStorageService).store('terminalFirst.sessions', { managedWorkspace: managed.toString(), sessions: [] }, StorageScope.WORKSPACE, StorageTarget.MACHINE);
		instantiationService.stub(IDialogService, dialog);
		instantiationService.stub(IConfigurationService, config);
		instantiationService.stub(ILocalPtyService, upcastPartial<ILocalPtyService>({ shutdown: async id => { shutdownIds.push(id); } }));
		const service = store.add(instantiationService.createInstance(TerminalFirstService));
		return { instantiationService, service, mainContainer, disposedIds, shutdownIds, panelShown: panelShown.event, creationStarted: creationStarted.event, cancelEditorClose: (value = true) => { cancelEditorClose = value; }, dialog, config, activated, closedKeys, restoredKeys, setOwns: (value: typeof owns) => { owns = value; }, setSpaceName: (value: string | undefined) => { spaceName = value; }, setPresetPick: (value: string | undefined) => { presetPick = value; }, presetPicks, storage: instantiationService.get(IStorageService), failCreation: () => { failCreation = true; }, get editorFocusCount() { return editorFocusCount; }, editors, addTerminal, terminals, created, hidden, commands, opened, focused, closed, workspace, get active() { return active; }, get maximized() { return maximized; }, published, sent, written, didPublish: didPublish.event, didSend: didSend.event, didWrite: didWrite.event, emitData: (terminal: ITerminalInstance, text: string) => dataEmitters.get(terminal)!.fire(text), instanceCreated: instanceCreated.event, emitCreated: (terminal: ITerminalInstance) => instanceCreated.fire(terminal), reconnect: (nonce: string, prespawnCwd?: string) => { const terminal = addTerminal({ location: TerminalLocation.Panel }, { nonce, prespawnCwd }); instanceCreated.fire(terminal); return terminal; }, setConnected: () => { connectionState = TerminalConnectionState.Connected; connectionChanged.fire(); } };
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
		const companion = state.addTerminal(TerminalFirstLaunch.floating({}));
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

	test('CLI goto fragments become editor selections', async () => {
		const state = fixture();
		await state.service.initialize();
		await state.service.openFiles(['file:///project/a.ts#L12,4', 'file:///project/b.ts#L7', 'file:///project/c.ts'], state.active!.shellIntegrationNonce, false);
		deepStrictEqual(state.opened.at(-1)?.map(input => [input.resource.toString(), input.options?.selection]), [
			['file:///project/a.ts', { startLineNumber: 12, startColumn: 4 }], ['file:///project/b.ts', { startLineNumber: 7, startColumn: 1 }], ['file:///project/c.ts', undefined],
		]);
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

	test('a new space gets its own retained layout, opens the tile picker, and is persisted', async () => {
		const state = fixture();
		await state.service.initialize();
		await state.service.newSpace();
		const shellOnly = state.service.sessions[0].spaces.length;
		await state.service.showEditor();
		const id = state.service.sessions[0].id;
		await state.service.newSpace();
		const spaces = state.service.sessions[0].spaces;
		const stored = state.storage.getObject<{ sessions: { spaces: { id: string; name: string }[]; activeSpace: string }[] }>('terminalFirst.sessions', StorageScope.WORKSPACE)!.sessions[0];
		deepStrictEqual({
			shellOnly,
			spaces: spaces.map(space => [space.name, space.active]),
			activated: state.activated.at(-1),
			picker: state.commands.at(-1),
			stored: [stored.spaces.map(space => space.name), stored.activeSpace === spaces[1].id],
		}, { shellOnly: 1, spaces: [['Space 1', false], ['Review', true]], activated: `${id}#${spaces[1].id}`, picker: 'terminalFirst.tile.new', stored: [['Space 1', 'Review'], true] });
	});

	test('space switching wraps, ignores out-of-range slots, and suggests the next free name', async () => {
		const state = fixture();
		await state.service.initialize();
		await state.service.showEditor();
		state.setSpaceName('');
		await state.service.newSpace();
		await state.service.newSpace();
		const active = () => state.service.sessions[0].spaces.findIndex(space => space.active);
		const steps: number[] = [active()];
		await state.service.switchSpace(1); steps.push(active());
		await state.service.switchSpace(-1); steps.push(active());
		await state.service.selectSpaceAt(2); steps.push(active());
		await state.service.selectSpaceAt(5); steps.push(active());
		state.setSpaceName(undefined);
		await state.service.newSpace();
		deepStrictEqual({ steps, names: state.service.sessions[0].spaces.map(space => space.name) }, { steps: [2, 0, 2, 1, 1], names: ['Space 1', 'Space 2', 'Space 3'] });
	});

	test('closing a space shows its neighbor, closing the last space leaves an empty one, and cancel keeps it', async () => {
		const state = fixture();
		await state.service.initialize();
		await state.service.showEditor();
		const id = state.service.sessions[0].id;
		await state.service.newSpace();
		const review = `${id}#${state.service.sessions[0].spaces[1].id}`;
		state.cancelEditorClose(true);
		await state.service.closeSpace();
		const afterCancel = { spaces: state.service.sessions[0].spaces.length, activated: state.activated.at(-1), closed: [...state.closedKeys] };
		state.cancelEditorClose(false);
		await state.service.closeSpace();
		const afterClose = { spaces: state.service.sessions[0].spaces.map(space => space.name), activated: state.activated.at(-1), closed: state.closedKeys.slice(afterCancel.closed.length) };
		await state.service.closeSpace();
		const last = state.service.sessions[0].spaces;
		deepStrictEqual({ afterCancel, afterClose, last: [last.map(space => space.name), last[0].id !== 'default', state.activated.at(-1) === `${id}#${last[0].id}`, state.closedKeys.slice(-2)] }, {
			afterCancel: { spaces: 2, activated: review, closed: [review] },
			afterClose: { spaces: ['Space 1'], activated: id, closed: [review, review] },
			last: [['Space 1'], true, true, [id, id]],
		});
	});

	test('restores spaces, defaults sessions saved without them, and recovers layouts under unknown keys', async () => {
		const state = fixture();
		const shell = state.addTerminal();
		state.storage.store('terminalFirst.sessions', { managedWorkspace: 'file:///managed/vs-nosh.code-workspace', active: shell.shellIntegrationNonce, sessions: [
			{ id: shell.shellIntegrationNonce, nonce: shell.shellIntegrationNonce, title: 'Shell', mode: 'shell', spaces: [{ id: 'default', name: 'Code' }, { id: 'rv', name: 'Review' }], activeSpace: 'rv' },
			{ id: 'old', nonce: 'old', title: 'Old', mode: 'shell' },
		] }, StorageScope.WORKSPACE, StorageTarget.MACHINE);
		state.restoredKeys.push(`${shell.shellIntegrationNonce}#rv`, `${shell.shellIntegrationNonce}#lost`, 'ghost#x');
		await state.service.initialize();
		deepStrictEqual({
			sessions: state.service.sessions.map(session => [session.title, session.spaces.map(space => [space.id === 'default' ? 'default' : space.name, space.active])]),
			activated: state.activated[0],
		}, {
			sessions: [['Shell 1', [['default', false], ['Review', true], ['Recovered Space', false]]], ['Old', [['default', true]]], ['Recovered Session', [['default', true], ['Recovered Space', false]]]],
			activated: `${shell.shellIntegrationNonce}#rv`,
		});
	});

	test('closing a session closes every space, and cancelling in any space keeps them all', async () => {
		const state = fixture();
		await state.service.initialize();
		await state.service.showEditor();
		const id = state.service.sessions[0].id;
		await state.service.newSpace();
		const review = `${id}#${state.service.sessions[0].spaces[1].id}`;
		await state.service.selectSpaceAt(1);
		state.cancelEditorClose(true);
		await state.service.closeSession(id);
		const cancelled = { sessions: state.service.sessions.length, spaces: state.service.sessions[0].spaces.length, closed: [...state.closedKeys], activated: state.activated.at(-1) };
		state.cancelEditorClose(false);
		await state.service.closeSession(id);
		deepStrictEqual({ cancelled, closed: state.closedKeys.slice(cancelled.closed.length), sessions: state.service.sessions.map(session => session.id !== id) }, {
			cancelled: { sessions: 1, spaces: 2, closed: [id], activated: id },
			closed: [id, review, id, review],
			sessions: [true],
		});
	});

	test('a preset names the space, opens its tiles by command, and a cancelled pick creates nothing', async () => {
		const state = fixture();
		await state.service.initialize();
		await state.service.showEditor();
		state.setPresetPick('Review');
		await state.service.newSpace();
		await state.service.newSpace();
		const afterPresets = { names: state.service.sessions[0].spaces.map(space => space.name), commands: state.commands.filter(id => id.includes('Preset') || id === 'terminalFirst.tile.new') };
		state.setPresetPick(undefined);
		await state.service.newSpace();
		deepStrictEqual({ afterPresets, picks: state.presetPicks[0], count: state.service.sessions[0].spaces.length }, {
			afterPresets: { names: ['Space 1', 'Review', 'Review 2'], commands: ['_terminalFirst.tile.applyPreset', '_terminalFirst.tile.applyPreset'] },
			picks: ['Empty', 'Code', 'Review'],
			count: 3,
		});
	});

	test('a session from a preset opens the editor in the chosen directory with the preset as its first space', async () => {
		const state = fixture();
		await state.service.initialize();
		state.setSpaceName('/projects/api');
		state.setPresetPick('Code');
		await state.service.newSessionFromPreset();
		deepStrictEqual({
			sessions: state.service.sessions.map(session => [session.mode, session.active, session.spaces.map(space => space.name)]),
			folder: state.workspace.folders[0]?.uri.path,
			cwd: state.created.at(-1) && state.terminals.length,
			applied: state.commands.at(-1),
		}, { sessions: [['shell', false, ['Space 1']], ['editor', true, ['Code']]], folder: '/projects/api', cwd: 2, applied: '_terminalFirst.tile.applyPreset' });
	});

	test('dirty state is reported per space and rolls up to the session', async () => {
		const state = fixture();
		await state.service.initialize();
		await state.service.showEditor();
		const id = state.service.sessions[0].id;
		await state.service.newSpace();
		const review = `${id}#${state.service.sessions[0].spaces[1].id}`;
		const input = store.add(new TestFileEditorInput(URI.file('/project/dirty.ts'), 'test'));
		input.setDirty();
		state.instantiationService.stub(IEditorService, 'getEditors', () => [{ editor: input, groupId: 0 }]);
		state.setOwns(key => key === review);
		deepStrictEqual(state.service.sessions.map(session => [session.dirty, session.spaces.map(space => !!space.dirty)]), [[true, [false, true]]]);
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

	test('startup marks the first prompt once, publishes the marks, and sends nothing to the shell', async () => {
		const state = fixture();
		await state.service.initialize();
		const publishedAfterPrompt = Event.toPromise(state.didPublish);
		state.emitData(state.active!, 'prompt> ');
		state.emitData(state.active!, 'more');
		await publishedAfterPrompt;
		deepStrictEqual({
			prompt: countMarks('prompt'), input: countMarks('input'), sent: state.sent, written: state.written,
			published: [...new Set(state.published.at(-1)?.map(entry => entry.name))].filter(name => name.endsWith('/presented') || name.endsWith('/prompt')).sort(),
		}, { prompt: 1, input: 0, sent: [], written: [], published: ['code/terminalFirst/presented', 'code/terminalFirst/prompt'] });
	});

	test('a perf run waits for the decoded input probe and writes the marks beside the markers file', async () => {
		const state = fixture(undefined, { 'prof-duration-markers': ['code/didStartMain-code/terminalFirst/input'], 'prof-duration-markers-file': '/perf/run-1.tsv' });
		await state.service.initialize();
		const probeSent = Event.toPromise(state.didSend);
		state.emitData(state.active!, 'prompt> ');
		await probeSent;
		const probe = state.sent[0];
		const token = [...probe.matchAll(/\\(?<octal>[0-7]{3})/g)].map(match => String.fromCharCode(parseInt(match.groups!.octal, 8))).join('');
		state.emitData(state.active!, probe);
		state.emitData(state.active!, 'unrelated startup output');
		const beforeEcho = countMarks('input');
		const reportWritten = Event.toPromise(state.didWrite);
		state.emitData(state.active!, token.slice(0, 5));
		state.emitData(state.active!, token.slice(5));
		await reportWritten;
		deepStrictEqual({ probes: state.sent.length, encoded: probe.startsWith('printf '), beforeEcho, input: countMarks('input'), written: [...new Set(state.written)] }, { probes: 1, encoded: true, beforeEcho: 0, input: 1, written: ['/perf/run-1.tsv.terminalFirst.json'] });
	});

	test('stored sessions show on the strip before the editor part is ready', async () => {
		const ready = new DeferredPromise<void>();
		const state = fixture(undefined, undefined, { editorPartReady: ready.p });
		state.storage.store('terminalFirst.sessions', { active: 'alpha', managedWorkspace: 'file:///managed/vs-nosh.code-workspace', sessions: [{ id: 'alpha', nonce: 'alpha', title: 'Alpha', mode: 'shell' }, { id: 'beta', nonce: 'beta', title: 'Beta', mode: 'editor' }] }, StorageScope.WORKSPACE, StorageTarget.MACHINE);
		const stripUpdated = Event.toPromise(state.service.onDidChangeSessions);
		const pending = state.service.initialize();
		await stripUpdated;
		const beforeReady = state.service.sessions.map(session => [session.title, session.mode]);
		await ready.complete();
		await pending;
		deepStrictEqual({ beforeReady, created: state.created.length, active: state.service.sessions.find(session => session.active)?.title }, { beforeReady: [['Alpha', 'shell'], ['Beta', 'editor']], created: 1, active: 'Shell 1' });
	});

	test('a stored session adopts its terminal when it reconnects, without waiting for replay', async () => {
		const state = fixture(undefined, undefined, { connected: false });
		state.storage.store('terminalFirst.sessions', { active: 'alpha', managedWorkspace: 'file:///managed/vs-nosh.code-workspace', sessions: [{ id: 'alpha', nonce: 'alpha', title: 'Alpha', mode: 'shell' }] }, StorageScope.WORKSPACE, StorageTarget.MACHINE);
		const pending = state.service.initialize();
		state.reconnect('alpha');
		state.setConnected();
		await pending;
		// A reconnected shell that no stored session claims becomes a session of its own.
		state.reconnect('stray');
		await Promise.resolve();
		deepStrictEqual({ created: state.created.length, sessions: state.service.sessions.map(session => session.title) }, { created: 0, sessions: ['Shell 1', 'Shell 2'] });
	});

	test('a prespawn arriving before initialization becomes the only session shell', async () => {
		const state = fixture();
		const shell = state.reconnect('prespawn', '/project');
		await state.service.initialize();
		deepStrictEqual({ created: state.created.length, ids: state.service.sessions.map(session => session.id), marker: shell.shellLaunchConfig.attachPersistentProcess?.reconnectionProperties }, { created: 0, ids: ['prespawn'], marker: undefined });
	});

	test('prespawn binds to the saved active session and preserves session order and layouts', async () => {
		const state = fixture();
		state.storage.store('terminalFirst.sessions', { active: 'beta', managedWorkspace: 'file:///managed/vs-nosh.code-workspace', sessions: [
			{ id: 'alpha', nonce: 'old-alpha', title: 'Alpha', mode: 'shell' },
			{ id: 'beta', nonce: 'old-beta', title: 'Beta', mode: 'shell', cwd: 'file:///project', spaces: [{ id: 'review', name: 'Review' }], activeSpace: 'review' },
		] }, StorageScope.WORKSPACE, StorageTarget.MACHINE);
		state.reconnect('prespawn', '/project');
		await state.service.initialize();
		deepStrictEqual({ created: state.created.length, ids: state.service.sessions.map(session => session.id), active: state.service.sessions.find(session => session.active)?.id, layout: state.activated.at(-1), nonce: state.active?.shellIntegrationNonce }, { created: 0, ids: ['alpha', 'beta'], active: 'beta', layout: 'beta#review', nonce: 'prespawn' });
	});

	test('a saved working directory takes precedence over the speculative workspace shell', async () => {
		const state = fixture();
		state.storage.store('terminalFirst.sessions', { active: 'alpha', managedWorkspace: 'file:///managed/vs-nosh.code-workspace', sessions: [
			{ id: 'alpha', nonce: 'old', title: 'Alpha', mode: 'shell', cwd: 'file:///project/nested' },
		] }, StorageScope.WORKSPACE, StorageTarget.MACHINE);
		const shell = state.reconnect('prespawn', '/project');
		await state.service.initialize();
		deepStrictEqual({ disposed: shell.isDisposed, shutdownIds: state.shutdownIds, created: state.created.length, cwd: state.active?.initialCwd, ids: state.service.sessions.map(session => session.id) }, { disposed: true, shutdownIds: [shell.instanceId], created: 1, cwd: '/project/nested', ids: ['alpha'] });
	});

	test('late speculation is discarded after the ordinary startup shell exists', async () => {
		const state = fixture();
		await state.service.initialize();
		const active = state.active;
		const shell = state.reconnect('late-prespawn', '/project');
		await Promise.resolve();
		deepStrictEqual({ disposed: shell.isDisposed, created: state.created.length, sessions: state.service.sessions.length, id: state.service.sessions[0].id }, { disposed: true, created: 1, sessions: 1, id: active!.shellIntegrationNonce });
	});

	test('late prespawn disposal waits until the creating group has inserted its instance', async () => {
		const state = fixture();
		await state.service.initialize();
		const shell = state.addTerminal({ location: TerminalLocation.Panel }, { nonce: 'late', prespawnCwd: '/project' });
		state.terminals.splice(state.terminals.indexOf(shell), 1);
		state.emitCreated(shell);
		const disposedBeforeInsert = shell.isDisposed;
		state.terminals.push(shell);
		await Promise.resolve();
		deepStrictEqual({ disposedBeforeInsert, retained: state.terminals.includes(shell), disposed: shell.isDisposed, shutdownIds: state.shutdownIds }, { disposedBeforeInsert: false, retained: false, disposed: true, shutdownIds: [shell.instanceId] });
	});

	test('a nonce-matched live prespawn reattaches on reload even after changing directory', async () => {
		const state = fixture();
		state.storage.store('terminalFirst.sessions', { active: 'alpha', managedWorkspace: 'file:///managed/vs-nosh.code-workspace', sessions: [
			{ id: 'alpha', nonce: 'live', title: 'Alpha', mode: 'shell', cwd: 'file:///project/nested' },
		] }, StorageScope.WORKSPACE, StorageTarget.MACHINE);
		const shell = state.reconnect('live', '/project');
		await state.service.initialize();
		deepStrictEqual({ disposed: shell.isDisposed, created: state.created.length, ids: state.service.sessions.map(session => session.id), marker: shell.shellLaunchConfig.attachPersistentProcess?.reconnectionProperties }, { disposed: false, created: 0, ids: ['alpha'], marker: undefined });
	});

	test('prespawn arriving while the panel opens is adopted before fallback creation', async () => {
		const panel = new DeferredPromise<void>();
		const state = fixture(undefined, undefined, { panelReady: panel.p });
		const panelOpening = Event.toPromise(state.panelShown);
		const initializing = state.service.initialize();
		await panelOpening;
		state.reconnect('prespawn', '/project');
		await panel.complete();
		await initializing;
		deepStrictEqual({ created: state.created.length, ids: state.service.sessions.map(session => session.id) }, { created: 0, ids: ['prespawn'] });
	});

	test('prespawn arriving during fallback creation is terminated without adding a session', async () => {
		const creation = new DeferredPromise<void>();
		const state = fixture(undefined, undefined, { creationReady: creation.p });
		const creating = Event.toPromise(state.creationStarted);
		const initializing = state.service.initialize();
		await creating;
		const shell = state.reconnect('late', '/project');
		await creation.complete();
		await initializing;
		deepStrictEqual({ disposed: shell.isDisposed, shutdownIds: state.shutdownIds, created: state.created.length, sessions: state.service.sessions.length }, { disposed: true, shutdownIds: [shell.instanceId], created: 1, sessions: 1 });
	});

	test('the shell starts when persisted terminals do not reconnect within the budget', () => runWithFakedTimers({ useFakeTimers: true }, async () => {
		const state = fixture(undefined, undefined, { connected: false });
		await state.service.initialize();
		deepStrictEqual({ created: state.created.length, shell: state.mainContainer.classList.contains('terminal-first-shell') }, { created: 1, shell: true });
	}));

	test('hidden session layouts wait for presentation', async () => {
		const state = fixture();
		const waitingBeforeInitialize = terminalFirstStartup.waiting;
		const pending = state.service.initialize();
		const waitingWhileStarting = terminalFirstStartup.waiting;
		await pending;
		deepStrictEqual([waitingBeforeInitialize, waitingWhileStarting, terminalFirstStartup.waiting], [false, true, false]);
	});
});
