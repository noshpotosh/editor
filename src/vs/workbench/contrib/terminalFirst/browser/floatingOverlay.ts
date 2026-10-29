/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { getWindow } from '../../../../base/browser/dom.js';
import { IWorkbenchLayoutService, Parts } from '../../../services/layout/browser/layoutService.js';

/** Keeps companion overlays centered within the active editor area. */
export function layoutFloatingOverlay(element: HTMLElement, layoutService: IWorkbenchLayoutService): number {
	const editor = layoutService.getContainer(getWindow(element), Parts.EDITOR_PART);
	if (!editor) { return 0; }
	const area = editor.getBoundingClientRect();
	const container = layoutService.mainContainer.getBoundingClientRect();
	const width = Math.min(1000, area.width * 0.8);
	const height = Math.min(640, area.height * 0.6);
	element.style.left = `${area.left - container.left + (area.width - width) / 2}px`;
	element.style.top = `${area.top - container.top + (area.height - height) / 2}px`;
	element.style.width = `${width}px`;
	element.style.height = `${height}px`;
	return width;
}
