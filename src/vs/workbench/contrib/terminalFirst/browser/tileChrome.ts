/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, DisposableResizeObserver, EventHelper, EventType, getActiveElement, getWindow } from '../../../../base/browser/dom.js';
import { RunOnceScheduler } from '../../../../base/common/async.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { onUnexpectedError } from '../../../../base/common/errors.js';
import { Event } from '../../../../base/common/event.js';
import { Disposable, DisposableMap, DisposableStore, IDisposable } from '../../../../base/common/lifecycle.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import { localize } from '../../../../nls.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IContextMenuService } from '../../../../platform/contextview/browser/contextView.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';
import { IEditorGroupView } from '../../../browser/parts/editor/editor.js';
import { EditorPartHooks, IEditorPartExtension, IEditorPartExtensionContext } from '../../../browser/parts/editor/editorPartHooks.js';
import { GroupIdentifier } from '../../../common/editor.js';
import { terminalFirstEnabled, terminalFirstPolicy } from '../../../services/terminalFirst/common/terminalFirstPolicy.js';
import { IKeybindingService } from '../../../../platform/keybinding/common/keybinding.js';

/** Context keys of widgets that must keep keyboard focus while the pointer rests on another tile. */
const focusHoldingWidgets = ['inQuickInput', 'dialogVisible', 'suggestWidgetVisible', 'findWidgetVisible', 'parameterHintsVisible', 'renameInputVisible'];

/**
 * Dresses every editor group as a tile: the tile class, a close control, the New Tile button of
 * an empty workspace, and focus that follows the pointer once it rests on a tile.
 */
export class TileChrome extends Disposable implements IEditorPartExtension {
	/** How long the pointer must rest on a tile before it takes focus. */
	static readonly HOVER_FOCUS_DELAY = 120;

	private readonly decorations = this._register(new DisposableMap<GroupIdentifier>());
	private contextMenuVisible = false;

	constructor(
		private readonly context: IEditorPartExtensionContext,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IContextKeyService private readonly contextKeyService: IContextKeyService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@ICommandService private readonly commandService: ICommandService,
		@IHoverService private readonly hoverService: IHoverService,
		@IKeybindingService private readonly keybindingService: IKeybindingService,
	) {
		super();
		this._register(contextMenuService.onDidShowContextMenu(() => this.contextMenuVisible = true));
		this._register(contextMenuService.onDidHideContextMenu(() => this.contextMenuVisible = false));
	}

	onDidCreateGroupView(group: IEditorGroupView): void {
		this.decorations.set(group.id, this.decorate(group));
	}

	private decorate(group: IEditorGroupView): IDisposable {
		const store = new DisposableStore();
		const element = group.element;
		element.classList.add('terminal-first-tile');

		// Focus follows the pointer once it rests on a tile, so passing over a tile
		// on the way elsewhere, or an open menu or widget, keeps keyboard focus put.
		const hoverFocus = store.add(new RunOnceScheduler(() => {
			const context = this.contextKeyService.getContext(getActiveElement());
			if (!this.contextMenuVisible && terminalFirstPolicy.mode === 'editor' && !terminalFirstPolicy.floatingVisible &&
				this.context.part.activeGroup !== group && this.context.part.groups.includes(group) &&
				!focusHoldingWidgets.some(key => context.getValue(key))) {
				group.focus();
			}
		}, TileChrome.HOVER_FOCUS_DELAY));
		store.add(addDisposableListener(element, EventType.MOUSE_ENTER, event => {
			if (!event.buttons && this.configurationService.getValue<boolean>('terminalFirst.tiles.focusFollowsMouse') !== false) {
				hoverFocus.schedule();
			}
		}));
		store.add(addDisposableListener(element, EventType.MOUSE_LEAVE, () => hoverFocus.cancel()));
		store.add(addDisposableListener(element, EventType.MOUSE_DOWN, () => hoverFocus.cancel()));

		const closeTile = element.ownerDocument.createElement('button');
		closeTile.className = 'terminal-first-close-tile';
		closeTile.type = 'button';
		const closeLabel = localize('closeTile', "Close Tile");
		closeTile.setAttribute('aria-label', closeLabel);
		const closeIcon = closeTile.appendChild($('span'));
		closeIcon.className = ThemeIcon.asClassName(Codicon.close);
		closeIcon.setAttribute('aria-hidden', 'true');
		element.appendChild(closeTile);
		store.add(this.hoverService.setupDelayedHover(closeTile, { content: closeLabel }));
		store.add(addDisposableListener(closeTile, EventType.MOUSE_DOWN, event => {
			hoverFocus.cancel();
			EventHelper.stop(event);
		}));
		store.add(addDisposableListener(closeTile, EventType.CLICK, event => {
			EventHelper.stop(event);
			void this.commandService.executeCommand('terminalFirst.tile.close', group.id).catch(onUnexpectedError);
		}));
		store.add(addDisposableListener(closeTile, EventType.DBLCLICK, event => EventHelper.stop(event)));

		const newTile = element.ownerDocument.createElement('button');
		newTile.className = 'terminal-first-empty-new-tile';
		newTile.type = 'button';
		const newTileIcon = newTile.appendChild($('span'));
		newTileIcon.className = ThemeIcon.asClassName(Codicon.add);
		newTileIcon.setAttribute('aria-hidden', 'true');
		newTile.appendChild($('span')).textContent = localize('newTile', "New Tile");
		element.appendChild(newTile);
		const chord = this.keybindingService.lookupKeybinding('terminalFirst.tile.new')?.getLabel();
		store.add(this.hoverService.setupDelayedHover(newTile, { content: chord ? localize('newTileHover', "Open the New Tile picker ({0})", chord) : localize('newTileHoverPlain', "Open the New Tile picker") }));
		store.add(addDisposableListener(newTile, EventType.CLICK, event => {
			EventHelper.stop(event);
			void this.commandService.executeCommand('terminalFirst.tile.new').catch(onUnexpectedError);
		}));
		store.add(addDisposableListener(newTile, EventType.DBLCLICK, event => EventHelper.stop(event)));

		// The close control lines up with the tab actions row; a restored header can be hidden during layout, so observe it becoming visible too.
		// The group view owns its header; the class names below are the ones its tabs control renders.
		// eslint-disable-next-line no-restricted-syntax
		const title = element.querySelector<HTMLElement>(':scope > .title');
		if (title) {
			const observer = store.add(new DisposableResizeObserver('terminalFirstTileHeader', () => this.updateClosePosition(element), getWindow(element)));
			store.add(observer.observe(title));
		}

		store.add(Event.once(group.onWillDispose)(() => this.decorations.deleteAndLeak(group.id)?.dispose()));
		return store;
	}

	private updateClosePosition(element: HTMLElement): void {
		// eslint-disable-next-line no-restricted-syntax
		const row = element.querySelector<HTMLElement>(':scope > .title .editor-actions')?.parentElement;
		const bounds = row?.getBoundingClientRect();
		const center = bounds?.height ? bounds.top - element.getBoundingClientRect().top - element.clientTop + bounds.height / 2 : undefined;
		element.style.setProperty('--terminal-first-close-center', `${center ?? 16}px`);
	}
}

if (terminalFirstEnabled) {
	EditorPartHooks.registerExtension((context, instantiationService) => instantiationService.createInstance(TileChrome, context));
}
