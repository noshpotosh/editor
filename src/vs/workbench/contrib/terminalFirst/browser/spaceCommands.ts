/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { KeyCode, KeyMod } from '../../../../base/common/keyCodes.js';
import { ILocalizedString, localize2 } from '../../../../nls.js';
import { Action2, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { KeybindingWeight } from '../../../../platform/keybinding/common/keybindingsRegistry.js';
import { ITerminalFirstService } from '../../../services/terminalFirst/common/terminalFirst.js';
import { terminalFirstEnabled, TerminalFirstFloatingEnabledContext } from '../../../services/terminalFirst/common/terminalFirstPolicy.js';
import { dockedNavigation } from './terminalFirstNavigation.js';

interface ISpaceAction {
	readonly id: string;
	readonly title: ILocalizedString;
	readonly run: (service: ITerminalFirstService) => Promise<void>;
	readonly keys?: { primary: number; mac: { primary: number } };
}

/** Hyprland-style chord: Ctrl+Alt everywhere (physical Control on macOS), like the tile commands. */
const mod = (key: number) => ({ primary: KeyMod.CtrlCmd | KeyMod.Alt | key, mac: { primary: KeyMod.WinCtrl | KeyMod.Alt | key } });

const spaceActions: readonly ISpaceAction[] = [
	{ id: 'new', title: localize2('newSpace', "New Space"), run: service => service.newSpace(), keys: mod(KeyCode.KeyN) },
	{ id: 'next', title: localize2('nextSpace', "Next Space"), run: service => service.switchSpace(1), keys: mod(KeyCode.BracketRight) },
	{ id: 'previous', title: localize2('previousSpace', "Previous Space"), run: service => service.switchSpace(-1), keys: mod(KeyCode.BracketLeft) },
	{ id: 'rename', title: localize2('renameSpace', "Rename Space"), run: service => service.renameSpace() },
	{ id: 'close', title: localize2('closeSpace', "Close Space"), run: service => service.closeSpace() },
	{ id: 'pick', title: localize2('pickSpace', "Switch Space"), run: service => service.pickSpace() },
	...Array.from({ length: 9 }, (_, index): ISpaceAction => ({ id: `select${index + 1}`, title: localize2('selectSpace', "Switch to Space {0}", index + 1), run: service => service.selectSpaceAt(index + 1), keys: mod(KeyCode.Digit1 + index) })),
];

/** Every space command, so terminal tiles can pass their chords to the workbench. */
export const spaceCommandIds: readonly string[] = spaceActions.map(action => `terminalFirst.space.${action.id}`);

if (terminalFirstEnabled) {
	for (const action of spaceActions) {
		registerAction2(class extends Action2 {
			constructor() {
				super({
					id: `terminalFirst.space.${action.id}`, title: action.title, f1: true, precondition: TerminalFirstFloatingEnabledContext, category: localize2('category', "VS NOSH"),
					// Stay above extension defaults (including VSCodeVim), but below user overrides.
					keybinding: action.keys && { ...action.keys, when: dockedNavigation, weight: KeybindingWeight.ExternalExtension + 1000 },
				});
			}
			run(accessor: ServicesAccessor): Promise<void> { return action.run(accessor.get(ITerminalFirstService)); }
		});
	}
}
