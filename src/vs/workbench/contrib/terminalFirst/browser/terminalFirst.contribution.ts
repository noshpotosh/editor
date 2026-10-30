/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import '../common/terminalFirstColorRegistry.js';
import './tiles.js';
import './terminalCopyMode.js';
import './terminalFirstLeader.js';
import './terminalFirstNavigation.js';
import { ContextKeyExpr } from '../../../../platform/contextkey/common/contextkey.js';
import { mainWindow } from '../../../../base/browser/window.js';
import { KeyCode, KeyMod } from '../../../../base/common/keyCodes.js';
import { terminalFirstEnabled, TerminalFirstFloatingEnabledContext } from '../../../services/terminalFirst/common/terminalFirstPolicy.js';
import { localize, localize2 } from '../../../../nls.js';
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
import './viewPruning.js';
import './tileListNavigation.js';
import { createTerminalFirstTerminalPolicy } from './terminalPolicy.js';
import { SessionStripContribution } from './sessionStripContribution.js';
import { TerminalPolicy } from '../../terminal/browser/terminalPolicy.js';

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
	TerminalPolicy.set(createTerminalFirstTerminalPolicy());
	Registry.as<IConfigurationRegistry>(Extensions.Configuration).registerConfiguration({ id: 'terminalFirst.terminal', title: localize('terminalSettings', "Terminal First"), type: 'object', properties: {
		'terminalFirst.terminal.padding': { type: 'number', default: 12, minimum: 0, maximum: 100, description: localize('padding', "Terminal padding in pixels.") },
	} });
	registerWorkbenchContribution2('workbench.contrib.terminalFirst', TerminalFirstContribution, WorkbenchPhase.AfterRestored);
	registerWorkbenchContribution2(SessionStripContribution.ID, SessionStripContribution, WorkbenchPhase.BlockRestore);
	Registry.as<IConfigurationRegistry>(Extensions.Configuration).registerDefaultConfigurations([{
		overrides: {
			'window.titleBarStyle': 'custom',
			'window.customTitleBarVisibility': 'auto',
			'terminal.integrated.fontFamily': '"JetBrains Mono", "SF Mono", Menlo, monospace',
			'terminal.integrated.fontSize': 13,
			'terminal.integrated.lineHeight': 1.2,
			'terminal.integrated.cursorStyle': 'block',
			'terminal.integrated.cursorBlinking': true,
			'terminal.integrated.scrollback': 10000,
			'terminal.integrated.gpuAcceleration': 'on',
			'terminal.integrated.minimumContrastRatio': 1,
			'security.workspace.trust.startupPrompt': 'never',
			'extensions.ignoreRecommendations': true,
			'update.mode': 'none',
			'update.showReleaseNotes': false,
			'workbench.tips.enabled': false,
			'workbench.enableExperiments': false,
			'git.openRepositoryInParentFolders': 'never',
			'git.autoRepositoryDetection': 'subFolders',

			'workbench.startupEditor': 'none',
			'workbench.welcomePage.experimentalOnboarding': false,
			'terminal.integrated.initialHint': false,
			'workbench.editor.showTabs': 'multiple',
			'workbench.editor.enablePreview': false,
			'workbench.editor.focusRecentEditorAfterClose': true,
			'workbench.editor.editorActionsLocation': 'hidden',
			'git.showCommitInput': false,
			'scm.showActionButton': false,
			'scm.showInputActionButton': false,
			'workbench.statusBar.visible': false,
			'workbench.activityBar.location': 'hidden',
			'workbench.secondarySideBar.defaultVisibility': 'hidden',
			'window.commandCenter': false,
			'workbench.layoutControl.enabled': false,
			'chat.titleBar.openInAgentsWindow.enabled': false,
			'editor.minimap.enabled': false,
			'breadcrumbs.enabled': false,
			// Leader, copy mode, and tile chords must reach the workbench from the shell and from terminal tiles.
			'terminal.integrated.commandsToSkipShell': [
				'terminalFirst.leader', 'terminalFirst.copyMode.enter', 'terminalFirst.toggleFloatingTerminal',
				...['new', 'explorer', 'scm', 'terminal', 'close', 'maximize', 'toggleSplit', 'balance'].map(id => `terminalFirst.tile.${id}`),
				...['Left', 'Down', 'Up', 'Right'].flatMap(direction => ['focus', 'move', 'swap', 'resize'].map(action => `terminalFirst.tile.${action}${direction}`)),
			],
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
					// Cmd+Shift keeps Select All and Toggle Panel on their upstream keys; the leader offers `j a` and `j j`.
					keybinding: { primary: KeyMod.CtrlCmd | KeyMod.Shift | action.key, when: action.context, weight: KeybindingWeight.ExternalExtension + 1000 } });
			}
			run(accessor: ServicesAccessor): Promise<void> { return action.run(accessor.get(ITerminalFirstService)); }
		});
	}

	CommandsRegistry.registerCommand('terminalFirst.showEditor', accessor => accessor.get(ITerminalFirstService).showEditor());
	CommandsRegistry.registerCommand('terminalFirst.showShell', accessor => accessor.get(ITerminalFirstService).showShell());
	CommandsRegistry.registerCommand('terminalFirst.closeSession', accessor => {
		const service = accessor.get(ITerminalFirstService);
		const active = service.sessions.find(session => session.active);
		return active ? service.closeSession(active.id) : undefined;
	});
	const actions = [
		{ id: 'terminalFirst.toggleFloatingFileBrowser', title: localize2('terminalFirst.toggleFloatingFileBrowser', "Toggle Floating File Browser"), key: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyE, run: (service: ITerminalFirstService) => service.toggleFloatingFileBrowser() },
		{ id: 'terminalFirst.toggleFloatingTerminal', title: localize2('terminalFirst.toggleFloatingTerminal', "Toggle Floating Terminal"), key: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyT, run: (service: ITerminalFirstService) => service.toggleFloatingTerminal() },
		{ id: 'terminalFirst.newTerminal', title: localize2('terminalFirst.newTerminal', "New Shell Session"), key: KeyMod.CtrlCmd | KeyMod.Alt | KeyCode.KeyN, run: (service: ITerminalFirstService) => service.newTerminal() },
		{ id: 'terminalFirst.nextTerminal', title: localize2('terminalFirst.nextTerminal', "Next Shell Session"), key: KeyMod.CtrlCmd | KeyMod.Alt | KeyCode.RightArrow, run: (service: ITerminalFirstService) => service.switchTerminal(1) },
		{ id: 'terminalFirst.previousTerminal', title: localize2('terminalFirst.previousTerminal', "Previous Shell Session"), key: KeyMod.CtrlCmd | KeyMod.Alt | KeyCode.LeftArrow, run: (service: ITerminalFirstService) => service.switchTerminal(-1) },
		{ id: 'terminalFirst.pickTerminal', title: localize2('terminalFirst.pickTerminal', "Switch Shell Session"), key: KeyMod.CtrlCmd | KeyMod.Alt | KeyCode.KeyP, run: (service: ITerminalFirstService) => service.pickTerminal() },
	];
	for (const action of actions) {
		registerAction2(class extends Action2 {
			constructor() {
				super({ id: action.id, title: action.title, category: localize2('terminalFirst.category', "VS NOSH"), precondition: (action.id === 'terminalFirst.toggleFloatingTerminal' || action.id === 'terminalFirst.toggleFloatingFileBrowser') ? TerminalFirstFloatingEnabledContext : undefined, f1: true, keybinding: { primary: action.key, weight: KeybindingWeight.ExternalExtension + 1000 } });
			}
			run(accessor: ServicesAccessor): Promise<void> {
				return action.run(accessor.get(ITerminalFirstService));
			}
		});
	}

	CommandsRegistry.registerCommand('_terminalFirst.windowId', () => mainWindow.vscodeWindowId);
	CommandsRegistry.registerCommand('_terminalFirst.openFiles', (accessor, fileURIs: string[], terminalSession: string, wait: boolean, cwd?: string) => accessor.get(ITerminalFirstService).openFiles(fileURIs, terminalSession, wait, cwd));
}
