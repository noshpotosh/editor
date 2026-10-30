/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Color } from '../../../../base/common/color.js';
import { IEditorGroupTitleHeight } from '../../../browser/parts/editor/editor.js';
import { EditorPartHooks, IEditorGroupLayoutHook, IGroupRect } from '../../../browser/parts/editor/editorPartHooks.js';
import { terminalFirstEnabled } from '../../../services/terminalFirst/common/terminalFirstPolicy.js';
import { EDITOR_TILE_INSET, EDITOR_TILE_MIN_HEIGHT, EDITOR_TILE_MIN_WIDTH } from '../common/tileLayout.js';

/** Width reserved at the right of a tile header for the close control. */
const CLOSE_CONTROL_WIDTH = 32;
/** Tile headers never shrink below the height of the close control row. */
const MIN_TITLE_HEIGHT = 32;

/** Frames every editor group as a tile: a gutter around the cell, a reserved close control, and a usable minimum size. */
class TileLayoutHook implements IEditorGroupLayoutHook {
	/** Tiles keep their chosen sizes when focus follows the pointer. */
	readonly expandMinimizedGroupOnActivate = false;
	/** The gutter background shows between tiles instead of a separator line. */
	readonly gridSeparatorBorder = Color.transparent;

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
