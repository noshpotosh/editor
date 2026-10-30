/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, MutableDisposable } from '../../../../base/common/lifecycle.js';
import { localize } from '../../../../nls.js';
import { IWorkbenchContribution } from '../../../common/contributions.js';
import { IStatusbarEntry, IStatusbarEntryAccessor, IStatusbarService, StatusbarAlignment } from '../../../services/statusbar/browser/statusbar.js';
import { ITerminalFirstService } from '../../../services/terminalFirst/common/terminalFirst.js';

/** Left of the branch indicator (10000), right of the remote indicator. */
const PRIORITY = 11000;
export const SPACE_STATUS_ENTRY_ID = 'terminalFirst.spaces';

/**
 * The space switcher: one status bar dropdown showing the active space and opening the space picker. It exists only while the active session is in editor mode and has more
 * than one space, so a session with a single layout shows no trace of the feature.
 */
export class SpaceStatusContribution extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.terminalFirstSpaceStatus';

	private readonly entry = this._register(new MutableDisposable<IStatusbarEntryAccessor>());

	constructor(
		@ITerminalFirstService private readonly service: ITerminalFirstService,
		@IStatusbarService private readonly statusbar: IStatusbarService,
	) {
		super();
		this.render();
		this._register(service.onDidChangeSessions(() => this.render()));
	}

	private render(): void {
		const session = this.service.sessions.find(session => session.active);
		const spaces = session?.mode === 'editor' ? session.spaces : [];
		if (spaces.length < 2) {
			this.entry.clear();
			return;
		}
		const active = spaces.find(space => space.active) ?? spaces[0];
		const index = spaces.indexOf(active) + 1;
		const entry: IStatusbarEntry = {
			name: localize('spaces', "Spaces"),
			text: `$(layout) ${index} ${active.name} $(chevron-up)`,
			ariaLabel: localize('spaceOf', "Space {0} of {1}: {2}", index, spaces.length, active.name),
			tooltip: localize('switchSpace', "Switch Space"),
			command: 'terminalFirst.space.pick',
		};
		if (this.entry.value) {
			this.entry.value.update(entry);
		} else {
			this.entry.value = this.statusbar.addEntry(entry, SPACE_STATUS_ENTRY_ID, StatusbarAlignment.LEFT, PRIORITY);
		}
	}

}
