/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import './sessionStrip.css';
import { $, append, addDisposableListener, EventType } from '../../../../base/browser/dom.js';
import { DisposableStore } from '../../../../base/common/lifecycle.js';
import { localize } from '../../../../nls.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { IStorageService } from '../../../../platform/storage/common/storage.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { IWorkbenchLayoutService, Parts } from '../../../services/layout/browser/layoutService.js';
import { ITerminalFirstService } from '../../../services/terminalFirst/common/terminalFirst.js';
import { Part } from '../../part.js';

/** The session strip belongs to the window, outside both editor and terminal surfaces. */
export class SessionStripPart extends Part {
	readonly minimumWidth = 0;
	readonly maximumWidth = Number.POSITIVE_INFINITY;
	readonly minimumHeight = 36;
	readonly maximumHeight = 36;
	private readonly controls = this._register(new DisposableStore());
	private stripElement: HTMLElement | undefined;
	private readonly buttons = new Map<string, HTMLElement>();

	constructor(
		@IThemeService themeService: IThemeService,
		@IStorageService storageService: IStorageService,
		@IWorkbenchLayoutService layoutService: IWorkbenchLayoutService,
		@ITerminalFirstService private readonly service: ITerminalFirstService,
		@INotificationService private readonly notifications: INotificationService,
	) {
		super(Parts.TERMINAL_FIRST_PART, { hasTitle: false }, themeService, storageService, layoutService);
		this._register(service.onDidChangeSessions(() => this.render()));
	}

	protected override createContentArea(parent: HTMLElement): HTMLElement {
		this.element = parent;
		this.stripElement = parent;
		this.render();
		return parent;
	}

	private render(): void {
		if (!this.stripElement) { return; }
		const focusedId = this.stripElement.ownerDocument.activeElement?.getAttribute('data-session-control');
		this.controls.clear();
		this.buttons.clear();
		this.stripElement.replaceChildren();
		const tabs = append(this.stripElement, $('.session-tabs'));
		tabs.setAttribute('role', 'tablist');
		tabs.setAttribute('aria-label', localize('shellSessions', "Terminal Sessions"));
		const button = (parent: HTMLElement, text: string, label: string, id: string, run: () => Promise<void>) => {
			const node = append(parent, $<HTMLButtonElement>('button'));
			node.textContent = text;
			node.disabled = !this.service.sessions.length;
			node.setAttribute('aria-label', label);
			node.setAttribute('data-session-control', id);
			this.buttons.set(id, node);
			this.controls.add(addDisposableListener(node, EventType.CLICK, () => run().catch(error => this.notifications.error(error))));
			return node;
		};
		for (const session of this.service.sessions) {
			const wrapper = append(tabs, $('.session-tab'));
			wrapper.classList.toggle('active', session.active);
			const tab = button(wrapper, session.title, session.title, session.id, () => this.service.selectSession(session.id));
			tab.setAttribute('role', 'tab');
			tab.setAttribute('aria-selected', String(session.active));
			tab.tabIndex = session.active ? 0 : -1;
			this.controls.add(addDisposableListener(tab, EventType.KEY_DOWN, event => {
				if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
					event.preventDefault();
					void this.service.switchTerminal(event.key === 'ArrowLeft' ? -1 : 1).then(() => {
						const active = this.service.sessions.find(session => session.active);
						if (active) { this.buttons.get(active.id)?.focus(); }
					}, error => this.notifications.error(error));
				}
			}));
			button(wrapper, '×', localize('closeSession', "Close {0}", session.title), session.id + ':close', () => this.service.closeSession(session.id));
		}
		button(this.stripElement, '+', localize('newSession', "New Terminal"), 'new', () => this.service.newTerminal());
		const editor = this.service.sessions.some(session => session.active && session.mode === 'editor');
		const label = editor ? localize('returnToTerminal', "Return to Terminal") : localize('openEditor', "Open Editor");
		button(this.stripElement, label, label, 'toggle', () => this.service.toggle()).classList.add('session-toggle');
		if (focusedId) {
			this.buttons.get(focusedId)?.focus();
		}
	}

	toJSON(): object { return { type: Parts.TERMINAL_FIRST_PART }; }
}
