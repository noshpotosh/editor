/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { deepStrictEqual } from 'assert';
import { NativeVim, VimSharedState } from '../../../../../editor/contrib/nativeVim/common/nativeVim.js';
import { TerminalCopyHost } from '../../browser/terminalCopyMode.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';

suite('Terminal copy snapshot', () => {
	ensureNoDisposablesAreLeakedInTestSuite();
	test('counts, search, visual line yank and read-only edits use the existing grammar', () => {
		const host = new TerminalCopyHost(['alpha beta', 'second line', 'third line'], () => { });
		const shared = new VimSharedState(); const vim = new NativeVim(host, shared);
		for (const key of ['2', 'j', '0', 'V', 'y']) { vim.key(key); }
		const copied = shared.registers.get('"');
		for (const key of ['g', 'g', '/', 'b', 'e', 't', 'a', '<CR>']) { vim.key(key); }
		const found = host.position();
		for (const key of ['d', 'd']) { vim.key(key); }
		deepStrictEqual({ copied, found, contents: host.text(), readonly: host.readonly() }, { copied: { text: 'third line', line: true }, found: 6, contents: 'alpha beta\nsecond line\nthird line', readonly: true });
	});
	test('visual motions retain their anchor and counts traverse empty rows', () => {
		const moves: (number | boolean | undefined)[][] = [];
		const host = new TerminalCopyHost(['one', '', 'three'], (...move) => moves.push(move));
		const vim = new NativeVim(host, new VimSharedState());
		for (const key of ['v', '2', 'j']) { vim.key(key); }
		deepStrictEqual({ position: host.position(), last: moves.at(-1), row: host.row(host.position()) }, { position: 5, last: [5, 0, false], row: 2 });
	});
});
