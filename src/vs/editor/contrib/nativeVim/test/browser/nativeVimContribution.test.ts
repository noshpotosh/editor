/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import assert from 'assert';
import { spy, stub } from 'sinon';
import { Selection } from '../../../../common/core/selection.js';
import { Emitter, Event } from '../../../../../base/common/event.js';
import { IKeyboardEvent, StandardKeyboardEvent } from '../../../../../base/browser/keyboardEvent.js';
import { toDisposable } from '../../../../../base/common/lifecycle.js';
import { IContextKeyService } from '../../../../../platform/contextkey/common/contextkey.js';
import { IKeybindingService } from '../../../../../platform/keybinding/common/keybinding.js';
import { ResultKind } from '../../../../../platform/keybinding/common/keybindingResolver.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { createCodeEditorServices, instantiateTestCodeEditor } from '../../../../test/browser/testCodeEditor.js';
import { instantiateTextModel } from '../../../../test/common/testTextModel.js';
import { NativeVimContribution } from '../../browser/nativeVimContribution.js';
import { INativeVimService } from '../../common/nativeVimService.js';
import { VimSharedState } from '../../common/nativeVim.js';

suite('Native Vim editor integration', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();
	function setup(text: string, readOnly = false, hasTextFocus = true, keyDown?: Event<IKeyboardEvent>, focusEvents?: { focus: Event<void>; blur: Event<void> }) {
		const services = createCodeEditorServices(store);
		const vim = {
			enabled: true, preserveModeOnFocus: false, shared: new VimSharedState(), onDidChange: Event.None, hint: '',
			key: () => false, cancel: () => { }, execute: () => { }, readClipboard: async () => 'clipboard',
		};
		services.stub(INativeVimService, vim);
		const model = store.add(instantiateTextModel(services, text));
		const editor = store.add(instantiateTestCodeEditor(services, model, { readOnly, hasTextFocus }));
		if (keyDown) {
			const listener = stub(editor, 'onKeyDown').callsFake(keyDown);
			store.add(toDisposable(() => listener.restore()));
		}
		if (focusEvents) {
			const focus = stub(editor, 'onDidFocusEditorText').callsFake(focusEvents.focus);
			const blur = stub(editor, 'onDidBlurEditorText').callsFake(focusEvents.blur);
			store.add(toDisposable(() => { focus.restore(); blur.restore(); }));
		}
		const contribution = store.add(editor.registerAndInstantiateContribution(NativeVimContribution.ID, NativeVimContribution));
		const keys = (sequence: string[]) => { for (const key of sequence) { if (!contribution.handle(key)) { editor.trigger('keyboard', 'type', { text: key }); } } };
		return { editor, model, contribution, keys, services, vim };
	}
	test('borrowing focus for the leader and returning it preserves Insert and Visual modes and selection', () => {
		const snapshots = [];
		for (const mode of ['insert', 'visual'] as const) {
			const focus = store.add(new Emitter<void>());
			const blur = store.add(new Emitter<void>());
			const f = setup('one two', false, true, undefined, { focus: focus.event, blur: blur.event });
			f.keys(mode === 'insert' ? ['i'] : ['v', 'l']);
			const selection = f.editor.getSelection();
			f.vim.preserveModeOnFocus = true;
			blur.fire(); focus.fire();
			f.vim.preserveModeOnFocus = false;
			const preserved = { mode: f.contribution.engine.mode, sameSelection: f.editor.getSelection()!.equalsSelection(selection!) };
			// A subsequent pane switch has the ordinary reset behavior, even after a preserved return.
			blur.fire(); focus.fire();
			snapshots.push({ ...preserved, modeAfterPaneSwitch: f.contribution.engine.mode });
		}
		assert.deepStrictEqual(snapshots, [
			{ mode: 'insert', sameSelection: true, modeAfterPaneSwitch: 'normal' },
			{ mode: 'visual', sameSelection: true, modeAfterPaneSwitch: 'normal' },
		]);
	});
	test('an abandoned leader return and focus in a different editor reset that editor mode', () => {
		const focus = store.add(new Emitter<void>());
		const blur = store.add(new Emitter<void>());
		const f = setup('one two', false, true, undefined, { focus: focus.event, blur: blur.event });
		f.keys(['i']);
		f.vim.preserveModeOnFocus = true;
		blur.fire();
		f.vim.preserveModeOnFocus = false;
		focus.fire();
		const afterOutsideFocus = f.contribution.engine.mode;
		f.keys(['i']);
		f.vim.preserveModeOnFocus = true;
		focus.fire(); // A different editor has not lent its focus to this leader.
		assert.deepStrictEqual([afterOutsideFocus, f.contribution.engine.mode], ['normal', 'normal']);
	});
	test('resolved Ctrl+H/J/K/L and Ctrl+Space bypass Vim in every mode, including user overrides', () => {
		const keyDown = store.add(new Emitter<IKeyboardEvent>());
		const { services, contribution } = setup('abc', false, true, keyDown.event);
		services.get(IContextKeyService).createKey('terminalFirstEnabled', true);
		const dispatch = stub(services.get(IKeybindingService), 'softDispatch').returns({ kind: ResultKind.KbFound, commandId: 'user.command', commandArgs: undefined, isBubble: false });
		store.add(toDisposable(() => dispatch.restore()));
		const handled: string[] = [];
		const handle = stub(contribution, 'handle').callsFake(key => { handled.push(key); return true; });
		store.add(toDisposable(() => handle.restore()));
		const prevented: boolean[] = [];
		for (const mode of ['normal', 'visual', 'insert'] as const) {
			contribution.engine.reset();
			if (mode !== 'normal') { contribution.engine.key(mode === 'visual' ? 'v' : 'i'); }
			for (const key of ['h', 'j', 'k', 'l', ' ']) {
				const event = new KeyboardEvent('keydown', { key, ctrlKey: true, cancelable: true });
				keyDown.fire(new StandardKeyboardEvent(event));
				prevented.push(event.defaultPrevented);
			}
		}
		assert.deepStrictEqual({ handled, prevented }, { handled: [], prevented: Array(15).fill(false) });
	});
	test('modifier-only key presses do not reach Vim or report errors in Normal and Visual modes', () => {
		const keyDown = store.add(new Emitter<IKeyboardEvent>());
		const { contribution } = setup('abc', false, true, keyDown.event);
		const handle = spy(contribution, 'handle');
		store.add(toDisposable(() => handle.restore()));
		const snapshots = [];
		for (const mode of ['normal', 'visual'] as const) {
			contribution.engine.reset();
			if (mode === 'visual') { contribution.engine.key('v'); }
			const prevented = ['Shift', 'Control', 'Alt', 'Meta'].map(key => {
				const event = new KeyboardEvent('keydown', { key, shiftKey: key === 'Shift', ctrlKey: key === 'Control', altKey: key === 'Alt', metaKey: key === 'Meta', cancelable: true });
				keyDown.fire(new StandardKeyboardEvent(event));
				return event.defaultPrevented;
			});
			snapshots.push({ mode: contribution.engine.mode, error: contribution.engine.error, prevented });
		}
		assert.deepStrictEqual({ handled: handle.callCount, snapshots }, { handled: 0, snapshots: [
			{ mode: 'normal', error: '', prevented: [false, false, false, false] },
			{ mode: 'visual', error: '', prevented: [false, false, false, false] },
		] });
	});
	test('Tab and Shift+Tab reach remaps as distinct keys', () => {
		const keyDown = store.add(new Emitter<IKeyboardEvent>());
		const { contribution } = setup('abc', false, true, keyDown.event);
		const handled: string[] = [];
		const handle = stub(contribution, 'handle').callsFake(key => { handled.push(key); return true; });
		store.add(toDisposable(() => handle.restore()));
		for (const shiftKey of [false, true]) {
			keyDown.fire(new StandardKeyboardEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey, cancelable: true })));
		}
		assert.deepStrictEqual(handled, ['<Tab>', '<S-Tab>']);
	});
	test('change and inserted text undo together', async () => {
		const { model, keys } = setup('one two');
		keys(['c', 'i', 'w', 'h', 'i', '<Esc>']); const changed = model.getValue(); await model.undo();
		assert.deepStrictEqual({ changed, undone: model.getValue() }, { changed: 'hi two', undone: 'one two' });
	});
	test('visual selection deletes inclusive range', () => {
		const { model, keys } = setup('abcd'); keys(['v', 'l', 'd']); assert.strictEqual(model.getValue(), 'cd');
	});
	test('block movement keeps logical cursor independently of selection endpoints', () => {
		const { model, keys } = setup('abcd\nefgh\nijkl'); keys(['<C-v>', 'j', 'l', 'd']); assert.strictEqual(model.getValue(), 'cd\ngh\nijkl');
	});
	test('read-only permits movement without edits', () => {
		const { model, editor, keys } = setup('abc', true); keys(['l', 'x']);
		assert.deepStrictEqual({ text: model.getValue(), column: editor.getPosition()!.column }, { text: 'abc', column: 2 });
	});
	test('external edit cancels a pending operator', () => {
		const { model, contribution, keys } = setup('abc'); keys(['d']); model.setValue('changed');
		assert.deepStrictEqual({ text: model.getValue(), mode: contribution.engine.mode, pending: contribution.engine.pending }, { text: 'changed', mode: 'normal', pending: '' });
	});
	test('unfocused editors do not handle keys', () => {
		const { model, contribution } = setup('abc', false, false);
		assert.deepStrictEqual({ handled: contribution.handle('x'), text: model.getValue() }, { handled: false, text: 'abc' });
	});

	test('a failing edit closes the undo transaction so later undo stops work', async () => {
		const { model, editor, contribution } = setup('one two');
		const failing = stub(editor, 'executeEdits').throws(new Error('edit failed'));
		assert.throws(() => contribution.handle('c') && contribution.handle('w'), /edit failed/);
		failing.restore();
		editor.setPosition({ lineNumber: 1, column: 1 });
		editor.trigger('keyboard', 'type', { text: 'b' }); model.pushStackElement();
		editor.trigger('keyboard', 'type', { text: 'c' }); model.pushStackElement();
		await model.undo();
		assert.strictEqual(model.getValue(), 'bone two');
	});

	test('motions on a large document stay within budget', () => {
		const lines = Array.from({ length: 50000 }, (_, index) => `line ${index} with some words in it`);
		const { editor, keys } = setup(lines.join('\n'));
		const started = Date.now();
		keys(['G']);
		for (let i = 0; i < 200; i++) { keys(['k']); }
		keys(['g', 'g']);
		for (let i = 0; i < 50; i++) { keys(['w']); }
		keys(['v', 'j', 'j', 'l']);
		const elapsed = Date.now() - started;
		assert.ok(elapsed < 2000, `Vim motions took ${elapsed} ms on a 50k-line document`);
		assert.deepStrictEqual({ line: editor.getPosition()?.lineNumber, selected: editor.getSelection()?.isEmpty() === false }, { line: 1 + Math.floor(50 / 7) + 2, selected: true });
	});

	test('nested undo transactions restore ordinary boundaries afterward', async () => {
		const { model, editor } = setup('a');
		const first = model.beginUndoRedoTransaction(); const second = model.beginUndoRedoTransaction();
		editor.trigger('keyboard', 'type', { text: 'b' }); model.pushStackElement(); second.dispose();
		editor.trigger('keyboard', 'type', { text: 'c' }); first.dispose();
		editor.trigger('keyboard', 'type', { text: 'd' }); model.pushStackElement();
		await model.undo(); const afterFirstUndo = model.getValue(); await model.undo();
		assert.deepStrictEqual({ afterFirstUndo, afterSecondUndo: model.getValue() }, { afterFirstUndo: 'bca', afterSecondUndo: 'a' });
	});

	test('Insert preserves multiple cursors and Escape retains the primary cursor', () => {
		const { model, editor, keys } = setup('a\nb'); editor.setSelections([new Selection(1, 1, 1, 1), new Selection(2, 1, 2, 1)]);
		keys(['i', 'x', '<Esc>']);
		assert.deepStrictEqual({ text: model.getValue(), cursors: editor.getSelections()!.length }, { text: 'xa\nxb', cursors: 1 });
	});
	test('composition records committed text for repeat', () => {
		const { model, editor, contribution, keys } = setup('a'); keys(['i']); contribution.startComposition();
		editor.trigger('keyboard', 'type', { text: '日本' }); contribution.endComposition(); keys(['<Esc>', '.']);
		assert.strictEqual(model.getValue(), '日日本本a');
	});
	test('CRLF open-line insertion lands on the new line', () => {
		const { model, keys } = setup('one\r\ntwo'); keys(['o', 'x', '<Esc>']); assert.strictEqual(model.getValue(), 'one\r\nx\r\ntwo');
	});
	test('visual highlighting includes the character under the cursor', () => {
		const { editor, keys } = setup('😀abc'); keys(['v']); assert.deepStrictEqual(editor.getSelection(), new Selection(1, 1, 1, 3));
	});
	test('typing queued behind a clipboard read is not lost', async () => {
		const { model, keys } = setup('a'); keys(['"', '+', 'p', 'i', 'z', '<Esc>']); await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
		assert.strictEqual(model.getValue(), 'azclipboard');
	});
	test('clipboard put is ordered before subsequent keys', async () => {
		const { model, keys } = setup('a'); keys(['"', '+', 'p', 'x']); await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
		assert.strictEqual(model.getValue(), 'alipboard');
	});
});
