/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import './filePreview.css';
import { $, append } from '../../../../base/browser/dom.js';
import { Disposable, IReference, MutableDisposable } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { CodeEditorWidget } from '../../../../editor/browser/widget/codeEditor/codeEditorWidget.js';
import { IModelService } from '../../../../editor/common/services/model.js';
import { IResolvedTextEditorModel, ITextModelService } from '../../../../editor/common/services/resolverService.js';
import { localize } from '../../../../nls.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { ITextFileService } from '../../../services/textfile/common/textfiles.js';

/** What the pane shows. Targets compare by identity, so a refreshed stat re-reads the file. */
export interface FilePreviewTarget {
	readonly resource: URI;
	readonly isDirectory?: boolean;
}

/** Files above this size show a placeholder instead of a text model. */
const previewSizeLimit = 1024 * 1024;

/** A read-only preview pane shared by the floating pickers; previewing never opens an editor tab. */
export class FilePreview extends Disposable {
	readonly element: HTMLElement;
	private readonly message: HTMLElement;
	private readonly editorContainer: HTMLElement;
	private readonly editor: CodeEditorWidget;
	private readonly reference = this._register(new MutableDisposable<IReference<IResolvedTextEditorModel>>());
	private generation = 0;
	private target: FilePreviewTarget | undefined;
	/** Set while the pane is hidden with a target it has not loaded. */
	private deferred = false;

	constructor(
		parent: HTMLElement,
		private readonly showHidden: () => boolean = () => false,
		@IInstantiationService instantiationService: IInstantiationService,
		@IFileService private readonly fileService: IFileService,
		@ITextModelService private readonly resolver: ITextModelService,
		@ITextFileService private readonly textFiles: ITextFileService,
		@IModelService private readonly models: IModelService,
	) {
		super();
		this.element = append(parent, $('.terminal-first-preview'));
		const title = append(this.element, $('span.terminal-first-preview-title'));
		title.textContent = localize('previewTitle', "Preview");
		this.message = append(this.element, $('.terminal-first-preview-message'));
		this.editorContainer = append(this.element, $('.terminal-first-preview-editor'));
		this.editorContainer.hidden = true;
		this.editor = this._register(instantiationService.createInstance(CodeEditorWidget, this.editorContainer, {
			readOnly: true, domReadOnly: true, minimap: { enabled: false }, lineNumbers: 'on', scrollBeyondLastLine: false,
			contextmenu: false, renderLineHighlight: 'none', ariaLabel: localize('filePreview', "File Preview"),
		}, { contributions: [] }));
	}

	get hidden(): boolean { return !!this.element.hidden; }

	/** A hidden pane holds no model; it loads its target again when shown. */
	set hidden(value: boolean) {
		if (this.hidden === value) { return; }
		this.element.hidden = value;
		if (value) {
			this.generation++;
			this.showMessage('');
			this.deferred = !!this.target;
		} else if (this.deferred) {
			void this.update(this.target, true);
		}
	}

	/**
	 * Shows `target`. The current contents stay on screen until the new ones are ready,
	 * so moving between rows never flashes a loading state.
	 */
	async update(target: FilePreviewTarget | undefined, force = false): Promise<void> {
		if (target === this.target && !force) { return; }
		this.target = target;
		this.deferred = this.hidden && !!target;
		if (this.hidden) { return; }
		const generation = ++this.generation;
		if (!target) { this.showMessage(''); return; }
		const resource = target.resource;
		try {
			if (target.isDirectory) {
				const directory = await this.fileService.resolve(resource);
				if (generation !== this.generation) { return; }
				const children = (directory.children ?? []).filter(child => this.showHidden() || !child.name.startsWith('.'));
				children.sort((a, b) => Number(b.isDirectory) - Number(a.isDirectory) || a.name.localeCompare(b.name));
				this.showMessage(children.map(child => child.name + (child.isDirectory ? '/' : '')).join('\n') || localize('emptyFolder', "Empty Folder"));
				return;
			}
			const stat = await this.fileService.stat(resource);
			if (generation !== this.generation) { return; }
			const existing = this.models.getModel(resource);
			if (stat.size > previewSizeLimit || (existing && existing.getValueLength() > previewSizeLimit)) {
				this.showMessage(localize('largePreview', "Preview unavailable for files larger than 1 MiB. Press Enter to open."));
				return;
			}
			if (!existing) { await this.textFiles.read(resource, { acceptTextOnly: true, limits: { size: previewSizeLimit } }); }
			if (generation !== this.generation) { return; }
			const reference = await this.resolver.createModelReference(resource);
			if (generation !== this.generation) { reference.dispose(); return; }
			this.editor.setModel(reference.object.textEditorModel);
			this.reference.value = reference;
			this.message.hidden = true;
			this.editorContainer.hidden = false;
			this.layout();
		} catch {
			if (generation === this.generation) { this.showMessage(localize('unavailablePreview', "Preview unavailable: this file is binary, missing, or cannot be read. Press Enter to open.")); }
		}
	}

	/** Drops the current contents and ignores any load still in flight. */
	clear(): void {
		this.target = undefined;
		this.deferred = false;
		this.generation++;
		this.showMessage('');
	}

	private showMessage(text: string): void {
		this.editor.setModel(null);
		this.reference.clear();
		this.editorContainer.hidden = true;
		this.message.hidden = false;
		this.message.textContent = text;
	}

	/** True when keyboard focus is inside the pane. */
	contains(node: Node | null): boolean { return !!node && this.element.contains(node); }

	focus(): void {
		this.message.tabIndex = 0;
		if (this.message.hidden) { this.editor.focus(); } else { this.message.focus(); }
	}

	/** Scrolls by half the pane; positive scrolls down. */
	scroll(direction: 1 | -1): void {
		const delta = direction * this.element.clientHeight / 2;
		this.editor.setScrollTop(this.editor.getScrollTop() + delta);
		this.message.scrollTop += delta;
	}

	layout(): void {
		this.editor.layout({ width: this.editorContainer.clientWidth, height: this.editorContainer.clientHeight });
	}

	override dispose(): void {
		this.clear();
		super.dispose();
	}
}
