/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DeferredPromise, timeout } from '../../../../base/common/async.js';

/**
 * Startup ordering shared between the session controller and the workbench pieces it must not
 * wait for. The controller announces when the first surface is on screen; work that the shell
 * does not need (hidden session layouts, later the extension host) waits for that moment.
 */
class TerminalFirstStartup {
	private presentedDeferred: DeferredPromise<void> | undefined;
	private deferExtensionHost = false;

	/** Called once by the session controller when it begins; until then nothing waits. */
	begin(options?: { readonly deferExtensionHost?: boolean }): void {
		this.presentedDeferred ??= new DeferredPromise<void>();
		this.deferExtensionHost = options?.deferExtensionHost ?? false;
	}

	/** The first shell or editor surface is on screen, or startup gave up trying. */
	presented(): void {
		this.presentedDeferred?.complete();
	}

	/** Resolves once presented, or at once when no controller started. */
	whenPresented(): Promise<void> {
		return this.presentedDeferred?.p ?? Promise.resolve();
	}

	/** True between `begin()` and `presented()`. */
	get waiting(): boolean {
		return this.presentedDeferred !== undefined && !this.presentedDeferred.isSettled;
	}

	/**
	 * When the controller asked for it, the extension host starts once the first surface is on
	 * screen, or shortly after the workbench restored if startup stalls; otherwise at once.
	 */
	whenExtensionHostMayStart(whenRestored: Promise<void>, graceMs = 2000): Promise<void> {
		if (!this.presentedDeferred || !this.deferExtensionHost) {
			return Promise.resolve();
		}
		return Promise.race([this.presentedDeferred.p, whenRestored.then(() => timeout(graceMs))]);
	}

	/** Lets tests start over. */
	reset(): void {
		this.presentedDeferred?.complete();
		this.presentedDeferred = undefined;
		this.deferExtensionHost = false;
	}
}

export const terminalFirstStartup = new TerminalFirstStartup();
