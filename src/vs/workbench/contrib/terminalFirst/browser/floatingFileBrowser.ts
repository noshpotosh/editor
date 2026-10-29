/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import './floatingFileBrowser.css';
import { $, append, addDisposableListener, EventType, getWindow, trackFocus } from '../../../../base/browser/dom.js';
import { status } from '../../../../base/browser/ui/aria/aria.js';
import { InputBox } from '../../../../base/browser/ui/inputbox/inputBox.js';
import { IListRenderer } from '../../../../base/browser/ui/list/list.js';
import { Disposable, MutableDisposable, IReference, toDisposable } from '../../../../base/common/lifecycle.js';
import { isEqual } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { CodeEditorWidget } from '../../../../editor/browser/widget/codeEditor/codeEditorWidget.js';
import { IModelService } from '../../../../editor/common/services/model.js';
import { IResolvedTextEditorModel, ITextModelService } from '../../../../editor/common/services/resolverService.js';
import { localize } from '../../../../nls.js';
import { layoutFloatingOverlay } from './floatingOverlay.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
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

/** A session-owned picker; previewing never opens an editor tab. */
export class FloatingFileBrowser extends Disposable {
	private readonly element: HTMLElement;
	private readonly path: HTMLElement;
	private readonly status: HTMLElement;
	private readonly hints: HTMLElement;
	private readonly body: HTMLElement;
	private readonly listContainer: HTMLElement;
	private readonly previewContainer: HTMLElement;
	private readonly previewMessage: HTMLElement;
	private readonly previewEditorContainer: HTMLElement;
	private readonly hiddenButton: HTMLButtonElement;
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
	) {
		super();
		this.element = append(layoutService.mainContainer, $('.terminal-first-file-browser'));
		this.element.hidden = true;
		this.element.setAttribute('role', 'dialog');
		this.element.setAttribute('aria-label', localize('fileBrowser', "File Browser"));
		this.focusedContext = TerminalFirstBrowserFocusedContext.bindTo(contextKeys);
		this.modeContext = TerminalFirstBrowserModeContext.bindTo(contextKeys);
		const header = append(this.element, $('.file-browser-header'));
		this.path = append(header, $('span.file-browser-path'));
		const button = (text: string, run: () => void) => {
			const button = append(header, $<HTMLButtonElement>('button'));
			button.textContent = text;
			this._register(addDisposableListener(button, EventType.CLICK, run));
			return button;
		};
		button(localize('parent', "Parent"), () => this.model.parent());
		button(localize('sessionFolder', "Session Folder"), () => { if (this.model.root) { this.model.navigate(this.model.root); } });
		this.hiddenButton = button(localize('hiddenFiles', "Hidden Files"), () => this.model.toggleHidden());
		button(localize('close', "Close"), () => this.hide(true));
		this.body = append(this.element, $('.file-browser-body'));
		const left = append(this.body, $('.file-browser-left'));
		this.input = this._register(new InputBox(left, undefined, { inputBoxStyles: defaultInputBoxStyles, ariaLabel: localize('filterFiles', "Filter Files"), placeholder: localize('filterPlaceholder', "Filter this folder…") }));
		this.listContainer = append(left, $('.file-browser-list.show-file-icons'));
		const labels = this._register(instantiationService.createInstance(ResourceLabels, DEFAULT_LABELS_CONTAINER));
		const renderer: IListRenderer<FileBrowserEntry, IResourceLabel> = {
			templateId: 'file',
			renderTemplate: container => labels.create(container, { supportHighlights: true }),
			renderElement: (entry, _index, label) => label.setResource({ resource: entry.stat.resource, name: entry.stat.name }, { fileKind: entry.stat.isDirectory ? FileKind.FOLDER : FileKind.FILE, matches: entry.matches }),
			disposeTemplate: label => label.dispose(),
		};
		this.list = this._register(instantiationService.createInstance(WorkbenchList<FileBrowserEntry>, 'FloatingFileBrowser', this.listContainer,
			{ getHeight: () => 24, getTemplateId: () => 'file' }, [renderer], {
				identityProvider: { getId: entry => entry.stat.resource.toString() },
				accessibilityProvider: { getAriaLabel: entry => entry.stat.name, getWidgetAriaLabel: () => localize('files', "Files") },
				multipleSelectionSupport: false, typeNavigationEnabled: false,
			}));
		this.previewContainer = append(this.body, $('.file-browser-preview'));
		this.previewMessage = append(this.previewContainer, $('.file-browser-preview-message'));
		this.previewEditorContainer = append(this.previewContainer, $('.file-browser-preview-editor'));
		this.preview = this._register(instantiationService.createInstance(CodeEditorWidget, this.previewEditorContainer, {
			readOnly: true, domReadOnly: true, minimap: { enabled: false }, lineNumbers: 'on', scrollBeyondLastLine: false,
			contextmenu: false, renderLineHighlight: 'none', ariaLabel: localize('filePreview', "File Preview"),
		}, { contributions: [] }));
		this.status = append(this.element, $('.file-browser-status'));
		this.status.setAttribute('role', 'status');
		this.hints = append(this.element, $('.file-browser-hints'));
		this.hints.setAttribute('aria-live', 'polite');
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
		this._register(focus.onDidFocus(() => this.focusedContext.set(true)));
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

	show(root: URI): void {
		this.visible = true;
		this.opening = false;
		this.element.hidden = false;
		this.model.show(root);
		this.setMode('insert');
		this.layout();
	}

	hideBrowser(): void {
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
		this.hints.textContent = mode === 'insert'
			? localize('insertHints', "INSERT · ↑↓ / Ctrl+J/K Navigate · Enter Open · Esc Normal Mode")
			: localize('normalHints', "NORMAL · j/k Navigate · h Parent · l Open · w Session Folder · . Hidden · i Filter · q/Esc Close");
		this.input.inputElement.readOnly = mode === 'normal';
		if (mode === 'insert') { this.input.focus(); } else { this.list.domFocus(); }
	}

	private keydown(event: KeyboardEvent): void {
		if (event.isComposing || event.keyCode === 229 || event.metaKey || event.altKey) { return; }
		const target = event.target;
		const inPicker = target === this.input.inputElement || (target instanceof getWindow(this.element).Node && this.listContainer.contains(target));
		if (event.key === 'Escape') {
			if (this.mode === 'insert') { this.setMode('normal'); } else { this.hide(true); }
		} else if (!inPicker) { return;
		} else if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || (event.ctrlKey && ['j', 'k'].includes(event.key)) || (this.mode === 'normal' && !event.ctrlKey && ['j', 'k'].includes(event.key))) {
			const down = event.key === 'ArrowDown' || event.key === 'j';
			const index = Math.max(0, Math.min(this.list.length - 1, (this.list.getFocus()[0] ?? 0) + (down ? 1 : -1)));
			if (this.list.length) { this.list.setFocus([index]); this.list.reveal(index); }
		} else if (event.ctrlKey) { return;
		} else if (event.key === 'Enter' || (this.mode === 'normal' && event.key === 'l')) {
			const entry = this.list.getFocusedElements()[0];
			if (entry) { void this.accept(entry); }
		} else if ((this.mode === 'insert' && event.key === 'Backspace' && !this.input.value) || (this.mode === 'normal' && event.key === 'h')) {
			this.model.parent();
		} else if (this.mode === 'normal' && ['i', '/'].includes(event.key)) { this.setMode('insert');
		} else if (this.mode === 'normal' && event.key === 'w' && this.model.root) { this.model.navigate(this.model.root);
		} else if (this.mode === 'normal' && event.key === '.') { this.model.toggleHidden();
		} else if (this.mode === 'normal' && event.key === 'q') { this.hide(true);
		} else { return; }
		event.preventDefault();
		event.stopPropagation();
	}

	private render(): void {
		if (!this.visible) { return; }
		this.path.textContent = this.model.directory?.fsPath ?? '';
		if (this.input.value !== this.model.query) { this.input.value = this.model.query; }
		this.hiddenButton.setAttribute('aria-pressed', String(this.model.hidden));
		const selected = this.model.selected;
		this.list.splice(0, this.list.length, this.model.entries);
		const index = this.model.entries.findIndex(entry => isEqual(entry.stat.resource, selected));
		this.list.setFocus(index < 0 ? [] : [index]);
		this.status.textContent = this.model.error ?? (this.model.loading ? localize('loading', "Loading…") : this.list.length ? localize('fileCount', "{0} items", this.list.length) : localize('empty', "No matching files or folders."));
		// A refresh may retain the same focus while its file contents have changed.
		void this.updatePreview(this.model.entries[index]);
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
		if (entry.stat.isDirectory) {
			this.previewMessage.textContent = localize('folderPreview', "Folder\n{0}", resource.fsPath);
			return;
		}
		this.previewMessage.textContent = localize('loadingPreview', "Loading preview…");
		try {
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
		const width = layoutFloatingOverlay(this.element, this.layoutService);
		this.previewContainer.hidden = width < 600;
		this.list.layout(this.listContainer.clientHeight, this.listContainer.clientWidth);
		this.preview.layout({ width: this.previewEditorContainer.clientWidth, height: this.previewEditorContainer.clientHeight });
	}

	override dispose(): void { this.hideBrowser(); super.dispose(); }
}
