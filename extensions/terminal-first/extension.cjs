/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const vscode = require('vscode');
const fs = require('node:fs/promises');
const path = require('node:path');

/** Publishes a stable pointer so restored shells can reach a restarted extension host. */
exports.activate = context => {
	const initialize = async () => {
		if (process.platform !== 'darwin' || vscode.env.uriScheme !== 'terminal-first') {
			return;
		}
		const socketPath = process.env.VSCODE_IPC_HOOK_CLI;
		if (!socketPath) {
			throw new Error(vscode.l10n.t('The window CLI server is unavailable. Reload the window to retry.'));
		}
		const windowId = await vscode.commands.executeCommand('_terminalFirst.windowId');
		await fs.mkdir(context.globalStorageUri.fsPath, { recursive: true });
		const pointerPath = path.join(context.globalStorageUri.fsPath, `window-${windowId}.json`);
		const temporaryPath = `${pointerPath}.${process.pid}.tmp`;
		await fs.writeFile(temporaryPath, JSON.stringify({ socketPath }), { mode: 0o600 });
		await fs.rename(temporaryPath, pointerPath);

		const environment = context.environmentVariableCollection;
		environment.persistent = true;
		environment.description = vscode.l10n.t('Enables the e command for opening files in this window.');
		environment.prepend('PATH', `${path.join(context.extensionPath, 'bin')}${path.delimiter}`);
		environment.replace('TERMINAL_FIRST_NODE', process.execPath);
		environment.replace('TERMINAL_FIRST_CLI_POINTER', pointerPath);
	};
	const ready = initialize();
	context.subscriptions.push(vscode.commands.registerCommand('terminalFirst.initializeShell', () => ready));
	return ready;
};
