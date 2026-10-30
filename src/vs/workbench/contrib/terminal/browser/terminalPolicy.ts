/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IDisposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { IProcessEnvironment } from '../../../../base/common/platform.js';
import { ContextKeyExpression } from '../../../../platform/contextkey/common/contextkey.js';
import { IShellLaunchConfig, ITerminalProfile } from '../../../../platform/terminal/common/terminal.js';
import { ICreateTerminalOptions, ITerminalGroup, ITerminalInstance } from './terminal.js';

/**
 * Lets a product decide which terminals may be created and how they are presented. The terminal
 * service, groups, editors, and actions consult the registered policy at fixed points instead of
 * carrying product-specific branches. Without a policy, upstream behavior applies.
 */
export interface ITerminalPolicy {
	/** Throws when `createTerminal` must not proceed for these options. */
	beforeCreate(options: ICreateTerminalOptions | undefined): void;
	/** Marks a terminal re-created from persisted state as allowed: `background` is a hidden terminal, `group` a panel group member. */
	prepareReconnect(options: ICreateTerminalOptions, kind: 'background' | 'group'): ICreateTerminalOptions;
	/** Adjusts the launch config before its instance is created and records that this launch is allowed. */
	prepareLaunchConfig(config: IShellLaunchConfig, options: ICreateTerminalOptions | undefined): void;
	/** Whether contributed profiles are ignored for these options. */
	skipContributedProfile(options: ICreateTerminalOptions | undefined): boolean;
	/** Throws when no instance may be created for this configuration. */
	authorizeInstance(config: IShellLaunchConfig | ITerminalProfile): void;
	/** Whether reconnected panel terminals restore their split layout. */
	readonly restoreGroupLayout: boolean;
	/** Whether the terminal view creates a terminal when it opens empty. */
	readonly autoCreateInView: boolean;
	/** A detached terminal is presented by the product itself, never by the panel or an editor. */
	isDetached(instance: ITerminalInstance): boolean;
	/** Whether a terminal created at the editor location opens an editor right away. */
	opensEditorFor(options: ICreateTerminalOptions | undefined): boolean;
	/** Throws when the instance must not be shown in an editor. */
	assertCanOpenEditor(instance: ITerminalInstance): void;
	/** Throws when another instance must not join the group. */
	assertCanAddToGroup(group: ITerminalGroup): void;
	/** Throws when instances must not be rearranged within the group. */
	assertCanMoveInGroup(group: ITerminalGroup): void;
	/** Narrows the precondition of a terminal action. */
	actionPrecondition(id: string, precondition: ContextKeyExpression | undefined): ContextKeyExpression | undefined;
	/** Whether a terminal action may run right now. */
	canRunAction(id: string): boolean;
	/** Adds product variables to a terminal's process environment; `nonce` identifies its shell integration session. */
	decorateEnvironment(env: IProcessEnvironment, nonce: string): void;
}

let current: ITerminalPolicy | undefined;

export const TerminalPolicy = {
	/** Registers the single policy for this window. */
	set(policy: ITerminalPolicy): IDisposable {
		if (current) {
			throw new Error('A terminal policy is already registered');
		}
		current = policy;
		return toDisposable(() => {
			if (current === policy) {
				current = undefined;
			}
		});
	},
	get(): ITerminalPolicy | undefined {
		return current;
	},
};
