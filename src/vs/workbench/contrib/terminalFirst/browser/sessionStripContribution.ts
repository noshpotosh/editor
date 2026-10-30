/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, append } from '../../../../base/browser/dom.js';
import { mainWindow } from '../../../../base/browser/window.js';
import { Disposable, MutableDisposable } from '../../../../base/common/lifecycle.js';
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

	private readonly pendingLayout = this._register(new MutableDisposable());

	constructor(
		@IWorkbenchLayoutService private readonly layoutService: IWorkbenchLayoutService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@ILogService private readonly logService: ILogService,
	) {
		super();
		// Contributions start before the parts render their content; the first main-container layout follows rendering.
		if (!this.attach()) {
			this.pendingLayout.value = layoutService.onDidLayoutMainContainer(() => {
				if (this.attach()) {
					this.pendingLayout.clear();
				}
			});
		}
	}

	private attach(): boolean {
		const titlebar = this.layoutService.getContainer(mainWindow, Parts.TITLEBAR_PART);
		// eslint-disable-next-line no-restricted-syntax
		const root = titlebar?.querySelector<HTMLElement>('.titlebar-container');
		// eslint-disable-next-line no-restricted-syntax
		const left = root?.querySelector<HTMLElement>('.titlebar-left');
		if (!root || !left) {
			return false;
		}
		root.classList.add('terminal-first-titlebar');
		// eslint-disable-next-line no-restricted-syntax
		root.querySelector('.window-title')?.classList.add('terminal-first-title');
		this._register(this.instantiationService.createInstance(SessionTabsWidget, append(left, $('.titlebar-sessions.terminal-first-sessions'))));
		this.logService.trace('[terminalFirst] Session strip attached to the title bar.');
		return true;
	}
}
