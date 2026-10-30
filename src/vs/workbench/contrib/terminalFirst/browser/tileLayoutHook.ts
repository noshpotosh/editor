/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Color } from '../../../../base/common/color.js';
import { BrowserViewUri } from '../../../../platform/browserView/common/browserViewUri.js';
import { IEditorGroupTitleHeight } from '../../../browser/parts/editor/editor.js';
import { EditorPartHooks, IEditorGroupLayoutHook, IGroupRect } from '../../../browser/parts/editor/editorPartHooks.js';
import { EditorInputCapabilities } from '../../../common/editor.js';
import { GroupLayoutArgument, GroupOrientation, GroupsOrder, IEditorGroup, IEditorPart } from '../../../services/editor/common/editorGroupsService.js';
import { terminalFirstEnabled } from '../../../services/terminalFirst/common/terminalFirstPolicy.js';
import { EDITOR_TILE_INSET, EDITOR_TILE_MIN_HEIGHT, EDITOR_TILE_MIN_WIDTH } from '../common/tileLayout.js';

/** Width reserved at the right of a tile header for the close control. */
const CLOSE_CONTROL_WIDTH = 32;
/** Tile headers never shrink below the height of the close control row. */
const MIN_TITLE_HEIGHT = 32;

interface BalancedTileLayout {
	readonly layout: GroupLayoutArgument;
	readonly editorOnly: boolean;
	readonly columns: number;
	readonly rows: number;
}

/** Empty groups are editor tiles; dedicated tools, terminals, and browser tiles keep their sizes. */
function isEditorTile(group: IEditorGroup): boolean {
	return group.editors.every(editor => !editor.hasCapability(EditorInputCapabilities.RequiresDedicatedGroup) && editor.resource?.scheme !== BrowserViewUri.scheme);
}

/** Frames every editor group as a tile: a gutter around the cell, a reserved close control, and a usable minimum size. */
class TileLayoutHook implements IEditorGroupLayoutHook {
	/** Tiles keep their chosen sizes when focus follows the pointer. */
	readonly expandMinimizedGroupOnActivate = false;
	/** A new tile takes half its source cell, leaving surrounding tiles at their chosen sizes. */
	readonly preserveOtherGroupsOnSplit = true;
	/** The gutter background shows between tiles instead of a separator line. */
	readonly gridSeparatorBorder = Color.transparent;

	onDidSplitEditor(part: IEditorPart, source: IEditorGroup): void {
		if (!isEditorTile(source)) {
			return;
		}
		const groups = part.getGroups(GroupsOrder.GRID_APPEARANCE);
		const layout = part.getLayout();
		let index = 0;
		let changed = false;
		const balance = (node: GroupLayoutArgument, orientation: GroupOrientation): BalancedTileLayout => {
			if (!node.groups) {
				return { layout: node, editorOnly: isEditorTile(groups[index++]), columns: 1, rows: 1 };
			}
			const horizontal = orientation === GroupOrientation.HORIZONTAL;
			const children = node.groups.map(child => balance(child, horizontal ? GroupOrientation.VERTICAL : GroupOrientation.HORIZONTAL));
			// Mixed branches keep their dimensions so tool and terminal tiles never resize.
			const editors = children.filter(child => child.editorOnly);
			const size = editors.reduce((sum, child) => sum + (child.layout.size ?? 0), 0);
			const units = editors.reduce((sum, child) => sum + (horizontal ? child.columns : child.rows), 0);
			const balanced = children.map(child => {
				if (!child.editorOnly || editors.length < 2) {
					return child.layout;
				}
				const target = size * (horizontal ? child.columns : child.rows) / units;
				changed ||= Math.abs(target - (child.layout.size ?? 0)) > 0.5;
				return { ...child.layout, size: target };
			});
			return {
				layout: { ...node, groups: balanced },
				editorOnly: children.every(child => child.editorOnly),
				columns: horizontal ? children.reduce((sum, child) => sum + child.columns, 0) : Math.max(...children.map(child => child.columns)),
				rows: horizontal ? Math.max(...children.map(child => child.rows)) : children.reduce((sum, child) => sum + child.rows, 0),
			};
		};
		const balanced = balance({ groups: layout.groups }, layout.orientation);
		if (changed) {
			part.applyLayout({ orientation: layout.orientation, groups: balanced.layout.groups! });
		}
	}

	adjustLayout(rect: IGroupRect): IGroupRect & { readonly titleWidth: number } {
		const width = Math.max(0, rect.width - EDITOR_TILE_INSET * 2);
		return {
			width,
			height: Math.max(0, rect.height - EDITOR_TILE_INSET * 2),
			top: rect.top + EDITOR_TILE_INSET,
			left: rect.left + EDITOR_TILE_INSET,
			titleWidth: Math.max(0, width - CLOSE_CONTROL_WIDTH),
		};
	}

	minimumSize(size: { readonly width: number; readonly height: number }): { readonly width: number; readonly height: number } {
		return { width: Math.max(EDITOR_TILE_MIN_WIDTH, size.width + EDITOR_TILE_INSET * 2), height: Math.max(EDITOR_TILE_MIN_HEIGHT, size.height + EDITOR_TILE_INSET * 2) };
	}

	titleHeight(height: IEditorGroupTitleHeight): IEditorGroupTitleHeight {
		return { total: Math.max(MIN_TITLE_HEIGHT, height.total), offset: height.offset };
	}
}

if (terminalFirstEnabled) {
	EditorPartHooks.setLayoutHook(new TileLayoutHook());
}
