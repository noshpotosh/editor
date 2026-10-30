/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { deepStrictEqual } from 'assert';
import { Emitter } from '../../../../../base/common/event.js';
import { toDisposable } from '../../../../../base/common/lifecycle.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { upcastPartial } from '../../../../../base/test/common/mock.js';
import { IStatusbarEntry, IStatusbarService } from '../../../../services/statusbar/browser/statusbar.js';
import { ITerminalFirstService, ITerminalFirstSession, ITerminalFirstSpace } from '../../../../services/terminalFirst/common/terminalFirst.js';
import { SpaceStatusContribution } from '../../browser/spaceStatus.js';

suite('Space status bar switcher', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	test('shows the active space dropdown for two or more spaces and leaves for one space or the shell', () => {
		const changed = store.add(new Emitter<void>());
		const spaces = (names: string[], active = 0): ITerminalFirstSpace[] => names.map((name, index) => ({ id: name.toLowerCase(), name, active: index === active, dirty: name === 'Review' }));
		let sessions: ITerminalFirstSession[] = [{ id: 'one', title: 'One', mode: 'editor', active: true, spaces: spaces(['Code']) }];
		const service = upcastPartial<ITerminalFirstService>({
			get sessions() { return sessions; }, onDidChangeSessions: changed.event,
		});
		const entries: IStatusbarEntry[] = [];
		let live = 0;
		const statusbar = upcastPartial<IStatusbarService>({
			addEntry: (entry: IStatusbarEntry) => {
				live++;
				const record = { ...entry };
				entries.push(record);
				return { update: next => { Object.assign(record, next); }, dispose: () => { live--; } };
			},
		});
		store.add(new SpaceStatusContribution(service, statusbar));
		const single = { live, entries: entries.length };
		sessions = [{ ...sessions[0], spaces: spaces(['Code', 'Review'], 1) }];
		changed.fire();
		const two = { live, text: entries.at(-1)?.text, aria: entries.at(-1)?.ariaLabel, command: entries.at(-1)?.command, content: entries.at(-1)?.content };
		sessions = [{ ...sessions[0], spaces: spaces(['A', 'B', 'C', 'D', 'E'], 2) }];
		changed.fire();
		const five = { live, text: entries.at(-1)?.text, content: entries.at(-1)?.content };
		sessions = [{ ...sessions[0], mode: 'shell' }];
		changed.fire();
		const shell = { live };
		store.add(toDisposable(() => { sessions = []; }));
		deepStrictEqual({ single, two, five, shell }, {
			single: { live: 0, entries: 0 },
			two: { live: 1, text: '$(layout) 2 Review $(chevron-up)', aria: 'Space 2 of 2: Review', command: 'terminalFirst.space.pick', content: undefined },
			five: { live: 1, text: '$(layout) 3 C $(chevron-up)', content: undefined },
			shell: { live: 0 },
		});
	});
});
