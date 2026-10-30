/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IDisposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { EditorInput } from '../../../common/editor/editorInput.js';
import { IEditorGroup, IEditorGroupsService } from './editorGroupsService.js';

/**
 * Lets a product keep some editor groups exclusive to one input. The group finder, group views,
 * and the editor part consult the registered hook at fixed points; without a hook, every group
 * accepts every editor as upstream does.
 */
export interface IEditorGroupRoutingHook {
	/** Returns the group an editor aimed at `group` should open in instead; throws to refuse the open. */
	resolveGroup(group: IEditorGroup, editor: EditorInput | undefined, editorGroupService: IEditorGroupsService): IEditorGroup;
	/** Whether `editor` may be opened, moved, or copied into `group`. */
	canPlace(group: IEditorGroup, editor: EditorInput): boolean;
	/** Whether copying `group` may duplicate its editors into the new group. */
	canCopyGroup(group: IEditorGroup): boolean;
}

let current: IEditorGroupRoutingHook | undefined;

export const EditorGroupRouting = {
	/** Registers the single routing hook for this window. */
	set(hook: IEditorGroupRoutingHook): IDisposable {
		if (current) {
			throw new Error('An editor group routing hook is already registered');
		}
		current = hook;
		return toDisposable(() => {
			if (current === hook) {
				current = undefined;
			}
		});
	},
	get(): IEditorGroupRoutingHook | undefined {
		return current;
	},
};
