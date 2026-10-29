/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { deepStrictEqual, rejects, strictEqual } from 'assert';
import { Emitter } from '../../../../../base/common/event.js';
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
import { IEditorGroupsService } from '../../../../services/editor/common/editorGroupsService.js';
import { IWorkbenchEnvironmentService } from '../../../../services/environment/common/environmentService.js';
import { IWorkbenchLayoutService, Parts } from '../../../../services/layout/browser/layoutService.js';
import { TestEditorInput, TestEditorService, workbenchInstantiationService } from '../../../../test/browser/workbenchTestServices.js';
import { ITerminalGroupService, ITerminalInstance, ITerminalService } from '../../../terminal/browser/terminal.js';
import { TerminalFirstService } from '../../browser/terminalFirstService.js';

suite('Terminal First', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	/** Creates real controller behavior with terminal and layout boundaries replaced by small fakes. */
	function fixture(filesToOpenOrCreate?: IPath[]) {
		const instantiationService = workbenchInstantiationService(undefined, store);
		const activeChanged = store.add(new Emitter<void>());
		const closed = store.add(new Emitter<IEditorCloseEvent>());
		const focused = store.add(new Emitter<ITerminalInstance>());
		const created: ITerminalInstance[] = [];
		const terminals: ITerminalInstance[] = [];
		let active: ITerminalInstance | undefined;
		let maximized = false;
		const hidden = new Map<Parts, boolean>();
		const commands: string[] = [];
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
		const addTerminal = () => {
			const terminal = upcastPartial<ITerminalInstance>({
				instanceId: terminals.length + 1,
				shellIntegrationNonce: `session-${terminals.length + 1}`,
				focusWhenReady: async () => { focused.fire(terminal); },
			});
			terminals.push(terminal);
			active = terminal;
			return terminal;
		};
		instantiationService.stub(IEditorService, editors);
		instantiationService.stub(ITerminalService, upcastPartial<ITerminalService>({
			whenConnected: Promise.resolve(),
			createTerminal: async () => { const terminal = addTerminal(); created.push(terminal); return terminal; },
			setActiveInstance: terminal => { active = terminal; },
		}));
		instantiationService.stub(ITerminalGroupService, upcastPartial<ITerminalGroupService>({
			instances: terminals,
			get activeInstance() { return active && terminals.includes(active) ? active : undefined; },
			showPanel: async () => { hidden.set(Parts.PANEL_PART, false); },
		}));
		instantiationService.stub(IWorkbenchLayoutService, upcastPartial<IWorkbenchLayoutService>({
			whenRestored: Promise.resolve(),
			mainContainer: document.createElement('div'),
			setPartHidden: (value, part) => { hidden.set(part, value); },
			isPanelMaximized: () => maximized,
			toggleMaximizedPanel: () => { maximized = !maximized; },
			setPanelPosition: () => { },
			setPanelAlignment: () => { },
			layout: () => { },
		}));
		instantiationService.stub(IEditorGroupsService, upcastPartial<IEditorGroupsService>({ enforcePartOptions: () => toDisposable(() => { }) }));
		instantiationService.stub(ICommandService, upcastPartial<ICommandService>({ executeCommand: async id => { commands.push(id); return undefined; } }));
		instantiationService.stub(IWorkbenchEnvironmentService, upcastPartial<IWorkbenchEnvironmentService>({ filesToOpenOrCreate }));
		instantiationService.stub(IFileService, upcastPartial<IFileService>({ exists: async resource => !resource.path.endsWith('new.ts') }));
		const service = store.add(instantiationService.createInstance(TerminalFirstService));
		return { service, editors, addTerminal, terminals, created, hidden, commands, opened, focused, closed, get active() { return active; }, get maximized() { return maximized; } };
	}

	test('starts in a shell and reuses a restored terminal', async () => {
		const state = fixture();
		const restored = state.addTerminal();
		await state.service.initialize();
		deepStrictEqual([state.active === restored, state.created.length, state.maximized], [true, 0, true]);
	});

	test('starts explicit file launches in the editor without creating a shell', async () => {
		const state = fixture([{ fileUri: URI.file('/project/file.ts') }]);
		await state.service.initialize();
		deepStrictEqual([state.created.length, state.hidden.get(Parts.PANEL_PART)], [0, true]);
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
		await state.service.toggleTools();
		strictEqual(state.hidden.get(Parts.STATUSBAR_PART), false);
		await state.service.showShell();
		strictEqual(state.hidden.get(Parts.STATUSBAR_PART), true);
		await state.service.showEditor(false);
		strictEqual(state.hidden.get(Parts.STATUSBAR_PART), false);
	});

	test('closing the last file returns to the shell', async () => {
		const state = fixture();
		await state.service.initialize();
		await state.service.openFiles(['file:///project/file.ts'], state.active!.shellIntegrationNonce, false);
		const editor = state.editors.editors[0];
		state.editors.editors = [];
		const returned = new Promise<void>(resolve => {
			const listener = state.focused.event(() => { listener.dispose(); resolve(); });
		});
		state.closed.fire({ editor, groupId: 0, context: EditorCloseContext.UNKNOWN, index: 0, sticky: false });
		await returned;
		strictEqual(state.maximized, true);
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
