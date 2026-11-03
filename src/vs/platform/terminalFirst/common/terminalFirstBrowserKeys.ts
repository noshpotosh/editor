/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { SCAN_CODE_STR_TO_EVENT_KEY_CODE } from '../../../base/common/keyCodes.js';
import type { IBrowserViewKeyDownEvent } from '../../browserView/common/browserView.js';

interface IBrowserKeyInput {
	readonly type: string;
	readonly code: string;
	readonly key: string;
	readonly control: boolean;
	readonly shift: boolean;
	readonly alt: boolean;
	readonly meta: boolean;
	readonly isAutoRepeat: boolean;
	readonly isComposing?: boolean;
	readonly modifiers?: readonly string[];
}

interface IBrowserKeyTarget {
	preventDefault(): void;
	focusWorkbench(): void;
	dispatch(event: IBrowserViewKeyDownEvent): void;
}

const directions = new Set(['KeyH', 'KeyJ', 'KeyK', 'KeyL']);
// Keep this limited to the default tile/space controls. Other website shortcuts and text stay local.
const tileAndSpaceKeys = new Set([
	'Enter', 'KeyE', 'KeyG', 'KeyT', 'KeyB', 'KeyC', 'KeyQ', 'KeyF', 'KeyO', 'Equal', 'KeyX',
	'KeyH', 'KeyJ', 'KeyK', 'KeyL', 'ArrowLeft', 'ArrowDown', 'ArrowUp', 'ArrowRight',
	'KeyN', 'BracketLeft', 'BracketRight', ...Array.from({ length: 9 }, (_, index) => `Digit${index + 1}`),
]);

/** Claims app navigation before a page can consume it, without changing ordinary browser input. */
export class TerminalFirstBrowserKeyRouter {
	private swapDeadline = 0;

	constructor(private readonly enabled: boolean) { }

	reset(): void { this.swapDeadline = 0; }

	forward(input: IBrowserKeyInput, target: IBrowserKeyTarget): boolean {
		if (!this.enabled || input.type !== 'keyDown') {
			return false;
		}
		if (input.isComposing || input.modifiers?.includes('altGr')) {
			this.reset();
			return false;
		}
		if (['Control', 'Shift', 'Alt', 'Meta'].includes(input.key)) {
			return false;
		}
		const control = input.control && !input.meta;
		const leader = control && !input.alt && !input.shift && input.code === 'Space';
		const navigation = control && !input.alt && !input.shift && directions.has(input.code);
		const tileOrSpace = control && input.alt && (input.shift ? directions.has(input.code) : tileAndSpaceKeys.has(input.code));
		const swap = tileOrSpace && !input.shift && input.code === 'KeyX';
		const continuation = this.swapDeadline > Date.now();
		if (!leader && !navigation && !tileOrSpace && !continuation) {
			return false;
		}

		target.preventDefault();
		if (swap && continuation && input.isAutoRepeat) {
			return true;
		}
		// Match the workbench chord budget. Keep native focus for swap so cancel returns to the page.
		this.swapDeadline = swap && !continuation ? Date.now() + 5000 : 0;
		// Leader continuations are DOM events: move focus before the first key is dispatched.
		if (leader && !continuation) {
			target.focusWorkbench();
		}
		target.dispatch({
			key: input.key,
			keyCode: SCAN_CODE_STR_TO_EVENT_KEY_CODE[input.code] || 0,
			code: input.code,
			ctrlKey: input.control,
			shiftKey: input.shift,
			altKey: input.alt,
			metaKey: input.meta,
			repeat: input.isAutoRepeat,
		});
		return true;
	}
}
