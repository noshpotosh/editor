/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IContextMenuDelegate } from '../../../../base/browser/contextmenu.js';
import { DeferredPromise, disposableTimeout } from '../../../../base/common/async.js';
import { Event } from '../../../../base/common/event.js';
import { IMenuService } from '../../../../platform/actions/common/actions.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { ContextMenuMenuDelegate } from '../../../../platform/contextview/browser/contextMenuService.js';
import { IContextMenuMenuDelegate, IContextMenuService } from '../../../../platform/contextview/browser/contextView.js';

/**
 * Lets the keyboard actions picker borrow a view's own context menu. While armed, the next context
 * menu a view inside a tile asks for is handed over as a delegate instead of being shown, so the
 * picker lists exactly the actions a right-click would, for built-in and extension views alike.
 */
export class TileContextMenuCapture {
	private pending: DeferredPromise<IContextMenuDelegate | undefined> | undefined;

	/** Captures the next context menu requested within `timeout` ms; resolves `undefined` when none is requested. */
	arm(timeout = 500): Promise<IContextMenuDelegate | undefined> {
		this.pending?.complete(undefined);
		const pending = this.pending = new DeferredPromise<IContextMenuDelegate | undefined>();
		const timer = disposableTimeout(() => { if (this.pending === pending) { this.pending = undefined; pending.complete(undefined); } }, timeout);
		void pending.p.finally(() => timer.dispose());
		return pending.p;
	}

	/** Hands a requested menu to the armed caller. Returns false when nothing is armed, so the menu shows normally. */
	capture(delegate: IContextMenuDelegate): boolean {
		const pending = this.pending;
		if (!pending) {
			return false;
		}
		this.pending = undefined;
		pending.complete(delegate);
		return true;
	}
}

export const tileContextMenuCapture = new TileContextMenuCapture();

/** The context menu service views inside a tile receive: ordinary menus pass through, captured ones go to the picker. */
export class TileContextMenuService implements IContextMenuService {
	declare readonly _serviceBrand: undefined;
	readonly onDidShowContextMenu: Event<void>;
	readonly onDidHideContextMenu: Event<void>;

	constructor(
		@IContextMenuService private readonly contextMenuService: IContextMenuService,
		@IMenuService private readonly menuService: IMenuService,
		@IContextKeyService private readonly contextKeyService: IContextKeyService,
	) {
		this.onDidShowContextMenu = contextMenuService.onDidShowContextMenu;
		this.onDidHideContextMenu = contextMenuService.onDidHideContextMenu;
	}

	showContextMenu(delegate: IContextMenuDelegate | IContextMenuMenuDelegate): void {
		if (tileContextMenuCapture.capture(ContextMenuMenuDelegate.transform(delegate, this.menuService, this.contextKeyService))) {
			return;
		}
		this.contextMenuService.showContextMenu(delegate);
	}
}
