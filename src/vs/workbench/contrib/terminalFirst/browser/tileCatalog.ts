/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Codicon } from '../../../../base/common/codicons.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import { URI } from '../../../../base/common/uri.js';
import { localize } from '../../../../nls.js';
import { ExtensionIdentifier } from '../../../../platform/extensions/common/extensions.js';
import { ICustomViewDescriptor, IViewContainerModel, IViewDescriptor, IViewDescriptorService, ViewContainer, ViewContainerLocation } from '../../../common/views.js';
import { IExtensionService } from '../../../services/extensions/common/extensions.js';
import { IPaneCompositePartService } from '../../../services/panecomposite/browser/panecomposite.js';
import { TERMINAL_VIEW_ID } from '../../terminal/common/terminal.js';

/** The sections of the New Tile picker, in display order. */
export const enum TileGroup {
	Workspace = 'workspace',
	Tools = 'tools',
	Web = 'web',
	Extensions = 'extensions',
}

export const tileGroupLabels: Record<TileGroup, string> = {
	[TileGroup.Workspace]: localize('tileGroupWorkspace', "Workspace"),
	[TileGroup.Tools]: localize('tileGroupTools', "Tools"),
	[TileGroup.Web]: localize('tileGroupWeb', "Web"),
	[TileGroup.Extensions]: localize('tileGroupExtensions', "Extensions"),
};

/** What a picker row opens. */
export type TileCatalogTarget =
	| { readonly kind: 'editor' }
	| { readonly kind: 'terminal' }
	| { readonly kind: 'web'; readonly app: string }
	| { readonly kind: 'container'; readonly id: string }
	| { readonly kind: 'view'; readonly id: string }
	| { readonly kind: 'views'; readonly ids: readonly string[] };

export interface ITileCatalogEntry {
	readonly group: TileGroup;
	/** Never empty; falls back through the container title, the first view's name, and the ID. */
	readonly label: string;
	/** What opens, so the picker reads as a list of things rather than names. */
	readonly description: string;
	readonly icon: ThemeIcon | { readonly dark: URI; readonly light?: URI };
	/** The command whose keybinding the row shows, when one exists. */
	readonly command?: string;
	readonly target: TileCatalogTarget;
}

/** View container locations whose containers open as tiles; the terminal container stays the shell surface. */
export const tiledLocations = [ViewContainerLocation.Sidebar, ViewContainerLocation.Panel, ViewContainerLocation.AuxiliaryBar] as const;

/** Built-in containers shown under Tools, in this order; other built-ins follow in registration order. */
const toolOrder = ['workbench.view.explorer', 'workbench.view.scm', 'workbench.view.search', 'workbench.panel.markers', 'workbench.panel.output', 'workbench.panel.repl', 'workbench.view.debug', 'workbench.view.extensions'];

/** Commands that open a built-in container directly, so the row can show their chord. */
const toolCommands: Record<string, string> = { 'workbench.view.explorer': 'terminalFirst.tile.explorer', 'workbench.view.scm': 'terminalFirst.tile.scm' };

const toolDescriptions: Record<string, string> = {
	'workbench.view.explorer': localize('describeExplorer', "Files in the workspace"),
	'workbench.view.scm': localize('describeScm', "Source control changes"),
	'workbench.view.search': localize('describeSearch', "Find and replace in files"),
	'workbench.panel.markers': localize('describeProblems', "Errors and warnings"),
	'workbench.panel.output': localize('describeOutput', "Output channels"),
	'workbench.panel.repl': localize('describeDebugConsole', "Debug console"),
	'workbench.view.debug': localize('describeDebug', "Run and debug"),
	'workbench.view.extensions': localize('describeExtensions', "Browse and manage extensions"),
};

/** A readable name for a view container, including moved extension views that share one tile. */
export function viewContainerDisplayName(container: ViewContainer, model: IViewContainerModel | undefined, services?: Pick<ITileCatalogServices, 'descriptors' | 'extensions'>): string {
	if (services && model && isGeneratedContainer(container)) {
		const sharedExtension = sharedExtensionGroup(model.allViewDescriptors, services.descriptors);
		if (sharedExtension) { return extensionGroupLabel(sharedExtension, services); }
	}
	// A container generated for a single moved view is named after that view, not after the container it came from.
	const single = model?.activeViewDescriptors.length === 1 ? model.activeViewDescriptors[0] : undefined;
	if (single && isGeneratedContainer(container)) {
		return single.singleViewPaneContainerTitle || single.name.value;
	}
	const title = model?.title || (typeof container.title === 'string' ? container.title : container.title?.value);
	return title || single?.name.value || container.id;
}

