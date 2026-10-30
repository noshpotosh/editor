/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { append, $ } from '../../../../base/browser/dom.js';
import { IWorkbenchLayoutService } from '../../../services/layout/browser/layoutService.js';
import './floatingOverlay.css';
import './nativeVim.css';
import { NativeVimPickers } from './nativeVimPickers.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { ITerminalFirstService } from '../../../services/terminalFirst/common/terminalFirst.js';
import { Disposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { Emitter } from '../../../../base/common/event.js';
import { RunOnceScheduler } from '../../../../base/common/async.js';
import { localize, localize2 } from '../../../../nls.js';
import { INativeVimService } from '../../../../editor/contrib/nativeVim/common/nativeVimService.js';
import { validateVimRemaps, VimRemap } from '../../../../editor/contrib/nativeVim/common/vimRemapping.js';
import { VimMode, VimSharedState } from '../../../../editor/contrib/nativeVim/common/nativeVim.js';
import { NativeVimContribution } from '../../../../editor/contrib/nativeVim/browser/nativeVimContribution.js';
import { ICodeEditorService } from '../../../../editor/browser/services/codeEditorService.js';
import { Range } from '../../../../editor/common/core/range.js';
import { EditorOption } from '../../../../editor/common/config/editorOptions.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { Extensions, IConfigurationRegistry } from '../../../../platform/configuration/common/configurationRegistry.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { IClipboardService } from '../../../../platform/clipboard/common/clipboardService.js';
import { IQuickInputService } from '../../../../platform/quickinput/common/quickInput.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { IDialogService } from '../../../../platform/dialogs/common/dialogs.js';
import { IExtensionManagementService } from '../../../../platform/extensionManagement/common/extensionManagement.js';
import { EnablementState, IWorkbenchExtensionEnablementService } from '../../../services/extensionManagement/common/extensionManagement.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { Action2, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { terminalFirstEnabled } from '../../../services/terminalFirst/common/terminalFirstPolicy.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { URI } from '../../../../base/common/uri.js';
import { dirname, joinPath } from '../../../../base/common/resources.js';

interface ModalAction { keys: string; label: string; command: string }
const actions: readonly ModalAction[] = [
	{ keys: 'ff', label: localize('findFile', "Find File"), command: 'workbench.action.quickOpen' },
	{ keys: 'fe', label: localize('browse', "Browse Directory"), command: 'terminalFirst.toggleFloatingFileBrowser' },
	{ keys: 'fs', label: localize('save', "Save File"), command: 'workbench.action.files.save' },
	{ keys: 'bb', label: localize('buffers', "Pick Buffer"), command: 'workbench.action.showAllEditors' },
	{ keys: 'bn', label: localize('nextBuffer', "Next Buffer"), command: 'workbench.action.nextEditor' },
	{ keys: 'bp', label: localize('previousBuffer', "Previous Buffer"), command: 'workbench.action.previousEditor' },
	{ keys: 'bd', label: localize('closeBuffer', "Close Buffer"), command: 'workbench.action.closeActiveEditor' },
	...(['h', 'j', 'k', 'l'] as const).map((key, index) => ({ keys: `w${key}`, label: [localize('left', "Focus Left Pane"), localize('down', "Focus Pane Below"), localize('up', "Focus Pane Above"), localize('right', "Focus Right Pane")][index], command: ['workbench.action.focusLeftGroup', 'workbench.action.focusBelowGroup', 'workbench.action.focusAboveGroup', 'workbench.action.focusRightGroup'][index] })),
	{ keys: 'wv', label: localize('vertical', "Split Vertically"), command: 'workbench.action.splitEditorRight' },
	{ keys: 'ws', label: localize('horizontal', "Split Horizontally"), command: 'workbench.action.splitEditorDown' },
	{ keys: 'wq', label: localize('closePane', "Close Pane"), command: 'workbench.action.closeEditorsInGroup' },
	{ keys: 'ss', label: localize('searchText', "Search Project Text"), command: 'workbench.action.findInFiles' },
	{ keys: 'sy', label: localize('symbols', "Search Project Symbols"), command: 'workbench.action.showAllSymbols' },
	{ keys: 'ca', label: localize('codeAction', "Code Actions"), command: 'editor.action.quickFix' },
	{ keys: 'cr', label: localize('rename', "Rename Symbol"), command: 'editor.action.rename' },
	{ keys: 'cf', label: localize('format', "Format Document"), command: 'editor.action.formatDocument' },
	{ keys: 'cd', label: localize('diagnostic', "Next Diagnostic"), command: 'editor.action.marker.nextInFiles' },
	{ keys: 'jj', label: localize('jumpList', "Open Jump List"), command: 'terminalFirst.toggleFloatingJumpList' },
	{ keys: 'ja', label: localize('addJump', "Add File to Jump List"), command: 'terminalFirst.addToJumpList' },
	{ keys: 'tt', label: localize('terminal', "Toggle Floating Terminal"), command: 'terminalFirst.toggleFloatingTerminal' },
	{ keys: 'ts', label: localize('session', "Pick Session"), command: 'terminalFirst.pickTerminal' },
	{ keys: 'tn', label: localize('newSession', "New Session"), command: 'terminalFirst.newTerminal' },
];

/** App-owned navigation layer. It never dispatches keys to a terminal or unrelated input. */
class NativeVimService extends Disposable implements INativeVimService {
	declare readonly _serviceBrand: undefined;
	readonly shared = new VimSharedState();
	private ready = false;
	private readonly changed = this._register(new Emitter<void>());
	readonly onDidChange = this.changed.event;
	hint = '';
	private sequence: string | undefined;
	private readonly hints = this._register(new RunOnceScheduler(() => this.showHints(), 250));
	private remapBuffer: string[] = [];
	private expanding = false;
	private remaps: readonly VimRemap[] = [];
	private readonly initialEngine: string;
	private readonly jumps = new Map<string, { entries: { resource: URI; offset: number }[]; index: number }>();

	constructor(
		@IWorkbenchLayoutService layout: IWorkbenchLayoutService,
		@IStorageService storage: IStorageService,
		@ITerminalFirstService private readonly sessions: ITerminalFirstService,
		@IContextKeyService contexts: IContextKeyService,
		@IConfigurationService private readonly configuration: IConfigurationService,
		@ICommandService private readonly commands: ICommandService,
		@ICodeEditorService private readonly editors: ICodeEditorService,
		@IEditorService private readonly editorService: IEditorService,
		@IClipboardService private readonly clipboard: IClipboardService,
		@IQuickInputService private readonly quickInput: IQuickInputService,
		@INotificationService private readonly notifications: INotificationService,
		@IDialogService private readonly dialogs: IDialogService,
		@IExtensionManagementService extensions: IExtensionManagementService,
		@IWorkbenchExtensionEnablementService enablement: IWorkbenchExtensionEnablementService,
	) {
		super();
		this._register(new NativeVimPickers(this, quickInput, commands, contexts));
		const menu = append(layout.mainContainer, $('.native-vim-leader'));
		menu.hidden = true; menu.setAttribute('role', 'status'); menu.setAttribute('aria-live', 'polite');
		this._register(toDisposable(() => menu.remove()));
		this._register(this.onDidChange(() => { menu.textContent = this.hint; menu.hidden = !this.hint; }));
		this._register(sessions.onDidChangeSessions(() => {
			this.cancel();
			for (const id of this.jumps.keys()) { if (!sessions.sessions.some(session => session.id === id)) { this.jumps.delete(id); } }
		}));
		this.updateRemaps();
		this.initialEngine = configuration.getValue<string>('terminalFirst.vim.engine');
		if (terminalFirstEnabled) {
			void extensions.getInstalled().then(async installed => {
				const vim = installed.filter(extension => extension.identifier.id.toLowerCase() === 'vscodevim.vim');
				const disabledKey = 'terminalFirst.vim.disabledExtension';
				if (this.initialEngine === 'extension') {
					if (storage.getBoolean(disabledKey, StorageScope.PROFILE, false)) { await enablement.setEnablement(vim, EnablementState.EnabledGlobally); storage.remove(disabledKey, StorageScope.PROFILE); notifications.info(localize('reloadExtension', "VSCodeVim has been enabled. Reload the window to finish switching engines.")); }
					return;
				}
				if (vim.some(extension => enablement.isEnabled(extension))) {
					await enablement.setEnablement(vim, EnablementState.DisabledGlobally);
					storage.store(disabledKey, true, StorageScope.PROFILE, StorageTarget.MACHINE);
					notifications.info(localize('reloadNative', "VSCodeVim has been disabled for this profile. Reload the window to finish switching engines."));
					return;
				}
				this.ready = this.initialEngine === 'native'; this.changed.fire();
			}).catch(error => notifications.error(error));
		}
		this._register(configuration.onDidChangeConfiguration(event => {
			if (event.affectsConfiguration('terminalFirst.vim.engine')) { notifications.info(localize('reloadEngine', "Reload the window to change the Vim engine.")); }
			if (event.affectsConfiguration('terminalFirst.vim')) { this.cancel(); this.updateRemaps(); }
		}));
	}
	private updateRemaps(): void {
		const remaps = this.configuration.getValue<VimRemap[]>('terminalFirst.vim.remaps') ?? [];
		if (validateVimRemaps(remaps)) { this.remaps = remaps; }
		else { this.remaps = []; this.notifications.warn(localize('invalidRemaps', "Vim remaps contain a cycle, ambiguous prefix, or invalid mapping. No custom remaps were applied.")); }
	}
	readClipboard(): Promise<string> { return this.clipboard.readText(); }
	get enabled(): boolean { return this.ready; }
	cancel(): void { this.sequence = undefined; this.remapBuffer = []; this.hint = ''; this.hints.cancel(); this.changed.fire(); }
	key(key: string, mode: VimMode, allowRemaps = true): boolean {
		if (this.expanding) { return false; }
		if (key === '<Esc>') { const pending = this.sequence !== undefined || this.remapBuffer.length > 0; this.cancel(); return pending; }
		if (this.sequence !== undefined) {
			this.sequence += key;
			if (this.sequence === '?') { this.cancel(); this.execute('help'); return true; }
			const action = actions.find(action => action.keys === this.sequence);
			if (action) { this.cancel(); this.execute(action.command); }
			else if (actions.some(action => action.keys.startsWith(this.sequence!))) { this.showHints(); }
			else { this.cancel(); }
			return true;
		}
		if (mode === 'normal' && (key === this.configuration.getValue<string>('terminalFirst.vim.leader') || key === '<C-w>')) {
			this.sequence = key === '<C-w>' ? 'w' : ''; this.hints.schedule(this.configuration.getValue<number>('terminalFirst.vim.hintDelay')); return true;
		}
		if (!allowRemaps) { return false; }
		const remaps = this.remaps;
		const candidate = [...this.remapBuffer, key];
		const matches = remaps.filter(remap => remap.mode === mode && candidate.every((part, index) => remap.before[index] === part));
		if (matches.length) {
			this.remapBuffer = candidate;
			const exact = matches.find(remap => remap.before.length === candidate.length);
			if (exact) {
				this.remapBuffer = [];
				if (exact.command) { this.execute(exact.command); }
				else if (exact.after) {
					if (exact.after.join('\0') === exact.before.join('\0')) { return true; }
					this.expanding = true;
					try { for (const part of exact.after) { this.input(part); } } finally { this.expanding = false; }
				}
			}
			return true;
		}
		if (this.remapBuffer.length) {
			const buffer = this.remapBuffer; this.remapBuffer = []; this.expanding = true;
			try { for (const part of buffer) { this.input(part); } } finally { this.expanding = false; }
		}
		return false;
	}
	private input(key: string): void {
		const editor = this.editors.getFocusedCodeEditor(); const contribution = editor?.getContribution<NativeVimContribution>(NativeVimContribution.ID);
		if (contribution && !contribution.handle(key)) { editor?.trigger('nativeVim', 'type', { text: key }); }
	}
	private showHints(): void {
		if (this.sequence === undefined) { return; }
		const groups: Record<string, string> = { f: localize('filesGroup', "Files"), b: localize('buffersGroup', "Buffers"), w: localize('panesGroup', "Panes"), s: localize('searchGroup', "Search"), c: localize('codeGroup', "Code"), j: localize('jumpsGroup', "Jump List"), t: localize('sessionsGroup', "Sessions and Terminal"), '?': localize('helpGroup', "Search All Actions") };
		this.hint = this.sequence ? actions.filter(action => action.keys.startsWith(this.sequence!)).map(action => `${action.keys}  ${action.label}`).join('\n') : Object.entries(groups).map(([key, label]) => `${key}  ${label}`).join('\n');
		this.changed.fire();
	}
	execute(command: string, argument?: string): void { void this.run(command, argument).catch(error => this.notifications.error(error)); }
	private async run(command: string, argument?: string): Promise<void> {
		if (command === 'recordJump' || command === 'jumpBack' || command === 'jumpForward') {
			const editor = this.editors.getFocusedCodeEditor(); const model = editor?.getModel();
			const id = this.sessions.sessions.find(session => session.active)?.id;
			if (!id || !model || !editor) { return; }
			let history = this.jumps.get(id);
			if (!history) { history = { entries: [], index: 0 }; this.jumps.set(id, history); }
			const current = { resource: model.uri, offset: model.getOffsetAt(editor.getPosition()!) };
			if (command === 'recordJump') { history.entries.splice(history.index); history.entries.push({ resource: model.uri, offset: Number(argument) }); history.index = history.entries.length; return; }
			if (command === 'jumpBack') { if (!history.index) { return; } if (history.index === history.entries.length) { history.entries.push(current); } history.index--; }
			else { if (history.index >= history.entries.length - 1) { return; } history.index++; }
			const target = history.entries[history.index];
			await this.editorService.openEditor({ resource: target.resource, options: { pinned: true } });
			const active = this.editors.getActiveCodeEditor(); if (active?.getModel()?.uri.toString() === target.resource.toString()) { const position = active.getModel()!.getPositionAt(target.offset); active.setPosition(position); active.revealPositionInCenterIfOutsideViewport(position); }
			return;
		}
		if (command === 'clipboardWrite') { await this.clipboard.writeText(argument ?? ''); return; }
		if (command === 'help') {
			const item = await this.quickInput.pick(actions.map(action => ({ label: action.label, description: `Space ${action.keys}`, command: action.command })), { placeHolder: localize('helpPlaceholder', "Search Vim Actions") });
			if (item) { await this.commands.executeCommand(item.command); } return;
		}
		if (command !== 'ex') { await this.commands.executeCommand(command); return; }
		await this.ex(argument?.trim() ?? '');
	}
	private async ex(line: string): Promise<void> {
		const editor = this.editors.getFocusedCodeEditor() ?? this.editors.getActiveCodeEditor(); const model = editor?.getModel();
		if (!editor || !model) { return; }
		if (/^\d+$/.test(line)) { editor.setPosition({ lineNumber: Math.min(model.getLineCount(), Math.max(1, Number(line))), column: 1 }); return; }
		const simple: Record<string, string> = { w: 'workbench.action.files.save', wa: 'workbench.action.files.saveAll', q: 'workbench.action.closeActiveEditor', bd: 'workbench.action.closeActiveEditor', bdelete: 'workbench.action.closeActiveEditor', bn: 'workbench.action.nextEditor', bnext: 'workbench.action.nextEditor', bp: 'workbench.action.previousEditor', bprevious: 'workbench.action.previousEditor', buffers: 'workbench.action.showAllEditors', ls: 'workbench.action.showAllEditors', split: 'workbench.action.splitEditorDown', sp: 'workbench.action.splitEditorDown', vsplit: 'workbench.action.splitEditorRight', vs: 'workbench.action.splitEditorRight' };
		if (simple[line]) { await this.commands.executeCommand(simple[line]); return; }
		if (line === 'wq' || line === 'x') { const input = this.editorService.activeEditor; await this.commands.executeCommand('workbench.action.files.save'); if (input && this.editorService.activeEditor === input && !input.isDirty()) { await this.commands.executeCommand('workbench.action.closeActiveEditor'); } return; }
		if (line.startsWith('e ')) { const path = line.slice(2).trim(); await this.editorService.openEditor({ resource: path.startsWith('/') ? URI.file(path) : joinPath(dirname(model.uri), path), options: { pinned: true } }); return; }
		if (line === 'e') { await this.commands.executeCommand('workbench.action.quickOpen'); return; }
		const substitution = /^(?<range>%|'<,'>)?s\/(?<pattern>(?:\\.|[^/])*)\/(?<replacement>(?:\\.|[^/])*)\/(?<flags>[gic]*)$/.exec(line);
		if (!substitution?.groups) { throw new Error(localize('unsupportedEx', "Unsupported Vim command: {0}", line)); }
		if (editor.getOption(EditorOption.readOnly)) { throw new Error(localize('readOnly', "This editor is read-only.")); }
		const { range, pattern, replacement, flags } = substitution.groups;
		const selection = editor.getSelection()!;
		const first = range === '%' ? 1 : range ? selection.startLineNumber : editor.getPosition()!.lineNumber;
		const last = range === '%' ? model.getLineCount() : range ? selection.endLineNumber : first;
		const expression = new RegExp(pattern, `u${flags.includes('i') ? 'i' : ''}${flags.includes('g') ? 'g' : ''}`);
		const version = model.getVersionId(); const edits: { range: Range; text: string }[] = [];
		for (let number = first; number <= last; number++) {
			const text = model.getLineContent(number); expression.lastIndex = 0;
			const matches = [...text.matchAll(new RegExp(expression.source, expression.flags.includes('g') ? expression.flags : expression.flags + 'g'))];
			for (const match of flags.includes('g') ? matches : matches.slice(0, 1)) {
				if (flags.includes('c') && !(await this.dialogs.confirm({ message: localize('replaceConfirm', "Replace “{0}” on line {1}?", match[0], number), primaryButton: localize('replaceButton', "Replace") })).confirmed) { continue; }
				const single = new RegExp(expression.source, expression.flags.replace('g', '') + 'y');
				single.lastIndex = match.index;
				const replaced = text.replace(single, replacement.replace(/\\\//g, '/'));
				const expanded = replaced.slice(match.index, replaced.length - (text.length - match.index - match[0].length));
				edits.push({ range: new Range(number, match.index + 1, number, match.index + match[0].length + 1), text: expanded });
			}
		}
		if (model.isDisposed() || model.getVersionId() !== version || editor.getModel() !== model) { throw new Error(localize('changed', "The document changed; substitution was cancelled.")); }
		editor.pushUndoStop(); editor.executeEdits('nativeVim.substitute', edits); editor.pushUndoStop();
	}
}

registerSingleton(INativeVimService, NativeVimService, InstantiationType.Delayed);
Registry.as<IConfigurationRegistry>(Extensions.Configuration).registerConfiguration({
	id: 'terminalFirst.vim', title: localize('settings', "Native Vim"), type: 'object', properties: {
		'terminalFirst.vim.engine': { type: 'string', enum: ['native', 'extension', 'off'], default: 'extension', description: localize('engineSetting', "Vim engine. Reload required. Native is experimental until acceptance validation is complete.") },
		'terminalFirst.vim.leader': { type: 'string', default: ' ', minLength: 1, maxLength: 1, description: localize('leaderSetting', "Normal-mode leader key.") },
		'terminalFirst.vim.hintDelay': { type: 'number', default: 250, minimum: 0, maximum: 2000, description: localize('hintSetting', "Delay before showing leader hints, in milliseconds.") },
		'terminalFirst.vim.remaps': { type: 'array', default: [], description: localize('remapsSetting', "Nonrecursive mode-specific key mappings."), items: { type: 'object', required: ['mode', 'before'], additionalProperties: false, properties: { mode: { type: 'string', enum: ['normal', 'insert', 'visual', 'visualLine', 'visualBlock', 'operator', 'replace'] }, before: { type: 'array', minItems: 1, items: { type: 'string' } }, after: { type: 'array', items: { type: 'string' } }, command: { type: 'string' } }, oneOf: [{ required: ['after'] }, { required: ['command'] }] } },
	}
});
registerAction2(class extends Action2 {
	constructor() { super({ id: 'terminalFirst.vim.help', title: localize2('help', "Search Native Vim Actions"), f1: true }); }
	run(accessor: ServicesAccessor): void { accessor.get(INativeVimService).execute('help'); }
});
