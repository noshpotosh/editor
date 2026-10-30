/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import './sessionStrip.css';
import { $, append, addDisposableListener, EventType } from '../../../../base/browser/dom.js';
import { getDefaultHoverDelegate } from '../../../../base/browser/ui/hover/hoverDelegateFactory.js';
import { renderIcon } from '../../../../base/browser/ui/iconLabel/iconLabels.js';
import { Disposable, DisposableStore } from '../../../../base/common/lifecycle.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import { localize } from '../../../../nls.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { NotificationService } from '../../../services/notification/common/notificationService.js';
import { terminalFirstPolicy } from '../../../services/terminalFirst/common/terminalFirstPolicy.js';
import { ITerminalFirstService } from '../../../services/terminalFirst/common/terminalFirst.js';
import { sessionCloseIcon, sessionDirtyIcon, sessionEditorIcon, sessionNewIcon, sessionNotificationsIcon, sessionShellIcon } from './terminalFirstIcons.js';

/** The session strip belongs to the window, outside both editor and terminal surfaces. */
export class SessionTabsWidget extends Disposable {
	private readonly controls = this._register(new DisposableStore());
	private stripElement: HTMLElement | undefined;
	private readonly buttons = new Map<string, HTMLElement>();

	constructor(
		parent: HTMLElement,
		@ITerminalFirstService private readonly service: ITerminalFirstService,
		@INotificationService private readonly notifications: INotificationService,
		@ICommandService private readonly commands: ICommandService,
		@IHoverService private readonly hoverService: IHoverService,
	) {
		super();
		this.stripElement = parent;
		this.render();
		this._register(service.onDidChangeSessions(() => this.scheduleRender()));
		this._register((notifications as NotificationService).model.onDidChangeNotification(() => this.scheduleRender()));
	}

	private renderQueued = false;

	/** Session events arrive in bursts (title changes, reconnects, layout recovery); the strip rebuilds once per tick. */
	private scheduleRender(): void {
		if (this.renderQueued) { return; }
		this.renderQueued = true;
		queueMicrotask(() => {
			this.renderQueued = false;
			if (!this._store.isDisposed) { this.render(); }
		});
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
		const button = (parent: HTMLElement, content: { icon?: ThemeIcon; text?: string }, label: string, id: string, run: () => Promise<void>) => {
			const node = append(parent, $<HTMLButtonElement>('button'));
			if (content.icon) { append(node, renderIcon(content.icon)); }
			if (content.text) { append(node, $('span.session-label')).textContent = content.text; }
			node.disabled = !this.service.sessions.length;
			node.setAttribute('aria-label', label);
			node.setAttribute('data-session-control', id);
			this.buttons.set(id, node);
			this.controls.add(this.hoverService.setupManagedHover(getDefaultHoverDelegate('element'), node, label));
			this.controls.add(addDisposableListener(node, EventType.CLICK, () => run().catch(error => this.notifications.error(error))));
			return node;
		};
		for (const session of this.service.sessions) {
			const wrapper = append(tabs, $('.session-tab'));
			wrapper.classList.toggle('active', session.active);
			wrapper.classList.toggle('dirty', !!session.dirty);
			const mode = session.mode === 'shell' ? localize('shellMode', "Shell") : localize('editorMode', "Editor");
			const tab = button(wrapper, { icon: session.mode === 'shell' ? sessionShellIcon : sessionEditorIcon, text: session.title }, localize('sessionMode', "{0} ({1})", session.title, mode), session.id, () => this.service.selectSession(session.id));
			tab.classList.add('session-select');
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
			// Like editor tabs, a dirty session shows a dot that turns into the close button on intent.
			const close = button(wrapper, { icon: sessionCloseIcon }, localize('closeSession', "Close {0}", session.title), session.id + ':close', () => this.service.closeSession(session.id));
			close.classList.add('session-close');
			if (session.dirty) { append(close, renderIcon(sessionDirtyIcon)).classList.add('session-dirty-indicator'); }
		}
		button(tabs, { icon: sessionNewIcon }, localize('newSession', "New Terminal"), 'new', () => this.service.newTerminal()).classList.add('session-new');
		const count = (this.notifications as NotificationService).model.notifications.length;
		if (terminalFirstPolicy.shell && count) {
			button(tabs, { icon: sessionNotificationsIcon, text: String(count) }, localize('notifications', "Show {0} Notifications in Editor", count), 'notifications', async () => {
				await this.service.showEditor();
				await this.commands.executeCommand('notifications.showList');
			}).classList.add('session-notifications');
		}
		if (focusedId) {
			this.buttons.get(focusedId)?.focus();
		}
	}

}