/** Containers the view descriptor service creates when a view is moved out on its own. */
function isGeneratedContainer(container: ViewContainer): boolean {
	return container.id.startsWith('workbench.views.service');
}

/** The container's icon, falling back through the model, the descriptor, and a generic layout glyph. */
export function viewContainerIcon(container: ViewContainer, model: IViewContainerModel | undefined): ThemeIcon | { readonly dark: URI; readonly light?: URI } {
	const icon = model?.icon ?? container.icon;
	if (ThemeIcon.isThemeIcon(icon)) {
		return icon;
	}
	if (URI.isUri(icon)) {
		return { dark: icon };
	}
	return Codicon.layout;
}

export interface ITileCatalogServices {
	readonly descriptors: IViewDescriptorService;
	readonly composites: IPaneCompositePartService;
	readonly extensions: Pick<IExtensionService, 'extensions'>;
	/** Web app tiles, in display order. */
	readonly webApps: readonly { readonly id: string; readonly label: string; readonly configuredUrl: string | undefined }[];
}

/** Builds the New Tile picker rows. `viewsOnly` keeps only Tools and Extensions. */
export function buildTileCatalog({ descriptors, composites, extensions: extensionService, webApps }: ITileCatalogServices, viewsOnly = false): ITileCatalogEntry[] {
	const nameServices = { descriptors, extensions: extensionService };
	const groupedViews = extensionViewGroups(descriptors, true).filter(group => group.views.length > 1);
	const availableContainers: ViewContainer[] = [];
	const entries: ITileCatalogEntry[] = [];
	if (!viewsOnly) {
		entries.push(
			{ group: TileGroup.Workspace, label: localize('editorTile', "Editor"), description: localize('describeEditor', "Empty editor tile"), icon: Codicon.file, target: { kind: 'editor' } },
			{ group: TileGroup.Workspace, label: localize('terminalTile', "Terminal"), description: localize('describeTerminal', "Shell in the session directory"), icon: Codicon.terminal, command: 'terminalFirst.tile.terminal', target: { kind: 'terminal' } },
		);
	}
	const tools: ITileCatalogEntry[] = [];
	const extensions: ITileCatalogEntry[] = [];
	for (const location of tiledLocations) {
		const visibleOrder = composites.getVisiblePaneCompositeIds(location);
		const containers = [...descriptors.getViewContainersByLocation(location)].sort((a, b) => rank(a.id, visibleOrder) - rank(b.id, visibleOrder));
		for (const container of containers) {
			const model = descriptors.getViewContainerModel(container);
			if (container.id === TERMINAL_VIEW_ID || !model.activeViewDescriptors.length || (container.hideIfEmpty && !model.visibleViewDescriptors.length)) {
				continue;
			}
			availableContainers.push(container);
			const sharedExtension = isGeneratedContainer(container) && sharedExtensionGroup(model.allViewDescriptors, descriptors);
			const builtIn = !container.extensionId && !sharedExtension;
			const label = viewContainerDisplayName(container, model, nameServices);
			const icon = viewContainerIcon(container, model);
			const list = builtIn ? tools : extensions;
			list.push({
				group: builtIn ? TileGroup.Tools : TileGroup.Extensions,
				label,
				description: sharedExtension ? describeGroupedViews(sharedExtension.views) : toolDescriptions[container.id] ?? (builtIn ? localize('describeBuiltInView', "View") : localize('describeExtensionView', "Extension view")),
				icon,
				command: toolCommands[container.id],
				target: { kind: 'container', id: container.id },
			});
			if (model.activeViewDescriptors.length > 1) {
				for (const view of model.activeViewDescriptors.filter(view => view.canMoveView)) {
					list.push({
						group: builtIn ? TileGroup.Tools : TileGroup.Extensions,
						label: localize('viewInContainer', "{0} › {1}", label, view.name.value),
						description: localize('describeSingleView', "Single view in its own tile"),
						icon: ThemeIcon.isThemeIcon(view.containerIcon) ? view.containerIcon : icon,
						target: { kind: 'view', id: view.id },
					});
				}
			}
		}
	}
	for (const group of groupedViews) {
		const ids = new Set(group.views.map(view => view.id));
		// A whole-container row already opens this exact group. Dormant unrelated views still count.
		if (availableContainers.some(container => {
			const views = descriptors.getViewContainerModel(container).allViewDescriptors;
			return views.length === ids.size && views.every(view => ids.has(view.id));
		})) { continue; }
		const icon = group.views[0].containerIcon;
		extensions.push({
			group: TileGroup.Extensions,
			label: extensionGroupLabel(group, nameServices),
			description: describeGroupedViews(group.views),
			icon: ThemeIcon.isThemeIcon(icon) ? icon : URI.isUri(icon) ? { dark: icon } : viewContainerIcon(group.container, descriptors.getViewContainerModel(group.container)),
			target: { kind: 'views', ids: [...ids] },
		});
	}
	tools.sort((a, b) => rank(containerIdOf(a), toolOrder) - rank(containerIdOf(b), toolOrder));
	entries.push(...tools);
	if (!viewsOnly) {
		for (const app of webApps) {
			entries.push({ group: TileGroup.Web, label: app.label, description: app.configuredUrl ?? localize('describeWebApp', "Asks for the URL the first time"), icon: Codicon.globe, command: `terminalFirst.tile.${app.id}`, target: { kind: 'web', app: app.id } });
		}
	}
	entries.push(...extensions);
	return entries;
}

