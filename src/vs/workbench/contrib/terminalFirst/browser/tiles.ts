/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Queue } from '../../../../base/common/async.js';
import { KeyChord, KeyCode, KeyMod } from '../../../../base/common/keyCodes.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { isEqual } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { ILocalizedString, localize, localize2 } from '../../../../nls.js';
import { Action2, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { BrowserViewUri } from '../../../../platform/browserView/common/browserViewUri.js';
import { ConfigurationTarget, IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { Extensions as ConfigurationExtensions, IConfigurationRegistry } from '../../../../platform/configuration/common/configurationRegistry.js';
import { KeybindingWeight } from '../../../../platform/keybinding/common/keybindingsRegistry.js';
import { createDecorator, IInstantiationService, ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { SyncDescriptor } from '../../../../platform/instantiation/common/descriptors.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { IQuickInputService, IQuickPickItem, IQuickPickSeparator } from '../../../../platform/quickinput/common/quickInput.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import { EditorPaneDescriptor, IEditorPaneRegistry } from '../../../browser/editor.js';
import { PaneComposite } from '../../../browser/panecomposite.js';
import { EditorExtensions, EditorInputCapabilities, IEditorFactoryRegistry } from '../../../common/editor.js';
import { registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { IViewDescriptorService, ViewContainerLocation } from '../../../common/views.js';
import { GroupDirection, GroupsArrangement, GroupsOrder, IEditorGroup, IEditorGroupsService } from '../../../services/editor/common/editorGroupsService.js';
import { noRoomForTileMessage, tileFits, tileSplitDirection, tileSplitSizes } from '../common/tileLayout.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { ITerminalFirstService } from '../../../services/terminalFirst/common/terminalFirst.js';
import { terminalFirstEnabled, terminalFirstPolicy, TerminalFirstFloatingEnabledContext } from '../../../services/terminalFirst/common/terminalFirstPolicy.js';
import { IViewsService } from '../../../services/views/common/viewsService.js';
import { viewContainerHosts } from '../../../services/views/browser/viewContainerHost.js';
import { TERMINAL_VIEW_ID } from '../../terminal/common/terminal.js';
import { IViewTileComposites, tileViewIds, ViewTileComposites, ViewTileEditor, ViewTileInput, ViewTileSerializer } from './tileEditor.js';
import { dockedNavigation } from './terminalFirstNavigation.js';
import { EditorPartSessions } from './editorPartSessions.js';
import './tileChrome.js';
import './tileLayoutHook.js';
import './tileRouting.js';

type TileKind = 'editor' | 'terminal' | { readonly container: string };

/** A web app shown without browser chrome in an integrated browser tile. */
interface IWebAppTile {
	/** The browser view; a stable ID lets reopening find it and restores it after a restart. */
	readonly resource: URI;
	/** The setting that holds the app's URL. */
	readonly setting: string;
	readonly label: string;
	readonly prompt: string;
	readonly placeHolder: string;
}

type WebAppTileId = 'jira' | 'bitbucket';

export const webAppTiles: Readonly<Record<WebAppTileId, IWebAppTile>> = {
	jira: {
		resource: BrowserViewUri.forId('vs-nosh-jira'),
		setting: 'terminalFirst.jira.boardUrl',
		label: localize('jiraBoard', "Jira Board"),
		prompt: localize('jiraBoardPrompt', "Enter the URL of your Jira board"),
		placeHolder: 'https://your-site.atlassian.net/jira/software/projects/KEY/boards/1',
	},
	bitbucket: {
		resource: BrowserViewUri.forId('vs-nosh-bitbucket'),
		setting: 'terminalFirst.bitbucket.url',
		label: localize('bitbucket', "Bitbucket"),
		prompt: localize('bitbucketPrompt', "Enter the Bitbucket page to show, such as your pull requests or a repository"),
		placeHolder: 'https://bitbucket.org/your-workspace/your-repo/pull-requests/',
	},
};

/** Returns the trimmed URL when it is an http(s) address, which is all a web app tile loads. */
function parseWebAppUrl(value: string): string | undefined {
	const url = URL.parse(value.trim());
	return url && (url.protocol === 'https:' || url.protocol === 'http:') ? url.toString() : undefined;
}

/** View container locations whose containers open as tiles; the terminal container stays the shell surface. */
const tiledLocations = [ViewContainerLocation.Sidebar, ViewContainerLocation.Panel, ViewContainerLocation.AuxiliaryBar] as const;

interface ITilePick extends IQuickPickItem {
	readonly tile?: TileKind;
	readonly app?: WebAppTileId;
	/** A single view, which may move into a container of its own. */
	readonly view?: string;
}

const ITileService = createDecorator<TileService>('terminalFirstTiles');

/** Spatial order used to choose the tile that absorbs a closed tile's space. */
const closeFallbackOrder = [GroupDirection.LEFT, GroupDirection.UP, GroupDirection.RIGHT, GroupDirection.DOWN] as const;

function isHorizontal(direction: GroupDirection): boolean {
	return direction === GroupDirection.LEFT || direction === GroupDirection.RIGHT;
}

function opposite(direction: GroupDirection): GroupDirection {
	switch (direction) {
		case GroupDirection.LEFT: return GroupDirection.RIGHT;
		case GroupDirection.RIGHT: return GroupDirection.LEFT;
		case GroupDirection.UP: return GroupDirection.DOWN;
		case GroupDirection.DOWN: return GroupDirection.UP;
	}
}

export class TileService extends Disposable {
	declare readonly _serviceBrand: undefined;
	private readonly operations = this._register(new Queue<IEditorGroup | undefined>());

	constructor(
		@IEditorGroupsService private readonly groups: IEditorGroupsService,
		@IEditorService private readonly editors: IEditorService,
		@ITerminalFirstService private readonly sessions: ITerminalFirstService,
		@IQuickInputService private readonly quickInput: IQuickInputService,
		@INotificationService private readonly notifications: INotificationService,
		@IConfigurationService private readonly configuration: IConfigurationService,
		@IInstantiationService private readonly instantiation: IInstantiationService,
		@IViewDescriptorService private readonly descriptors: IViewDescriptorService,
		@IViewsService private readonly views: IViewsService,
		@IViewTileComposites private readonly composites: ViewTileComposites,
	) {
		super();
		// Every view container except the shell surface opens as a tile, so the sidebar and panel never host views.
		this._register(viewContainerHosts.registerResolver(id => id === TERMINAL_VIEW_ID ? undefined : {
			isEnabled: () => terminalFirstEnabled && terminalFirstPolicy.mode !== 'shell',
			open: async focus => { await this.open({ container: id }, undefined, !!focus); return this.getComposite(id); },
			get: () => this.getComposite(id),
			close: async () => { const group = this.findTool(id); if (group) { await this.close(group); } },
		}));
	}

	initialize(): void { /* Instantiates the delayed controller before restoring views. */ }

	private get part() { return this.groups.mainPart; }

	private findTool(containerId: string): IEditorGroup | undefined {
		const session = this.sessions.sessions.find(session => session.active);
		return this.part.groups.find(group => group.editors.some(input => input instanceof ViewTileInput && input.containerId === containerId && input.sessionId === session?.id));
	}

	private getComposite(containerId: string): PaneComposite | undefined {
		return this.findTool(containerId) ? this.composites.get(containerId) : undefined;
	}

	/**
	 * Resolves the container to tile for a view container or view ID. A view that shares its
	 * container with other views moves into a generated container of its own, like dragging it
	 * out upstream; Reset View Locations returns it.
	 */
	private containerFor(id: string): string | undefined {
		if (id === TERMINAL_VIEW_ID) { return undefined; }
		if (this.descriptors.getViewContainerById(id)) { return id; }
		const view = this.descriptors.getViewDescriptorById(id);
		const container = this.descriptors.getViewContainerByViewId(id);
		const location = container && this.descriptors.getViewContainerLocation(container);
		if (!view || !container || container.id === TERMINAL_VIEW_ID || location === null || location === undefined) { return undefined; }
		if (view.canMoveView && this.descriptors.getViewContainerModel(container).activeViewDescriptors.length > 1) {
			this.descriptors.moveViewToLocation(view, location, 'terminalFirst.tile');
		}
		return this.descriptors.getViewContainerByViewId(id)?.id;
	}

	/** Opens a view container, or a single view, as a tile. Opening it again focuses the existing tile. */
	async openView(id: string, direction?: GroupDirection, focus = true): Promise<IEditorGroup | undefined> {
		const container = this.containerFor(id);
		if (!container) { return undefined; }
		const group = await this.open({ container }, direction, focus);
		if (group && id !== container) { await this.views.openView(id, focus); }
		return group;
	}

	private viewPicks(): (ITilePick | IQuickPickSeparator)[] {
		const containers: ITilePick[] = [];
		const views: ITilePick[] = [];
		for (const location of tiledLocations) {
			for (const container of this.descriptors.getViewContainersByLocation(location)) {
				const model = this.descriptors.getViewContainerModel(container);
				if (container.id === TERMINAL_VIEW_ID || !model.activeViewDescriptors.length) { continue; }
				containers.push({ label: model.title, iconClasses: ThemeIcon.isThemeIcon(model.icon) ? ThemeIcon.asClassNameArray(model.icon) : undefined, tile: { container: container.id } });
				if (model.activeViewDescriptors.length > 1) {
					for (const view of model.activeViewDescriptors.filter(view => view.canMoveView)) {
						views.push({ label: localize('viewInContainer', "{0} › {1}", model.title, view.name.value), view: view.id });
					}
				}
			}
		}
		return [
			{ type: 'separator', label: localize('views', "Views") }, ...containers,
			...(views.length ? [{ type: 'separator' as const, label: localize('singleViews', "Single Views") }, ...views] : []),
		];
	}

	/** Layout changes act on the whole grid, so a maximized tile is restored first. */
	private unmaximize(): void {
		if (this.part.hasMaximizedGroup()) { this.part.toggleMaximizeGroup(); }
	}

	private neighbor(direction: GroupDirection, source = this.part.activeGroup, wrap = false): IEditorGroup | undefined {
		return this.part.findGroup({ direction }, source, wrap);
	}

	async pick(direction?: GroupDirection, viewsOnly = false): Promise<void> {
		const tiles: (ITilePick | IQuickPickSeparator)[] = viewsOnly ? [] : [
			{ type: 'separator', label: localize('tiles', "Tiles") },
			{ label: localize('editor', "Editor"), tile: 'editor' },
			{ label: localize('terminal', "Terminal"), tile: 'terminal' },
			...Object.entries(webAppTiles).map(([app, { label }]) => ({ label, app: app as WebAppTileId })),
		];
		const selection = await this.quickInput.pick<ITilePick>([...tiles, ...this.viewPicks()], { placeHolder: viewsOnly ? localize('openViewTile', "Open View as Tile") : localize('newTile', "New Tile"), matchOnDescription: true });
		if (selection?.view) { await this.openView(selection.view, direction); } else if (selection?.app) { await this.openWebApp(selection.app, direction); } else if (selection?.tile) { await this.open(selection.tile, direction); }
	}

	/**
	 * Shows a web app (Jira, Bitbucket) in a chromeless integrated browser tile, asking for its URL
	 * the first time. Opening it again focuses the existing tile.
	 */
	async openWebApp(id: WebAppTileId, direction?: GroupDirection): Promise<IEditorGroup | undefined> {
		const app = webAppTiles[id];
		const existing = this.part.groups.find(group => group.editors.some(input => isEqual(input.resource, app.resource)));
		if (existing) { existing.focus(); return existing; }
		const url = await this.webAppUrl(app);
		if (!url) { return undefined; }
		const group = await this.open('editor', direction);
		if (!group) { return undefined; }
		await this.editors.openEditor({ resource: app.resource, options: { pinned: true, viewState: { url, chromeless: true } } }, group);
		return group;
	}

	private async webAppUrl(app: IWebAppTile): Promise<string | undefined> {
		const configured = parseWebAppUrl(this.configuration.getValue<string>(app.setting) ?? '');
		if (configured) { return configured; }
		const value = await this.quickInput.input({
			prompt: app.prompt,
			placeHolder: app.placeHolder,
			ignoreFocusLost: true,
			validateInput: async value => value.trim() && !parseWebAppUrl(value) ? localize('webAppUrlInvalid', "Enter an http or https URL.") : undefined,
		});
		const url = value && parseWebAppUrl(value);
		if (url) { await this.configuration.updateValue(app.setting, url, ConfigurationTarget.USER); }
		return url;
	}

	/** Opens a tile beside the focused tile and resolves to it, or `undefined` when nothing opened. */
	open(kind: TileKind, direction?: GroupDirection, focus = true): Promise<IEditorGroup | undefined> {
		return this.operations.queue(async () => {
			await this.sessions.showEditor(false);
			const session = this.sessions.sessions.find(session => session.active);
			if (!session) { return undefined; }
			if (typeof kind === 'object') {
				const existing = this.findTool(kind.container);
				if (existing) { if (focus) { existing.focus(); } return existing; }
			}
			this.unmaximize();
			const source = this.part.activeGroup;
			let group = source;
			if (this.part.count !== 1 || !source.isEmpty || direction !== undefined) {
				const size = this.part.getSize(source);
				const split = tileSplitDirection(size, direction);
				if (split === undefined) {
					// Background reveals (an extension, an auto-revealed panel) fail quietly.
					if (focus) { this.notifications.info(noRoomForTileMessage()); }
					return undefined;
				}
				group = this.part.addGroup(source, split);
				this.part.setSize(group, tileSplitSizes(size, split));
			}
			const rollback = () => {
				if (group !== source && group.isEmpty && this.part.groups.includes(group)) { this.part.removeGroup(group); }
			};
			try {
				if (typeof kind === 'object') {
					await this.editors.openEditor(this.instantiation.createInstance(ViewTileInput, kind.container, session.id), { pinned: true, preserveFocus: !focus }, group);
				} else if (kind === 'terminal' && !await this.sessions.openTerminalTile(group.id)) {
					rollback();
					return undefined;
				}
			} catch (error) {
				rollback();
				throw error;
			}
			if (!this.part.groups.includes(group)) { return undefined; }
			if (focus) { group.focus(); }
			return group;
		});
	}

	/** Splits the focused editor tile and shows its active file in the new tile, like `:split`. */
	async splitEditor(direction: GroupDirection): Promise<void> {
		const source = this.part.activeGroup;
		const editor = source.activeEditor;
		const group = await this.open('editor', direction);
		if (group && editor && !editor.hasCapability(EditorInputCapabilities.RequiresDedicatedGroup) && source.contains(editor)) {
			source.copyEditor(editor, group);
		}
	}

	/** The neighbor that takes over a closed tile's space: one sharing a full edge, else the first spatial neighbor. */
	private closeFallback(group: IEditorGroup): IEditorGroup | undefined {
		const size = this.part.getSize(group);
		const neighbors = closeFallbackOrder.map(direction => ({ direction, target: this.neighbor(direction, group) }));
		const sibling = neighbors.find(({ direction, target }) => {
			if (!target) { return false; }
			const other = this.part.getSize(target);
			return isHorizontal(direction) ? other.height === size.height : other.width === size.width;
		});
		return (sibling ?? neighbors.find(({ target }) => !!target))?.target;
	}

	async close(target: IEditorGroup | number = this.part.activeGroup): Promise<void> {
		const group = typeof target === 'number' ? this.part.groups.find(group => group.id === target) : target;
		if (!group) { return; }
		const fallback = this.closeFallback(group);
		if (await group.closeAllEditors() && this.part.groups.includes(group) && this.part.count > 1) {
			this.part.removeGroup(group);
			if (fallback && this.part.groups.includes(fallback)) { fallback.focus(); }
		}
	}

	focus(direction: GroupDirection): void {
		this.neighbor(direction, undefined, this.configuration.getValue<boolean>('terminalFirst.tiles.wrapFocus') === true)?.focus();
	}

	/** Re-docks the focused tile on the far side of its neighbor. */
	move(direction: GroupDirection): void {
		this.unmaximize();
		const source = this.part.activeGroup;
		const target = this.neighbor(direction, source);
		if (target) { this.part.moveGroup(source, target, direction); source.focus(); }
	}

	/** Exchanges the focused tile with its neighbor; focus stays with the moved tile. */
	swap(direction: GroupDirection): void {
		this.unmaximize();
		const source = this.part.activeGroup;
		const target = this.neighbor(direction, source);
		if (target) { EditorPartSessions.for(this.part)?.swapGroups(source, target); source.focus(); }
	}

	/** Flips the focused tile and its neighbor between side by side and stacked, like Hyprland's `togglesplit`. */
	toggleSplit(): void {
		this.unmaximize();
		const source = this.part.activeGroup;
		for (const direction of closeFallbackOrder) {
			const target = this.neighbor(direction, source);
			if (!target) { continue; }
			const sourceSize = this.part.getSize(source);
			const targetSize = this.part.getSize(target);
			// The pair shares one cell after the flip; keep the source on the same side (left/top first).
			const placement = isHorizontal(direction)
				? (direction === GroupDirection.LEFT ? GroupDirection.DOWN : GroupDirection.UP)
				: (direction === GroupDirection.UP ? GroupDirection.RIGHT : GroupDirection.LEFT);
			const cell = isHorizontal(direction)
				? { width: sourceSize.width + targetSize.width, height: targetSize.height }
				: { width: targetSize.width, height: sourceSize.height + targetSize.height };
			if (!tileFits(cell, placement)) {
				this.notifications.info(noRoomForTileMessage());
				return;
			}
			this.part.moveGroup(source, target, placement);
			this.part.setSize(source, tileSplitSizes(cell, placement));
			source.focus();
			return;
		}
	}

	/** Gives every tile an equal share of its row or column. */
	balance(): void {
		this.unmaximize();
		this.part.arrangeGroups(GroupsArrangement.EVEN);
	}

	/**
	 * Moves the focused tile's edge toward the given side: grows into a neighbor on that side,
	 * otherwise shrinks from the opposite side. The grid clamps to tile minimums.
	 */
	resize(direction: GroupDirection): void {
		this.unmaximize();
		const group = this.part.activeGroup;
		const size = this.part.getSize(group);
		const step = Math.max(1, this.configuration.getValue<number>('terminalFirst.tiles.resizeStep') ?? 40);
		const delta = this.neighbor(direction, group) ? step : this.neighbor(opposite(direction), group) ? -step : 0;
		if (!delta) { return; }
		this.part.setSize(group, isHorizontal(direction) ? { width: size.width + delta, height: size.height } : { width: size.width, height: size.height + delta });
	}

	maximize(): void { this.part.toggleMaximizeGroup(); }

	next(offset: number): void {
		const groups = this.part.getGroups(GroupsOrder.GRID_APPEARANCE);
		groups[(groups.indexOf(this.part.activeGroup) + offset + groups.length) % groups.length]?.focus();
	}
}

class TileContribution {
	constructor(@ITileService tiles: TileService) { tiles.initialize(); }
}

if (terminalFirstEnabled) {
	registerSingleton(ITileService, TileService, InstantiationType.Delayed);
	registerSingleton(IViewTileComposites, ViewTileComposites, InstantiationType.Delayed);
	Registry.as<IEditorFactoryRegistry>(EditorExtensions.EditorFactory).registerEditorSerializer(ViewTileInput.ID, ViewTileSerializer);
	Registry.as<IEditorPaneRegistry>(EditorExtensions.EditorPane).registerEditorPane(EditorPaneDescriptor.create(ViewTileEditor, ViewTileEditor.ID, localize('viewTileEditor', "View Tile")), [new SyncDescriptor(ViewTileInput)]);
	registerWorkbenchContribution2('terminalFirst.tiles', TileContribution, WorkbenchPhase.BlockRestore);
	Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration).registerConfiguration({
		id: 'terminalFirst.tiles', title: localize('tileSettings', "Tiles"), type: 'object', properties: {
			'terminalFirst.tiles.focusFollowsMouse': { type: 'boolean', default: true, description: localize('focusFollowsMouse', "Focus a tile when the pointer rests on it in the code workspace.") },
			'terminalFirst.tiles.wrapFocus': { type: 'boolean', default: false, description: localize('wrapFocus', "Wrap directional tile focus around the edges of the code workspace.") },
			'terminalFirst.tiles.resizeStep': { type: 'number', default: 40, minimum: 4, maximum: 400, description: localize('resizeStep', "Pixels to move a tile edge for each resize command.") },
		}
	});
	Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration).registerConfiguration({
		id: 'terminalFirst.webApps', title: localize('webAppSettings', "Web App Tiles"), type: 'object', properties: {
			[webAppTiles.jira.setting]: { type: 'string', default: '', format: 'uri', description: localize('jiraBoardUrl', "The Jira board to show in the Jira Board tile. When empty, Open Jira Board asks for it.") },
			[webAppTiles.bitbucket.setting]: { type: 'string', default: '', format: 'uri', description: localize('bitbucketUrl', "The Bitbucket page to show in the Bitbucket tile, such as your pull requests or a repository. When empty, Open Bitbucket asks for it.") },
		}
	});
	// Hyprland-style modifier: Ctrl+Alt on every platform (physical Control on macOS).
	const mod = (key: number) => ({ primary: KeyMod.CtrlCmd | KeyMod.Alt | key, mac: { primary: KeyMod.WinCtrl | KeyMod.Alt | key } });
	const swap = (key: KeyCode) => ({ primary: KeyChord(KeyMod.CtrlCmd | KeyMod.Alt | KeyCode.KeyX, key), mac: { primary: KeyChord(KeyMod.WinCtrl | KeyMod.Alt | KeyCode.KeyX, key) } });
	type TileAction = { id: string; title: ILocalizedString; run: (service: TileService, groupId?: number) => unknown; keys?: { primary: number; mac: { primary: number } } };
	const actions: TileAction[] = [
		{ id: 'new', title: localize2('new', "New Tile"), run: service => service.pick(), keys: mod(KeyCode.Enter) },
		{ id: 'explorer', title: localize2('files', "Open Explorer Tile"), run: service => service.openView(tileViewIds.explorer), keys: mod(KeyCode.KeyE) },
		{ id: 'scm', title: localize2('git', "Open Git Changes Tile"), run: service => service.openView(tileViewIds.scm), keys: mod(KeyCode.KeyG) },
		{ id: 'terminal', title: localize2('shell', "Open Terminal Tile"), run: service => service.open('terminal'), keys: mod(KeyCode.KeyT) },
		{ id: 'jira', title: localize2('jira', "Open Jira Board"), run: service => service.openWebApp('jira'), keys: mod(KeyCode.KeyB) },
		{ id: 'bitbucket', title: localize2('openBitbucket', "Open Bitbucket"), run: service => service.openWebApp('bitbucket'), keys: mod(KeyCode.KeyC) },
		{ id: 'splitRight', title: localize2('splitRight', "New Tile to the Right"), run: service => service.pick(GroupDirection.RIGHT) },
		{ id: 'splitDown', title: localize2('splitDown', "New Tile Below"), run: service => service.pick(GroupDirection.DOWN) },
		{ id: 'splitEditorRight', title: localize2('splitEditorRight', "Split Editor Tile Right"), run: service => service.splitEditor(GroupDirection.RIGHT) },
		{ id: 'splitEditorDown', title: localize2('splitEditorDown', "Split Editor Tile Down"), run: service => service.splitEditor(GroupDirection.DOWN) },
		{ id: 'close', title: localize2('close', "Close Tile"), run: (service, groupId) => service.close(groupId), keys: mod(KeyCode.KeyQ) },
		{ id: 'maximize', title: localize2('maximize', "Toggle Maximized Tile"), run: service => service.maximize(), keys: mod(KeyCode.KeyF) },
		{ id: 'toggleSplit', title: localize2('toggleSplit', "Toggle Tile Split Direction"), run: service => service.toggleSplit(), keys: mod(KeyCode.KeyO) },
		{ id: 'balance', title: localize2('balance', "Balance Tile Sizes"), run: service => service.balance(), keys: mod(KeyCode.Equal) },
		{ id: 'next', title: localize2('next', "Focus Next Tile"), run: service => service.next(1) },
		{ id: 'previous', title: localize2('previous', "Focus Previous Tile"), run: service => service.next(-1) },
	];
	for (const [suffix, direction, label, letter, arrow] of [
		['Left', GroupDirection.LEFT, localize('left', "Left"), KeyCode.KeyH, KeyCode.LeftArrow], ['Down', GroupDirection.DOWN, localize('down', "Down"), KeyCode.KeyJ, KeyCode.DownArrow],
		['Up', GroupDirection.UP, localize('up', "Up"), KeyCode.KeyK, KeyCode.UpArrow], ['Right', GroupDirection.RIGHT, localize('right', "Right"), KeyCode.KeyL, KeyCode.RightArrow],
	] as const) {
		actions.push(
			{ id: `focus${suffix}`, title: localize2('focus', "Focus Tile {0}", label), run: service => service.focus(direction), keys: mod(letter) },
			{ id: `move${suffix}`, title: localize2('move', "Move Tile {0}", label), run: service => service.move(direction), keys: mod(KeyMod.Shift | letter) },
			{ id: `swap${suffix}`, title: localize2('swap', "Swap Tile {0}", label), run: service => service.swap(direction), keys: swap(letter) },
			{ id: `resize${suffix}`, title: localize2('resize', "Move Tile Edge {0}", label), run: service => service.resize(direction), keys: mod(arrow) },
		);
	}
	for (const action of actions) {
		registerAction2(class extends Action2 {
			constructor() {
				super({
					id: `terminalFirst.tile.${action.id}`, title: action.title, f1: true, precondition: TerminalFirstFloatingEnabledContext, category: localize2('category', "VS NOSH"),
					// Stay above extension defaults (including VSCodeVim), but below user overrides.
					keybinding: action.keys && { ...action.keys, when: dockedNavigation, weight: KeybindingWeight.ExternalExtension + 1000 },
				});
			}
			async run(accessor: ServicesAccessor, groupId?: number): Promise<void> { await action.run(accessor.get(ITileService), groupId); }
		});
	}
	const directions: Record<string, GroupDirection> = { left: GroupDirection.LEFT, right: GroupDirection.RIGHT, up: GroupDirection.UP, down: GroupDirection.DOWN };
	/** Public entry point for extensions and keybindings: `executeCommand('terminalFirst.tile.openView', { id: 'myExtension.view' })`. */
	registerAction2(class extends Action2 {
		constructor() {
			super({
				id: 'terminalFirst.tile.openView', title: localize2('openView', "Open View as Tile"), f1: true, precondition: TerminalFirstFloatingEnabledContext, category: localize2('category', "VS NOSH"),
				metadata: {
					description: localize('openViewDescription', "Opens a view container or a single view as a tile."),
					args: [{
						name: 'options', isOptional: true, schema: {
							type: 'object', required: ['id'], properties: {
								id: { type: 'string', description: localize('openViewId', "The view or view container ID.") },
								direction: { enum: ['left', 'right', 'up', 'down'], description: localize('openViewDirection', "Where to place the new tile. Defaults to the longer side of the focused tile.") },
								preserveFocus: { type: 'boolean', description: localize('openViewPreserveFocus', "Keep focus in the current tile.") },
							}
						}
					}]
				},
			});
		}
		async run(accessor: ServicesAccessor, options?: { id?: string; direction?: string; preserveFocus?: boolean }): Promise<void> {
			const service = accessor.get(ITileService);
			const direction = options?.direction ? directions[options.direction] : undefined;
			if (typeof options?.id === 'string') { await service.openView(options.id, direction, !options.preserveFocus); } else { await service.pick(direction, true); }
		}
	});
}
