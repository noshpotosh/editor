/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { $, append, addDisposableListener, getWindow } from '../../../../base/browser/dom.js';
import { Disposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { RunOnceScheduler } from '../../../../base/common/async.js';
import { localize, localize2 } from '../../../../nls.js';
import { createDecorator, ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IContextKeyService, RawContextKey } from '../../../../platform/contextkey/common/contextkey.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { IQuickInputService } from '../../../../platform/quickinput/common/quickInput.js';
import { Action2, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { KeyCode, KeyMod } from '../../../../base/common/keyCodes.js';
import { KeybindingWeight } from '../../../../platform/keybinding/common/keybindingsRegistry.js';
import { IWorkbenchLayoutService } from '../../../services/layout/browser/layoutService.js';
import { ITerminalFirstService } from '../../../services/terminalFirst/common/terminalFirst.js';
import { terminalFirstEnabled, terminalFirstPolicy, isTerminalFirstCommandAllowed, TerminalFirstEnabledContext } from '../../../services/terminalFirst/common/terminalFirstPolicy.js';
import './nativeVim.css';
/** `repeat` actions keep their prefix active, forming a submap that exits on any other key. */
interface ModalAction { keys: string; label: string; command: string; repeat?: boolean }
const editorActions: readonly ModalAction[] = [
	{ keys: 'ff', label: localize('findFile', "Find File"), command: 'workbench.action.quickOpen' },
	{ keys: 'fe', label: localize('browse', "Browse Directory"), command: 'terminalFirst.tile.explorer' },
	{ keys: 'fb', label: localize('fileBrowser', "Browse Files"), command: 'terminalFirst.toggleFloatingFileBrowser' },
	{ keys: 'fs', label: localize('save', "Save File"), command: 'workbench.action.files.save' },
	{ keys: 'bb', label: localize('buffers', "Pick Buffer in Pane"), command: 'workbench.action.showEditorsInActiveGroup' },
	{ keys: 'bn', label: localize('nextBuffer', "Next Buffer in Pane"), command: 'workbench.action.nextEditorInGroup' },
	{ keys: 'bp', label: localize('previousBuffer', "Previous Buffer in Pane"), command: 'workbench.action.previousEditorInGroup' },
	{ keys: 'bd', label: localize('closeBuffer', "Close Buffer"), command: 'workbench.action.closeActiveEditor' },
	...(['h', 'j', 'k', 'l'] as const).map((key, index) => ({ keys: `w${key}`, label: [localize('left', "Focus Left Pane"), localize('down', "Focus Pane Below"), localize('up', "Focus Pane Above"), localize('right', "Focus Right Pane")][index], command: ['terminalFirst.tile.focusLeft', 'terminalFirst.tile.focusDown', 'terminalFirst.tile.focusUp', 'terminalFirst.tile.focusRight'][index] })),
	{ keys: 'wa', label: localize('newTile', "New Tile"), command: 'terminalFirst.tile.new' },
	{ keys: 'wm', label: localize('maximizeTile', "Toggle Maximized Tile"), command: 'terminalFirst.tile.maximize' },
	{ keys: 'wg', label: localize('gitTile', "Open Git Changes Tile"), command: 'terminalFirst.tile.scm' },
	{ keys: 'wt', label: localize('terminalTile', "Open Terminal Tile"), command: 'terminalFirst.tile.terminal' },
	{ keys: 'wb', label: localize('jiraTile', "Open Jira Board"), command: 'terminalFirst.tile.jira' },
	{ keys: 'wc', label: localize('bitbucketTile', "Open Bitbucket"), command: 'terminalFirst.tile.bitbucket' },
	...(['Left', 'Down', 'Up', 'Right'] as const).map((direction, index) => ({ keys: `wr${['h', 'j', 'k', 'l'][index]}`, label: [localize('edgeLeft', "Move Tile Edge Left"), localize('edgeDown', "Move Tile Edge Down"), localize('edgeUp', "Move Tile Edge Up"), localize('edgeRight', "Move Tile Edge Right")][index], command: `terminalFirst.tile.resize${direction}`, repeat: true })),
	{ keys: 'wr=', label: localize('balance', "Balance Tile Sizes"), command: 'terminalFirst.tile.balance', repeat: true },
	...(['Left', 'Down', 'Up', 'Right'] as const).map((direction, index) => ({ keys: `wx${['h', 'j', 'k', 'l'][index]}`, label: [localize('swapLeft', "Swap with Left Tile"), localize('swapDown', "Swap with Tile Below"), localize('swapUp', "Swap with Tile Above"), localize('swapRight', "Swap with Right Tile")][index], command: `terminalFirst.tile.swap${direction}` })),
	{ keys: 'wo', label: localize('toggleSplit', "Toggle Tile Split Direction"), command: 'terminalFirst.tile.toggleSplit' },
	{ keys: 'w=', label: localize('balance', "Balance Tile Sizes"), command: 'terminalFirst.tile.balance' },
	{ keys: 'wn', label: localize('nextPane', "Focus Next Pane"), command: 'terminalFirst.tile.next' },
	{ keys: 'wp', label: localize('previousPane', "Focus Previous Pane"), command: 'terminalFirst.tile.previous' },
	{ keys: 'wH', label: localize('moveLeft', "Move Tile to Left Pane"), command: 'terminalFirst.tile.moveLeft' },
	{ keys: 'wJ', label: localize('moveDown', "Move Tile to Pane Below"), command: 'terminalFirst.tile.moveDown' },
	{ keys: 'wK', label: localize('moveUp', "Move Tile to Pane Above"), command: 'terminalFirst.tile.moveUp' },
	{ keys: 'wL', label: localize('moveRight', "Move Tile to Right Pane"), command: 'terminalFirst.tile.moveRight' },
	{ keys: 'wv', label: localize('vertical', "Split Vertically"), command: 'terminalFirst.tile.splitRight' },
	{ keys: 'ws', label: localize('horizontal', "Split Horizontally"), command: 'terminalFirst.tile.splitDown' },
	{ keys: 'wq', label: localize('closePane', "Close Pane"), command: 'terminalFirst.tile.close' },
	{ keys: 'ss', label: localize('searchText', "Search Project Text"), command: 'workbench.action.findInFiles' },
	{ keys: 'sy', label: localize('symbols', "Search Project Symbols"), command: 'workbench.action.showAllSymbols' },
	{ keys: 'ca', label: localize('codeAction', "Code Actions"), command: 'editor.action.quickFix' },
	{ keys: 'cr', label: localize('rename', "Rename Symbol"), command: 'editor.action.rename' },
	{ keys: 'cf', label: localize('format', "Format Document"), command: 'editor.action.formatDocument' },
	{ keys: 'cd', label: localize('diagnostic', "Next Diagnostic"), command: 'editor.action.marker.nextInFiles' },
	{ keys: 'jj', label: localize('jumpList', "Open Jump List"), command: 'terminalFirst.toggleFloatingJumpList' },
	{ keys: 'ja', label: localize('addJump', "Add File to Jump List"), command: 'terminalFirst.addToJumpList' },
	...Array.from({ length: 9 }, (_, index) => ({ keys: `j${index + 1}`, label: localize('jumpSlot', "Open Jump List Slot {0}", index + 1), command: `terminalFirst.jumpToSlot${index + 1}` })),
	{ keys: 'tt', label: localize('terminal', "Toggle Floating Terminal"), command: 'terminalFirst.toggleFloatingTerminal' },
	{ keys: 'ts', label: localize('session', "Pick Session"), command: 'terminalFirst.pickTerminal' },
	{ keys: 'tn', label: localize('newSession', "New Session"), command: 'terminalFirst.newTerminal' },
	{ keys: 'q', label: localize('shell', "Return to Shell"), command: 'terminalFirst.showShell' },
	{ keys: '[', label: localize('copyMode', "Copy Scrollback"), command: 'terminalFirst.copyMode.enter' },
];


const shellActions: readonly ModalAction[] = [
	{ keys: 'e', label: localize('editor', "Open Editor"), command: 'terminalFirst.showEditor' },
	{ keys: 'n', label: localize('next', "Next Session"), command: 'terminalFirst.nextTerminal' },
	{ keys: 'p', label: localize('previous', "Previous Session"), command: 'terminalFirst.previousTerminal' },
	{ keys: 's', label: localize('pick', "Pick Session"), command: 'terminalFirst.pickTerminal' },
	{ keys: 'c', label: localize('create', "New Session"), command: 'terminalFirst.newTerminal' },
	{ keys: 'x', label: localize('close', "Close Session"), command: 'terminalFirst.closeSession' },
	{ keys: '[', label: localize('copy', "Copy Scrollback"), command: 'terminalFirst.copyMode.enter' },
	{ keys: 'r', label: localize('reload', "Reload Window"), command: 'workbench.action.reloadWindow' },
];
export const ITerminalFirstLeaderService = createDecorator<ITerminalFirstLeaderService>('terminalFirstLeaderService');
export interface ITerminalFirstLeaderService {
	readonly _serviceBrand: undefined;
	readonly active: boolean;
	readonly hint: string;
	readonly onDidChange: Event<void>;
	start(prefix?: string): void;
	key(key: string): boolean;
	cancel(): void;
	execute(command: string): Promise<void>;
}

/** Shared leader navigation, independent of the editor's Vim engine. */
export class TerminalFirstLeaderService extends Disposable implements ITerminalFirstLeaderService {
	declare readonly _serviceBrand: undefined;
	private sequence: string | undefined;
	hint = '';
	private readonly changed = this._register(new Emitter<void>());
	readonly onDidChange = this.changed.event;
	private readonly hints = this._register(new RunOnceScheduler(() => this.render(), 250));
	private readonly menu: HTMLElement;
	private readonly context;
	get active(): boolean { return this.sequence !== undefined; }
	private get actions(): readonly ModalAction[] {
		const actions = [...(terminalFirstPolicy.shell ? shellActions : editorActions)];
		if (!terminalFirstPolicy.shell) {
			const bindings = this.configuration.getValue<ModalAction[]>('terminalFirst.vim.leaderBindings');
			for (const binding of Array.isArray(bindings) ? bindings : []) {
				if (!binding || typeof binding.keys !== 'string' || !binding.keys || typeof binding.command !== 'string' || !binding.command || typeof binding.label !== 'string' || binding.keys.startsWith('?')) { continue; }
				// Keep every existing menu reachable, including its prefix sequences.
				if (actions.some(action => action.keys.startsWith(binding.keys) || binding.keys.startsWith(action.keys))) { continue; }
				actions.push({ keys: binding.keys, label: binding.label, command: binding.command });
			}
		}
		return actions.filter(action => isTerminalFirstCommandAllowed(action.command) && (action.keys !== '[' || terminalFirstPolicy.shell || terminalFirstPolicy.floatingVisible));
	}
	constructor(
		@IWorkbenchLayoutService layout: IWorkbenchLayoutService,
		@IConfigurationService private readonly configuration: IConfigurationService,
		@IContextKeyService contexts: IContextKeyService,
		@ICommandService private readonly commands: ICommandService,
		@IQuickInputService private readonly quickInput: IQuickInputService,
		@INotificationService private readonly notifications: INotificationService,
		@ITerminalFirstService sessions: ITerminalFirstService,
	) {
		super();
		this.context = new RawContextKey<boolean>('terminalFirstLeaderActive', false).bindTo(contexts);
		this.menu = append(layout.mainContainer, $('.native-vim-leader'));
		this.menu.hidden = true;
		this.menu.setAttribute('role', 'status');
		this.menu.setAttribute('aria-live', 'polite');
		this._register(toDisposable(() => { this.context.reset(); this.menu.remove(); }));
		this._register(sessions.onDidChangeSessions(() => this.cancel()));
		const window = getWindow(layout.mainContainer);
		this._register(addDisposableListener(window, 'blur', () => this.cancel()));
		this._register(addDisposableListener(window, 'keydown', event => {
			if (!this.active) { return; }
			event.preventDefault(); event.stopImmediatePropagation();
			if (['Shift', 'Control', 'Alt', 'Meta'].includes(event.key)) { return; }
			this.key(event.key === 'Escape' ? '<Esc>' : event.key);
		}, true));
	}
	start(prefix = ''): void {
		this.sequence = prefix; this.context.set(true);
		this.hints.schedule(this.configuration.getValue<number>('terminalFirst.vim.hintDelay') ?? 250);
		this.changed.fire();
	}
	cancel(): void {
		this.sequence = undefined; this.context.reset(); this.hints.cancel(); this.menu.hidden = true; this.hint = ''; this.changed.fire();
	}
	key(key: string): boolean {
		if (!this.active) { return false; }
		if (key === '<Esc>') {
			const returnToShell = this.sequence === '' && !terminalFirstPolicy.shell;
			this.cancel();
			if (returnToShell) { void this.execute('terminalFirst.showShell').catch(error => this.notifications.error(error)); }
			return true;
		}
		this.sequence += key;
		const action = this.actions.find(action => action.keys === this.sequence);
		if (action?.repeat) {
			this.sequence = this.sequence!.slice(0, -1);
			this.render();
			void this.execute(action.command).catch(error => this.notifications.error(error));
		} else if (this.sequence === '?' || action) {
			const command = action?.command ?? 'help'; this.cancel();
			void this.execute(command).catch(error => this.notifications.error(error));
		} else if (this.actions.some(action => action.keys.startsWith(this.sequence!))) { this.render(); }
		else { this.cancel(); }
		return true;
	}
	private describeBinding(action: ModalAction): string {
		if (terminalFirstPolicy.shell) { return `Ctrl+Space ${action.keys}`; }
		const leader = this.configuration.getValue<string>('terminalFirst.vim.leader') ?? ' ';
		const label = leader === ' ' ? localize('spaceKey', "Space") : leader;
		return action.keys.startsWith('w') ? `${label} ${action.keys} / Ctrl+W ${action.keys.slice(1)}` : `${label} ${action.keys}`;
	}
	private render(): void {
		if (!this.active) { return; }
		const rows = this.actions.filter(action => action.keys.startsWith(this.sequence!)).map(action => [this.describeBinding(action), action.label]);
		rows.push(['?', localize('helpLabel', "Search All Actions")]);
		this.hint = rows.map(([keys, label]) => `${keys}  ${label}`).join('\n');
		this.menu.replaceChildren(...rows.flatMap(([keys, label]) => [$('span.native-vim-leader-keys', undefined, keys), $('span.native-vim-leader-label', undefined, label)]));
		this.menu.hidden = false; this.changed.fire();
	}
	async execute(command: string): Promise<void> {
		if (command === 'help') {
			const item = await this.quickInput.pick(this.actions.map(action => ({ label: action.label, description: this.describeBinding(action), command: action.command })), { placeHolder: localize('helpPlaceholder', "Search Leader Actions") });
			if (item) { await this.execute(item.command); }
			return;
		}
		if (!isTerminalFirstCommandAllowed(command)) { return; }
		await this.commands.executeCommand(command);
	}
}
registerSingleton(ITerminalFirstLeaderService, TerminalFirstLeaderService, InstantiationType.Delayed);
if (terminalFirstEnabled) {
	registerAction2(class extends Action2 {
		constructor() { super({ id: 'terminalFirst.leader', title: localize2('leader', "Start Leader Sequence"), f1: true, precondition: TerminalFirstEnabledContext, keybinding: { primary: KeyMod.WinCtrl | KeyCode.Space, weight: KeybindingWeight.ExternalExtension + 1000 } }); }
		run(accessor: ServicesAccessor): void { accessor.get(ITerminalFirstLeaderService).start(); }
	});
}
