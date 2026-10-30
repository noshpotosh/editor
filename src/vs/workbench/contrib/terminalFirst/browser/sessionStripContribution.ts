/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, append } from '../../../../base/browser/dom.js';
import { mainWindow } from '../../../../base/browser/window.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IWorkbenchContribution } from '../../../common/contributions.js';
import { IWorkbenchLayoutService, Parts } from '../../../services/layout/browser/layoutService.js';
import { SessionTabsWidget } from './sessionStripPart.js';

/**
 * Places the session strip at the left of the main window's title bar and hides the window
 * title. The title bar part renders its own DOM, so the strip is attached to the elements it
 * creates: `.titlebar-container > .titlebar-left` and `.window-title`.
 */
export class SessionStripContribution extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.terminalFirstSessionStrip';

	constructor(
		@IWorkbenchLayoutService layoutService: IWorkbenchLayoutService,
		@IInstantiationService instantiationService: IInstantiationService,
		@ILogService logService: ILogService,
	) {
		super();
		const titlebar = layoutService.getContainer(mainWindow, Parts.TITLEBAR_PART);
		// eslint-disable-next-line no-restricted-syntax
		const root = titlebar?.querySelector<HTMLElement>('.titlebar-container');
		// eslint-disable-next-line no-restricted-syntax
		const left = root?.querySelector<HTMLElement>('.titlebar-left');
		if (!root || !left) {
			logService.error('[terminalFirst] The title bar has no .titlebar-container > .titlebar-left; the session strip was not rendered.');
			return;
		}
		root.classList.add('terminal-first-titlebar');
		// eslint-disable-next-line no-restricted-syntax
		root.querySelector('.window-title')?.classList.add('terminal-first-title');
		this._register(instantiationService.createInstance(SessionTabsWidget, append(left, $('.titlebar-sessions.terminal-first-sessions'))));
	}
}
