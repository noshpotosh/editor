/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { mainWindow } from '../../../../base/browser/window.js';
import { KeyCode, KeyMod } from '../../../../base/common/keyCodes.js';
import { isMacintosh } from '../../../../base/common/platform.js';
import { localize2 } from '../../../../nls.js';
import { Action2, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { CommandsRegistry } from '../../../../platform/commands/common/commands.js';
import { Extensions, IConfigurationRegistry } from '../../../../platform/configuration/common/configurationRegistry.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { KeybindingWeight } from '../../../../platform/keybinding/common/keybindingsRegistry.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { ITerminalFirstService, TerminalFirstService } from './terminalFirstService.js';

registerSingleton(ITerminalFirstService, TerminalFirstService, InstantiationType.Delayed);

/** Starts the terminal-first surface after workbench and terminal restoration. */
class TerminalFirstContribution {
	constructor(
		@ITerminalFirstService service: ITerminalFirstService,
		@ILogService logService: ILogService,
	) {
		void service.initialize().catch(error => logService.error(error));
	}
}

if (isMacintosh) {
	registerWorkbenchContribution2('workbench.contrib.terminalFirst', TerminalFirstContribution, WorkbenchPhase.AfterRestored);
	Registry.as<IConfigurationRegistry>(Extensions.Configuration).registerDefaultConfigurations([{
		overrides: {
			'workbench.startupEditor': 'none',
			'workbench.editor.showTabs': 'none',
			'workbench.statusBar.visible': false,
			'workbench.activityBar.location': 'hidden',
			'workbench.secondarySideBar.defaultVisibility': 'hidden',
			'window.commandCenter': false,
			'editor.minimap.enabled': false,
			'breadcrumbs.enabled': false,
			'terminal.integrated.tabs.enabled': false,
			'terminal.integrated.tabs.showActiveTerminal': 'never',
			'terminal.integrated.shellIntegration.decorationsEnabled': 'never',
			'terminal.integrated.allowChords': false,
			'vim.showmodename': true,
			'vim.statusBarColorControl': false,
			'vim.useCtrlKeys': true,
			'vim.showMarksInGutter': true,
		},
	}]);

	const actions = [
		{ id: 'terminalFirst.toggle', title: localize2('terminalFirst.toggle', "Toggle Shell / Editor"), key: KeyMod.CtrlCmd | KeyCode.Escape, run: (service: ITerminalFirstService) => service.toggle() },
		{ id: 'terminalFirst.newTerminal', title: localize2('terminalFirst.newTerminal', "New Shell Session"), key: KeyMod.CtrlCmd | KeyMod.Alt | KeyCode.KeyN, run: (service: ITerminalFirstService) => service.newTerminal() },
		{ id: 'terminalFirst.nextTerminal', title: localize2('terminalFirst.nextTerminal', "Next Shell Session"), key: KeyMod.CtrlCmd | KeyMod.Alt | KeyCode.RightArrow, run: (service: ITerminalFirstService) => service.switchTerminal(1) },
		{ id: 'terminalFirst.previousTerminal', title: localize2('terminalFirst.previousTerminal', "Previous Shell Session"), key: KeyMod.CtrlCmd | KeyMod.Alt | KeyCode.LeftArrow, run: (service: ITerminalFirstService) => service.switchTerminal(-1) },
		{ id: 'terminalFirst.pickTerminal', title: localize2('terminalFirst.pickTerminal', "Switch Shell Session"), key: KeyMod.CtrlCmd | KeyMod.Alt | KeyCode.KeyP, run: (service: ITerminalFirstService) => service.pickTerminal() },
		{ id: 'terminalFirst.toggleTools', title: localize2('terminalFirst.toggleTools', "Toggle Workbench Tools"), key: KeyMod.CtrlCmd | KeyMod.Alt | KeyCode.KeyU, run: (service: ITerminalFirstService) => service.toggleTools() },
	];
	for (const action of actions) {
		registerAction2(class extends Action2 {
			constructor() {
				super({ id: action.id, title: action.title, category: localize2('terminalFirst.category', "Terminal First"), f1: true, keybinding: { primary: action.key, weight: KeybindingWeight.WorkbenchContrib + 1 } });
			}
			run(accessor: ServicesAccessor): Promise<void> {
				return action.run(accessor.get(ITerminalFirstService));
			}
		});
	}

	CommandsRegistry.registerCommand('_terminalFirst.windowId', () => mainWindow.vscodeWindowId);
	CommandsRegistry.registerCommand('_terminalFirst.openFiles', (accessor, fileURIs: string[], terminalSession: string, wait: boolean) => accessor.get(ITerminalFirstService).openFiles(fileURIs, terminalSession, wait));
}
