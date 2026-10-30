/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import assert from 'assert';
import { Selection } from '../../../../common/core/selection.js';
import { Event } from '../../../../../base/common/event.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { createCodeEditorServices, instantiateTestCodeEditor } from '../../../../test/browser/testCodeEditor.js';
import { instantiateTextModel } from '../../../../test/common/testTextModel.js';
import { NativeVimContribution } from '../../browser/nativeVimContribution.js';
import { INativeVimService } from '../../common/nativeVimService.js';
import { VimSharedState } from '../../common/nativeVim.js';

suite('Native Vim editor integration', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();
	function setup(text: string, readOnly = false, hasTextFocus = true) {
		const services = createCodeEditorServices(store);
		services.stub(INativeVimService, {
			enabled: true, shared: new VimSharedState(), onDidChange: Event.None, hint: '',
			key: () => false, cancel: () => { }, execute: () => { }, readClipboard: async () => 'clipboard',
		});
		const model = store.add(instantiateTextModel(services, text));
		const editor = store.add(instantiateTestCodeEditor(services, model, { readOnly, hasTextFocus }));
		const contribution = store.add(editor.registerAndInstantiateContribution(NativeVimContribution.ID, NativeVimContribution));
		const keys = (sequence: string[]) => { for (const key of sequence) { if (!contribution.handle(key)) { editor.trigger('keyboard', 'type', { text: key }); } } };
		return { editor, model, contribution, keys };
	}
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
