/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { deepStrictEqual } from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { authorizeTerminalFirstLaunch, consumeTerminalFirstLaunch, isTerminalFirstCommandAllowed, terminalFirstPolicy } from '../../../../services/terminalFirst/common/terminalFirstPolicy.js';

suite('Terminal First Policy', () => {
	ensureNoDisposablesAreLeakedInTestSuite();
	test('shell permits terminal interaction and session commands while rejecting workbench controls', () => {
		const commands = ['terminalFirst.toggle', 'terminalFirst.newTerminal', '_terminalFirst.openFiles', 'workbench.action.terminal.paste', 'workbench.action.toggleSidebarVisibility', 'workbench.action.showCommands', 'workbench.action.terminal.new', 'workbench.action.terminal.split', 'workbench.action.terminal.moveToEditor'];
		deepStrictEqual(commands.map(id => isTerminalFirstCommandAllowed(id, 'shell', true)), [true, true, true, true, false, false, false, false, false]);
	});
	test('editor retains normal tools but cannot open integrated terminals', () => {
		deepStrictEqual(['workbench.view.explorer', 'workbench.action.showCommands', 'terminalFirst.newTerminal', 'workbench.action.terminal.new', 'workbench.action.terminal.focus'].map(id => isTerminalFirstCommandAllowed(id, 'editor', true)), [true, true, true, false, false]);
	});
	test('visible float permits interactions (including menus) but never creation or presentation commands', () => {
		terminalFirstPolicy.floatingVisible = true;
		try {
			deepStrictEqual(['paste', 'focusFind', 'new', 'split', 'moveToEditor', 'focus'].map(command => isTerminalFirstCommandAllowed(`workbench.action.terminal.${command}`, 'editor', true)), [true, true, false, false, false, false]);
		} finally { terminalFirstPolicy.floatingVisible = false; }
	});

	test('launch permission belongs to one configuration and can only be consumed once', () => {
		const launch = {};
		authorizeTerminalFirstLaunch(launch);
		deepStrictEqual([consumeTerminalFirstLaunch({}), consumeTerminalFirstLaunch(launch), consumeTerminalFirstLaunch(launch)], [false, true, false]);
	});
	test('other products retain their commands', () => {
		deepStrictEqual(['workbench.action.terminal.new', 'workbench.view.explorer'].map(id => isTerminalFirstCommandAllowed(id, 'shell', false)), [true, true]);
	});
});
