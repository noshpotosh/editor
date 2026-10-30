/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { deepStrictEqual } from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { terminalFirstStartup } from '../../common/terminalFirstStartup.js';
import { DeferredPromise } from '../../../../../base/common/async.js';
import { runWithFakedTimers } from '../../../../../base/test/common/timeTravelScheduler.js';

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

	test('the extension host waits for presentation only when asked, and at most two seconds past restore', () => runWithFakedTimers({ useFakeTimers: true }, async () => {
		const restored = new DeferredPromise<void>();
		let started = 0;
		const start = () => { started++; };
		await terminalFirstStartup.whenExtensionHostMayStart(restored.p).then(start);
		const idle = started;
		terminalFirstStartup.begin({ deferExtensionHost: false });
		await terminalFirstStartup.whenExtensionHostMayStart(restored.p).then(start);
		const notDeferred = started;
		terminalFirstStartup.reset();
		terminalFirstStartup.begin({ deferExtensionHost: true });
		const deferred = terminalFirstStartup.whenExtensionHostMayStart(restored.p).then(start);
		await restored.complete();
		const afterRestore = started;
		await deferred;
		const afterGrace = started;
		terminalFirstStartup.reset();
		terminalFirstStartup.begin({ deferExtensionHost: true });
		const presentedFirst = terminalFirstStartup.whenExtensionHostMayStart(new DeferredPromise<void>().p).then(start);
		terminalFirstStartup.presented();
		await presentedFirst;
		deepStrictEqual([idle, notDeferred, afterRestore, afterGrace, started], [1, 2, 2, 3, 4]);
	}));
});
