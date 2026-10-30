/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { isMacintosh, isNative } from '../../../base/common/platform.js';

/** The URL protocol that identifies a VS NOSH build; also the feature gate for every fork behavior. */
export const TERMINAL_FIRST_URL_PROTOCOL = 'terminal-first';

/** Height of the title bar that holds the session strip, shared with electron-main sheet offsets. */
export const TERMINAL_FIRST_TITLEBAR_HEIGHT = 36;

/**
 * Whether a product configuration is VS NOSH. Pure so early bootstrap code and the extension
 * host can call it without loading the product module.
 */
export function isTerminalFirstProduct(urlProtocol: string | undefined, platform: { readonly isMacintosh: boolean; readonly isNative: boolean } = { isMacintosh, isNative }): boolean {
	return platform.isNative && platform.isMacintosh && urlProtocol === TERMINAL_FIRST_URL_PROTOCOL;
}
