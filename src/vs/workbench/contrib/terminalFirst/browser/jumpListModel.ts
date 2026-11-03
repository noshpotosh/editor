/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { dirname, joinPath } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { IUriIdentityService } from '../../../../platform/uriIdentity/common/uriIdentity.js';

/** A project bookmark with the cursor position captured when it was added. */
export interface JumpListEntry {
	readonly resource: URI;
	readonly lineNumber?: number;
	readonly column?: number;
}

/** Ordered project bookmarks, independent of editor and terminal lifetimes. */
export class JumpListModel {
	private items: JumpListEntry[] = [];
	private removed: JumpListEntry | undefined;
	private undoStack: JumpListEntry[][] = [];
	private redoStack: JumpListEntry[][] = [];
	private key = '';
	get entries(): readonly JumpListEntry[] { return this.items; }

	constructor(
		@IStorageService private readonly storage: IStorageService,
		@IUriIdentityService private readonly identity: IUriIdentityService,
		@IFileService private readonly files: IFileService,
	) { }

	async resolveProject(directory: URI): Promise<URI> {
		let current = directory;
		while (true) {
			if (await this.files.exists(joinPath(current, '.git'))) { return current; }
			const parent = dirname(current);
			if (this.identity.extUri.isEqual(parent, current)) { return directory; }
			current = parent;
		}
	}

	load(project: URI): void {
		const key = `terminalFirst.jumpList.v1.${this.identity.extUri.getComparisonKey(project)}`;
		const stored = this.read(key);
		// Reopening the same project's unchanged list keeps its undo history; a different project or an external change starts over.
		if (key === this.key && stored.length === this.items.length && stored.every((item, index) => this.identity.extUri.isEqual(item.resource, this.items[index].resource) && item.lineNumber === this.items[index].lineNumber && item.column === this.items[index].column)) {
			return;
		}
		this.key = key;
		this.items = stored;
		this.removed = undefined;
		this.undoStack = [];
		this.redoStack = [];
	}

	private read(key: string): JumpListEntry[] {
		const items: JumpListEntry[] = [];
		try {
			const stored = this.storage.getObject<{ version: number; entries: (string | { resource: string; lineNumber?: number; column?: number })[] }>(key, StorageScope.PROFILE);
			if (stored?.version !== 1 || !Array.isArray(stored.entries)) { return items; }
			for (const value of stored.entries) {
				if (typeof value !== 'string' && (!value || typeof value.resource !== 'string')) { continue; }
				try {
					const resource = URI.parse(typeof value === 'string' ? value : value.resource, true);
					if (resource.scheme === 'file' && resource.path.startsWith('/') && !items.some(item => this.identity.extUri.isEqual(item.resource, resource))) {
						const lineNumber = typeof value !== 'string' && typeof value.lineNumber === 'number' && Number.isSafeInteger(value.lineNumber) && value.lineNumber > 0 ? value.lineNumber : undefined;
						const column = lineNumber && typeof value !== 'string' && typeof value.column === 'number' && Number.isSafeInteger(value.column) && value.column > 0 ? value.column : undefined;
						items.push({ resource, lineNumber, column });
					}
				} catch { /* Ignore malformed entries without losing valid bookmarks. */ }
			}
		} catch { /* A damaged saved list starts empty. */ }
		return items;
	}

	indexOf(resource: URI): number { return this.items.findIndex(item => this.identity.extUri.isEqual(item.resource, resource)); }

	add(resource: URI, position?: { lineNumber: number; column: number }): boolean {
		if (resource.scheme !== 'file') { return false; }
		const index = this.indexOf(resource);
		const entry: JumpListEntry = { resource, lineNumber: position?.lineNumber, column: position?.column };
		if (index >= 0) {
			if (this.items[index].lineNumber === entry.lineNumber && this.items[index].column === entry.column) { return false; }
			this.change(this.items.map((item, i) => i === index ? entry : item));
		} else {
			this.change([...this.items, entry]);
		}
		return true;
	}

	remove(index: number): void {
		if (!this.items[index]) { return; }
		this.removed = this.items[index];
		this.change(this.items.filter((_, i) => i !== index));
	}

	put(index: number, before: boolean): number {
		if (!this.removed || this.indexOf(this.removed.resource) >= 0) { return index; }
		const items = [...this.items];
		const target = Math.max(0, Math.min(items.length, index + (before ? 0 : 1)));
		items.splice(target, 0, this.removed);
		this.change(items);
		return target;
	}

	/** Moves an entry by `delta` rows; returns its new index. */
	move(index: number, delta: number): number {
		const target = Math.max(0, Math.min(this.items.length - 1, index + delta));
		if (!this.items[index] || target === index) { return index; }
		const items = [...this.items];
		const [item] = items.splice(index, 1);
		items.splice(target, 0, item);
		this.change(items);
		return target;
	}

	undo(): void {
		const items = this.undoStack.pop();
		if (items) { this.redoStack.push(this.items); this.items = items; this.save(); }
	}

	redo(): void {
		const items = this.redoStack.pop();
		if (items) { this.undoStack.push(this.items); this.items = items; this.save(); }
	}

	private change(items: JumpListEntry[]): void {
		this.undoStack.push(this.items);
		this.redoStack = [];
		this.items = items;
		this.save();
	}

	private save(): void {
		this.storage.store(this.key, { version: 1, entries: this.items.map(item => ({ resource: item.resource.toString(), lineNumber: item.lineNumber, column: item.column })) }, StorageScope.PROFILE, StorageTarget.MACHINE);
	}
}
