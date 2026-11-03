/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { deepStrictEqual, strictEqual } from 'assert';
import { addDisposableListener } from '../../../../../base/browser/dom.js';
import { DisposableStore, toDisposable } from '../../../../../base/common/lifecycle.js';
import { Event } from '../../../../../base/common/event.js';
import { URI } from '../../../../../base/common/uri.js';
import { upcastPartial } from '../../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { ICodeEditorService } from '../../../../../editor/browser/services/codeEditorService.js';
import { ITextModel } from '../../../../../editor/common/model.js';
import { ICodeEditor } from '../../../../../editor/browser/editorBrowser.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { IExtensionManagementService } from '../../../../../platform/extensionManagement/common/extensionManagement.js';
import { INotificationService } from '../../../../../platform/notification/common/notification.js';
import { IQuickInputService, IQuickPickItem } from '../../../../../platform/quickinput/common/quickInput.js';
import { GroupDirection, IEditorGroupsService } from '../../../../services/editor/common/editorGroupsService.js';
import { ITerminalFirstService } from '../../../../services/terminalFirst/common/terminalFirst.js';
import { IWorkbenchExtensionEnablementService } from '../../../../services/extensionManagement/common/extensionManagement.js';
import { TestFileEditorInput, createEditorParts, registerTestEditor, workbenchTeardown, workbenchInstantiationService } from '../../../../test/browser/workbenchTestServices.js';
import { SyncDescriptor } from '../../../../../platform/instantiation/common/descriptors.js';
import { Registry } from '../../../../../platform/registry/common/platform.js';
import { EditorExtensions, IEditorFactoryRegistry, EditorsOrder } from '../../../../common/editor.js';
import { OpenNextEditorInGroup, OpenPreviousEditorInGroup } from '../../../../browser/parts/editor/editorActions.js';
import { ActiveGroupEditorsByMostRecentlyUsedQuickAccess } from '../../../../browser/parts/editor/editorQuickAccess.js';
import { NativeVimPickers } from '../../browser/nativeVimPickers.js';
import { INativeVimService } from '../../../../../editor/contrib/nativeVim/common/nativeVimService.js';
import { IContext, IContextKeyService } from '../../../../../platform/contextkey/common/contextkey.js';
import { ITerminalFirstLeaderService, TerminalFirstLeaderService } from '../../browser/terminalFirstLeader.js';
import { terminalFirstPolicy } from '../../../../services/terminalFirst/common/terminalFirstPolicy.js';
import { terminalFirstStartup } from '../../../../services/terminalFirst/common/terminalFirstStartup.js';
import { NativeVimService } from '../../browser/nativeVim.js';

