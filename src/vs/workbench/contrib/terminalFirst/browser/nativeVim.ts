/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import './floatingOverlay.css';
import { ITerminalFirstLeaderService } from './terminalFirstLeader.js';
import { NativeVimPickers } from './nativeVimPickers.js';
import { IContextKey, IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { ITerminalFirstService } from '../../../services/terminalFirst/common/terminalFirst.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { Emitter } from '../../../../base/common/event.js';
import { localize, localize2 } from '../../../../nls.js';
import { INativeVimService } from '../../../../editor/contrib/nativeVim/common/nativeVimService.js';
import { validateVimRemaps, VimRemap } from '../../../../editor/contrib/nativeVim/common/vimRemapping.js';
import { restoreVimSharedState, serializeVimSharedState, VimMode, VimSharedState } from '../../../../editor/contrib/nativeVim/common/nativeVim.js';
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
import { terminalFirstEnabled, TerminalFirstVimEnabledContext } from '../../../services/terminalFirst/common/terminalFirstPolicy.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { URI } from '../../../../base/common/uri.js';
import { dirname, joinPath } from '../../../../base/common/resources.js';
import { registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';

/** App-owned navigation layer. It never dispatches keys to a terminal or unrelated input. */
export class NativeVimService extends Disposable implements INativeVimService {
	declare readonly _serviceBrand: undefined;
	private static readonly SHARED_STATE_KEY = 'terminalFirst.vim.sharedState';
	readonly shared = new VimSharedState();
	private ready = false;
	private readonly vimEnabledContext: IContextKey<boolean>;
	private readonly changed = this._register(new Emitter<void>());
	readonly onDidChange = this.changed.event;
	hint = '';
	private remapBuffer: string[] = [];
	private expanding = false;
	private remaps: readonly VimRemap[] = [];
	private readonly initialEngine: string;
	private readonly jumps = new Map<string, { entries: { resource: URI; offset: number }[]; index: number }>();

	constructor(
		@ITerminalFirstLeaderService private readonly leader: ITerminalFirstLeaderService,
		@IStorageService storage: IStorageService,
		@ITerminalFirstService private readonly sessions: ITerminalFirstService,
		@IContextKeyService contexts: IContextKeyService,
		@IConfigurationService private readonly configuration: IConfigurationService,
		@ICommandService private readonly commands: ICommandService,
		@ICodeEditorService private readonly editors: ICodeEditorService,
		@IEditorService private readonly editorService: IEditorService,
		@IClipboardService private readonly clipboard: IClipboardService,
		@IQuickInputService quickInput: IQuickInputService,
		@INotificationService private readonly notifications: INotificationService,
		@IDialogService private readonly dialogs: IDialogService,
		@IExtensionManagementService extensions: IExtensionManagementService,
		@IWorkbenchExtensionEnablementService enablement: IWorkbenchExtensionEnablementService,
	) {
		super();
		this.vimEnabledContext = TerminalFirstVimEnabledContext.bindTo(contexts);
		// Registers, marks, and macros persist per profile unless turned off.
		if (configuration.getValue<boolean>('terminalFirst.vim.persistRegisters') !== false) {
			restoreVimSharedState(this.shared, storage.getObject(NativeVimService.SHARED_STATE_KEY, StorageScope.PROFILE));
		}
		this._register(storage.onWillSaveState(() => {
			if (configuration.getValue<boolean>('terminalFirst.vim.persistRegisters') !== false) {
				storage.store(NativeVimService.SHARED_STATE_KEY, serializeVimSharedState(this.shared), StorageScope.PROFILE, StorageTarget.MACHINE);
			} else {
				storage.remove(NativeVimService.SHARED_STATE_KEY, StorageScope.PROFILE);
			}
		}));
		this._register(this.leader.onDidChange(() => { this.hint = this.leader.hint; this.changed.fire(); }));
		this._register(new NativeVimPickers(this, quickInput, commands, contexts));
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
				this.ready = this.initialEngine === 'native'; this.vimEnabledContext.set(this.ready); this.changed.fire();
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
	cancel(): void { this.leader.cancel(); this.remapBuffer = []; this.hint = ''; this.changed.fire(); }
	key(key: string, mode: VimMode, allowRemaps = true): boolean {
		if (this.expanding) { return false; }
		if (this.leader.active) { return this.leader.key(key); }
		if (key === '<Esc>') { const pending = this.remapBuffer.length > 0; this.cancel(); return pending; }
		if (mode === 'normal' && (key === this.configuration.getValue<string>('terminalFirst.vim.leader') || key === '<C-w>')) {
			this.leader.start(key === '<C-w>' ? 'w' : ''); return true;
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
		if (command === 'help' || command.startsWith('workbench.action.moveEditorTo')) { await this.leader.execute(command); return; }
		if (command !== 'ex') { await this.commands.executeCommand(command); return; }
		await this.ex(argument?.trim() ?? '');
	}
	private async ex(line: string): Promise<void> {
		const editor = this.editors.getFocusedCodeEditor() ?? this.editors.getActiveCodeEditor(); const model = editor?.getModel();
		if (!editor || !model) { return; }
		if (/^\d+$/.test(line)) { editor.setPosition({ lineNumber: Math.min(model.getLineCount(), Math.max(1, Number(line))), column: 1 }); return; }
		const simple: Record<string, string> = { w: 'workbench.action.files.save', wa: 'workbench.action.files.saveAll', q: 'workbench.action.closeActiveEditor', bd: 'workbench.action.closeActiveEditor', bdelete: 'workbench.action.closeActiveEditor', bn: 'workbench.action.nextEditorInGroup', bnext: 'workbench.action.nextEditorInGroup', bp: 'workbench.action.previousEditorInGroup', bprevious: 'workbench.action.previousEditorInGroup', buffers: 'workbench.action.showEditorsInActiveGroup', ls: 'workbench.action.showEditorsInActiveGroup', split: 'terminalFirst.tile.splitEditorDown', sp: 'terminalFirst.tile.splitEditorDown', vsplit: 'terminalFirst.tile.splitEditorRight', vs: 'terminalFirst.tile.splitEditorRight' };
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

/** The service decides whether native Vim is on; instantiating it at startup sets `terminalFirstVimEnabled` before any editor or tile is opened. */
class NativeVimStartup {
	static readonly ID = 'workbench.contrib.terminalFirstNativeVimStartup';
	constructor(@INativeVimService _vim: INativeVimService) { }
}
if (terminalFirstEnabled) {
	registerWorkbenchContribution2(NativeVimStartup.ID, NativeVimStartup, WorkbenchPhase.BlockRestore);
}
Registry.as<IConfigurationRegistry>(Extensions.Configuration).registerConfiguration({
	id: 'terminalFirst.vim', title: localize('settings', "Native Vim"), type: 'object', properties: {
		'terminalFirst.vim.engine': { type: 'string', enum: ['native', 'extension', 'off'], default: 'native', description: localize('engineSetting', "Vim engine. Reload required. Native is experimental until acceptance validation is complete.") },
		'terminalFirst.vim.leader': { type: 'string', default: ' ', minLength: 1, maxLength: 1, description: localize('leaderSetting', "Normal-mode leader key.") },
		'terminalFirst.vim.hintDelay': { type: 'number', default: 250, minimum: 0, maximum: 2000, description: localize('hintSetting', "Delay before showing leader hints, in milliseconds.") },
		'terminalFirst.vim.persistRegisters': { type: 'boolean', default: true, description: localize('persistRegistersSetting', "Keep Vim registers, file marks, macros, and the last search across windows and restarts.") },
		'terminalFirst.vim.listActionKeys': { type: 'boolean', default: false, description: localize('listActionKeysSetting', "In view tiles, single keys run row actions: s/u/d stage, unstage, and discard in Changes; r/a/A/d/D/y/x/p rename, create, delete, copy, cut, and paste in Explorer. Delete and discard still confirm. The '.' actions picker is always available.") },
		'terminalFirst.vim.leaderBindings': { type: 'array', default: [], description: localize('leaderBindingsSetting', "Additional code-mode leader shortcuts. Bindings that conflict with existing shortcuts or menu prefixes are ignored."), items: { type: 'object', required: ['keys', 'label', 'command'], additionalProperties: false, properties: { keys: { type: 'string', minLength: 1 }, label: { type: 'string' }, command: { type: 'string', minLength: 1 } } } },
		'terminalFirst.vim.remaps': { type: 'array', default: [], description: localize('remapsSetting', "Nonrecursive mode-specific key mappings."), items: { type: 'object', required: ['mode', 'before'], additionalProperties: false, properties: { mode: { type: 'string', enum: ['normal', 'insert', 'visual', 'visualLine', 'visualBlock', 'operator', 'replace'] }, before: { type: 'array', minItems: 1, items: { type: 'string' } }, after: { type: 'array', items: { type: 'string' } }, command: { type: 'string' } }, oneOf: [{ required: ['after'] }, { required: ['command'] }] } },
	}
});
registerAction2(class extends Action2 {
	constructor() { super({ id: 'terminalFirst.vim.help', title: localize2('help', "Search Native Vim Actions"), f1: true }); }
	run(accessor: ServicesAccessor): void { accessor.get(INativeVimService).execute('help'); }
});
