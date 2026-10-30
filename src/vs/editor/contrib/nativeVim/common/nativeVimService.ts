/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { Event } from '../../../../base/common/event.js';
import { VimMode, VimSharedState } from './nativeVim.js';

export const INativeVimService = createDecorator<INativeVimService>('nativeVimService');
export interface INativeVimService {
	readonly _serviceBrand: undefined;
	readonly enabled: boolean;
	readonly shared: VimSharedState;
	readonly onDidChange: Event<void>;
	readonly hint: string;
	key(key: string, mode: VimMode, allowRemaps?: boolean): boolean;
	cancel(): void;
	readClipboard(): Promise<string>;
	execute(command: string, argument?: string): void;
}
