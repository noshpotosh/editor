/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IContextMenuDelegate } from '../../../../base/browser/contextmenu.js';
import { IMenuService } from '../../../../platform/actions/common/actions.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { ContextMenuMenuDelegate } from '../../../../platform/contextview/browser/contextMenuService.js';
import { IContextMenuMenuDelegate, IContextMenuService, IContextViewService } from '../../../../platform/contextview/browser/contextView.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { IKeybindingService } from '../../../../platform/keybinding/common/keybinding.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { ITelemetryService } from '../../../../platform/telemetry/common/telemetry.js';
import { terminalFirstEnabled } from '../../../../platform/terminalFirst/common/terminalFirst.js';
import { ContextMenuService } from '../../../services/contextmenu/electron-browser/contextmenuService.js';
import { IHostService } from '../../../services/host/browser/host.js';
import { tileContextMenuCapture } from '../browser/tileContextMenu.js';

/**
 * The window's context menu service, with one addition: while the tile actions picker has armed
 * a capture, the next requested menu is handed to the picker instead of being shown. Replacing
 * the singleton (rather than wrapping per tile) covers views created from the root services,
 * such as extension tree views, so every view's row menu can be listed.
 */
class TerminalFirstContextMenuService extends ContextMenuService {

	constructor(
		@INotificationService notificationService: INotificationService,
		@ITelemetryService telemetryService: ITelemetryService,
		@IKeybindingService keybindingService: IKeybindingService,
		@IConfigurationService configurationService: IConfigurationService,
		@IContextViewService contextViewService: IContextViewService,
		@IMenuService private readonly menuService: IMenuService,
		@IContextKeyService private readonly contextKeyService: IContextKeyService,
		@IHostService hostService: IHostService,
	) {
		super(notificationService, telemetryService, keybindingService, configurationService, contextViewService, menuService, contextKeyService, hostService);
	}

	override showContextMenu(delegate: IContextMenuDelegate | IContextMenuMenuDelegate): void {
		if (tileContextMenuCapture.capture(ContextMenuMenuDelegate.transform(delegate, this.menuService, this.contextKeyService))) {
			return;
		}
		super.showContextMenu(delegate);
	}
}

if (terminalFirstEnabled) {
	// Registered after the upstream singleton, so this descriptor wins.
	registerSingleton(IContextMenuService, TerminalFirstContextMenuService, InstantiationType.Delayed);
}
