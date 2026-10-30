/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { deepStrictEqual } from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { terminalFirstStartup } from '../../common/terminalFirstStartup.js';

suite('Terminal First startup ordering', () => {
	ensureNoDisposablesAreLeakedInTestSuite();
	teardown(() => terminalFirstStartup.reset());

	test('nothing waits until a controller begins, then everything waits for presentation', async () => {
		const idle = terminalFirstStartup.waiting;
		terminalFirstStartup.begin();
		terminalFirstStartup.begin();
		const waiting = terminalFirstStartup.waiting;
		const pending = terminalFirstStartup.whenPresented();
		terminalFirstStartup.presented();
		await pending;
		deepStrictEqual([idle, waiting, terminalFirstStartup.waiting], [false, true, false]);
	});
});
