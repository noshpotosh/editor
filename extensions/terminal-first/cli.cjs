/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

/** Parses file arguments without shell interpolation or special handling of colons in filenames. */
function parseArguments(args) {
	let wait = false;
	let positional = false;
	const files = [];
	for (const argument of args) {
		if (!positional && argument === '--') {
			positional = true;
		} else if (!positional && argument === '--wait') {
			wait = true;
		} else if (!positional && (argument === '--help' || argument === '-h')) {
			return { help: true, files: [], wait: false };
		} else if (!positional && argument.startsWith('-')) {
			throw new Error(`Unknown option: ${argument}. Use -- before filenames beginning with a dash.`);
		} else {
			files.push(argument);
		}
	}
	if (!files.length) {
		throw new Error('Usage: e [--wait] [--] <file>...');
	}
	return { files, wait, help: false };
}

/** Opens files through the current window's extension-host CLI server. */
async function openFiles(args, environment = process.env, cwd = process.cwd()) {
	const options = parseArguments(args);
	if (options.help) {
		return 'Usage: e [--wait] [--] <file>...\nOpens files in this window. --wait returns when all requested files are closed.';
	}
	if (!environment.TERMINAL_FIRST_CLI_POINTER || !environment.TERMINAL_FIRST_SESSION) {
		throw new Error('Run e inside a Terminal First shell.');
	}
	const fileURIs = [];
	for (const file of options.files) {
		const absolutePath = path.resolve(cwd, file);
		try {
			if ((await fs.stat(absolutePath)).isDirectory()) {
				throw new Error(`Directories are not supported: ${file}. Use the terminal-first workspace-opening command instead.`);
			}
		} catch (error) {
			if (error.code !== 'ENOENT') {
				throw error;
			}
		}
		fileURIs.push(pathToFileURL(absolutePath).href);
	}
	const { socketPath } = JSON.parse(await fs.readFile(environment.TERMINAL_FIRST_CLI_POINTER, 'utf8'));
	if (typeof socketPath !== 'string' || !path.isAbsolute(socketPath)) {
		throw new Error('The window CLI pointer is invalid. Reload the window to retry.');
	}
	const body = JSON.stringify({ type: 'terminalFirstOpen', fileURIs, terminalSession: environment.TERMINAL_FIRST_SESSION, wait: options.wait });
	await new Promise((resolve, reject) => {
		const request = http.request({ socketPath, path: '/', method: 'POST', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) } }, response => {
			const chunks = [];
			response.on('data', chunk => chunks.push(chunk));
			response.on('error', reject);
			response.on('end', () => {
				if (response.statusCode !== 200) {
					reject(new Error(`Could not open files: ${Buffer.concat(chunks).toString('utf8')}`));
				} else {
					resolve();
				}
			});
		});
		request.on('error', error => reject(new Error(`Cannot reach this window. Reload it and retry. ${error.message}`)));
		request.end(body);
	});
}

module.exports = { parseArguments, openFiles };

if (require.main === module) {
	openFiles(process.argv.slice(2)).then(message => {
		if (message) {
			process.stdout.write(`${message}\n`);
		}
	}, error => {
		process.stderr.write(`e: ${error.message}\n`);
		process.exitCode = 1;
	});
}
