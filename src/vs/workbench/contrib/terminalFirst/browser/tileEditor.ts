/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import './tiles.css';
import { $, append, Dimension } from '../../../../base/browser/dom.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { Disposable, DisposableStore, MutableDisposable } from '../../../../base/common/lifecycle.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import { URI } from '../../../../base/common/uri.js';
import { localize } from '../../../../nls.js';
import { WorkbenchToolBar } from '../../../../platform/actions/browser/toolbar.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IEditorOptions } from '../../../../platform/editor/common/editor.js';
import { createDecorator, IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { ServiceCollection } from '../../../../platform/instantiation/common/serviceCollection.js';
import { IStorageService } from '../../../../platform/storage/common/storage.js';
import { ITelemetryService } from '../../../../platform/telemetry/common/telemetry.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { PaneComposite } from '../../../browser/panecomposite.js';
import { EditorPane } from '../../../browser/parts/editor/editorPane.js';
import { EditorInputCapabilities, IEditorOpenContext, IEditorSerializer } from '../../../common/editor.js';
import { EditorInput } from '../../../common/editor/editorInput.js';
import { IViewDescriptorService } from '../../../common/views.js';
import { IEditorGroup, IEditorGroupsService } from '../../../services/editor/common/editorGroupsService.js';
import { EDITOR_TILE_INSET, EDITOR_TILE_MIN_WIDTH } from '../common/tileLayout.js';
import { IWorkbenchLayoutService, Parts } from '../../../services/layout/browser/layoutService.js';
import { viewContainerHosts } from '../../../services/views/browser/viewContainerHost.js';
import { IPaneCompositePartService } from '../../../services/panecomposite/browser/panecomposite.js';

/** Container IDs of the built-in tool tiles; also maps tool tiles persisted before view tiles. */
export const tileViewIds = { explorer: 'workbench.view.explorer', scm: 'workbench.view.scm' } as const;

interface IViewTileOwner {
	/** Called when another tile takes the composite, so this tile drops its references. */
	detach(): void;
}

interface IViewTileComposite {
	readonly composite: PaneComposite;
	/** Stable host element that moves between tiles; its scoped context keys move with it. */
	readonly element: HTMLElement;
	readonly store: DisposableStore;
	owner: IViewTileOwner | undefined;
	references: number;
}

export const IViewTileComposites = createDecorator<ViewTileComposites>('terminalFirstViewTileComposites');

/**
 * One composite per view container per window. Every session may hold a tile for the container,
 * but only the visible tile owns the composite, so singleton-backed views (extension tree views,
 * webview views, the Explorer) are created once and keep their state across session switches.
 */
export class ViewTileComposites extends Disposable {
	declare readonly _serviceBrand: undefined;
	private readonly entries = new Map<string, IViewTileComposite>();
	/** Tile inputs per container, including those of inactive sessions. */
	private readonly references = new Map<string, number>();

	constructor(
		@IInstantiationService private readonly instantiation: IInstantiationService,
		@IPaneCompositePartService private readonly composites: IPaneCompositePartService,
		@IViewDescriptorService private readonly descriptors: IViewDescriptorService,
		@IContextKeyService private readonly contextKeys: IContextKeyService,
	) {
		super();
		this._register(descriptors.onDidChangeViewContainers(({ removed }) => {
			for (const { container } of removed) { this.disposeEntry(container.id); }
		}));
	}

	get(containerId: string): PaneComposite | undefined {
		return this.entries.get(containerId)?.composite;
	}

	retain(containerId: string): void {
		this.references.set(containerId, (this.references.get(containerId) ?? 0) + 1);
	}

	unretain(containerId: string): void {
		const count = (this.references.get(containerId) ?? 0) - 1;
		if (count > 0) { this.references.set(containerId, count); return; }
		this.references.delete(containerId);
		this.disposeEntry(containerId);
	}

	/** Hands the composite to `owner`, creating it on first use. Resolves `undefined` until the container is registered. */
	acquire(containerId: string, owner: IViewTileOwner): IViewTileComposite | undefined {
		let entry = this.entries.get(containerId);
		if (!entry) {
			const container = this.descriptors.getViewContainerById(containerId);
			const location = container && this.descriptors.getViewContainerLocation(container);
			if (location === null || location === undefined) { return undefined; }
			const descriptor = this.composites.getPaneComposite(containerId, location);
			if (!descriptor) { return undefined; }
			const store = new DisposableStore();
			const element = $('.tile-tool-composite');
			const scoped = store.add(this.instantiation.createChild(new ServiceCollection([IContextKeyService, store.add(this.contextKeys.createScoped(element))])));
			const composite = store.add(descriptor.instantiate(scoped));
			composite.create(element);
			entry = { composite, element, store, owner: undefined, references: 0 };
			this.entries.set(containerId, entry);
		}
		if (entry.owner !== owner) {
			entry.owner?.detach();
			entry.owner = owner;
		}
		this.setVisible(entry, true);
		return entry;
	}

	release(containerId: string, owner: IViewTileOwner): void {
		const entry = this.entries.get(containerId);
		if (entry?.owner !== owner) { return; }
		entry.owner = undefined;
		this.setVisible(entry, false);
		entry.element.remove();
	}

	private setVisible(entry: IViewTileComposite, visible: boolean): void {
		if (entry.composite.isVisible() !== visible) {
			entry.composite.setVisible(visible);
			viewContainerHosts.setVisible(entry.composite.getId(), visible);
		}
	}

	private disposeEntry(containerId: string): void {
		const entry = this.entries.get(containerId);
		if (!entry) { return; }
		this.entries.delete(containerId);
		entry.owner?.detach();
		this.setVisible(entry, false);
		for (const view of entry.composite.getViewPaneContainer()?.panes ?? []) { view.saveState(); }
		entry.element.remove();
		entry.store.dispose();
	}

	override dispose(): void {
		for (const id of [...this.entries.keys()]) { this.disposeEntry(id); }
		super.dispose();
	}
}

/** A tile that hosts one view container (built-in or contributed by an extension) for one session. */
export class ViewTileInput extends EditorInput {
	static readonly ID = 'terminalFirst.toolTile';
	override readonly typeId = ViewTileInput.ID;
	override readonly resource: URI;
	private readonly containerInfo = this._register(new MutableDisposable());
	override get capabilities(): EditorInputCapabilities {
		return EditorInputCapabilities.Readonly | EditorInputCapabilities.Singleton | EditorInputCapabilities.RequiresDedicatedGroup | EditorInputCapabilities.ExcludeFromEditorLimit;
	}

	constructor(
		readonly containerId: string,
		readonly sessionId: string,
		@IViewDescriptorService private readonly descriptors: IViewDescriptorService,
		@IViewTileComposites private readonly composites: ViewTileComposites,
	) {
		super();
		this.resource = URI.from({ scheme: 'terminal-first-tile', authority: 'view', path: `/${sessionId}/${encodeURIComponent(containerId)}` });
		composites.retain(containerId);
		this._register(descriptors.onDidChangeViewContainers(() => this.trackContainer()));
		this.trackContainer();
	}

	private get model() {
		const container = this.descriptors.getViewContainerById(this.containerId);
		return container ? this.descriptors.getViewContainerModel(container) : undefined;
	}

	/** Extension containers register after editors restore, so the label follows registration. */
	private trackContainer(): void {
		this.containerInfo.value = this.model?.onDidChangeContainerInfo(() => this._onDidChangeLabel.fire());
		this._onDidChangeLabel.fire();
	}

	override getName(): string { return this.model?.title ?? localize('viewTile', "View"); }
	override getIcon(): ThemeIcon | undefined {
		const icon = this.model?.icon;
		return ThemeIcon.isThemeIcon(icon) ? icon : undefined;
	}
	override matches(other: EditorInput): boolean {
		return other instanceof ViewTileInput && other.containerId === this.containerId && other.sessionId === this.sessionId;
	}
	override dispose(): void {
		if (!this.isDisposed()) { this.composites.unretain(this.containerId); }
		super.dispose();
	}
}

export class ViewTileSerializer implements IEditorSerializer {
	canSerialize(input: EditorInput): boolean { return input instanceof ViewTileInput; }
	serialize(input: ViewTileInput): string { return JSON.stringify({ containerId: input.containerId, sessionId: input.sessionId }); }
	deserialize(instantiationService: IInstantiationService, value: string): ViewTileInput | undefined {
		try {
			const data = JSON.parse(value) as { containerId?: string; kind?: string; sessionId?: string };
			// Unknown container IDs are kept: extension containers register after editors restore.
			const containerId = typeof data.containerId === 'string' ? data.containerId : data.kind === 'explorer' || data.kind === 'scm' ? tileViewIds[data.kind] : undefined;
			if (containerId && typeof data.sessionId === 'string') {
				return instantiationService.createInstance(ViewTileInput, containerId, data.sessionId);
			}
		} catch { /* Invalid persisted input is omitted, like other unrestorable editors. */ }
		return undefined;
	}
}

/** Matches the view pane header height; keep in sync with `.tile-tool-actions` in tiles.css. */
const toolTileHeaderHeight = 22;

/** Shows the window's composite for the input's container, including its menus and view-service event wiring. */
export class ViewTileEditor extends EditorPane implements IViewTileOwner {
	static readonly ID = 'terminalFirst.toolTileEditor';
	private element!: HTMLElement;
	private readonly content = this._register(new DisposableStore());
	private dimension = new Dimension(0, 0);
	private composite: PaneComposite | undefined;
	private containerId: string | undefined;
	get viewContainer(): PaneComposite | undefined { return this.composite; }
	override get minimumWidth(): number { return EDITOR_TILE_MIN_WIDTH - EDITOR_TILE_INSET * 2; }
	override get minimumHeight(): number { return 150; }

	constructor(
		group: IEditorGroup,
		@ITelemetryService telemetry: ITelemetryService,
		@IThemeService theme: IThemeService,
		@IStorageService storage: IStorageService,
		@IInstantiationService private readonly instantiation: IInstantiationService,
		@IViewTileComposites private readonly composites: ViewTileComposites,
		@IViewDescriptorService descriptors: IViewDescriptorService,
		@IWorkbenchLayoutService private readonly layoutService: IWorkbenchLayoutService,
		@IEditorGroupsService private readonly groups: IEditorGroupsService,
	) {
		super(ViewTileEditor.ID, group, telemetry, theme, storage);
		this._register(layoutService.onDidChangePartVisibility(() => this.updateVisibility()));
		this._register(groups.onDidChangeActiveGroup(() => this.updateVisibility()));
		this._register(descriptors.onDidChangeViewContainers(() => this.updateVisibility()));
		this._register(descriptors.onDidChangeContainerLocation(() => this.updateVisibility()));
	}

	protected createEditor(parent: HTMLElement): void {
		this.element = append(parent, $('.terminal-first-tool-tile'));
	}

	override async setInput(input: ViewTileInput, options: IEditorOptions | undefined, context: IEditorOpenContext, token: CancellationToken): Promise<void> {
		this.releaseComposite();
		await super.setInput(input, options, context, token);
		if (!token.isCancellationRequested) { this.updateVisibility(); }
	}

	override setVisible(visible: boolean): void {
		super.setVisible(visible);
		this.updateVisibility();
	}

	private updateVisibility(): void {
		const visible = this.isVisible() && this.groups.mainPart.groups.includes(this.group) && this.layoutService.isVisible(Parts.EDITOR_PART, this.window);
		if (!visible) { this.releaseComposite(); return; }
		if (this.composite || !(this.input instanceof ViewTileInput) || !this.element) { return; }
		const containerId = this.input.containerId;
		const entry = this.composites.acquire(containerId, this);
		if (!entry) {
			if (!this.element.hasChildNodes()) {
				append(this.element, $('.tile-tool-placeholder', undefined, localize('waitingForView', "Waiting for {0}…", this.input.getName())));
			}
			return;
		}
		this.element.replaceChildren();
		const composite = this.composite = entry.composite;
		this.containerId = containerId;
		const header = append(this.element, $('.tile-tool-actions'));
		const body = append(this.element, $('.tile-tool-body'));
		body.appendChild(entry.element);
		const toolbar = this.content.add(this.instantiation.createInstance(WorkbenchToolBar, header, {
			actionViewItemProvider: (action, options) => composite.getActionViewItem(action, options),
			actionRunner: composite.getActionRunner(),
		}));
		const updateActions = () => {
			toolbar.context = composite.getActionsContext();
			toolbar.setActions([...composite.getActions()], [...composite.getSecondaryActions()]);
		};
		this.content.add(composite.onTitleAreaUpdate(updateActions));
		updateActions();
		this.layout(this.dimension);
	}

	/** Another tile took the composite, or its container was removed. */
	detach(): void {
		this.composite = undefined;
		this.containerId = undefined;
		this.content.clear();
		this.element?.replaceChildren();
	}

	private releaseComposite(): void {
		if (this.containerId) { this.composites.release(this.containerId, this); }
		this.detach();
	}

	override clearInput(): void { this.releaseComposite(); super.clearInput(); }
	override focus(): void { super.focus(); this.composite?.focus(); }
	layout(dimension: Dimension): void {
		this.dimension = dimension;
		this.element.style.height = `${dimension.height}px`;
		this.composite?.layout(new Dimension(dimension.width, Math.max(0, dimension.height - toolTileHeaderHeight)));
	}
	override dispose(): void { this.releaseComposite(); super.dispose(); }
}
