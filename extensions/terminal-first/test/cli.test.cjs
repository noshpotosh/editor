/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require('node:assert/strict');
const { execFile } = require('node:child_process');
const { once } = require('node:events');
const fs = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { promisify } = require('node:util');
const { test } = require('node:test');
const { pathToFileURL } = require('node:url');
const { parseArguments, parseGoto, openFiles } = require('../cli.cjs');

/** Creates a window-scoped CLI endpoint and shell environment. */
async function createWindow(t, handler = (_body, response) => response.end('null')) {
	const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'tf-'));
	const socketPath = path.join(directory, 'cli.sock');
	const pointerPath = path.join(directory, 'window.json');
	const requests = [];
	const server = http.createServer(async (request, response) => {
		const chunks = [];
		for await (const chunk of request) {
			chunks.push(chunk);
		}
		const body = JSON.parse(Buffer.concat(chunks).toString());
		requests.push(body);
		handler(body, response);
	});
	server.listen(socketPath);
	await once(server, 'listening');
	await fs.writeFile(pointerPath, JSON.stringify({ socketPath }));
	t.after(async () => {
		await new Promise(resolve => server.close(resolve));
		await fs.rm(directory, { recursive: true, force: true });
	});
	return { directory, socketPath, pointerPath, requests, environment: { TERMINAL_FIRST_CLI_POINTER: pointerPath, TERMINAL_FIRST_SESSION: directory } };
}

test('parses wait, goto, help and filenames following --', () => {
	assert.deepEqual(parseArguments(['--wait', '--', '-file', 'a b']), { wait: true, goto: false, help: false, files: ['-file', 'a b'] });
	assert.equal(parseArguments(['--help']).help, true);
	assert.deepEqual(parseArguments(['-g', 'a.ts:3:4']), { wait: false, goto: true, help: false, files: ['a.ts:3:4'] });
	assert.deepEqual(parseArguments([]), { wait: false, goto: false, help: false, files: [] });
	assert.throws(() => parseArguments(['--unknown']), /Unknown option/);
	assert.deepEqual(['a.ts:12', 'a.ts:12:4', 'notes:draft.txt', 'plain.ts'].map(parseGoto), [{ path: 'a.ts', line: 12, column: undefined }, { path: 'a.ts', line: 12, column: 4 }, { path: 'notes:draft.txt' }, { path: 'plain.ts' }]);
});

test('help and errors use the invoked command name', async () => {
	assert.match(await openFiles(['--help'], { TERMINAL_FIRST_CLI_NAME: 'e' }, '/tmp'), /^Usage: e /);
	await assert.rejects(openFiles(['x'], { TERMINAL_FIRST_CLI_NAME: 'e' }, '/tmp'), /Run e inside/);
});

test('opens quoted, Unicode, special-character and new files relative to the shell cwd', async t => {
	const window = await createWindow(t);
	const files = ['a b.ts', 'résumé.txt', '$(touch injected);`echo nope`:#.txt'];
	await fs.writeFile(path.join(window.directory, files[0]), 'existing');
	await openFiles(files, window.environment, window.directory);
	assert.deepEqual(window.requests, [{
		type: 'terminalFirstOpen',
		fileURIs: files.map(file => pathToFileURL(path.join(window.directory, file)).href),
		terminalSession: window.directory,
		wait: false,
		cwd: pathToFileURL(window.directory).href,
	}]);
});

test('a directory argument opens the editor there, files beside it open in that session, and two directories are refused', async t => {
	const window = await createWindow(t);
	const nested = path.join(window.directory, 'nested');
	await fs.mkdir(nested);
	await openFiles(['file.ts', 'nested'], window.environment, window.directory);
	assert.deepEqual(window.requests, [{ type: 'terminalFirstOpen', fileURIs: [pathToFileURL(path.join(window.directory, 'file.ts')).href], terminalSession: window.directory, wait: false, cwd: pathToFileURL(nested).href }]);
	await assert.rejects(openFiles(['.', 'nested'], window.environment, window.directory), /Only one directory/);
	assert.equal(window.requests.length, 1);
});

