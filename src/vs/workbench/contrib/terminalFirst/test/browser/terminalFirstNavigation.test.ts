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

suite('Terminal First docked navigation', () => {
	ensureNoDisposablesAreLeakedInTestSuite();
	const defaults = KeybindingsRegistry.getDefaultKeybindings()
		.filter(binding => binding.when?.keys().includes('terminalFirstEnabled') && /^(workbench.action.navigate(Left|Right|Up|Down)|list.(collapse|expand|focusDown|focusUp))$/.test(binding.command ?? ''))
		.map(binding => new ResolvedKeybindingItem(USLayoutResolvedKeybinding.resolveKeybinding(binding.keybinding!, OS)[0], binding.command, undefined, binding.when ?? undefined, true, null, false));
	function resolve(key: string, context: Record<string, boolean | string | undefined> = {}, overrides: ResolvedKeybindingItem[] = []) {
		const values: Record<string, boolean | string | undefined> = { terminalFirstEnabled: true, ...context };
		const result = new KeybindingResolver(defaults, overrides, () => { }).resolve({ getValue: <T extends ContextKeyValue>(key: string) => values[key] as T | undefined }, [], key.replace(/[hjkl]$/, letter => letter.toUpperCase()));
		return result.kind === ResultKind.KbFound ? result.commandId : undefined;
	}

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

	test('Explorer navigation requires tree focus and leaves text inputs alone', () => {
		const context = { filesExplorerFocus: true, listFocus: true };
		assert.deepStrictEqual(['h', 'j', 'k', 'l'].map(key => resolve(key, context)), ['list.collapse', 'list.focusDown', 'list.focusUp', 'list.expand']);
		for (const exclusion of [{ inputFocus: true }, { listFocus: false }, { filesExplorerFocus: false }]) {
			assert.deepStrictEqual(['h', 'j', 'k', 'l'].map(key => resolve(key, { ...context, ...exclusion })), Array(4).fill(undefined));
		}
	});

	test('user bindings override navigation defaults', () => {
		const left = defaults.find(binding => binding.command === 'workbench.action.navigateLeft')!;
		const override = new ResolvedKeybindingItem(left.resolvedKeybinding, 'user.command', undefined, undefined, false, null, false);
		assert.strictEqual(resolve('ctrl+h', {}, [override]), 'user.command');
	});
});
