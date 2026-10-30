/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ISerializedGrid } from '../../../../base/browser/ui/grid/grid.js';
import { Color } from '../../../../base/common/color.js';
import { IDisposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { GroupIdentifier } from '../../../common/editor.js';
import { IEditorPart } from '../../../services/editor/common/editorGroupsService.js';
import { IEditorGroupTitleHeight, IEditorGroupView } from './editor.js';
import type { IEditorPartUIState } from './editorPart.js';

export interface IGroupRect {
	readonly width: number;
	readonly height: number;
	readonly top: number;
	readonly left: number;
}

/**
 * Adjusts how editor groups are sized and framed. A product registers one hook; without it the
 * group fills its grid cell as upstream does.
 */
export interface IEditorGroupLayoutHook {
	/** Insets the rectangle a group may use and optionally narrows its title row. */
	adjustLayout?(rect: IGroupRect): IGroupRect & { readonly titleWidth?: number };
	/** Raises the minimum size of a group. */
	minimumSize?(size: { readonly width: number; readonly height: number }): { readonly width: number; readonly height: number };
	/** Adjusts the height reserved for the group title. */
	titleHeight?(height: IEditorGroupTitleHeight): IEditorGroupTitleHeight;
	/** Whether activating a minimized group expands it. Defaults to true. */
	readonly expandMinimizedGroupOnActivate?: boolean;
	/** The color of the separators between groups; defaults to the theme's group border. */
	readonly gridSeparatorBorder?: Color;
}

/** Internals an editor part extension may drive. Each member maps to one private operation of the part. */
export interface IEditorPartExtensionContext {
	readonly part: IEditorPart;
	/** Every group view the part owns, including ones an extension hides. */
	readonly groupViews: ReadonlyMap<GroupIdentifier, IEditorGroupView>;
	readonly memento: { [key: string]: unknown };
	willRestoreState(): boolean;
	mostRecentActiveGroups(): GroupIdentifier[];
	setMostRecentActiveGroups(groups: GroupIdentifier[]): void;
	createState(): IEditorPartUIState;
	/** Replaces the grid with the serialized one, reusing the given views in grid order when provided. */
	restoreGrid(serializedGrid: ISerializedGrid, activeGroup: GroupIdentifier, reuse?: IEditorGroupView[]): void;
	/** Replaces the grid with a single new group. */
	createSingleGroupGrid(): IEditorGroupView;
	setGroupActive(group: IEditorGroupView): void;
	swapViews(group: IEditorGroupView, other: IEditorGroupView): void;
	/** Whether focus was inside `element`, so it should be restored after a structural change. */
	shouldRestoreFocus(element: HTMLElement): boolean;
	/** Renumbers groups and lays the grid out again after a structural change. */
	relayout(): void;
	fireDidAddGroup(group: IEditorGroupView): void;
	fireDidRemoveGroup(group: IEditorGroupView): void;
	fireDidMoveGroup(group: IEditorGroupView): void;
}

/** Extends an editor part. One instance is created per part. */
export interface IEditorPartExtension extends IDisposable {
	/** Whether `group` takes part in `groups`, `count`, and navigation. Defaults to true. */
	isGroupVisible?(group: IEditorGroupView): boolean;
	/** Called for every group view the part creates, including restored ones. */
	onDidCreateGroupView?(group: IEditorGroupView): void;
	/** Called once the part's groups are restored, before `whenRestored` resolves. */
	onDidRestore?(): Promise<void> | void;
	/** Called when the part persists its state. */
	saveState?(): void;
}

export type EditorPartExtensionFactory = (context: IEditorPartExtensionContext, instantiationService: IInstantiationService) => IEditorPartExtension;

const factories: EditorPartExtensionFactory[] = [];
let layoutHook: IEditorGroupLayoutHook | undefined;

export const EditorPartHooks = {
	get layout(): IEditorGroupLayoutHook | undefined {
		return layoutHook;
	},
	/** Registers the single layout hook for this window. */
	setLayoutHook(hook: IEditorGroupLayoutHook): IDisposable {
		if (layoutHook) {
			throw new Error('An editor group layout hook is already registered');
		}
		layoutHook = hook;
		return toDisposable(() => {
			if (layoutHook === hook) {
				layoutHook = undefined;
			}
		});
	},
	/** Registers a factory that is invoked for every editor part created afterwards. */
	registerExtension(factory: EditorPartExtensionFactory): IDisposable {
		factories.push(factory);
		return toDisposable(() => {
			const index = factories.indexOf(factory);
			if (index >= 0) {
				factories.splice(index, 1);
			}
		});
	},
	createExtensions(context: IEditorPartExtensionContext, instantiationService: IInstantiationService): IEditorPartExtension[] {
		return factories.map(factory => factory(context, instantiationService));
	},
};
