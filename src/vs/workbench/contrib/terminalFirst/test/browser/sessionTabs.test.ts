/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { deepStrictEqual } from 'assert';
import { Emitter } from '../../../../../base/common/event.js';
import { toDisposable } from '../../../../../base/common/lifecycle.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { upcastPartial } from '../../../../../base/test/common/mock.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { IHoverService } from '../../../../../platform/hover/browser/hover.js';
import { ITerminalFirstService, ITerminalFirstSession } from '../../../../services/terminalFirst/common/terminalFirst.js';
import { SessionTabsWidget } from '../../browser/sessionStripPart.js';
import { NotificationService } from '../../../../services/notification/common/notificationService.js';
import { workbenchInstantiationService } from '../../../../test/browser/workbenchTestServices.js';

suite('Session title-bar tabs', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();
	test('renders modes and dirty state, then switches and focuses via arrows', async () => {
		const instantiation = workbenchInstantiationService(undefined, store);
		const parent = document.createElement('div'); document.body.appendChild(parent);
		store.add(toDisposable(() => parent.remove()));
		const changed = store.add(new Emitter<void>());
		let sessions: ITerminalFirstSession[] = [{ id: 'one', title: 'One', mode: 'shell', active: true }, { id: 'two', title: 'Two', mode: 'editor', dirty: true, active: false }];
		const service = upcastPartial<ITerminalFirstService>({
			get sessions() { return sessions; }, onDidChangeSessions: changed.event,
			switchTerminal: async offset => { sessions = sessions.map((session, index) => ({ ...session, active: index === offset })); changed.fire(); },
		});
		const notifications = store.add(instantiation.createInstance(NotificationService));
		store.add(new SessionTabsWidget(parent, service, notifications, instantiation.get(ICommandService), instantiation.get(IHoverService)));
		parent.querySelector<HTMLButtonElement>('[role=tab]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
		await Promise.resolve();
		deepStrictEqual({ tabs: [...parent.querySelectorAll('[role=tab]')].map(tab => [tab.getAttribute('aria-label'), tab.parentElement!.classList.contains('dirty'), tab.getAttribute('aria-selected'), tab.getAttribute('tabindex')]), focus: document.activeElement?.getAttribute('data-session-control') }, { tabs: [['One (Shell)', false, 'false', '-1'], ['Two (Editor)', true, 'true', '0']], focus: 'two' });
	});
});