test('--goto encodes the line and column as a fragment the window understands', async t => {
	const window = await createWindow(t);
	await openFiles(['-g', 'a.ts:12:4', 'b.ts:7', 'c.ts'], window.environment, window.directory);
	assert.deepEqual(window.requests[0].fileURIs, [`${pathToFileURL(path.join(window.directory, 'a.ts')).href}#L12,4`, `${pathToFileURL(path.join(window.directory, 'b.ts')).href}#L7`, pathToFileURL(path.join(window.directory, 'c.ts')).href]);
});

test('keeps simultaneous windows isolated and follows a refreshed CLI pointer after reload', async t => {
	const first = await createWindow(t);
	const second = await createWindow(t);
	await Promise.all([openFiles(['one.ts'], first.environment, first.directory), openFiles(['two.ts'], second.environment, second.directory)]);
	assert.deepEqual([first.requests.map(request => request.terminalSession), second.requests.map(request => request.terminalSession)], [[first.directory], [second.directory]]);
	await fs.writeFile(first.pointerPath, JSON.stringify({ socketPath: second.socketPath }));
	await openFiles(['after-reload.ts'], first.environment, first.directory);
	assert.equal(second.requests.at(-1).terminalSession, first.directory);
});

test('--wait stays pending until the window acknowledges file closure', async t => {
	let acknowledge;
	let requestReceived;
	const received = new Promise(resolve => { requestReceived = resolve; });
	const window = await createWindow(t, (body, response) => {
		assert.equal(body.wait, true);
		acknowledge = () => response.end('null');
		requestReceived();
	});
	let completed = false;
	const pending = openFiles(['--wait', 'commit.txt'], window.environment, window.directory).then(() => { completed = true; });
	await received;
	assert.equal(completed, false);
	acknowledge();
	await pending;
	assert.equal(completed, true);
});

test('reports unavailable integration and window-side failures', async t => {
	await assert.rejects(openFiles(['file.ts'], {}, '/tmp'), /inside a Terminal First shell/);
	const window = await createWindow(t, (_body, response) => {
		response.statusCode = 500;
		response.end('Shell session expired');
	});
	await assert.rejects(openFiles(['file.ts'], window.environment, window.directory), /Shell session expired/);
});

test('shell launcher preserves arguments and uses the supplied runtime', async t => {
	const window = await createWindow(t);
	await promisify(execFile)(path.resolve(__dirname, '../bin/e'), ['--', '-a b.txt'], {
		cwd: window.directory,
		env: { ...process.env, ...window.environment, TERMINAL_FIRST_NODE: process.execPath },
	});
	assert.deepEqual(window.requests[0].fileURIs, [pathToFileURL(path.join(await fs.realpath(window.directory), '-a b.txt')).href]);
});

test('bare code opens the editor at the shell current directory', async t => {
	const window = await createWindow(t);
	const cwd = path.join(window.directory, 'nested directory');
	await fs.mkdir(cwd);
	await promisify(execFile)(path.resolve(__dirname, '../bin/code'), [], {
		cwd,
		env: { ...process.env, ...window.environment, TERMINAL_FIRST_NODE: process.execPath },
	});
	assert.deepEqual(window.requests, [{
		type: 'terminalFirstOpen',
		fileURIs: [],
		terminalSession: window.directory,
		wait: false,
		cwd: pathToFileURL(await fs.realpath(cwd)).href,
	}]);
});


test('waits briefly for a cold-start pointer to be published', async t => {
	const window = await createWindow(t);
	await fs.unlink(window.pointerPath);
	const pending = openFiles([], window.environment, window.directory);
	await new Promise(resolve => setTimeout(resolve, 75));
	await fs.writeFile(window.pointerPath, JSON.stringify({ socketPath: window.socketPath }));
	await pending;
	assert.equal(window.requests.length, 1);
});
