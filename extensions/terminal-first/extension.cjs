/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const vscode = require('vscode');
const fs = require('node:fs/promises');
const path = require('node:path');

let pointerPath;

/** Removes pointers of windows whose CLI socket is gone, so a shell never waits on a dead window. */
async function sweepStalePointers(storagePath, keep) {
	for (const entry of await fs.readdir(storagePath).catch(() => [])) {
		const candidate = path.join(storagePath, entry);
		if (!/^window-\d+\.json$/.test(entry) || candidate === keep) {
			continue;
		}
		try {
			const { socketPath } = JSON.parse(await fs.readFile(candidate, 'utf8'));
			await fs.access(socketPath);
		} catch {
			await fs.rm(candidate, { force: true });
		}
	}
}

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
		pointerPath = path.join(context.globalStorageUri.fsPath, `window-${windowId}.json`);
		const temporaryPath = `${pointerPath}.${process.pid}.tmp`;
		await fs.writeFile(temporaryPath, JSON.stringify({ socketPath }), { mode: 0o600 });
		await fs.rename(temporaryPath, pointerPath);
		await sweepStalePointers(context.globalStorageUri.fsPath, pointerPath);

		// Clear legacy persistent mutations; the workbench now supplies each shell environment.
		context.environmentVariableCollection.clear();
	};
	const ready = initialize();
	context.subscriptions.push(vscode.commands.registerCommand('terminalFirst.initializeShell', () => ready));
	return ready;
};

/** The window is closing or the host restarts; `activate` writes a fresh pointer either way. */
exports.deactivate = () => pointerPath ? fs.rm(pointerPath, { force: true }) : undefined;
