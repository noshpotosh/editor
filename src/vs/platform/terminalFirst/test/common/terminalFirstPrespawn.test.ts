/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { DeferredPromise } from '../../../../base/common/async.js';
import { URI } from '../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { terminalFirstShellEnvironment } from '../../common/terminalFirstEnvironment.js';
import { TerminalFirstPrespawnRegistry } from '../../common/terminalFirstPrespawn.js';

suite('Terminal first prespawn coordination', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('shared CLI environment preserves renderer resolver expressions', () => {
		assert.deepStrictEqual(terminalFirstShellEnvironment('/app/extensions/terminal-first/bin', URI.file('/profile/globalStorage'), 7, '${execPath}', '${env:PATH}'), {
			PATH: '/app/extensions/terminal-first/bin:${env:PATH}',
			TERMINAL_FIRST_NODE: '${execPath}',
			TERMINAL_FIRST_CLI_POINTER: URI.file('/profile/globalStorage/vscode.terminal-first/window-7.json').fsPath,
		});
	});

	test('renderer cancels unfinished speculation without waiting', async () => {
		const registry = new TerminalFirstPrespawnRegistry();
		const request = registry.begin('workspace')!;
		await registry.beforeGetLayout('workspace');
		let wroteLayout = false;
		const published = await request.publish(async () => { wroteLayout = true; });
		assert.deepStrictEqual({ cancelled: request.isCancelled, published, wroteLayout }, { cancelled: true, published: false, wroteLayout: false });
	});

	test('renderer waits for a publication already queued after process start', async () => {
		const registry = new TerminalFirstPrespawnRegistry();
		const request = registry.begin('workspace')!;
		const write = new DeferredPromise<void>();
		const publication = request.publish(() => write.p);
		const claim = registry.beforeGetLayout('workspace');
		request.cancel(); // window ownership has transferred to the renderer
		await write.complete();
		await claim;
		assert.deepStrictEqual({ published: await publication, claimed: request.isClaimed, cancelled: request.isCancelled }, { published: true, claimed: true, cancelled: false });
	});

	test('only one producer can reserve a workspace and releasing an old request preserves its replacement', async () => {
		const registry = new TerminalFirstPrespawnRegistry();
		const first = registry.begin('workspace')!;
		const duplicate = registry.begin('workspace');
		await registry.beforeGetLayout('workspace');
		const next = registry.begin('workspace')!;
		registry.release('workspace', first);
		await registry.beforeGetLayout('workspace');
		assert.deepStrictEqual({ duplicate, first: first.isCancelled, next: next.isCancelled }, { duplicate: undefined, first: true, next: true });
	});

	test('failed publication does not reject the renderer layout request', async () => {
		const registry = new TerminalFirstPrespawnRegistry();
		const request = registry.begin('workspace')!;
		const write = new DeferredPromise<void>();
		const publication = request.publish(() => write.p);
		const rejection = assert.rejects(publication, /layout failure/);
		const claim = registry.beforeGetLayout('workspace');
		await write.error(new Error('layout failure'));
		await Promise.all([rejection, claim]);
	});
});
