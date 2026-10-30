/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { activeContrastBorder, badgeBackground, badgeForeground, contrastBorder, focusBorder, listHighlightForeground, oneOf, quickInputBackground, quickInputForeground, registerColor, toolbarHoverBackground, widgetBorder, ColorTransformType } from '../../../../platform/theme/common/colorRegistry.js';
import { EDITOR_GROUP_BORDER, PANEL_BACKGROUND, PANEL_BORDER, SIDE_BAR_BACKGROUND, TAB_ACTIVE_BACKGROUND, TAB_ACTIVE_BORDER_TOP, TAB_ACTIVE_FOREGROUND, TAB_INACTIVE_FOREGROUND } from '../../../common/theme.js';
import { TERMINAL_BACKGROUND_COLOR, TERMINAL_CURSOR_FOREGROUND_COLOR, TERMINAL_FOREGROUND_COLOR } from '../../terminal/common/terminalColorRegistry.js';

/*
 * Terminal First colors. Every default refers to an existing workbench color, so themes that
 * do not know about Terminal First still render coherently, while themes and
 * `workbench.colorCustomizations` can target these surfaces individually.
 */

// Session strip

export const TERMINAL_FIRST_SESSION_STRIP_BACKGROUND = registerColor('terminalFirst.sessionStrip.background', oneOf(TERMINAL_BACKGROUND_COLOR, PANEL_BACKGROUND), localize('terminalFirst.sessionStrip.background', "Background color of the title bar session strip while the shell is shown."));
export const TERMINAL_FIRST_SESSION_TAB_ACTIVE_BACKGROUND = registerColor('terminalFirst.sessionTab.activeBackground', TAB_ACTIVE_BACKGROUND, localize('terminalFirst.sessionTab.activeBackground', "Background color of the active session tab."));
export const TERMINAL_FIRST_SESSION_TAB_ACTIVE_FOREGROUND = registerColor('terminalFirst.sessionTab.activeForeground', TAB_ACTIVE_FOREGROUND, localize('terminalFirst.sessionTab.activeForeground', "Foreground color of the active session tab."));
export const TERMINAL_FIRST_SESSION_TAB_ACTIVE_BORDER = registerColor('terminalFirst.sessionTab.activeBorder', {
	dark: TAB_ACTIVE_BORDER_TOP,
	light: TAB_ACTIVE_BORDER_TOP,
	hcDark: activeContrastBorder,
	hcLight: activeContrastBorder
}, localize('terminalFirst.sessionTab.activeBorder', "Border at the top of the active session tab."));
export const TERMINAL_FIRST_SESSION_TAB_INACTIVE_FOREGROUND = registerColor('terminalFirst.sessionTab.inactiveForeground', TAB_INACTIVE_FOREGROUND, localize('terminalFirst.sessionTab.inactiveForeground', "Foreground color of inactive session tabs and session strip buttons."));
export const TERMINAL_FIRST_SESSION_TAB_HOVER_BACKGROUND = registerColor('terminalFirst.sessionTab.hoverBackground', toolbarHoverBackground, localize('terminalFirst.sessionTab.hoverBackground', "Background color of session tabs and session strip buttons when hovered."));

// Floating surfaces: terminal, file browser, jump list, leader menu and Vim status

export const TERMINAL_FIRST_FLOATING_BACKGROUND = registerColor('terminalFirst.floating.background', quickInputBackground, localize('terminalFirst.floating.background', "Background color of floating surfaces such as the floating terminal, file browser, jump list and leader menu."));
export const TERMINAL_FIRST_FLOATING_FOREGROUND = registerColor('terminalFirst.floating.foreground', quickInputForeground, localize('terminalFirst.floating.foreground', "Foreground color of floating surfaces such as the floating terminal, file browser, jump list and leader menu."));
export const TERMINAL_FIRST_FLOATING_BORDER = registerColor('terminalFirst.floating.border', {
	dark: oneOf(widgetBorder, PANEL_BORDER),
	light: oneOf(widgetBorder, PANEL_BORDER),
	hcDark: contrastBorder,
	hcLight: contrastBorder
}, localize('terminalFirst.floating.border', "Border color of floating surfaces such as the floating terminal, file browser, jump list and leader menu."));
export const TERMINAL_FIRST_MARKER_FOREGROUND = registerColor('terminalFirst.marker.foreground', listHighlightForeground, localize('terminalFirst.marker.foreground', "Foreground color of the file browser prompt and of marked file browser rows."));

// Tiles

export const TERMINAL_FIRST_TILE_BORDER = registerColor('terminalFirst.tile.border', {
	dark: EDITOR_GROUP_BORDER,
	light: EDITOR_GROUP_BORDER,
	hcDark: contrastBorder,
	hcLight: contrastBorder
}, localize('terminalFirst.tile.border', "Border color of inactive tiles."));
export const TERMINAL_FIRST_TILE_ACTIVE_BORDER = registerColor('terminalFirst.tile.activeBorder', {
	dark: focusBorder,
	light: focusBorder,
	hcDark: activeContrastBorder,
	hcLight: activeContrastBorder
}, localize('terminalFirst.tile.activeBorder', "Border color of the active tile when more than one tile is open."));
export const TERMINAL_FIRST_TILE_HOVER_BORDER = registerColor('terminalFirst.tile.hoverBorder', {
	// An opaque midpoint, so the border transition never passes through transparency.
	dark: { op: ColorTransformType.Mix, color: TERMINAL_FIRST_TILE_ACTIVE_BORDER, with: TERMINAL_FIRST_TILE_BORDER, ratio: 0.5 },
	light: { op: ColorTransformType.Mix, color: TERMINAL_FIRST_TILE_ACTIVE_BORDER, with: TERMINAL_FIRST_TILE_BORDER, ratio: 0.5 },
	hcDark: activeContrastBorder,
	hcLight: activeContrastBorder
}, localize('terminalFirst.tile.hoverBorder', "Border color of an inactive tile while the pointer rests on it."));
export const TERMINAL_FIRST_TILE_GUTTER_BACKGROUND = registerColor('terminalFirst.tile.gutterBackground', SIDE_BAR_BACKGROUND, localize('terminalFirst.tile.gutterBackground', "Background color of the gutter between tiles and of tool tiles such as Explorer and Git Changes."));

// Copy mode

export const TERMINAL_FIRST_COPY_MODE_BADGE_BACKGROUND = registerColor('terminalFirst.copyMode.badgeBackground', badgeBackground, localize('terminalFirst.copyMode.badgeBackground', "Background color of the copy mode badge."));
export const TERMINAL_FIRST_COPY_MODE_BADGE_FOREGROUND = registerColor('terminalFirst.copyMode.badgeForeground', badgeForeground, localize('terminalFirst.copyMode.badgeForeground', "Foreground color of the copy mode badge."));
export const TERMINAL_FIRST_COPY_MODE_CURSOR_BORDER = registerColor('terminalFirst.copyMode.cursorBorder', oneOf(TERMINAL_CURSOR_FOREGROUND_COLOR, TERMINAL_FOREGROUND_COLOR), localize('terminalFirst.copyMode.cursorBorder', "Outline color of the copy mode cursor."));