interface IExtensionViewGroup {
	readonly extensionId: ExtensionIdentifier;
	readonly container: ViewContainer;
	readonly views: IViewDescriptor[];
}

function describeGroupedViews(views: readonly IViewDescriptor[]): string {
	return localize('describeGroupedViews', "Views in one tile: {0}", views.map(view => view.name.value).join(', '));
}

function extensionGroupOf(view: IViewDescriptor, descriptors: IViewDescriptorService): IExtensionViewGroup | undefined {
	const extensionId = (view as Partial<ICustomViewDescriptor>).extensionId;
	const container = extensionId && descriptors.getDefaultContainerById(view.id);
	return extensionId && container && container.id !== TERMINAL_VIEW_ID ? { extensionId, container, views: [view] } : undefined;
}

/** Groups follow their original contribution container even after individual views have moved. */
function extensionViewGroups(descriptors: IViewDescriptorService, activeOnly: boolean): IExtensionViewGroup[] {
	const groups = new Map<string, IExtensionViewGroup>();
	for (const location of tiledLocations) {
		for (const container of descriptors.getViewContainersByLocation(location)) {
			if (container.id === TERMINAL_VIEW_ID) { continue; }
			const model = descriptors.getViewContainerModel(container);
			for (const view of activeOnly ? model.activeViewDescriptors : model.allViewDescriptors) {
				if (!view.canMoveView) { continue; }
				const group = extensionGroupOf(view, descriptors);
				if (!group) { continue; }
				const key = JSON.stringify([ExtensionIdentifier.toKey(group.extensionId), group.container.id]);
				const existing = groups.get(key);
				if (existing) { existing.views.push(view); } else { groups.set(key, group); }
			}
		}
	}
	for (const group of groups.values()) {
		group.views.sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.id.localeCompare(b.id));
	}
	return [...groups.values()];
}

/** Only a container wholly owned by one original extension group gets the extension's name. */
function sharedExtensionGroup(views: readonly IViewDescriptor[], descriptors: IViewDescriptorService): IExtensionViewGroup | undefined {
	if (views.length < 2) { return undefined; }
	const group = extensionGroupOf(views[0], descriptors);
	if (!group || !views.every(view => {
		const candidate = extensionGroupOf(view, descriptors);
		return candidate && ExtensionIdentifier.equals(candidate.extensionId, group.extensionId) && candidate.container.id === group.container.id;
	})) { return undefined; }
	return { ...group, views: [...views] };
}

function extensionGroupLabel(group: IExtensionViewGroup, { descriptors, extensions }: Pick<ITileCatalogServices, 'descriptors' | 'extensions'>): string {
	const extension = extensions.extensions.find(extension => ExtensionIdentifier.equals(extension.identifier, group.extensionId));
	const name = extension?.displayName || extension?.name || group.extensionId.value;
	const sameExtension = extensionViewGroups(descriptors, false).filter(candidate => candidate.views.length > 1 && ExtensionIdentifier.equals(candidate.extensionId, group.extensionId));
	if (sameExtension.length < 2) { return name; }
	const containerTitle = typeof group.container.title === 'string' ? group.container.title : group.container.title.value;
	return localize('extensionViewsInContainer', "{0} › {1}", name, containerTitle || group.container.id);
}

function containerIdOf(entry: ITileCatalogEntry): string {
	return entry.target.kind === 'container' ? entry.target.id : entry.target.kind === 'view' ? `view:${entry.target.id}` : '';
}

/** Position in `order`, with unknown IDs after every known one in their existing order. */
function rank(id: string, order: readonly string[]): number {
	const index = order.indexOf(id);
	return index < 0 ? order.length : index;
}
