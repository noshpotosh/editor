/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ContextKeyValue } from '../../../../../platform/contextkey/common/contextkey.js';
import { OS } from '../../../../../base/common/platform.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { KeybindingsRegistry } from '../../../../../platform/keybinding/common/keybindingsRegistry.js';
import { KeybindingResolver, ResultKind } from '../../../../../platform/keybinding/common/keybindingResolver.js';
import { ResolvedKeybindingItem } from '../../../../../platform/keybinding/common/resolvedKeybindingItem.js';
import { USLayoutResolvedKeybinding } from '../../../../../platform/keybinding/common/usLayoutResolvedKeybinding.js';
import '../../browser/terminalFirstNavigation.js';
import '../../browser/tileListNavigation.js';

suite('Terminal First docked navigation', () => {
	ensureNoDisposablesAreLeakedInTestSuite();
	const defaults = KeybindingsRegistry.getDefaultKeybindings()
		.filter(binding => binding.when?.keys().includes('terminalFirstEnabled') && /^(workbench\.action\.navigate(Left|Right|Up|Down)|terminalFirst\.tileList\..*)$/.test(binding.command ?? ''))
		.map(binding => new ResolvedKeybindingItem(USLayoutResolvedKeybinding.resolveKeybinding(binding.keybinding!, OS)[0], binding.command, undefined, binding.when ?? undefined, true, null, false));
	function resolve(key: string, context: Record<string, boolean | string | undefined> = {}, overrides: ResolvedKeybindingItem[] = [], chords: string[] = []) {
		const values: Record<string, boolean | string | undefined> = { terminalFirstEnabled: true, ...context };
		const result = new KeybindingResolver(defaults, overrides, () => { }).resolve({ getValue: <T extends ContextKeyValue>(key: string) => values[key] as T | undefined }, chords, key.replace(/[hjkl]$/, letter => letter.toUpperCase()));
		return result.kind === ResultKind.KbFound ? result.commandId : result.kind === ResultKind.MoreChordsNeeded ? 'chord' : undefined;
	}
	const tileList = { terminalFirstViewTile: true, terminalFirstVimEnabled: true, listFocus: true };

	test('physical Control navigates regardless of Vim engine, mode or terminal focus', () => {
		for (const mode of ['', 'normal', 'visual', 'insert']) {
			assert.deepStrictEqual(['ctrl+h', 'ctrl+j', 'ctrl+k', 'ctrl+l', 'meta+h', 'meta+j', 'meta+k', 'meta+l'].map(key => resolve(key, { nativeVimMode: mode, terminalFocus: true })), ['workbench.action.navigateLeft', 'workbench.action.navigateDown', 'workbench.action.navigateUp', 'workbench.action.navigateRight', undefined, undefined, undefined, undefined]);
		}
	});

	test('shell, floating overlays, quick input and other products are excluded', () => {
		for (const context of [{ terminalFirstEnabled: false }, ...['terminalFirstShell', 'terminalFirstBrowserVisible', 'terminalFirstFloatingVisible', 'terminalFirstJumpListVisible', 'inQuickOpen'].map(key => ({ [key]: true }))]) {
			assert.deepStrictEqual(['ctrl+h', 'ctrl+j', 'ctrl+k', 'ctrl+l', 'h', 'j', 'k', 'l'].map(key => resolve(key, { filesExplorerFocus: true, listFocus: true, ...context })), Array(8).fill(undefined));
		}
	});

	test('tile lists get Vim keys only with native Vim on, list focus, and no input or find widget', () => {
		const keys: [string, string | undefined, string[]?][] = [
			['j', 'terminalFirst.tileList.down'], ['k', 'terminalFirst.tileList.up'], ['h', 'terminalFirst.tileList.collapse'], ['l', 'terminalFirst.tileList.expand'],
			['O', 'terminalFirst.tileList.open'], ['shift+G', 'terminalFirst.tileList.last'], ['G', 'chord'], ['G', 'terminalFirst.tileList.first', ['G']],
			['ctrl+D', 'terminalFirst.tileList.pageDown'], ['ctrl+U', 'terminalFirst.tileList.pageUp'], ['/', 'terminalFirst.tileList.find'], ['Space', 'terminalFirst.tileList.leader'],
			['.', 'terminalFirst.tileList.actions'], ['M', 'terminalFirst.tileList.contextMenu'], ['F6', 'terminalFirst.tileList.focusNext'], ['shift+F6', 'terminalFirst.tileList.focusPrevious'],
			['Escape', 'terminalFirst.tileList.escape'], ['shift+/', 'terminalFirst.tileList.help'],
			['S', undefined], ['R', undefined],
		];
		assert.deepStrictEqual(keys.map(([key, , chords]) => resolve(key, tileList, [], chords)), keys.map(([, command]) => command));
		for (const exclusion of [{ terminalFirstVimEnabled: false }, { terminalFirstViewTile: false }, { listFocus: false }, { inputFocus: true }, { treeFindOpen: true }, { filesExplorerFocus: true, terminalFirstViewTile: false }]) {
			assert.deepStrictEqual(['h', 'j', 'k', 'l', '.', 'Space'].map(key => resolve(key, { ...tileList, ...exclusion })), Array(6).fill(undefined));
		}
	});

	test('row action keys are opt-in and scoped to their view', () => {
		const optIn = { ...tileList, 'config.terminalFirst.vim.listActionKeys': true };
		assert.deepStrictEqual({
			scm: ['S', 'U', 'D'].map(key => resolve(key, { ...optIn, view: 'workbench.scm' })),
			explorer: ['R', 'A', 'shift+A', 'D', 'shift+D', 'Y', 'X', 'P'].map(key => resolve(key, { ...optIn, filesExplorerFocus: true })),
			elsewhere: ['S', 'R'].map(key => resolve(key, optIn)),
			off: ['S', 'R'].map(key => resolve(key, { ...tileList, view: 'workbench.scm', filesExplorerFocus: true })),
		}, {
			scm: ['terminalFirst.tileList.stage', 'terminalFirst.tileList.unstage', 'terminalFirst.tileList.discard'],
			explorer: ['terminalFirst.tileList.rename', 'terminalFirst.tileList.newFile', 'terminalFirst.tileList.newFolder', 'terminalFirst.tileList.trash', 'terminalFirst.tileList.delete', 'terminalFirst.tileList.copy', 'terminalFirst.tileList.cut', 'terminalFirst.tileList.paste'],
			elsewhere: [undefined, undefined],
			off: [undefined, undefined],
		});
	});

	test('user bindings override navigation defaults', () => {
		const left = defaults.find(binding => binding.command === 'workbench.action.navigateLeft')!;
		const override = new ResolvedKeybindingItem(left.resolvedKeybinding, 'user.command', undefined, undefined, false, null, false);
		assert.strictEqual(resolve('ctrl+h', {}, [override]), 'user.command');
	});
});
