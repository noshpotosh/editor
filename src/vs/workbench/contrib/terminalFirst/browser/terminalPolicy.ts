/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IProcessEnvironment } from '../../../../base/common/platform.js';
import { localize } from '../../../../nls.js';
import { ContextKeyExpr, ContextKeyExpression } from '../../../../platform/contextkey/common/contextkey.js';
import { IShellLaunchConfig, ITerminalProfile, TerminalLocation } from '../../../../platform/terminal/common/terminal.js';
import { ICreateTerminalOptions, ITerminalGroup, ITerminalInstance } from '../../terminal/browser/terminal.js';
import { ITerminalPolicy } from '../../terminal/browser/terminalPolicy.js';
import { authorizeTerminalFirstLaunch, consumeTerminalFirstLaunch, isTerminalFirstCommandAllowed, isTerminalFirstInteraction, TerminalFirstFloatingVisibleContext, TerminalFirstShellContext } from '../../../services/terminalFirst/common/terminalFirstPolicy.js';

const sessionLaunches = new WeakSet<ICreateTerminalOptions>();
const floatingLaunches = new WeakSet<ICreateTerminalOptions>();
const tileLaunches = new WeakSet<ICreateTerminalOptions>();
const detachedConfigs = new WeakSet<IShellLaunchConfig>();
const detachedInstances = new WeakSet<ITerminalInstance>();

/**
 * Marks the intent of a terminal creation. Only the session controller, the floating host, and
 * tiles may create terminals, each through its own marker; everything else is refused.
 */
export const TerminalFirstLaunch = {
	/** A session's main shell, shown in the shell surface. */
	session<T extends ICreateTerminalOptions>(options: T): T { sessionLaunches.add(options); return options; },
	/** A companion shell presented by the floating host, never by the panel. */
	floating<T extends ICreateTerminalOptions>(options: T): T { floatingLaunches.add(options); return options; },
	/** A terminal tile; its editor is opened by the tile code, not on creation. */
	tile<T extends ICreateTerminalOptions>(options: T): T { tileLaunches.add(options); return options; },
	/** Whether the instance is a floating companion shell, including ones reconnected after a reload. */
	isDetached(instance: ITerminalInstance): boolean {
		if (detachedInstances.has(instance)) { return true; }
		if (detachedConfigs.has(instance.shellLaunchConfig)) { detachedInstances.add(instance); return true; }
		return false;
	},
};

/** The VS NOSH terminal policy: the session controller owns creation, floating shells stay detached, and terminal UI actions are limited to interactions. */
class TerminalFirstTerminalPolicy implements ITerminalPolicy {
	readonly restoreGroupLayout = false;
	readonly autoCreateInView = false;

	beforeCreate(options: ICreateTerminalOptions | undefined): void {
		if (!options || (!sessionLaunches.has(options) && !floatingLaunches.has(options) && !tileLaunches.has(options))) {
			throw new Error(localize('terminalFirst.creationBlocked', "Use the session strip to open a terminal. Integrated terminals, terminal tasks, and terminal-backed debugging are unavailable."));
		}
	}

	prepareReconnect(options: ICreateTerminalOptions, kind: 'background' | 'group'): ICreateTerminalOptions {
		// Persisted hidden terminals are the companion shells; panel groups are session shells.
		return kind === 'background' ? TerminalFirstLaunch.floating(options) : TerminalFirstLaunch.session(options);
	}

	prepareLaunchConfig(config: IShellLaunchConfig, options: ICreateTerminalOptions | undefined): void {
		if (options && floatingLaunches.has(options)) {
			config.hideFromUser = true;
			config.forcePersist = true;
			detachedConfigs.add(config);
		}
		authorizeTerminalFirstLaunch(config);
	}

	skipContributedProfile(options: ICreateTerminalOptions | undefined): boolean {
		return !!options && (floatingLaunches.has(options) || tileLaunches.has(options));
	}

	authorizeInstance(config: IShellLaunchConfig | ITerminalProfile): void {
		if (!consumeTerminalFirstLaunch(config)) {
			throw new Error(localize('sessionTerminalOnly', "Use the session strip to open a terminal. Editor terminals, splits, tasks, and extension-created terminals are unavailable."));
		}
	}

	isDetached(instance: ITerminalInstance): boolean {
		return TerminalFirstLaunch.isDetached(instance);
	}

	opensEditorFor(options: ICreateTerminalOptions | undefined): boolean {
		return !options || !tileLaunches.has(options);
	}

	assertCanOpenEditor(instance: ITerminalInstance): void {
		if (instance.target !== TerminalLocation.Editor) {
			throw new Error(localize('editorTerminalBlocked', "Use New Tile to open an editor terminal."));
		}
	}

	assertCanAddToGroup(group: ITerminalGroup): void {
		if (group.terminalInstances.length) {
			throw new Error(localize('splitBlocked', "Use separate session tabs instead of terminal splits."));
		}
	}

	assertCanMoveInGroup(): void {
		throw new Error(localize('joinBlocked', "Terminals must remain in separate session tabs."));
	}

	actionPrecondition(id: string, precondition: ContextKeyExpression | undefined): ContextKeyExpression | undefined {
		const interaction = isTerminalFirstInteraction(id);
		return ContextKeyExpr.and(precondition, interaction ? ContextKeyExpr.or(TerminalFirstShellContext, TerminalFirstFloatingVisibleContext) : ContextKeyExpr.false());
	}

	canRunAction(id: string): boolean {
		return isTerminalFirstCommandAllowed(id);
	}

	decorateEnvironment(env: IProcessEnvironment, nonce: string): void {
		// The nonce is restored with persistent terminals, so CLI requests find their shell after a reload.
		env.TERMINAL_FIRST_SESSION = nonce;
	}
}

/** The contribution registers one instance per window; tests register their own. */
export function createTerminalFirstTerminalPolicy(): ITerminalPolicy {
	return new TerminalFirstTerminalPolicy();
}
