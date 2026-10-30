/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import './floatingOverlay.css';
import './floatingFileBrowser.css';
import { $, append, addDisposableListener, EventType, getWindow, trackFocus } from '../../../../base/browser/dom.js';
import { status } from '../../../../base/browser/ui/aria/aria.js';
import { renderIcon } from '../../../../base/browser/ui/iconLabel/iconLabels.js';
import { InputBox } from '../../../../base/browser/ui/inputbox/inputBox.js';
import { IListRenderer } from '../../../../base/browser/ui/list/list.js';
import { Disposable, MutableDisposable, IReference, toDisposable } from '../../../../base/common/lifecycle.js';
import { dirname, isEqual, isEqualOrParent } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { CodeEditorWidget } from '../../../../editor/browser/widget/codeEditor/codeEditorWidget.js';
import { IModelService } from '../../../../editor/common/services/model.js';
import { IResolvedTextEditorModel, ITextModelService } from '../../../../editor/common/services/resolverService.js';
import { localize } from '../../../../nls.js';
import { StandardKeyboardEvent } from '../../../../base/browser/keyboardEvent.js';
import { KeyCode, KeyMod } from '../../../../base/common/keyCodes.js';
import { IKeybindingService } from '../../../../platform/keybinding/common/keybinding.js';
import { ResultKind } from '../../../../platform/keybinding/common/keybindingResolver.js';
import { KeybindingsRegistry, KeybindingWeight } from '../../../../platform/keybinding/common/keybindingsRegistry.js';
import { IQuickInputService } from '../../../../platform/quickinput/common/quickInput.js';
import { IOpenerService } from '../../../../platform/opener/common/opener.js';
import { IPathService } from '../../../services/path/common/pathService.js';
import { FileBrowserOperations, FileBrowserOperation } from './fileBrowserOperations.js';
import { ContextKeyExpr, IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { FileKind, IFileService, IFileStat } from '../../../../platform/files/common/files.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { WorkbenchList } from '../../../../platform/list/browser/listService.js';
import { defaultInputBoxStyles } from '../../../../platform/theme/browser/defaultStyles.js';
import { DEFAULT_LABELS_CONTAINER, IResourceLabel, ResourceLabels } from '../../../browser/labels.js';
import { IEditorGroupsService } from '../../../services/editor/common/editorGroupsService.js';
import { IWorkbenchLayoutService, Parts } from '../../../services/layout/browser/layoutService.js';
import { TerminalFirstBrowserFocusedContext, TerminalFirstBrowserModeContext } from '../../../services/terminalFirst/common/terminalFirstPolicy.js';
import { ITextFileService } from '../../../services/textfile/common/textfiles.js';
import { FileBrowserEntry, FileBrowserModel } from './fileBrowserModel.js';
import { fileBrowserMarkedIcon, fileBrowserPromptIcon } from '../../../browser/parts/terminalFirst/terminalFirstIcons.js';

const fileBrowserActions: { id: string; label: string; keys: string }[] = [];
/** Matches the workbench list row height so file rows read like the Explorer. */
const fileBrowserRowHeight = 22;
let activeBrowser: FloatingFileBrowser | undefined;

/** A session-owned picker; previewing never opens an editor tab. */
export class FloatingFileBrowser extends Disposable {
	private readonly element: HTMLElement;
	private readonly path: HTMLElement;
	private readonly status: HTMLElement;
	private readonly actionsButton: HTMLButtonElement;
	private readonly operations: FileBrowserOperations;
	private busy = false;
	private lifetime = 0;
	private readonly actions = fileBrowserActions;
	private readonly body: HTMLElement;
	private readonly listContainer: HTMLElement;
	private readonly previewContainer: HTMLElement;
	private readonly previewMessage: HTMLElement;
	private readonly previewEditorContainer: HTMLElement;
	private readonly input: InputBox;
	private readonly list: WorkbenchList<FileBrowserEntry>;
	private readonly preview: CodeEditorWidget;
	private readonly model: FileBrowserModel;
	private readonly reference = this._register(new MutableDisposable<IReference<IResolvedTextEditorModel>>());
	private previewGeneration = 0;
	private previewStat: IFileStat | undefined;
	private visible = false;
	private mode: 'insert' | 'normal' = 'insert';
	private opening = false;
	private readonly focusedContext;
	private readonly modeContext;

	constructor(
		private readonly hide: (focus: boolean) => void,
		private readonly open: (resource: URI) => Promise<boolean>,
		@IInstantiationService instantiationService: IInstantiationService,
		@IWorkbenchLayoutService private readonly layoutService: IWorkbenchLayoutService,
		@IEditorGroupsService groups: IEditorGroupsService,
		@IFileService private readonly fileService: IFileService,
		@ITextModelService private readonly resolver: ITextModelService,
		@ITextFileService private readonly textFiles: ITextFileService,
		@IModelService private readonly models: IModelService,
		@IContextKeyService contextKeys: IContextKeyService,
		@IQuickInputService private readonly quickInput: IQuickInputService,
		@IKeybindingService private readonly keybindings: IKeybindingService,
		@IPathService private readonly paths: IPathService,
		@IOpenerService private readonly opener: IOpenerService,
	) {
		super();
		this.element = append(layoutService.mainContainer, $('.terminal-first-file-browser'));
		this.element.hidden = true;
		this.element.setAttribute('role', 'dialog');
		this.element.setAttribute('aria-label', localize('fileBrowser', "File Browser"));
		this.focusedContext = TerminalFirstBrowserFocusedContext.bindTo(contextKeys);
		this.modeContext = TerminalFirstBrowserModeContext.bindTo(contextKeys);
		this.operations = instantiationService.createInstance(FileBrowserOperations);
		this.body = append(this.element, $('.file-browser-body'));
		const left = append(this.body, $('.file-browser-left'));
		const results = append(left, $('.file-browser-results'));
		this.path = append(results, $('span.file-browser-path'));
		this.listContainer = append(results, $('.file-browser-list.show-file-icons'));
		const prompt = append(left, $('.file-browser-prompt'));
		const prefix = append(prompt, $('span.file-browser-prompt-prefix'));
		append(prefix, renderIcon(fileBrowserPromptIcon));
		prefix.setAttribute('aria-hidden', 'true');
		this.input = this._register(new InputBox(prompt, undefined, { inputBoxStyles: defaultInputBoxStyles, ariaLabel: localize('filterFiles', "Filter Files"), placeholder: localize('filterPlaceholder', "Filter this folder…") }));
		const labels = this._register(instantiationService.createInstance(ResourceLabels, DEFAULT_LABELS_CONTAINER));
		const renderer: IListRenderer<FileBrowserEntry, { label: IResourceLabel; marker: HTMLElement }> = {
			templateId: 'file',
			renderTemplate: container => {
				const marker = append(container, $('span.file-browser-marker'));
				append(marker, renderIcon(fileBrowserMarkedIcon));
				return { marker, label: labels.create(container, { supportHighlights: true }) };
			},
			renderElement: (entry, _index, template) => {
				template.marker.classList.toggle('marked', this.model.marked.has(entry.stat.resource.toString()));
				template.label.setResource({ resource: entry.stat.resource, name: entry.stat.name }, { fileKind: entry.stat.isDirectory ? FileKind.FOLDER : FileKind.FILE, matches: entry.matches });
			},
			disposeTemplate: template => template.label.dispose(),
		};
		this.list = this._register(instantiationService.createInstance(WorkbenchList<FileBrowserEntry>, 'FloatingFileBrowser', this.listContainer,
			{ getHeight: () => fileBrowserRowHeight, getTemplateId: () => 'file' }, [renderer], {
				identityProvider: { getId: entry => entry.stat.resource.toString() },
				accessibilityProvider: { getAriaLabel: entry => this.model.marked.has(entry.stat.resource.toString()) ? localize('markedEntry', "{0}, marked", entry.stat.name) : entry.stat.name, getWidgetAriaLabel: () => localize('files', "Files") },
				multipleSelectionSupport: false, typeNavigationEnabled: false,
			}));
		this.previewContainer = append(this.body, $('.file-browser-preview'));
		const previewTitle = append(this.previewContainer, $('span.file-browser-pane-title'));
		previewTitle.textContent = localize('previewTitle', "Preview");
		this.previewMessage = append(this.previewContainer, $('.file-browser-preview-message'));
		this.previewEditorContainer = append(this.previewContainer, $('.file-browser-preview-editor'));
		this.preview = this._register(instantiationService.createInstance(CodeEditorWidget, this.previewEditorContainer, {
			readOnly: true, domReadOnly: true, minimap: { enabled: false }, lineNumbers: 'on', scrollBeyondLastLine: false,
			contextmenu: false, renderLineHighlight: 'none', ariaLabel: localize('filePreview', "File Preview"),
		}, { contributions: [] }));
		const footer = append(this.element, $('.file-browser-footer'));
		this.status = append(footer, $('.file-browser-status'));
		this.status.setAttribute('role', 'status');
		this.actionsButton = append(footer, $<HTMLButtonElement>('button'));
		this.actionsButton.textContent = localize('browserActions', "Actions / Help");
		this._register(addDisposableListener(this.actionsButton, EventType.CLICK, () => { void this.runAction('help'); }));
		this.model = this._register(instantiationService.createInstance(FileBrowserModel));
		this._register(this.model.onDidChange(() => this.render()));
		this._register(this.input.onDidChange(value => this.model.setQuery(value)));
		this._register(this.list.onDidChangeFocus(event => {
			this.list.setSelection([...event.indexes]);
			if (this.visible && event.elements[0]) { status(event.elements[0].stat.name); }
			this.model.selected = event.elements[0]?.stat.resource;
			void this.updatePreview(event.elements[0]);
		}));
		this._register(this.list.onMouseDblClick(event => { if (event.element) { void this.accept(event.element); } }));
		this._register(addDisposableListener(this.element, EventType.KEY_DOWN, event => this.keydown(event), true));
		const focus = this._register(trackFocus(this.element));
		this._register(focus.onDidFocus(() => this.focusedContext.set(!this.busy)));
		this._register(focus.onDidBlur(() => this.focusedContext.set(false)));
		this._register(layoutService.onDidLayoutMainContainer(() => this.layout()));
		this._register(groups.mainPart.onDidLayout(() => this.layout()));
		const editor = layoutService.getContainer(getWindow(this.element), Parts.EDITOR_PART);
		if (editor) {
			this._register(addDisposableListener(editor, EventType.MOUSE_DOWN, event => {
				const target = event.target;
				if (this.visible && target instanceof getWindow(this.element).Element && !target.closest('.context-view, .suggest-widget, .monaco-hover, .quick-input-widget')) { this.hide(false); }
			}, true));
		}
		this._register(toDisposable(() => this.element.remove()));
	}

	show(root: URI, sessionId = ''): void {
		this.lifetime++;
		activeBrowser = this;
		this.visible = true;
		this.opening = false;
		this.element.hidden = false;
		this.model.show(root, sessionId);
		this.setMode('insert');
		this.layout();
	}

	forgetSession(id: string): void { this.model.forgetSession(id); }

	hideBrowser(): void {
		if (activeBrowser === this) { activeBrowser = undefined; }
		this.lifetime++;
		this.visible = false;
		this.element.hidden = true;
		this.model.hide();
		this.previewStat = undefined;
		this.previewGeneration++;
		this.preview.setModel(null);
		this.reference.clear();
		this.focusedContext.reset();
		this.modeContext.reset();
	}

	private setMode(mode: 'insert' | 'normal'): void {
		this.mode = mode;
		this.modeContext.set(mode);
		this.renderStatus();
		this.input.inputElement.readOnly = mode === 'normal';
		if (mode === 'insert') { this.input.focus(); } else { this.list.domFocus(); }
		this.focusedContext.set(!this.busy && this.element.contains(this.element.ownerDocument.activeElement));
	}


	private keydown(event: KeyboardEvent): void {
		if (event.isComposing || event.keyCode === 229 || this.busy) { event.stopPropagation(); return; }
		if (event.target === this.actionsButton && ['Enter', ' '].includes(event.key)) { return; }
		// Let nonempty Backspace edit text, and preserve normal Option text input unless it resolves to an action.
		if (event.key === 'Backspace' && this.mode === 'insert' && this.input.value) { event.stopPropagation(); return; }
		const resolution = this.keybindings.softDispatch(new StandardKeyboardEvent(event), event.target as HTMLElement);
		if (resolution.kind === ResultKind.KbFound && resolution.commandId?.startsWith('terminalFirst.fileBrowser.')) {
			event.preventDefault();
			event.stopPropagation();
			void this.runAction(resolution.commandId.slice('terminalFirst.fileBrowser.'.length));
		}
	}

	private moveCursor(delta: number): void {
		if (!this.list.length) { return; }
		const index = Math.max(0, Math.min(this.list.length - 1, (this.list.getFocus()[0] ?? this.list.length - 1) + delta));
		this.list.setFocus([index]);
		this.list.reveal(index);
	}

	async runAction(id: string): Promise<void> {
		if (!this.visible || this.busy) { return; }
		const focused = this.list.getFocusedElements()[0];
		const generation = this.lifetime;
		let restoreFocus = false;
		try {
			switch (id) {
				case 'first': this.moveCursor(-this.list.length); return;
				case 'last': this.moveCursor(this.list.length); return;
				case 'down': this.moveCursor(1); return;
				case 'up': this.moveCursor(-1); return;
				case 'mark': case 'markPrevious': this.model.toggleMark(); this.moveCursor(id === 'mark' ? -1 : 1); return;
				case 'all': this.model.toggleAll(); return;
				case 'parent': this.model.parent(); return;
				case 'backspace': if (!this.input.value) { this.model.parent(); } return;
				case 'root': if (this.model.root) { this.model.navigate(this.model.root); } return;
				case 'setRoot': if (focused) { this.model.setRoot(focused.stat.isDirectory ? focused.stat.resource : dirname(focused.stat.resource)); } return;
				case 'browser': this.model.toggleBrowser(); return;
				case 'hidden': this.model.toggleHidden(); this.previewStat = undefined; void this.updatePreview(focused); return;
				case 'insert': case 'filter': this.setMode('insert'); return;
				case 'escape': if (this.mode === 'insert') { this.setMode('normal'); } else { this.hide(true); } return;
				case 'close': this.hide(true); return;
				case 'accept': if (focused) { await this.accept(focused); } return;
				case 'focus': {
					const active = this.element.ownerDocument.activeElement;
					if (active === this.actionsButton) { this.setMode(this.mode); }
					else if (this.previewContainer.contains(active)) { this.actionsButton.focus(); }
					else if (!this.previewContainer.hidden) { this.previewMessage.tabIndex = 0; this.previewMessage.hidden ? this.preview.focus() : this.previewMessage.focus(); }
					else { this.actionsButton.focus(); }
					return;
				}
				case 'previewDown': case 'previewUp': {
					const delta = (id === 'previewDown' ? 1 : -1) * this.previewContainer.clientHeight / 2;
					this.preview.setScrollTop(this.preview.getScrollTop() + delta);
					this.previewMessage.scrollTop += delta;
					return;
				}
			}
			restoreFocus = true;
			this.busy = true;
			this.focusedContext.set(false);
			if (id === 'home') {
				const home = await this.paths.userHome();
				if (generation === this.lifetime) { this.model.navigate(home); }
			} else if (id === 'systemOpen') {
				if (focused) { await this.opener.open(focused.stat.resource, { openExternal: true }); }
			} else if (id === 'help') {
				const selected = await this.quickInput.pick(this.actions.map(action => ({ label: action.label, description: this.keybindings.lookupKeybindings(`terminalFirst.fileBrowser.${action.id}`).map(binding => binding.getLabel()).filter(Boolean).join(' / ') || action.keys, id: action.id })), { placeHolder: localize('browserHelp', "Search File Browser Actions"), matchOnDescription: true });
				this.busy = false;
				if (generation === this.lifetime && selected) { await this.runAction(selected.id); }
			} else if (this.model.directory && ['create', 'createPrompt', 'rename', 'move', 'copy', 'delete'].includes(id)) {
				const sources = this.model.marked.size ? [...this.model.marked.values()] : focused ? [focused.stat] : [];
				const completed = await this.operations.run(id === 'createPrompt' ? 'create' : id as FileBrowserOperation, this.model.directory, sources, this.model.marked.size > 0, id === 'createPrompt' ? this.input.value : undefined, () => generation !== this.lifetime, resource => {
					if (generation === this.lifetime) {
						for (const [key, stat] of this.model.marked) {
							if (isEqualOrParent(stat.resource, resource)) { this.model.marked.delete(key); }
						}
					}
				});
				if (generation === this.lifetime) {
					for (const resource of completed) { this.model.marked.delete(resource.toString()); }
					await this.model.refreshEntries();
				}
			}
		} catch (error) {
			if (generation === this.lifetime) {
				await this.model.refreshEntries();
				this.status.textContent = error instanceof Error ? error.message : String(error);
			}
		} finally {
			this.busy = false;
			if (restoreFocus && generation === this.lifetime && this.visible) { this.focusedContext.set(true); if (this.mode === 'insert') { this.input.focus(); } else { this.list.domFocus(); } }
		}
	}

	private renderStatus(): void {
		const results = this.model.entries.length === 1 ? localize('browserOneResult', "1 result") : localize('browserResults', "{0} results", this.model.entries.length);
		this.status.textContent = this.model.error ?? this.model.notice ?? localize('browserStatus', "{0} · {1} · {2} marked{3}", this.mode === 'insert' ? localize('browserInsertMode', "INSERT") : localize('browserNormalMode', "NORMAL"), results, this.model.marked.size, this.model.loading ? ' · …' : '');
	}

	private render(): void {
		if (!this.visible) { return; }
		this.path.textContent = this.model.browser === 'folders' ? localize('folderFinderTitle', "Folders · {0}", this.model.root?.fsPath ?? '') : this.model.directory?.fsPath ?? '';
		this.path.title = this.path.textContent;
		if (this.input.value !== this.model.query) { this.input.value = this.model.query; }

		const selected = this.model.selected;
		const entries = [...this.model.entries].reverse();
		this.list.splice(0, this.list.length, entries);
		const index = entries.findIndex(entry => isEqual(entry.stat.resource, selected));
		this.list.setFocus(index < 0 ? [] : [index]);
		this.renderStatus();
		if (index >= 0) { this.list.reveal(index); }
		// A refresh may retain the same focus while its file contents have changed.
		void this.updatePreview(entries[index]);
		this.layout();
	}

	private async accept(entry: FileBrowserEntry): Promise<void> {
		if (this.opening || !this.visible) { return; }
		if (entry.stat.isDirectory) { this.model.navigate(entry.stat.resource); return; }
		this.opening = true;
		try { await this.open(entry.stat.resource); }
		catch (error) { if (this.visible) { this.status.textContent = error instanceof Error ? error.message : String(error); } }
		finally { this.opening = false; }
	}

	private async updatePreview(entry: FileBrowserEntry | undefined): Promise<void> {
		if (entry?.stat === this.previewStat) { return; }
		this.previewStat = entry?.stat;
		const generation = ++this.previewGeneration;
		this.preview.setModel(null);
		this.reference.clear();
		this.previewEditorContainer.hidden = true;
		this.previewMessage.hidden = false;
		this.previewMessage.textContent = '';
		if (!entry || !this.visible) { return; }
		const resource = entry.stat.resource;
		this.previewMessage.textContent = localize('loadingPreview', "Loading preview…");
		try {
			if (entry.stat.isDirectory) {
				const directory = await this.fileService.resolve(resource);
				if (generation !== this.previewGeneration) { return; }
				const children = (directory.children ?? []).filter(child => this.model.hidden || !child.name.startsWith('.'));
				children.sort((a, b) => Number(b.isDirectory) - Number(a.isDirectory) || a.name.localeCompare(b.name));
				this.previewMessage.textContent = children.map(child => child.name + (child.isDirectory ? '/' : '')).join('\n') || localize('emptyFolder', "Empty Folder");
				return;
			}
			const stat = await this.fileService.stat(resource);
			if (generation !== this.previewGeneration) { return; }
			const existing = this.models.getModel(resource);
			if (stat.size > 1024 * 1024 || (existing && existing.getValueLength() > 1024 * 1024)) {
				this.previewMessage.textContent = localize('largePreview', "Preview unavailable for files larger than 1 MiB. Press Enter to open.");
				return;
			}
			if (!existing) { await this.textFiles.read(resource, { acceptTextOnly: true, limits: { size: 1024 * 1024 } }); }
			if (generation !== this.previewGeneration) { return; }
			const reference = await this.resolver.createModelReference(resource);
			if (generation !== this.previewGeneration) { reference.dispose(); return; }
			this.reference.value = reference;
			this.preview.setModel(reference.object.textEditorModel);
			this.previewMessage.hidden = true;
			this.previewEditorContainer.hidden = false;
			this.layout();
		} catch {
			if (generation === this.previewGeneration) { this.previewMessage.textContent = localize('unavailablePreview', "Preview unavailable: this file is binary, missing, or cannot be read. Press Enter to open."); }
		}
	}

	private layout(): void {
		if (!this.visible) { return; }
		const editor = this.layoutService.getContainer(getWindow(this.element), Parts.EDITOR_PART);
		if (!editor) { return; }
		const area = editor.getBoundingClientRect();
		const container = this.layoutService.mainContainer.getBoundingClientRect();
		const width = area.width * 0.8;
		const height = area.height * 0.8;
		Object.assign(this.element.style, { width: `${width}px`, height: `${height}px`, left: `${area.left - container.left + (area.width - width) / 2}px`, top: `${area.top - container.top + (area.height - height) / 2}px` });
		this.previewContainer.hidden = width < 600;
		const available = this.listContainer.parentElement!.clientHeight - this.path.offsetHeight;
		this.listContainer.style.height = `${Math.min(available, this.list.length * fileBrowserRowHeight)}px`;
		this.list.layout(this.listContainer.clientHeight, this.listContainer.clientWidth);
		this.preview.layout({ width: this.previewEditorContainer.clientWidth, height: this.previewEditorContainer.clientHeight });
	}

	override dispose(): void { this.hideBrowser(); super.dispose(); }
}

function registerFileBrowserActions(): void {
	const ctrl = KeyMod.WinCtrl;
	const focused = ContextKeyExpr.and(TerminalFirstBrowserFocusedContext, ContextKeyExpr.not('quickInputVisible'));
	const add = (id: string, label: string, keys: string, normal: number | undefined, insert?: number, common?: number[]) => {
		fileBrowserActions.push({ id, label, keys });
		const command = `terminalFirst.fileBrowser.${id}`;
		KeybindingsRegistry.registerCommandAndKeybindingRule({ id: command, weight: KeybindingWeight.ExternalExtension + 1001, when: focused, primary: 0, handler: () => activeBrowser?.runAction(id) });
		for (const [mode, bindings] of [['normal', normal === undefined ? [] : [normal]], ['insert', insert === undefined ? [] : [insert]], ['', common ?? []]] as const) {
			for (const primary of bindings) {
				KeybindingsRegistry.registerKeybindingRule({ id: command, weight: KeybindingWeight.ExternalExtension + 1001, when: mode ? ContextKeyExpr.and(focused, TerminalFirstBrowserModeContext.isEqualTo(mode)) : focused, primary });
			}
		}
	};
	add('first', localize('firstAction', "First Row"), 'gg (Native Vim)', undefined);
	add('last', localize('lastAction', "Last Row"), 'G (Native Vim)', undefined);
	add('parent', localize('parentAction', "Parent Folder"), 'g / Ctrl+G', KeyCode.KeyG, ctrl | KeyCode.KeyG);
	add('home', localize('homeAction', "Home Folder"), 'e / Ctrl+E', KeyCode.KeyE, ctrl | KeyCode.KeyE);
	add('root', localize('rootAction', "Browser Root"), 'w / Ctrl+W', KeyCode.KeyW, ctrl | KeyCode.KeyW);
	add('setRoot', localize('setRootAction', "Set Browser Root"), 't / Ctrl+T', KeyCode.KeyT, ctrl | KeyCode.KeyT);
	add('browser', localize('browserAction', "Toggle Folder Finder"), 'f / Ctrl+F', KeyCode.KeyF, ctrl | KeyCode.KeyF);
	add('hidden', localize('hiddenAction', "Toggle Hidden Files"), 'h / Ctrl+H', KeyCode.KeyH, ctrl | KeyCode.KeyH);
	add('all', localize('allAction', "Toggle All Marks"), 's / Ctrl+S', KeyCode.KeyS, ctrl | KeyCode.KeyS);
	add('systemOpen', localize('systemOpenAction', "Open in Default Application"), 'o / Ctrl+O', KeyCode.KeyO, ctrl | KeyCode.KeyO);
	add('create', localize('createAction', "Create File or Folder"), 'c / Alt+C', KeyCode.KeyC, KeyMod.Alt | KeyCode.KeyC);
	add('rename', localize('renameAction', "Rename"), 'r / Alt+R', KeyCode.KeyR, KeyMod.Alt | KeyCode.KeyR);
	add('move', localize('moveAction', "Move"), 'm / Alt+M', KeyCode.KeyM, KeyMod.Alt | KeyCode.KeyM);
	add('copy', localize('copyAction', "Copy"), 'y / Alt+Y', KeyCode.KeyY, KeyMod.Alt | KeyCode.KeyY);
	add('delete', localize('deleteAction', "Delete"), 'd / Alt+D', KeyCode.KeyD, KeyMod.Alt | KeyCode.KeyD);
	add('down', localize('downAction', "Next Row"), 'j / ↓ / Ctrl+J', KeyCode.KeyJ, undefined, [KeyCode.DownArrow, ctrl | KeyCode.KeyJ]);
	add('up', localize('upAction', "Previous Row"), 'k / ↑ / Ctrl+K', KeyCode.KeyK, undefined, [KeyCode.UpArrow, ctrl | KeyCode.KeyK]);
	add('accept', localize('acceptAction', "Open"), 'Enter', undefined, undefined, [KeyCode.Enter]);
	add('createPrompt', localize('createPromptAction', "Create From Prompt"), 'Shift+Enter', undefined, undefined, [KeyMod.Shift | KeyCode.Enter]);
	add('mark', localize('markAction', "Mark and Advance"), 'Tab', undefined, undefined, [KeyCode.Tab]);
	add('markPrevious', localize('markPreviousAction', "Mark and Reverse"), 'Shift+Tab', undefined, undefined, [KeyMod.Shift | KeyCode.Tab]);
	add('escape', localize('escapeAction', "Normal Mode / Close"), 'Esc', undefined, undefined, [KeyCode.Escape]);
	add('close', localize('closeAction', "Close"), 'q', KeyCode.KeyQ);
	add('insert', localize('insertAction', "Filter"), 'i / /', KeyCode.KeyI);
	add('filter', localize('filterAction', "Focus Filter"), '/', KeyCode.Slash);
	add('backspace', localize('backspaceAction', "Parent When Filter Is Empty"), 'Backspace', undefined, KeyCode.Backspace);
	add('help', localize('helpAction', "Actions and Keyboard Help"), '? / Ctrl+/', KeyMod.Shift | KeyCode.Slash, ctrl | KeyCode.Slash);
	add('focus', localize('focusAction', "Cycle Focus"), 'F6', undefined, undefined, [KeyCode.F6]);
	add('previewDown', localize('previewDownAction', "Scroll Preview Down"), 'Ctrl+D', undefined, undefined, [ctrl | KeyCode.KeyD]);
	add('previewUp', localize('previewUpAction', "Scroll Preview Up"), 'Ctrl+U', undefined, undefined, [ctrl | KeyCode.KeyU]);
}


registerFileBrowserActions();
