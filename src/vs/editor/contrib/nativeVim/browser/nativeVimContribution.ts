/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { $ } from '../../../../base/browser/dom.js';
import { Disposable, MutableDisposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { localize } from '../../../../nls.js';
import { ICodeEditor, IOverlayWidget, OverlayWidgetPositionPreference } from '../../../browser/editorBrowser.js';
import { EditorContributionInstantiation, registerEditorContribution } from '../../../browser/editorExtensions.js';
import { EditorOption } from '../../../common/config/editorOptions.js';
import { Selection } from '../../../common/core/selection.js';
import { Range } from '../../../common/core/range.js';
import { IEditorContribution } from '../../../common/editorCommon.js';
import { IContextKeyService, RawContextKey } from '../../../../platform/contextkey/common/contextkey.js';
import { ICommandService, CommandsRegistry } from '../../../../platform/commands/common/commands.js';
import { ICodeEditorService } from '../../../browser/services/codeEditorService.js';
import { IKeybindingService } from '../../../../platform/keybinding/common/keybinding.js';
import { ResultKind } from '../../../../platform/keybinding/common/keybindingResolver.js';
import { NativeVim } from '../common/nativeVim.js';
import { INativeVimService } from '../common/nativeVimService.js';
import './nativeVim.css';
import { terminalFirstEnabled } from '../../../../platform/terminalFirst/common/terminalFirst.js';

export const NativeVimModeContext = new RawContextKey<string>('nativeVimMode', '');
export const NativeVimActiveContext = new RawContextKey<boolean>('nativeVimActive', false);

/** Thin model adapter. The workbench service owns command routing and window-wide registers. */
export class NativeVimContribution extends Disposable implements IEditorContribution, IOverlayWidget {
	static readonly ID = 'editor.contrib.nativeVim';
	readonly engine: NativeVim;
	private readonly node = $('.native-vim-status');
	private readonly modeContext;
	private readonly activeContext;
	private updating = false;
	private cachedText = '';
	private cachedVersion = -1;
	private readonly transaction = this._register(new MutableDisposable());
	private visualPosition: number | undefined;
	private cursorMode = '';
	private clipboardPending = false;
	private compositionBefore: string | undefined;
	private clipboardGeneration = 0;
	private readonly queuedKeys: string[] = [];
	private readonly originalCursorStyle;

	constructor(
		private readonly editor: ICodeEditor,
		@INativeVimService private readonly vim: INativeVimService,
		@IContextKeyService context: IContextKeyService,
		@ICommandService commands: ICommandService,
		@IKeybindingService keybindings: IKeybindingService,
	) {
		super();
		this.originalCursorStyle = editor.getRawOptions().cursorStyle;
		this.modeContext = NativeVimModeContext.bindTo(context);
		this.activeContext = NativeVimActiveContext.bindTo(context);
		this.engine = new NativeVim({
			text: () => {
				const model = editor.getModel(); if (!model) { return ''; }
				if (this.cachedVersion !== model.getVersionId()) { this.cachedText = model.getValue(); this.cachedVersion = model.getVersionId(); }
				return this.cachedText;
			},
			eol: () => editor.getModel()?.getEOL() ?? '\n',
			document: () => editor.getModel()?.uri.toString() ?? '',
			position: () => this.visualPosition ?? editor.getModel()?.getOffsetAt(editor.getPosition()!) ?? 0,
			readonly: () => editor.getOption(EditorOption.readOnly),
			boundary: () => { if (this.transaction.value) { this.transaction.clear(); } else { this.transaction.value = editor.getModel()?.beginUndoRedoTransaction(); } },
			edit: (start, end, text) => {
				const model = editor.getModel(); if (!model || editor.getOption(EditorOption.readOnly)) { return; }
				this.updating = true;
				try { editor.executeEdits('nativeVim', [{ range: Range.fromPositions(model.getPositionAt(start), model.getPositionAt(end)), text }]); }
				finally { this.updating = false; }
			},
			move: (offset, anchor, line, block) => {
				const model = editor.getModel(); if (!model) { return; }
				this.visualPosition = anchor === undefined ? undefined : offset;
				const position = model.getPositionAt(offset);
				if (anchor === undefined) { editor.setPosition(position, 'nativeVim'); }
				else {
					const from = model.getPositionAt(anchor);
					if (block) {
						const selections: Selection[] = [];
						for (let n = Math.min(from.lineNumber, position.lineNumber); n <= Math.max(from.lineNumber, position.lineNumber); n++) { selections.push(new Selection(n, Math.min(from.column, position.column), n, Math.max(from.column, position.column) + 1)); }
						editor.setSelections(selections, 'nativeVim');
					} else if (line) {
						const first = Math.min(from.lineNumber, position.lineNumber); const last = Math.max(from.lineNumber, position.lineNumber);
						editor.setSelection(new Selection(first, 1, last, model.getLineMaxColumn(last)), 'nativeVim');
					} else {
						const text = model.getValue();
						const inclusiveOffset = offset >= anchor ? offset : anchor;
						const inclusive = model.getPositionAt(inclusiveOffset + ((text.codePointAt(inclusiveOffset) ?? 0) > 0xffff ? 2 : 1));
						editor.setSelection(offset >= anchor ? Selection.fromPositions(from, inclusive) : Selection.fromPositions(inclusive, position), 'nativeVim');
					}
				}
				editor.revealPositionInCenterIfOutsideViewport(position);
			},
			command: (id, argument) => {
				if (id === 'undo' || id === 'redo') { void commands.executeCommand(id); }
				else if (id === 'scroll') { editor.trigger('nativeVim', 'cursorMove', { to: argument === '<C-u>' || argument === '<C-b>' ? 'up' : 'down', by: 'line', value: Math.max(1, Math.floor(editor.getLayoutInfo().height / editor.getOption(EditorOption.lineHeight) / (argument === '<C-d>' || argument === '<C-u>' ? 2 : 1))) }); }
				else { vim.execute(id, argument); }
			}
		}, vim.shared);
		this.node.setAttribute('role', 'status'); this.node.setAttribute('aria-live', 'polite');
		editor.addOverlayWidget(this); this._register(toDisposable(() => editor.removeOverlayWidget(this)));
		this._register(vim.onDidChange(() => this.render()));
		this._register(editor.onDidFocusEditorText(() => { this.engine.reset(); this.render(); }));
		this._register(editor.onDidBlurEditorText(() => { this.clipboardGeneration++; this.clipboardPending = false; this.queuedKeys.length = 0; this.engine.reset(); vim.cancel(); this.render(); }));
		this._register(editor.onDidChangeModel(() => { this.cachedVersion = -1; this.clipboardGeneration++; this.clipboardPending = false; this.queuedKeys.length = 0; this.compositionBefore = undefined; this.engine.reset(); this.transaction.clear(); this.render(); }));
		this._register(editor.onDidChangeModelContent(event => { if (event.isFlush || event.isUndoing || event.isRedoing) { this.engine.reset(); this.transaction.clear(); this.visualPosition = undefined; this.render(); return; } if (!this.updating && this.engine.mode !== 'insert' && this.engine.mode !== 'replace') { this.engine.reset(); } }));
		this._register(editor.onDidChangeCursorSelection(event => {
			if (event.source === 'mouse' && this.engine.mode.startsWith('visual')) { this.engine.reset(); this.visualPosition = undefined; this.render(); }
		}));
		this._register(editor.onKeyDown(event => {
			if (!this.active || event.browserEvent.isComposing || event.browserEvent.keyCode === 229 || event.metaKey || event.altKey) { return; }
			const key = event.browserEvent.key;
			// Let the leader and directional pane shortcuts (including user overrides) reach
			// the workbench before Vim consumes an unknown Control key or a remap.
			if (event.ctrlKey && !event.shiftKey && (key === ' ' || ['h', 'j', 'k', 'l'].includes(key.toLowerCase()))
				&& context.getContextKeyValue('terminalFirstEnabled')
				&& !['terminalFirstShell', 'terminalFirstBrowserVisible', 'terminalFirstFloatingVisible', 'terminalFirstJumpListVisible', 'inQuickOpen'].some(key => context.getContextKeyValue(key))) {
				const resolution = keybindings.softDispatch(event, this.editor.getDomNode()!);
				if (resolution.kind !== ResultKind.NoMatchingKb) { return; }
			}
			if (key === 'Escape' && (context.getContextKeyValue('suggestWidgetVisible') || context.getContextKeyValue('parameterHintsVisible'))) { return; }
			const specialKeys: Record<string, string> = { Escape: '<Esc>', Enter: '<CR>', Backspace: '<BS>', Tab: event.shiftKey ? '<S-Tab>' : '<Tab>' };
			const normalized = event.ctrlKey ? `<C-${key.toLowerCase()}>` : specialKeys[key];
			// Consume Normal-mode printable keys before workbench shortcuts or text input.
			if (!normalized) {
				if (this.engine.mode !== 'insert' && [...key].length === 1 && this.handle(key)) { event.preventDefault(); event.stopPropagation(); }
				return;
			}
			if (this.engine.mode === 'insert' && normalized !== '<Esc>') { if (normalized === '<BS>' || normalized === '<CR>') { this.engine.key(normalized); } return; }
			if (this.handle(normalized)) { event.preventDefault(); event.stopPropagation(); }
		}));
		this.render();
	}
	get composing(): boolean { return this.compositionBefore !== undefined; }
	startComposition(): void { this.compositionBefore = this.editor.getModel()?.getValue(); }
	endComposition(): void {
		const before = this.compositionBefore; this.compositionBefore = undefined;
		const after = this.editor.getModel()?.getValue(); if (before === undefined || after === undefined) { return; }
		let start = 0; while (start < before.length && start < after.length && before[start] === after[start]) { start++; }
		let oldEnd = before.length; let newEnd = after.length;
		while (oldEnd > start && newEnd > start && before[oldEnd - 1] === after[newEnd - 1]) { oldEnd--; newEnd--; }
		this.engine.recordInsertion(after.slice(start, newEnd), [...before.slice(start, oldEnd)].length);
	}
	get active(): boolean { return this.vim.enabled && !this.editor.isSimpleWidget && !!this.editor.getModel() && this.editor.hasTextFocus(); }
	handle(text: string): boolean {
		if (!this.active) { return false; }
		if (this.clipboardPending) { this.queuedKeys.push(text); return true; }
		if ((text === 'p' || text === 'P') && this.engine.clipboardRegister && this.engine.mode === 'normal') {
			this.clipboardPending = true; const generation = ++this.clipboardGeneration;
			void this.vim.readClipboard().then(value => {
				if (generation !== this.clipboardGeneration || !this.active) { return; }
				this.vim.shared.registers.set('+', { text: value, line: value.endsWith('\n') }); this.vim.shared.registers.set('*', { text: value, line: value.endsWith('\n') });
				this.engine.key(text);
			}).catch(() => { this.engine.error = 'clipboardUnavailable'; }).finally(() => {
				if (generation === this.clipboardGeneration) { this.clipboardPending = false; for (const key of this.queuedKeys.splice(0)) { if (!this.handle(key)) { this.editor.trigger('nativeVim', key === '<BS>' ? 'deleteLeft' : 'type', { text: key === '<CR>' ? '\n' : key === '<Tab>' ? '\t' : key }); } } this.render(); }
			});
			return true;
		}
		let handled = true;
		for (const key of text.startsWith('<') && text.endsWith('>') ? [text] : [...text]) {
			if (!this.vim.key(key, this.engine.mode)) { handled = this.engine.key(key); }
		}
		this.render(); return handled;
	}
	private render(): void {
		const active = this.active;
		const cursorMode = active ? this.engine.mode : '';
		if (cursorMode !== this.cursorMode) { this.cursorMode = cursorMode; this.editor.updateOptions({ cursorStyle: !active ? this.originalCursorStyle : this.engine.mode === 'insert' ? 'line' : this.engine.mode === 'replace' ? 'underline' : 'block' }); }
		this.activeContext.set(active); this.modeContext.set(active ? this.engine.mode : '');
		const modes = { normal: localize('normal', "NORMAL"), insert: localize('insert', "INSERT"), replace: localize('replace', "REPLACE"), visual: localize('visual', "VISUAL"), visualLine: localize('visualLine', "VISUAL LINE"), visualBlock: localize('visualBlock', "VISUAL BLOCK"), operator: localize('operator', "OPERATOR"), search: localize('search', "SEARCH"), command: localize('command', "COMMAND") };
		this.node.textContent = active ? [modes[this.engine.mode], this.engine.pending, this.engine.commandLine, this.engine.error ? this.errorMessage(this.engine.error) : ''].filter(Boolean).join(' · ') : '';
		this.node.hidden = !active;
		this.node.classList.toggle('error', !!this.engine.error);
	}
	private errorMessage(error: string): string {
		const messages: Record<string, string> = {
			readOnly: localize('readOnly', "This editor is read-only."),
			invalidMotion: localize('invalidMotion', "This operator needs a supported motion."),
			invalidObject: localize('invalidObject', "No matching text object at the cursor."),
			notFound: localize('notFound', "No search matches."),
			invalidPattern: localize('invalidPattern', "Invalid search expression."),
			recursiveMacro: localize('recursiveMacro', "Macro stopped at the replay limit."),
			clipboardUnavailable: localize('clipboardUnavailable', "The clipboard could not be read."),
		};
		return messages[error] ?? localize('unsupported', "Unsupported Vim command.");
	}
	getId(): string { return NativeVimContribution.ID; }
	getDomNode(): HTMLElement { return this.node; }
	getPosition() { return { preference: OverlayWidgetPositionPreference.BOTTOM_RIGHT_CORNER }; }
}

if (terminalFirstEnabled) {
	registerEditorContribution(NativeVimContribution.ID, NativeVimContribution, EditorContributionInstantiation.BeforeFirstInteraction);
}

// Preserve the default command chain for every editor that does not opt into native Vim.
for (const id of ['type', 'paste', 'compositionStart', 'compositionType', 'replacePreviousChar', 'compositionEnd']) {
	const previous = CommandsRegistry.getCommand(id);
	CommandsRegistry.registerCommand(id, (accessor, args?: { text?: string }) => {
		const editor = accessor.get(ICodeEditorService).getFocusedCodeEditor();
		const contribution = editor?.getContribution<NativeVimContribution>(NativeVimContribution.ID);
		if (contribution?.active) {
			if (id === 'type' && !contribution.composing && typeof args?.text === 'string' && contribution.handle(args.text)) { return; }
			if (id !== 'type' && contribution.engine.mode !== 'insert') {
				if (id === 'paste' && typeof args?.text === 'string') { contribution.handle('i'); contribution.engine.recordInsertion(args.text); previous?.handler(accessor, args); contribution.handle('<Esc>'); }
				return;
			}
			if (id === 'compositionStart') { contribution.startComposition(); }
			if (id === 'paste' && typeof args?.text === 'string') { contribution.engine.recordInsertion(args.text); }
			if (id === 'compositionEnd') { const result = previous?.handler(accessor, args); contribution.endComposition(); return result; }
		}
		return previous?.handler(accessor, args);
	});
}
