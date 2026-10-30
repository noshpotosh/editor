/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { EditorInputCapabilities } from '../../../common/editor.js';
import { EditorInput } from '../../../common/editor/editorInput.js';
import { EditorGroupRouting, IEditorGroupRoutingHook } from '../../../services/editor/common/editorGroupRouting.js';
import { GroupsOrder, IEditorGroup, IEditorGroupsService } from '../../../services/editor/common/editorGroupsService.js';
import { terminalFirstEnabled } from '../../../services/terminalFirst/common/terminalFirstPolicy.js';
import { noRoomForTileMessage, tileSplitDirection } from '../common/tileLayout.js';

/** Dedicated tool groups (terminal and view tiles) cannot accept another input, even with an explicit target. */
export function isGroupDedicatedForEditor(group: IEditorGroup, editor: EditorInput | undefined): boolean {
	return group.editors.some(existing => (!editor || !existing.matches(editor)) && (existing.hasCapability(EditorInputCapabilities.RequiresDedicatedGroup) || !!editor?.hasCapability(EditorInputCapabilities.RequiresDedicatedGroup)));
}

/** Keeps tool and terminal tiles exclusive: files aimed at them open in the last editor tile, or in a new one when there is room. */
class TileRouting implements IEditorGroupRoutingHook {
	resolveGroup(group: IEditorGroup, editor: EditorInput | undefined, editorGroupService: IEditorGroupsService): IEditorGroup {
		if (!isGroupDedicatedForEditor(group, editor)) {
			return group;
		}
		const candidate = editorGroupService.getGroups(GroupsOrder.MOST_RECENTLY_ACTIVE).find(candidate => !isGroupDedicatedForEditor(candidate, editor) && !candidate.isLocked);
		if (candidate) {
			return candidate;
		}
		const direction = tileSplitDirection(editorGroupService.getSize(group));
		if (direction === undefined) {
			throw new Error(noRoomForTileMessage());
		}
		return editorGroupService.addGroup(group, direction);
	}

	canPlace(group: IEditorGroup, editor: EditorInput): boolean {
		return !isGroupDedicatedForEditor(group, editor);
	}

	canCopyGroup(group: IEditorGroup): boolean {
		return !group.editors.some(editor => editor.hasCapability(EditorInputCapabilities.RequiresDedicatedGroup));
	}
}

if (terminalFirstEnabled) {
	EditorGroupRouting.set(new TileRouting());
}
