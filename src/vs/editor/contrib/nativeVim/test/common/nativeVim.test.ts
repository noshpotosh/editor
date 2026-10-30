/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import assert from 'assert';
import { validateVimRemaps } from '../../common/vimRemapping.js';
import { NativeVim, restoreVimSharedState, serializeVimSharedState, VimHost, VimSharedState } from '../../common/nativeVim.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';

class Host implements VimHost {
	value: string;
	cursor = 0;
	locked = false;
	readonly history: string[] = [];
	readonly commands: [string, string | undefined][] = [];
	constructor(value: string) { this.value = value; }
	text(): string { return this.value; }
	position(): number { return this.cursor; }
	move(offset: number): void { this.cursor = Math.min(this.value.length, Math.max(0, offset)); }
	edit(start: number, end: number, text: string): void { this.value = this.value.slice(0, start) + text + this.value.slice(end); this.cursor = start + text.length; }
	boundary(): void { if (this.history.at(-1) !== this.value) { this.history.push(this.value); } }
	command(id: string, argument?: string): void { this.commands.push([id, argument]); }
	readonly(): boolean { return this.locked; }
}
function setup(text: string) {
	const host = new Host(text); const shared = new VimSharedState(); const vim = new NativeVim(host, shared);
	const keys = (input: string | string[]) => { for (const key of typeof input === 'string' ? [...input] : input) { if (!vim.key(key)) { const p = host.position(); host.edit(p, p, key); } } };
	return { host, vim, shared, keys };
}

