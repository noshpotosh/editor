/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';

/** The space every session starts with; its layout key is the plain session id, so layouts saved before spaces existed restore into it. */
export const DEFAULT_SPACE_ID = 'default';

/** Separates the session id from the space id in a layout key. Session ids are shell integration nonces (UUIDs), which never contain it. */
const SEPARATOR = '#';

/** The key under which the editor part retains a space's tile grid. */
export function spaceLayoutKey(sessionId: string, spaceId: string): string {
	return spaceId === DEFAULT_SPACE_ID ? sessionId : `${sessionId}${SEPARATOR}${spaceId}`;
}

/** The session and space of a retained layout key; a key without a separator is a session's default space. */
export function parseSpaceLayoutKey(key: string): { readonly sessionId: string; readonly spaceId: string } {
	const index = key.indexOf(SEPARATOR);
	return index < 0 ? { sessionId: key, spaceId: DEFAULT_SPACE_ID } : { sessionId: key.slice(0, index), spaceId: key.slice(index + 1) };
}

/** "Space N" for the first N that no existing space uses. */
export function nextSpaceName(existing: readonly string[]): string {
	for (let n = 1; ; n++) {
		const name = defaultSpaceName(n);
		if (!existing.includes(name)) {
			return name;
		}
	}
}

export function defaultSpaceName(n: number): string {
	return localize('spaceName', "Space {0}", n);
}
