/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import './floatingOverlay.css';
import './floatingJumpList.css';
import { $, append, addDisposableListener, EventType, getWindow, trackFocus } from '../../../../base/browser/dom.js';
import { IListRenderer } from '../../../../base/browser/ui/list/list.js';
import { Disposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { localize } from '../../../../nls.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { FileKind } from '../../../../platform/files/common/files.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { WorkbenchList } from '../../../../platform/list/browser/listService.js';
import { IUriIdentityService } from '../../../../platform/uriIdentity/common/uriIdentity.js';
import { DEFAULT_LABELS_CONTAINER, IResourceLabel, ResourceLabels } from '../../../browser/labels.js';
import { IEditorGroupsService } from '../../../services/editor/common/editorGroupsService.js';
import { IWorkbenchLayoutService, Parts } from '../../../services/layout/browser/layoutService.js';
import { TerminalFirstJumpListFocusedContext } from '../../../services/terminalFirst/common/terminalFirstPolicy.js';
import { layoutFloatingOverlay } from './floatingOverlay.js';
import { JumpListModel } from './jumpListModel.js';

/** Native file rows with a small, explicit Vim editing vocabulary. */
export class FloatingJumpList extends Disposable {
	private readonly element: HTMLElement;
	private readonly heading: HTMLElement;
	private readonly message: HTMLElement;
	private readonly listContainer: HTMLElement;
	private readonly list: WorkbenchList<URI>;
	private readonly focusedContext;
	private project: URI | undefined;
	private visible = false;
	private pending = '';
	private generation = 0;
	private opening = false;

	constructor(
		private readonly model: JumpListModel,
		private readonly hide: (focus: boolean) => void,
		private readonly open: (resource: URI) => Promise<boolean>,
		@IInstantiationService instantiation: IInstantiationService,
		@IWorkbenchLayoutService private readonly layoutService: IWorkbenchLayoutService,
		@IEditorGroupsService groups: IEditorGroupsService,
		@IContextKeyService contextKeys: IContextKeyService,
		@IUriIdentityService private readonly identity: IUriIdentityService,
	) {
		super();
		this.element = append(layoutService.mainContainer, $('.terminal-first-jump-list'));
		this.element.hidden = true;
		this.element.setAttribute('role', 'dialog');
		this.element.setAttribute('aria-label', localize('jumpList', "Jump List"));
		this.focusedContext = TerminalFirstJumpListFocusedContext.bindTo(contextKeys);
		const header = append(this.element, $('.jump-list-header'));
		this.heading = append(header, $('span.jump-list-heading'));
		const close = append(header, $<HTMLButtonElement>('button'));
		close.textContent = localize('close', "Close");
		this._register(addDisposableListener(close, EventType.CLICK, () => this.hide(true)));
		this.listContainer = append(this.element, $('.jump-list-rows.show-file-icons'));
		const labels = this._register(instantiation.createInstance(ResourceLabels, DEFAULT_LABELS_CONTAINER));
		const renderer: IListRenderer<URI, { number: HTMLElement; label: IResourceLabel }> = {
			templateId: 'jumpFile',
			renderTemplate: container => {
				container.classList.add('jump-list-row');
				const number = append(container, $('span.jump-list-number'));
				return { number, label: labels.create(container) };
			},
			renderElement: (resource, index, template) => {
				template.number.textContent = String(index + 1);
				template.label.setResource({ resource, name: this.label(resource) }, { fileKind: FileKind.FILE });
			},
			disposeTemplate: template => template.label.dispose(),
		};
		this.list = this._register(instantiation.createInstance(WorkbenchList<URI>, 'FloatingJumpList', this.listContainer,
			{ getHeight: () => 22, getTemplateId: () => 'jumpFile' }, [renderer], {
				identityProvider: { getId: resource => this.identity.extUri.getComparisonKey(resource) },
				accessibilityProvider: { getAriaLabel: resource => this.label(resource), getWidgetAriaLabel: () => localize('jumpFiles', "Jump List Files") },
				multipleSelectionSupport: false, typeNavigationEnabled: false,
			}));
		this.message = append(this.element, $('.jump-list-status'));
		this.message.setAttribute('role', 'status');
		const hints = append(this.element, $('.jump-list-hints'));
		hints.textContent = localize('jumpHints', "j/k Navigate · gg/G First/Last · dd Remove · p/P Put After/Before · u Undo · Ctrl+R Redo · Enter Open · q/Esc Close");
		this._register(this.list.onDidChangeFocus(event => this.list.setSelection([...event.indexes])));
		this._register(this.list.onMouseDblClick(event => { if (event.element) { void this.accept(event.element); } }));
		this._register(addDisposableListener(this.element, EventType.KEY_DOWN, event => this.keydown(event), true));
		const focus = this._register(trackFocus(this.element));
		this._register(focus.onDidFocus(() => this.focusedContext.set(true)));
		this._register(focus.onDidBlur(() => { this.focusedContext.set(false); this.pending = ''; }));
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

	show(project: URI, active?: URI): void {
		this.project = project;
		this.visible = true;
		this.opening = false;
		this.pending = '';
		this.generation++;
		this.element.hidden = false;
		this.heading.textContent = localize('jumpHeading', "Jump List — {0}", project.fsPath);
		this.render(active ? Math.max(0, this.model.indexOf(active)) : 0);
		this.list.domFocus();
	}

	hideList(): void {
		this.visible = false;
		this.generation++;
		this.pending = '';
		this.element.hidden = true;
		this.focusedContext.reset();
	}

	private label(resource: URI): string {
		return this.project && this.identity.extUri.isEqualOrParent(resource, this.project)
			? this.identity.extUri.relativePath(this.project, resource) || resource.fsPath : resource.fsPath;
	}

	private render(index: number): void {
		this.list.splice(0, this.list.length, [...this.model.entries]);
		this.select(index);
		this.message.textContent = this.list.length ? '' : localize('emptyJumpList', "No files yet. Focus a file editor and press Cmd+A to add it.");
		this.layout();
	}

	private select(index: number): void {
		if (!this.list.length) { this.list.setFocus([]); return; }
		index = Math.max(0, Math.min(this.list.length - 1, index));
		this.list.setFocus([index]);
		this.list.reveal(index);
	}

	private keydown(event: KeyboardEvent): void {
		if (event.isComposing || event.keyCode === 229 || event.metaKey || event.altKey) { this.pending = ''; return; }
		if (event.key === 'Escape') { this.hide(true); }
		else if (!this.listContainer.contains(event.target as Node)) { return; }
		else {
			const index = this.list.getFocus()[0] ?? 0;
			const pending = this.pending;
			this.pending = '';
			if (event.ctrlKey) {
				if (event.key !== 'r') { return; }
				this.model.redo(); this.render(index);
			} else if (event.key === 'j' || event.key === 'ArrowDown') { this.select(index + 1);
			} else if (event.key === 'k' || event.key === 'ArrowUp') { this.select(index - 1);
			} else if (event.key === 'G') { this.select(this.list.length - 1);
			} else if (event.key === 'g') { if (pending === 'g') { this.select(0); } else { this.pending = 'g'; }
			} else if (event.key === 'd') { if (pending === 'd') { this.model.remove(index); this.render(index); } else { this.pending = 'd'; }
			} else if (event.key === 'p' || event.key === 'P') { this.render(this.model.put(index, event.key === 'P'));
			} else if (event.key === 'u') { this.model.undo(); this.render(index);
			} else if (event.key === 'q') { this.hide(true);
			} else if (event.key === 'Enter') { const resource = this.model.entries[index]; if (resource) { void this.accept(resource); }
			} else { return; }
		}
		event.preventDefault();
		event.stopPropagation();
	}

	private async accept(resource: URI): Promise<void> {
		if (this.opening || !this.visible) { return; }
		const generation = this.generation;
		this.opening = true;
		try { await this.open(resource); }
		catch (error) { if (this.visible && generation === this.generation) { this.message.textContent = error instanceof Error ? error.message : String(error); } }
		finally { if (generation === this.generation) { this.opening = false; } }
	}

	private layout(): void {
		if (!this.visible) { return; }
		layoutFloatingOverlay(this.element, this.layoutService);
		this.list.layout(this.listContainer.clientHeight, this.listContainer.clientWidth);
	}

	override dispose(): void { this.hideList(); super.dispose(); }
}
