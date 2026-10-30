/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ContextKeyExpr } from '../../../../platform/contextkey/common/contextkey.js';
import { mainWindow } from '../../../../base/browser/window.js';
import { KeyCode, KeyMod } from '../../../../base/common/keyCodes.js';
import { terminalFirstEnabled, TerminalFirstFloatingEnabledContext } from '../../../services/terminalFirst/common/terminalFirstPolicy.js';
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

if (terminalFirstEnabled) {
	registerWorkbenchContribution2('workbench.contrib.terminalFirst', TerminalFirstContribution, WorkbenchPhase.AfterRestored);
	Registry.as<IConfigurationRegistry>(Extensions.Configuration).registerDefaultConfigurations([{
		overrides: {
			'workbench.startupEditor': 'none',
			'workbench.welcomePage.experimentalOnboarding': false,
			'terminal.integrated.initialHint': false,
			'workbench.editor.showTabs': 'single',
			'workbench.editor.enablePreview': false,
			'workbench.editor.focusRecentEditorAfterClose': true,
			'workbench.editor.editorActionsLocation': 'hidden',
			'git.showCommitInput': false,
			'scm.showActionButton': false,
			'scm.showInputActionButton': false,
			'workbench.statusBar.visible': false,
			'workbench.activityBar.location': 'top',
			'workbench.sideBar.location': 'right',
			'workbench.secondarySideBar.defaultVisibility': 'hidden',
			'window.commandCenter': false,
			'workbench.layoutControl.enabled': false,
			'chat.titleBar.openInAgentsWindow.enabled': false,
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

	const jumpListEditorContext = ContextKeyExpr.and(TerminalFirstFloatingEnabledContext,
		ContextKeyExpr.has('editorTextFocus'), ContextKeyExpr.equals('resourceScheme', 'file'),
		ContextKeyExpr.not('terminalFirstBrowserVisible'), ContextKeyExpr.not('terminalFirstFloatingVisible'), ContextKeyExpr.not('terminalFirstJumpListVisible'));
	for (const action of [
		{ id: 'terminalFirst.addToJumpList', title: localize2('terminalFirst.addToJumpList', "Add File to Jump List"), key: KeyCode.KeyA, context: jumpListEditorContext, run: (service: ITerminalFirstService) => service.addToJumpList() },
		{ id: 'terminalFirst.toggleFloatingJumpList', title: localize2('terminalFirst.toggleFloatingJumpList', "Toggle Floating Jump List"), key: KeyCode.KeyJ, context: TerminalFirstFloatingEnabledContext, run: (service: ITerminalFirstService) => service.toggleFloatingJumpList() },
	]) {
		registerAction2(class extends Action2 {
			constructor() {
				super({ id: action.id, title: action.title, category: localize2('terminalFirst.category', "VS NOSH"), precondition: action.context, f1: true,
					// Extension contributions add their binding index to the base weight; stay above VSCodeVim's Cmd+A.
					keybinding: { primary: KeyMod.CtrlCmd | action.key, when: action.context, weight: KeybindingWeight.ExternalExtension + 1000 } });
			}
			run(accessor: ServicesAccessor): Promise<void> { return action.run(accessor.get(ITerminalFirstService)); }
		});
	}

	const actions = [
		{ id: 'terminalFirst.toggleFloatingFileBrowser', title: localize2('terminalFirst.toggleFloatingFileBrowser', "Toggle Floating File Browser"), key: KeyMod.CtrlCmd | KeyCode.KeyE, run: (service: ITerminalFirstService) => service.toggleFloatingFileBrowser() },
		{ id: 'terminalFirst.toggleFloatingTerminal', title: localize2('terminalFirst.toggleFloatingTerminal', "Toggle Floating Terminal"), key: KeyMod.CtrlCmd | KeyCode.KeyT, run: (service: ITerminalFirstService) => service.toggleFloatingTerminal() },
		{ id: 'terminalFirst.newTerminal', title: localize2('terminalFirst.newTerminal', "New Shell Session"), key: KeyMod.CtrlCmd | KeyMod.Alt | KeyCode.KeyN, run: (service: ITerminalFirstService) => service.newTerminal() },
		{ id: 'terminalFirst.nextTerminal', title: localize2('terminalFirst.nextTerminal', "Next Shell Session"), key: KeyMod.CtrlCmd | KeyMod.Alt | KeyCode.RightArrow, run: (service: ITerminalFirstService) => service.switchTerminal(1) },
		{ id: 'terminalFirst.previousTerminal', title: localize2('terminalFirst.previousTerminal', "Previous Shell Session"), key: KeyMod.CtrlCmd | KeyMod.Alt | KeyCode.LeftArrow, run: (service: ITerminalFirstService) => service.switchTerminal(-1) },
		{ id: 'terminalFirst.pickTerminal', title: localize2('terminalFirst.pickTerminal', "Switch Shell Session"), key: KeyMod.CtrlCmd | KeyMod.Alt | KeyCode.KeyP, run: (service: ITerminalFirstService) => service.pickTerminal() },
	];
	for (const action of actions) {
		registerAction2(class extends Action2 {
			constructor() {
				super({ id: action.id, title: action.title, category: localize2('terminalFirst.category', "VS NOSH"), precondition: (action.id === 'terminalFirst.toggleFloatingTerminal' || action.id === 'terminalFirst.toggleFloatingFileBrowser') ? TerminalFirstFloatingEnabledContext : undefined, f1: true, keybinding: { primary: action.key, weight: KeybindingWeight.WorkbenchContrib + 1 } });
			}
			run(accessor: ServicesAccessor): Promise<void> {
				return action.run(accessor.get(ITerminalFirstService));
			}
		});
	}

	CommandsRegistry.registerCommand('_terminalFirst.windowId', () => mainWindow.vscodeWindowId);
	CommandsRegistry.registerCommand('_terminalFirst.openFiles', (accessor, fileURIs: string[], terminalSession: string, wait: boolean, cwd?: string) => accessor.get(ITerminalFirstService).openFiles(fileURIs, terminalSession, wait, cwd));
}
