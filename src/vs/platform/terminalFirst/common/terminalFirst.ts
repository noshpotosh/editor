/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import product from '../../product/common/product.js';
import { isTerminalFirstProduct } from './terminalFirstProduct.js';

/** True in VS NOSH builds. Every fork behavior in upstream code must be gated by this value. */
export const terminalFirstEnabled = isTerminalFirstProduct(product.urlProtocol);

export { isTerminalFirstProduct, TERMINAL_FIRST_TITLEBAR_HEIGHT, TERMINAL_FIRST_URL_PROTOCOL } from './terminalFirstProduct.js';
