/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Registry } from '../../../../platform/registry/common/platform.js';
import { Extensions as ViewExtensions, IViewContainersRegistry, IViewsRegistry } from '../../../common/views.js';
import { VIEWLET_ID as EXPLORER_VIEWLET_ID } from '../../files/common/files.js';
import { IOutlinePane } from '../../outline/browser/outline.js';
import { HISTORY_VIEW_PANE_ID, VIEWLET_ID as SCM_VIEWLET_ID } from '../../scm/common/scm.js';
import { TimelinePaneId } from '../../timeline/common/timeline.js';
import { terminalFirstEnabled } from '../../../services/terminalFirst/common/terminalFirstPolicy.js';

/**
 * Views VS NOSH does not offer: the Source Control Graph, Outline, and Timeline. They are removed
 * after their contributions register them, which keeps those upstream files untouched. This module
 * must be evaluated after `workbench.common.main`, which `terminalFirst.contribution` guarantees.
 */
const prunedViews: readonly (readonly [viewId: string, containerId: string])[] = [
	[HISTORY_VIEW_PANE_ID, SCM_VIEWLET_ID],
	[IOutlinePane.Id, EXPLORER_VIEWLET_ID],
	[TimelinePaneId, EXPLORER_VIEWLET_ID],
];

export function pruneTerminalFirstViews(): void {
	const views = Registry.as<IViewsRegistry>(ViewExtensions.ViewsRegistry);
	const containers = Registry.as<IViewContainersRegistry>(ViewExtensions.ViewContainersRegistry);
	for (const [viewId, containerId] of prunedViews) {
		const container = containers.get(containerId);
		const view = container && views.getViews(container).find(view => view.id === viewId);
		if (container && view) {
			views.deregisterViews([view], container);
		}
	}
}

if (terminalFirstEnabled) {
	pruneTerminalFirstViews();
}
