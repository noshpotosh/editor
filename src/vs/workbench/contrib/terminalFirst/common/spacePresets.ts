/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';

/** The setting that holds the user's space presets. */
export const SPACE_PRESETS_SETTING = 'terminalFirst.spaces.presets';

export type SpacePresetDirection = 'left' | 'right' | 'up' | 'down';

/**
 * One tile of a preset. `tile` is `editor`, `terminal`, `web:<app>` (`jira`, `bitbucket`), or a
 * view or view container ID. Tiles open in order; each splits the tile opened by step `from`
 * (default: the previous one) toward `direction` and takes `size` of that cell (0 to 1, default half).
 */
export interface ISpacePresetTile {
	readonly tile: string;
	readonly direction?: SpacePresetDirection;
	readonly size?: number;
	readonly from?: number;
}

export interface ISpacePreset {
	readonly name: string;
	readonly tiles: readonly ISpacePresetTile[];
}

/** The presets shipped with VS NOSH; also the setting's default, so users see and edit them. */
export const defaultSpacePresets: readonly ISpacePreset[] = [
	{
		name: localize('presetCode', "Code"),
		tiles: [
			{ tile: 'editor' },
			{ tile: 'workbench.view.explorer', direction: 'left', size: 0.25, from: 0 },
			{ tile: 'terminal', direction: 'down', size: 0.3, from: 0 },
		],
	},
	{
		name: localize('presetReview', "Review"),
		tiles: [
			{ tile: 'editor' },
			{ tile: 'workbench.view.scm', direction: 'left', size: 0.3, from: 0 },
			{ tile: 'web:bitbucket', direction: 'right', size: 0.5, from: 0 },
		],
	},
];

const directions: readonly SpacePresetDirection[] = ['left', 'right', 'up', 'down'];

/** Keeps only well-formed presets from a setting value; a malformed entry is dropped rather than failing the whole list. */
export function validateSpacePresets(value: unknown): ISpacePreset[] {
	if (!Array.isArray(value)) {
		return [];
	}
	const presets: ISpacePreset[] = [];
	for (const candidate of value as unknown[]) {
		const preset = candidate as Partial<ISpacePreset> | undefined;
		if (!preset || typeof preset.name !== 'string' || !preset.name.trim() || !Array.isArray(preset.tiles)) {
			continue;
		}
		const tiles: ISpacePresetTile[] = [];
		for (const entry of preset.tiles as unknown[]) {
			const tile = entry as Partial<ISpacePresetTile> | undefined;
			if (!tile || typeof tile.tile !== 'string' || !tile.tile) {
				continue;
			}
			tiles.push({
				tile: tile.tile,
				direction: tile.direction && directions.includes(tile.direction) ? tile.direction : undefined,
				size: typeof tile.size === 'number' && tile.size > 0 && tile.size < 1 ? tile.size : undefined,
				from: typeof tile.from === 'number' && Number.isInteger(tile.from) && tile.from >= 0 && tile.from < tiles.length ? tile.from : undefined,
			});
		}
		presets.push({ name: preset.name.trim(), tiles });
	}
	return presets;
}

const builtInTileLabels: Record<string, string> = {
	editor: localize('tileEditor', "Editor"),
	terminal: localize('tileTerminal', "Terminal"),
	'web:jira': localize('tileJira', "Jira Board"),
	'web:bitbucket': localize('tileBitbucket', "Bitbucket"),
};

/** A short, readable list of a preset's tiles for pickers; `viewName` resolves view and container IDs. */
export function describeSpacePreset(preset: ISpacePreset, viewName: (id: string) => string | undefined): string {
	return preset.tiles.map(({ tile }) => builtInTileLabels[tile] ?? viewName(tile) ?? tile).join(', ');
}
