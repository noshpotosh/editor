/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { GroupDirection } from './editorGroupsService.js';

/** Four-pixel gutters plus a one-pixel border inside each grid cell. */
export const EDITOR_TILE_INSET = 5;
/** Smallest usable tile, including the group header and the tool toolbar. */
export const EDITOR_TILE_MIN_WIDTH = 230;
export const EDITOR_TILE_MIN_HEIGHT = 190;

/** Shown whenever a tile cannot be split without making a half unusable. */
export function noRoomForTileMessage(): string {
	return localize('noRoomForTile', "There is not enough room for another tile. Enlarge the window or close a tile first.");
}

function isHorizontal(direction: GroupDirection): boolean {
	return direction === GroupDirection.LEFT || direction === GroupDirection.RIGHT;
}

/** Whether splitting a tile of the given size in the given direction keeps both halves usable. */
export function tileFits(size: { width: number; height: number }, direction: GroupDirection): boolean {
	return isHorizontal(direction)
		? size.width >= EDITOR_TILE_MIN_WIDTH * 2 && size.height >= EDITOR_TILE_MIN_HEIGHT
		: size.height >= EDITOR_TILE_MIN_HEIGHT * 2 && size.width >= EDITOR_TILE_MIN_WIDTH;
}

/** Splits along the longer side, falling back to the other side unless a direction is requested. */
export function tileSplitDirection(size: { width: number; height: number }, direction?: GroupDirection): GroupDirection | undefined {
	if (direction !== undefined) { return tileFits(size, direction) ? direction : undefined; }
	const preferred = size.width > size.height ? GroupDirection.RIGHT : GroupDirection.DOWN;
	const fallback = preferred === GroupDirection.RIGHT ? GroupDirection.DOWN : GroupDirection.RIGHT;
	return tileFits(size, preferred) ? preferred : tileFits(size, fallback) ? fallback : undefined;
}

/** Splits a tile into two equal halves along the split axis. */
export function tileSplitSizes(size: { width: number; height: number }, direction: GroupDirection): { width: number; height: number } {
	return isHorizontal(direction) ? { width: Math.floor(size.width / 2), height: size.height } : { width: size.width, height: Math.floor(size.height / 2) };
}
