/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { dirname, joinPath } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { IUriIdentityService } from '../../../../platform/uriIdentity/common/uriIdentity.js';

/** Ordered project bookmarks, independent of editor and terminal lifetimes. */
export class JumpListModel {
	private items: URI[] = [];
	private removed: URI | undefined;
	private undoStack: URI[][] = [];
	private redoStack: URI[][] = [];
	private key = '';
	get entries(): readonly URI[] { return this.items; }

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
		this.key = `terminalFirst.jumpList.v1.${this.identity.extUri.getComparisonKey(project)}`;
		this.items = [];
		this.removed = undefined;
		this.undoStack = [];
		this.redoStack = [];
		try {
			const stored = this.storage.getObject<{ version: number; entries: string[] }>(this.key, StorageScope.PROFILE);
			if (stored?.version !== 1 || !Array.isArray(stored.entries)) { return; }
			for (const value of stored.entries) {
				if (typeof value !== 'string') { continue; }
				try {
					const resource = URI.parse(value, true);
					if (resource.scheme === 'file' && resource.path.startsWith('/') && this.indexOf(resource) < 0) { this.items.push(resource); }
				} catch { /* Ignore malformed entries without losing valid bookmarks. */ }
			}
		} catch { /* A damaged saved list starts empty. */ }
	}

	indexOf(resource: URI): number { return this.items.findIndex(item => this.identity.extUri.isEqual(item, resource)); }

	add(resource: URI): boolean {
		if (resource.scheme !== 'file' || this.indexOf(resource) >= 0) { return false; }
		this.change([...this.items, resource]);
		return true;
	}

	remove(index: number): void {
		if (!this.items[index]) { return; }
		this.removed = this.items[index];
		this.change(this.items.filter((_, i) => i !== index));
	}

	put(index: number, before: boolean): number {
		if (!this.removed || this.indexOf(this.removed) >= 0) { return index; }
		const items = [...this.items];
		const target = Math.max(0, Math.min(items.length, index + (before ? 0 : 1)));
		items.splice(target, 0, this.removed);
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

	private change(items: URI[]): void {
		this.undoStack.push(this.items);
		this.redoStack = [];
		this.items = items;
		this.save();
	}

	private save(): void {
		this.storage.store(this.key, { version: 1, entries: this.items.map(item => item.toString()) }, StorageScope.PROFILE, StorageTarget.MACHINE);
	}
}
