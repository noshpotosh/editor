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
	let goto = false;
	let positional = false;
	const files = [];
	for (const argument of args) {
		if (!positional && argument === '--') {
			positional = true;
		} else if (!positional && argument === '--wait') {
			wait = true;
		} else if (!positional && (argument === '--goto' || argument === '-g')) {
			goto = true;
		} else if (!positional && (argument === '--help' || argument === '-h')) {
			return { help: true, files: [], wait: false, goto: false };
		} else if (!positional && argument.startsWith('-')) {
			throw new Error(`Unknown option: ${argument}. Use -- before filenames beginning with a dash.`);
		} else {
			files.push(argument);
		}
	}
	return { files, wait, goto, help: false };
}

/** Splits `path:line[:column]` for --goto; a name without a trailing line number is returned unchanged. */
function parseGoto(file) {
	const match = /^(?<path>.+?)(?::(?<line>\d+))(?::(?<column>\d+))?$/.exec(file);
	if (!match || !match.groups) {
		return { path: file };
	}
	return { path: match.groups.path, line: Number(match.groups.line), column: match.groups.column ? Number(match.groups.column) : undefined };
}

/** Opens files through the current window's extension-host CLI server. */
async function openFiles(args, environment = process.env, cwd = process.cwd()) {
	const name = environment.TERMINAL_FIRST_CLI_NAME || 'code';
	const options = parseArguments(args);
	if (options.help) {
		return `Usage: ${name} [--wait] [--goto] [--] [<file or directory>...]\nOpens the editor in the current directory, or opens the specified files in this window. A directory argument opens the editor in that directory. --goto opens file:line[:column]. --wait returns when all requested files are closed.`;
	}
	if (!environment.TERMINAL_FIRST_CLI_POINTER || !environment.TERMINAL_FIRST_SESSION) {
		throw new Error(`Run ${name} inside a Terminal First shell.`);
	}
	const fileURIs = [];
	let directory;
	for (const file of options.files) {
		const target = options.goto ? parseGoto(file) : { path: file };
		const absolutePath = path.resolve(cwd, target.path);
		let isDirectory = false;
		try {
			isDirectory = (await fs.stat(absolutePath)).isDirectory();
		} catch (error) {
			if (error.code !== 'ENOENT') {
				throw error;
			}
		}
		if (isDirectory) {
			if (directory !== undefined) {
				throw new Error(`Only one directory can be opened at a time: ${file}.`);
			}
			directory = absolutePath;
			continue;
		}
		const url = pathToFileURL(absolutePath);
		if (target.line !== undefined) {
			url.hash = `L${target.line}${target.column !== undefined ? `,${target.column}` : ''}`;
		}
		fileURIs.push(url.href);
	}
	let pointer;
	const deadline = Date.now() + 2000;
	while (true) {
		try { pointer = await fs.readFile(environment.TERMINAL_FIRST_CLI_POINTER, 'utf8'); break; }
		catch (error) {
			if (error.code !== 'ENOENT' || Date.now() >= deadline) { throw error; }
			await new Promise(resolve => setTimeout(resolve, Math.min(50, deadline - Date.now())));
		}
	}
	const { socketPath } = JSON.parse(pointer);
	if (typeof socketPath !== 'string' || !path.isAbsolute(socketPath)) {
		throw new Error('The window CLI pointer is invalid. Reload the window to retry.');
	}
	const body = JSON.stringify({ type: 'terminalFirstOpen', fileURIs, terminalSession: environment.TERMINAL_FIRST_SESSION, wait: options.wait, cwd: pathToFileURL(directory ?? cwd).href });
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

module.exports = { parseArguments, parseGoto, openFiles };

if (require.main === module) {
	openFiles(process.argv.slice(2)).then(message => {
		if (message) {
			process.stdout.write(`${message}\n`);
		}
	}, error => {
		process.stderr.write(`${process.env.TERMINAL_FIRST_CLI_NAME || 'code'}: ${error.message}\n`);
		process.exitCode = 1;
	});
}