suite('Native Vim workbench navigation', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();
	teardown(() => terminalFirstStartup.reset());

	function fixture(leader = ' ', instantiation = workbenchInstantiationService(undefined, store), leaderBindings: { keys: string; label: string; command: string }[] = []) {
		const previousMode = terminalFirstPolicy.mode;
		terminalFirstPolicy.mode = 'editor';
		store.add(toDisposable(() => { terminalFirstPolicy.mode = previousMode; }));
		const commands: string[] = [];
		const commandHandlers = new Map<string, () => void>();
		const errors: string[] = [];
		let help: readonly IQuickPickItem[] = [];
		let chooseHelp: string | undefined;
		instantiation.stub(ITerminalFirstService, upcastPartial<ITerminalFirstService>({ sessions: [], onDidChangeSessions: Event.None }));
		instantiation.stub(IConfigurationService, new TestConfigurationService({ terminalFirst: { vim: { engine: 'native', leader, hintDelay: 250, remaps: [], leaderBindings } } }));
		instantiation.stub(ICommandService, upcastPartial<ICommandService>({ executeCommand: async id => { commands.push(id); commandHandlers.get(id)?.(); return undefined; } }));
		instantiation.stub(ICodeEditorService, upcastPartial<ICodeEditorService>({ getFocusedCodeEditor: () => upcastPartial<ICodeEditor>({ getModel: () => upcastPartial<ITextModel>({}) }) }));
		instantiation.stub(IExtensionManagementService, upcastPartial<IExtensionManagementService>({ getInstalled: async () => [] }));
		instantiation.stub(IWorkbenchExtensionEnablementService, upcastPartial<IWorkbenchExtensionEnablementService>({}));
		instantiation.stub(INotificationService, upcastPartial<INotificationService>({ error: error => { errors.push(String(error)); } }));
		instantiation.stub(IQuickInputService, upcastPartial<IQuickInputService>({
			onShow: Event.None, onHide: Event.None,
			pick: async picks => { const items = (await picks).filter(item => item.type !== 'separator'); help = items; return items.find(item => item.description === chooseHelp); },
		}));
		// The mock context key service answers null for getContext; the pickers read keys through it as soon as Vim is enabled.
		const contextKeys = instantiation.get(IContextKeyService);
		instantiation.stub(IContextKeyService, 'getContext', () => upcastPartial<IContext>({ getValue: key => contextKeys.getContextKeyValue(key) }));
		instantiation.stub(ITerminalFirstLeaderService, store.add(instantiation.createInstance(TerminalFirstLeaderService)));
		const vim = store.add(instantiation.createInstance(NativeVimService));
		const keys = (sequence: string[], mode: 'normal' | 'insert' = 'normal') => sequence.map(key => vim.key(key, mode));
		const settle = async () => { for (let i = 0; i < 8; i++) { await Promise.resolve(); } deepStrictEqual(errors, []); };
		return { instantiation, vim, keys, commands, commandHandlers, settle, leaderService: instantiation.get(ITerminalFirstLeaderService), get help() { return help; }, selectHelp: (description: string) => { chooseHelp = description; } };
	}
	function focusTarget(): HTMLInputElement {
		const input = document.createElement('input');
		document.body.appendChild(input);
		store.add(toDisposable(() => input.remove()));
		input.focus();
		return input;
	}
	function leaderMenu(): HTMLElement {
		const menu = document.querySelector<HTMLElement>('.native-vim-leader');
		if (!menu) { throw new Error('Expected the leader menu'); }
		return menu;
	}
	function pressMenuKey(key: string): KeyboardEvent {
		const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
		leaderMenu().dispatchEvent(event);
		return event;
	}

	test('numeric Ex commands reveal the destination and clamp to the document', async () => {
		const f = fixture();
		const moved: { lineNumber: number; column: number }[] = [];
		const revealed: { lineNumber: number; column: number }[] = [];
		f.instantiation.stub(ICodeEditorService, 'getFocusedCodeEditor', () => upcastPartial<ICodeEditor>({
				getModel: () => upcastPartial<ITextModel>({ getLineCount: () => 200 }),
				setPosition: position => { moved.push(position); },
				revealPositionInCenterIfOutsideViewport: position => { revealed.push(position); },
			}));
		for (const line of ['120', '999', '0']) { f.vim.execute('ex', line); }
		await f.settle();
		const expected = [{ lineNumber: 120, column: 1 }, { lineNumber: 200, column: 1 }, { lineNumber: 1, column: 1 }];
		deepStrictEqual({ moved, revealed }, { moved: expected, revealed: expected });
	});

	test('Space then Escape dismisses the root menu, restores editor focus and consumes Escape', async () => {
		const f = fixture();
		const editor = focusTarget();
		let bubbled = false;
		store.add(addDisposableListener(document.body, 'keydown', () => { bubbled = true; }));
		f.keys([' ']);
		const capturedBeforeHint = document.activeElement === leaderMenu() && leaderMenu().classList.contains('pending');
		const escape = pressMenuKey('Escape');
		await f.settle();
		deepStrictEqual({ capturedBeforeHint, consumed: escape.defaultPrevented, bubbled, commands: f.commands, active: f.leaderService.active, hidden: leaderMenu().hidden, editorFocused: document.activeElement === editor, mode: terminalFirstPolicy.mode }, {
			capturedBeforeHint: true, consumed: true, bubbled: false, commands: [], active: false, hidden: true, editorFocused: true, mode: 'editor',
		});
		f.keys([' ', 'q']);
		await f.settle();
		deepStrictEqual(f.commands, ['terminalFirst.showShell']);
	});

	test('delayed focus cancellation preserves the menu while explicit cancellation still closes it', async () => {
		const f = fixture();
		const editor = focusTarget();
		f.keys([' ', 'w']);
		await Promise.resolve();
		f.vim.cancel('focus');
		const preserved = f.leaderService.active && f.vim.hint === f.leaderService.hint && !!f.vim.hint;
		f.vim.cancel();
		deepStrictEqual({ preserved, active: f.leaderService.active, hint: f.vim.hint, editorFocused: document.activeElement === editor }, { preserved: true, active: false, hint: '', editorFocused: true });
	});

	test('leader commands run with the previous focus and retain their chosen destination', async () => {
		const f = fixture();
		const destination = focusTarget();
		const editor = focusTarget();
		let commandStartedInEditor = false;
		f.commandHandlers.set('workbench.action.quickOpen', () => { commandStartedInEditor = document.activeElement === editor; destination.focus(); });
		f.keys([' ']);
		pressMenuKey('f'); pressMenuKey('f');
		await f.settle();
		deepStrictEqual({ commandStartedInEditor, destinationFocused: document.activeElement === destination, active: f.leaderService.active }, { commandStartedInEditor: true, destinationFocused: true, active: false });
	});

	test('menu navigation scrolls without consuming letter bindings or leaking wheel events', async () => {
		const f = fixture();
		focusTarget();
		f.keys([' ']);
		const menu = leaderMenu();
		menu.style.maxHeight = '100px';
		menu.style.width = '400px';
		const offsets: number[] = [];
		const consumed = ['ArrowDown', 'PageDown', 'ArrowUp', 'PageUp', 'End', 'Home'].map(key => {
			const event = pressMenuKey(key); offsets.push(menu.scrollTop); return event.defaultPrevented;
		});
		let wheelBubbled = false;
		store.add(addDisposableListener(document.body, 'wheel', () => { wheelBubbled = true; }));
		const wheel = new WheelEvent('wheel', { deltaY: 100, bubbles: true, cancelable: true });
		menu.dispatchEvent(wheel);
		deepStrictEqual({ consumed, scrollable: menu.scrollHeight > menu.clientHeight, scrolled: [offsets[0] > 0, offsets[1] > offsets[0], offsets[2] < offsets[1], offsets[3] < offsets[2], offsets[4] > offsets[1], offsets[5] === 0], active: f.leaderService.active, wheelBubbled, nativeWheelAllowed: !wheel.defaultPrevented }, {
			consumed: [true, true, true, true, true, true], scrollable: true, scrolled: [true, true, true, true, true, true], active: true, wheelBubbled: false, nativeWheelAllowed: true,
		});
		pressMenuKey('f'); pressMenuKey('f');
		await f.settle();
		deepStrictEqual(f.commands, ['workbench.action.quickOpen']);
	});

	test('repeated resize survives tile focus while unmaximizing and Escape returns to that tile', async () => {
		const f = fixture();
		const tile = focusTarget();
		f.commandHandlers.set('terminalFirst.tile.resizeLeft', () => tile.focus());
		f.keys([' ', 'w', 'r']);
		pressMenuKey('h');
		await f.settle();
		const firstRetainedFocus = document.activeElement === leaderMenu() && f.leaderService.active;
		pressMenuKey('h');
		await f.settle();
		pressMenuKey('Escape');
		deepStrictEqual({ firstRetainedFocus, commands: f.commands, active: f.leaderService.active, tileFocused: document.activeElement === tile }, { firstRetainedFocus: true, commands: ['terminalFirst.tile.resizeLeft', 'terminalFirst.tile.resizeLeft'], active: false, tileFocused: true });
	});

	test('cancelling a pending resize does not reopen the menu or steal subsequent focus', async () => {
		const f = fixture();
		const tile = focusTarget();
		f.keys([' ', 'w', 'r', 'h', '<Esc>']);
		const destination = focusTarget();
		await f.settle();
		deepStrictEqual({ active: f.leaderService.active, hidden: leaderMenu().hidden, destinationFocused: document.activeElement === destination, tileFocused: document.activeElement === tile }, { active: false, hidden: true, destinationFocused: true, tileFocused: false });
	});

	test('additional leader bindings preserve existing commands and menu prefixes', async () => {
		const f = fixture(' ', undefined, [
			{ keys: 'v', label: 'Split current file', command: 'workbench.action.splitEditorRight' },
			{ keys: 'fg', label: 'Search project', command: 'workbench.action.findInFiles' },
			{ keys: 'c', label: 'Conflicting menu', command: 'unexpected.menu' },
			{ keys: 'ffx', label: 'Conflicting prefix', command: 'unexpected.prefix' },
			{ keys: 'ff', label: 'Conflicting command', command: 'unexpected.command' },
		]);
		f.keys([' ', 'v', ' ', 'f', 'g', ' ', 'c', 'a', ' ', 'f', 'f']);
		await f.settle();
		deepStrictEqual(f.commands, ['workbench.action.splitEditorRight', 'workbench.action.findInFiles', 'editor.action.quickFix', 'workbench.action.quickOpen']);
	});

	test('global leader captures pending keys and releases input after cancellation', async () => {
		const f = fixture();
		f.leaderService.start();
		const input = document.createElement('input'); document.body.appendChild(input);
		store.add(toDisposable(() => input.remove()));
		const events = ['f', 'f', 'z'].map(key => new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
		for (const event of events) { input.dispatchEvent(event); }
		await f.settle();
		deepStrictEqual({ consumed: events.map(event => event.defaultPrevented), commands: f.commands, active: f.leaderService.active }, { consumed: [true, true, false], commands: ['workbench.action.quickOpen'], active: false });
	});

	test('leader and Ctrl+W route tile actions; buffer commands and Ex aliases stay local', async () => {
		const f = fixture();
		const panes = ['n', 'p', 'h', 'j', 'k', 'l', 'v', 's', 'q', 'o', '='];
		const expectedPanes = ['next', 'previous', 'focusLeft', 'focusDown', 'focusUp', 'focusRight', 'splitRight', 'splitDown', 'close', 'toggleSplit', 'balance'];
		for (const suffix of panes) { f.keys([' ', 'w', suffix]); f.keys(['<C-w>', suffix]); }
		for (const suffix of ['n', 'p', 'b']) { f.keys([' ', 'b', suffix]); }
		for (const alias of ['bn', 'bnext', 'bp', 'bprevious', 'buffers', 'ls', 'sp', 'split', 'vs', 'vsplit']) { f.vim.execute('ex', alias); }
		await f.settle();
		deepStrictEqual(f.commands, [
			...expectedPanes.flatMap(command => [`terminalFirst.tile.${command}`, `terminalFirst.tile.${command}`]),
			...['nextEditorInGroup', 'previousEditorInGroup', 'showEditorsInActiveGroup', 'nextEditorInGroup', 'nextEditorInGroup', 'previousEditorInGroup', 'previousEditorInGroup', 'showEditorsInActiveGroup', 'showEditorsInActiveGroup'].map(command => `workbench.action.${command}`),
			...['splitEditorDown', 'splitEditorDown', 'splitEditorRight', 'splitEditorRight'].map(command => `terminalFirst.tile.${command}`),
		]);
	});

	test('resize submap repeats until another key; swap uses its own prefix', async () => {
		const f = fixture();
		f.keys([' ', 'w', 'r', 'h', 'h', 'l', '=', 'j']);
		const submapActive = f.leaderService.active;
		f.keys(['<Esc>']);
		f.keys(['<C-w>', 'r', 'k', 'z']);
		f.keys([' ', 'w', 'x', 'h']);
		f.keys(['<C-w>', 'x', 'l']);
		await f.settle();
		deepStrictEqual({ submapActive, active: f.leaderService.active, commands: f.commands }, {
			submapActive: true, active: false,
			commands: ['resizeLeft', 'resizeLeft', 'resizeRight', 'balance', 'resizeDown', 'resizeUp', 'swapLeft', 'swapRight'].map(command => `terminalFirst.tile.${command}`),
		});
	});

	test('cancelled and invalid sequences execute nothing; Insert does not start a leader', async () => {
		const f = fixture();
		f.keys([' ', 'w', '<Esc>', 'n']);
		f.keys(['<C-w>', 'z', 'n']);
		const handled = f.keys([' ', '<C-w>'], 'insert');
		await f.settle();
		deepStrictEqual({ commands: f.commands, hint: f.vim.hint, handled }, { commands: [], hint: '', handled: [false, false] });
	});

	test('custom leader hints and help share bindings including Ctrl+W alternatives', async () => {
		const f = fixture(',');
		f.keys([',', 'w']);
		strictEqual(f.vim.hint.includes(', wn / Ctrl+W n  Focus Next Pane'), true);
		f.keys(['<Esc>', ',', '?']);
		await f.settle();
		deepStrictEqual(f.help.filter(item => item.label === 'Focus Next Pane' || item.label === 'Pick Buffer in Pane').map(item => item.description), [', bb', ', wn / Ctrl+W n']);
	});

	test('real panes retain dirty buffers and selection; local cycling wraps without changing panes', async () => {
		const instantiation = workbenchInstantiationService(undefined, store);
		const editorId = 'nativeVimNavigationTestEditor';
		store.add(registerTestEditor(editorId, [new SyncDescriptor(TestFileEditorInput)], editorId));
		instantiation.invokeFunction(accessor => Registry.as<IEditorFactoryRegistry>(EditorExtensions.EditorFactory).start(accessor));
		const parts = await createEditorParts(instantiation, store.add(new DisposableStore()));
		instantiation.stub(IEditorGroupsService, parts);
		const f = fixture(' ', instantiation);
		const first = store.add(new TestFileEditorInput(URI.file('/first'), editorId));
		const second = store.add(new TestFileEditorInput(URI.file('/second'), editorId));
		const third = store.add(new TestFileEditorInput(URI.file('/third'), editorId));
		try {
			const source = parts.activeGroup;
			await source.openEditor(first, { pinned: true });
			await source.openEditor(second, { pinned: true });
			await source.setSelection(first, [second]);
			first.setDirty();
			const target = parts.addGroup(source, GroupDirection.RIGHT);
			source.moveEditor(first, target);
			target.focus();
			await f.settle();
			deepStrictEqual({ count: parts.count, moved: target.activeEditor === first, source: source.getEditors(EditorsOrder.SEQUENTIAL).map(editor => editor.resource?.path), dirty: first.isDirty(), saved: first.gotSaved, disposed: first.gotDisposed }, { count: 2, moved: true, source: ['/second'], dirty: true, saved: false, disposed: false });
			await target.openEditor(third, { pinned: true });
			class TestBufferPicker extends ActiveGroupEditorsByMostRecentlyUsedQuickAccess {
				getEditorsForTest() { return this.doGetEditors(); }
			}
			const picker = store.add(instantiation.createInstance(TestBufferPicker));
			deepStrictEqual(picker.getEditorsForTest().map(item => [item.editor.resource?.path, item.groupId]), [['/third', target.id], ['/first', target.id]]);
			// Dispatch the same built-in actions used by the Vim routes against real groups.
			await instantiation.invokeFunction(accessor => new OpenNextEditorInGroup().run(accessor));
			strictEqual(target.activeEditor, first);
			await instantiation.invokeFunction(accessor => new OpenPreviousEditorInGroup().run(accessor));
			strictEqual(target.activeEditor, third);
			source.focus();
			await instantiation.invokeFunction(accessor => new OpenNextEditorInGroup().run(accessor));
			await instantiation.invokeFunction(accessor => new OpenPreviousEditorInGroup().run(accessor));
			deepStrictEqual([parts.activeGroup === source, source.activeEditor === second, parts.count], [true, true, 2]);
		} finally {
			first.dirty = false;
			await workbenchTeardown(instantiation);
		}
	});

	test('terminal key events are not intercepted by the workbench Vim layer', () => {
		const instantiation = workbenchInstantiationService(undefined, store);
		const input = document.createElement('input');
		document.body.appendChild(input);
		store.add(toDisposable(() => input.remove()));
		const contexts = instantiation.get(IContextKeyService);
		contexts.createKey('terminalFocus', true);
		instantiation.stub(IContextKeyService, 'getContext', () => upcastPartial<IContext>({ getValue: key => contexts.getContextKeyValue(key) }));
		const intercepted: string[] = [];
		store.add(new NativeVimPickers(
			upcastPartial<INativeVimService>({ enabled: true, cancel: () => { }, key: key => { intercepted.push(key); return true; } }),
			upcastPartial<IQuickInputService>({ onShow: Event.None, onHide: Event.None }),
			instantiation.get(ICommandService), contexts,
		));
		input.focus();
		const events = [new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }), new KeyboardEvent('keydown', { key: 'w', ctrlKey: true, bubbles: true, cancelable: true }), new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })];
		for (const event of events) { input.dispatchEvent(event); }
		deepStrictEqual([intercepted, events.map(event => event.defaultPrevented)], [[], [false, false, false]]);
	});

	test('H/J/K/L move whole tiles through both prefixes and help', async () => {
		const f = fixture();
		for (const key of ['H', 'J', 'K', 'L']) {
			f.keys([' ', 'w', key]); f.keys(['<C-w>', key]);
			f.selectHelp(`Space w${key} / Ctrl+W ${key}`);
			f.vim.execute('help');
			await f.settle();
		}
		deepStrictEqual(f.commands, ['Left', 'Down', 'Up', 'Right'].flatMap(direction => Array(3).fill(`terminalFirst.tile.move${direction}`)));
	});

	test('native Vim is enabled before the installed extensions are known', () => {
		terminalFirstStartup.begin();
		const state = fixture();
		strictEqual(state.vim.enabled, true);
	});
});
