/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { VimMode } from './nativeVim.js';
export interface VimRemap {
	mode: VimMode;
	before: string[];
	after?: string[];
	command?: string;
}

/** Reject ambiguous prefixes and cycles even though expansion is deliberately nonrecursive. */
export function validateVimRemaps(remaps: readonly VimRemap[]): boolean {
	const visiting = new Set<VimRemap>();
	const visited = new Set<VimRemap>();
	const visit = (remap: VimRemap): boolean => {
		if (visiting.has(remap)) { return false; }
		if (visited.has(remap)) { return true; }
		visiting.add(remap);
		if (remap.after) {
			for (const next of remaps) {
				if (next.mode === remap.mode && next.before.length <= remap.after.length && next.before.every((key, index) => key === remap.after![index]) && !visit(next)) { return false; }
			}
		}
		visiting.delete(remap); visited.add(remap); return true;
	};
	for (const remap of remaps) {
		if (!remap.before.length || remap.before.some(key => !key) || (!!remap.after === !!remap.command)) { return false; }
		if (remaps.some(other => other !== remap && other.mode === remap.mode && other.before.length >= remap.before.length && remap.before.every((key, index) => key === other.before[index]))) { return false; }
		if (!visit(remap)) { return false; }
	}
	return true;
}