suite('Native Vim', () => {
	ensureNoDisposablesAreLeakedInTestSuite();
	for (const sample of [
		{ name: 'operator count multiplication', text: 'a b c d e f g', keys: '2d3w', expected: 'g' },
		{ name: 'inner word', text: 'hello world', keys: 'diw', expected: ' world' },
		{ name: 'around word', text: 'hello world', keys: 'daw', expected: 'world' },
		{ name: 'nested brackets', text: '(a (b) c)', keys: 'ldi(', expected: '()' },
		{ name: 'line yank and put', text: 'one\ntwo\n', keys: 'yyp', expected: 'one\none\ntwo\n' },
		{ name: 'delete to end', text: 'abc', keys: 'ld$', expected: 'a' },
		{ name: 'surrogate movement', text: '😀a', keys: 'lx', expected: '😀' },
		{ name: 'join', text: 'one\n  two', keys: 'J', expected: 'one two' },
		{ name: 'line deletion', text: 'one\ntwo\nthree', keys: '2dd', expected: 'three' },
		{ name: 'find operator', text: 'abc def', keys: 'dfc', expected: ' def' },
	]) {
		test(sample.name, () => { const { host, vim, keys } = setup(sample.text); keys(sample.keys); assert.deepStrictEqual({ text: host.value, mode: vim.mode }, { text: sample.expected, mode: 'normal' }); });
	}
	test('change and dot include inserted text', () => {
		const { host, vim, keys } = setup('one two'); keys('ciw'); keys('x'); keys(['<Esc>']); keys('w.');
		assert.deepStrictEqual({ text: host.value, mode: vim.mode }, { text: 'x x', mode: 'normal' });
	});
	test('macro replay', () => {
		const { host, shared, keys } = setup('abc'); keys('qaxq@a');
		assert.deepStrictEqual({ text: host.value, macro: shared.macros.get('a') }, { text: 'c', macro: ['x'] });
	});
	test('black hole leaves unnamed register unchanged', () => {
		const { shared, keys } = setup('one two'); keys('yiw"_dw'); assert.deepStrictEqual(shared.registers.get('"'), { text: 'one', line: false });
	});
	test('read-only blocks edits but allows yank', () => {
		const { host, vim, shared, keys } = setup('one'); host.locked = true; keys('ddyiw');
		assert.deepStrictEqual({ text: host.value, mode: vim.mode, register: shared.registers.get('0') }, { text: 'one', mode: 'normal', register: { text: 'one', line: false } });
	});
	test('search wraps and reports invalid expressions', () => {
		const { host, vim, keys } = setup('one two one'); keys('/one'); keys(['<CR>']); const first = host.cursor; keys('n'); const wrapped = host.cursor; keys('/['); keys(['<CR>']);
		assert.deepStrictEqual({ first, wrapped, error: vim.error }, { first: 8, wrapped: 0, error: 'invalidPattern' });
	});
	test('escape cancels an operator without editing', () => { const { host, vim, keys } = setup('abc'); keys('2d'); keys(['<Esc>']); assert.deepStrictEqual({ text: host.value, mode: vim.mode, pending: vim.pending }, { text: 'abc', mode: 'normal', pending: '' }); });
	test('empty document stays bounded', () => { const { host, keys } = setup(''); keys('hjklwbGe$x'); assert.deepStrictEqual({ text: host.value, cursor: host.cursor }, { text: '', cursor: 0 }); });
	test('insert transaction has one pair of boundaries', () => { const { host, keys } = setup('abc'); keys('ihello'); keys(['<Esc>']); assert.deepStrictEqual(host.history, ['abc', 'helloabc']); });
	test('block delete edits each selected row', () => { const { host, keys } = setup('abcd\nefgh\nijkl'); keys(['<C-v>', 'j', 'l', 'd']); assert.strictEqual(host.value, 'cd\ngh\nijkl'); });

	test('dot repeats the visual selection and operator', () => { const { host, keys } = setup('abcdef'); keys('vld.'); assert.strictEqual(host.value, 'ef'); });
	test('failed character search does not delete text', () => { const { host, keys } = setup('abc'); keys('dfz'); assert.strictEqual(host.value, 'abc'); });
	test('visual case change preserves the register', () => { const { host, shared, keys } = setup('abc'); keys('vlU'); assert.deepStrictEqual({ text: host.value, registers: shared.registers.size }, { text: 'ABc', registers: 0 }); });
	test('CRLF line motions and deletion preserve endings', () => { const { host, keys } = setup('one\r\ntwo\r\nthree'); keys('jdd'); assert.strictEqual(host.value, 'one\r\nthree'); });
	test('last line deletion removes its preceding newline', () => { const { host, keys } = setup('one\ntwo'); keys('Gdd'); assert.strictEqual(host.value, 'one'); });
	test('cw preserves following whitespace', () => { const { host, keys } = setup('one two'); keys('cw'); keys('x'); keys(['<Esc>']); assert.strictEqual(host.value, 'x two'); });
	test('line change retains a separate line', () => { const { host, keys } = setup('one\ntwo'); keys('ccx'); keys(['<Esc>']); assert.strictEqual(host.value, 'x\ntwo'); });
	test('case operator composes with a text object', () => { const { host, keys } = setup('one two'); keys('gUiw'); assert.strictEqual(host.value, 'ONE two'); });
	test('block change replicates inserted text', () => { const { host, keys } = setup('abcd\nefgh'); keys(['<C-v>', 'j', 'l', 'c', 'x', '<Esc>']); assert.strictEqual(host.value, 'xcd\nxgh'); });
	test('visual inner word', () => { const { host, keys } = setup('one two'); keys('viwd'); assert.strictEqual(host.value, ' two'); });
	test('replace count cannot extend a line', () => { const { host, keys } = setup('ab\ncd'); keys('4rx'); assert.strictEqual(host.value, 'xx\ncd'); });
	test('x cannot join lines', () => { const { host, keys } = setup('ab\ncd'); keys('9x'); assert.strictEqual(host.value, '\ncd'); });
	test('remaps reject cycles and ambiguous prefixes', () => {
		assert.deepStrictEqual([
			validateVimRemaps([{ mode: 'normal', before: ['a'], after: ['b'] }, { mode: 'normal', before: ['b'], after: ['a'] }]),
			validateVimRemaps([{ mode: 'normal', before: ['g'], after: ['j'] }, { mode: 'normal', before: ['g', 'g'], after: ['k'] }]),
			validateVimRemaps([{ mode: 'normal', before: ['j'], after: ['k'] }]),
		], [false, false, true]);
	});
	test('colon delegates without modifying text', () => { const { host, keys } = setup('abc'); keys(':w'); keys(['<CR>']); assert.deepStrictEqual(host.commands, [['ex', 'w']]); });

	test('shared state round-trips through storage and ignores malformed entries', () => {
		const state = new VimSharedState();
		state.registers.set('"', { text: 'yanked', line: false });
		state.registers.set('a', { text: 'block', line: false, block: true });
		state.marks.set('file:///a.ts', new Map([['a', 12], ['b', 0]]));
		state.macros.set('q', ['d', 'w']);
		state.search = 'needle'; state.searchBackwards = true;
		const restored = new VimSharedState();
		const accepted = restoreVimSharedState(restored, JSON.parse(JSON.stringify(serializeVimSharedState(state))));
		const rejected = restoreVimSharedState(new VimSharedState(), { version: 2 });
		const partial = new VimSharedState();
		restoreVimSharedState(partial, { version: 1, registers: { ok: { text: 't', line: true }, bad: { text: 1 } }, marks: { 'file:///b': { a: -1, b: 'x', c: 3 } }, macros: { m: ['x'], broken: [1] } });
		assert.deepStrictEqual({
			accepted, rejected,
			registers: [...restored.registers], marks: [...restored.marks].map(([document, marks]) => [document, [...marks]]), macros: [...restored.macros], search: [restored.search, restored.searchBackwards],
			partial: { registers: [...partial.registers.keys()], marks: [...partial.marks.get('file:///b') ?? []], macros: [...partial.macros.keys()] },
		}, {
			accepted: true, rejected: false,
			registers: [['"', { text: 'yanked', line: false }], ['a', { text: 'block', line: false, block: true }]], marks: [['file:///a.ts', [['a', 12], ['b', 0]]]], macros: [['q', ['d', 'w']]], search: ['needle', true],
			partial: { registers: ['ok'], marks: [['c', 3]], macros: ['m'] },
		});
	});
});
