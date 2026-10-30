/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const run = promisify(execFile);
const bin = path.join(__dirname, '..', 'bin', 'e');
let directory;
let server;
let requests;

before(async () => {
	directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'e-test-')));
	requests = [];
	server = http.createServer((request, response) => {
		const chunks = [];
		request.on('data', chunk => chunks.push(chunk));
		request.on('end', () => {
			requests.push({ agent: request.headers['user-agent'], body: JSON.parse(Buffer.concat(chunks).toString('utf8')) });
			response.writeHead(200).end('ok');
		});
	});
	const socketPath = path.join(directory, 'window.sock');
	await new Promise(resolve => server.listen(socketPath, resolve));
	await fs.writeFile(path.join(directory, 'pointer.json'), JSON.stringify({ socketPath }));
	await fs.writeFile(path.join(directory, 'plain.txt'), '');
	await fs.mkdir(path.join(directory, 'sub'));
});

after(async () => {
	await new Promise(resolve => server.close(resolve));
	await fs.rm(directory, { recursive: true, force: true });
});

function invoke(args, cwd = directory) {
	return run(bin, args, { cwd, env: { ...process.env, TERMINAL_FIRST_NODE: process.execPath, TERMINAL_FIRST_CLI_POINTER: path.join(directory, 'pointer.json'), TERMINAL_FIRST_SESSION: 'nonce-1' } });
}

test('plain files and a directory go straight over the socket with curl', async () => {
	await invoke(['plain.txt', 'sub']);
	const [request] = requests.splice(0);
	assert.deepStrictEqual({ curl: /^curl\//.test(request.agent ?? ''), body: request.body }, {
		curl: true,
		body: { type: 'terminalFirstOpen', fileURIs: [`file://${path.join(directory, 'plain.txt')}`], terminalSession: 'nonce-1', wait: false, cwd: `file://${path.join(directory, 'sub')}` },
	});
});

test('options and names that need encoding fall back to the Node client', async () => {
	await fs.writeFile(path.join(directory, 'with space.txt'), '');
	await invoke(['--goto', 'plain.txt:3:4']);
	await invoke(['with space.txt']);
	const [first, second] = requests.splice(0);
	assert.deepStrictEqual({ agents: [first.agent, second.agent], first: first.body.fileURIs, second: second.body.fileURIs }, {
		agents: [undefined, undefined],
		first: [`file://${path.join(directory, 'plain.txt')}#L3,4`],
		second: [`file://${path.join(directory, 'with%20space.txt')}`],
	});
});
