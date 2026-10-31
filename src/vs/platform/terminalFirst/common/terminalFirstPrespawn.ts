/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** A speculative process must publish before the renderer asks for its initial layout. */
export class TerminalFirstPrespawnRequest {
	private publishing: Promise<void> | undefined;
	private cancelled = false;
	private claimed = false;

	get isCancelled(): boolean { return this.cancelled; }
	get isClaimed(): boolean { return this.claimed; }

	/** Cancels preparation unless the renderer has already claimed the published process. */
	cancel(): void {
		if (!this.claimed) {
			this.cancelled = true;
		}
	}

	/** Publishes only a fully started, detached shell; no await may precede the callback. */
	async publish(writeLayout: () => Promise<void>): Promise<boolean> {
		if (this.cancelled) {
			return false;
		}
		this.publishing = writeLayout();
		await this.publishing;
		return !this.cancelled;
	}

	/** Never waits for profile resolution or spawning: unfinished speculation loses to the renderer. */
	async claim(): Promise<void> {
		if (this.publishing && !this.cancelled) {
			this.claimed = true;
			await this.publishing;
		} else {
			this.cancel();
		}
	}
}

/** Coordinates the main-process producer and the existing pty layout request without delaying startup. */
export class TerminalFirstPrespawnRegistry {
	private readonly requests = new Map<string, TerminalFirstPrespawnRequest>();

	begin(workspaceId: string): TerminalFirstPrespawnRequest | undefined {
		if (this.requests.has(workspaceId)) {
			return undefined;
		}
		const request = new TerminalFirstPrespawnRequest();
		this.requests.set(workspaceId, request);
		return request;
	}

	release(workspaceId: string, request: TerminalFirstPrespawnRequest): void {
		if (this.requests.get(workspaceId) === request) {
			this.requests.delete(workspaceId);
		}
	}

	async beforeGetLayout(workspaceId: string): Promise<void> {
		const request = this.requests.get(workspaceId);
		if (request) {
			this.release(workspaceId, request);
			try {
				await request.claim();
			} catch {
				// A failed speculative layout must not prevent the normal reconnect path.
				request.cancel();
			}
		}
	}
}

export const terminalFirstPrespawn = new TerminalFirstPrespawnRegistry();
