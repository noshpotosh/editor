/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { RunOnceScheduler } from '../../../../base/common/async.js';
import { compareFileNames } from '../../../../base/common/comparers.js';
import { Emitter } from '../../../../base/common/event.js';
import { createMatches, fuzzyScore, IMatch } from '../../../../base/common/filters.js';
import { Disposable, DisposableStore } from '../../../../base/common/lifecycle.js';
import { dirname, isEqual, relativePath } from '../../../../base/common/resources.js';
import { localize } from '../../../../nls.js';
import { URI } from '../../../../base/common/uri.js';
import { IFileService, IFileStat } from '../../../../platform/files/common/files.js';

export interface FileBrowserEntry {
	readonly stat: IFileStat;
	readonly matches: IMatch[];
}

/** Filters one directory without applying workspace search exclusions. */
export function filterFileBrowserEntries(children: readonly IFileStat[], query: string, hidden: boolean): FileBrowserEntry[] {
	return children.filter(stat => hidden || !stat.name.startsWith('.')).map(stat => ({
		stat, score: query ? fuzzyScore(query, query.toLowerCase(), 0, stat.name, stat.name.toLowerCase(), 0, { firstMatchCanBeWeak: true, boostFullMatch: true }) : undefined
	})).filter(entry => !query || entry.score).sort((a, b) => {
		if (query) { return (b.score![0] - a.score![0]) || compareFileNames(a.stat.name, b.stat.name); }
		return Number(b.stat.isDirectory) - Number(a.stat.isDirectory) || compareFileNames(a.stat.name, b.stat.name);
	}).map(({ stat, score }) => ({ stat, matches: score ? createMatches(score) : [] }));
}

/** Owns a visible directory and invalidates reads when navigation or dismissal supersedes them. */
export class FileBrowserModel extends Disposable {
	private readonly changed = this._register(new Emitter<void>());
	readonly onDidChange = this.changed.event;
	private readonly watch = this._register(new DisposableStore());
	private readonly refresh = this._register(new RunOnceScheduler(() => { void this.load(); }, 100));
	private generation = 0;
	private sessionId = '';
	private sessionRoot: URI | undefined;
	private readonly remembered = new Map<string, { directory: URI; root: URI; hidden: boolean }>();
	readonly marked = new Map<string, IFileStat>();
	browser: 'files' | 'folders' = 'files';
	notice: string | undefined;
	private children: IFileStat[] = [];
	directory: URI | undefined;
	root: URI | undefined;
	query = '';
	hidden = false;
	loading = false;
	error: string | undefined;
	selected: URI | undefined;
	entries: FileBrowserEntry[] = [];

	constructor(@IFileService private readonly fileService: IFileService) { super(); }

	show(root: URI, sessionId = ''): void {
		this.hide();
		this.sessionId = sessionId;
		this.sessionRoot = root;
		const saved = sessionId ? this.remembered.get(sessionId) : undefined;
		this.root = saved?.root ?? root;
		this.hidden = saved?.hidden ?? false;
		this.browser = 'files';
		this.notice = undefined;
		this.navigate(saved?.directory ?? root, !!saved);
	}

	forgetSession(id: string): void { this.remembered.delete(id); }

	toggleBrowser(): void {
		this.browser = this.browser === 'files' ? 'folders' : 'files';
		this.query = '';
		this.selected = undefined;
		void this.load();
	}

	setRoot(resource: URI): void {
		this.root = resource;
		this.browser = 'files';
		this.navigate(resource);
	}

	toggleMark(resource = this.selected): void {
		const stat = this.entries.find(entry => isEqual(entry.stat.resource, resource))?.stat;
		if (!stat) { return; }
		const key = stat.resource.toString();
		if (this.marked.has(key)) { this.marked.delete(key); } else { this.marked.set(key, stat); }
		this.changed.fire();
	}

	toggleAll(): void {
		const clear = this.entries.every(entry => this.marked.has(entry.stat.resource.toString()));
		for (const { stat } of this.entries) {
			if (clear) { this.marked.delete(stat.resource.toString()); } else { this.marked.set(stat.resource.toString(), stat); }
		}
		this.changed.fire();
	}

	async refreshEntries(): Promise<void> {
		const generation = this.generation;
		for (const [key, stat] of this.marked) {
			const exists = await this.fileService.exists(stat.resource);
			if (generation !== this.generation) { return; }
			if (!exists) { this.marked.delete(key); }
		}
		await this.load();
	}

	navigate(directory: URI, restoring = false): void {
		this.browser = 'files';
		this.watch.clear();
		this.refresh.cancel();
		this.generation++;
		this.directory = directory;
		this.query = '';
		this.selected = undefined;
		this.children = [];
		this.entries = [];
		try {
			const watcher = this.watch.add(this.fileService.createWatcher(directory, { recursive: false, excludes: [] }));
			this.watch.add(watcher.onDidChange(() => this.refresh.schedule()));
		} catch { /* Reading remains available on providers without watching. */ }
		void this.load(restoring);
	}

	parent(): void {
		if (this.directory && !isEqual(this.directory, dirname(this.directory))) {
			const previous = this.directory;
			this.navigate(dirname(previous));
			this.selected = previous;
		}
	}

	setQuery(query: string): void { this.query = query; this.filter(); }
	toggleHidden(): void { this.hidden = !this.hidden; if (this.browser === 'folders') { void this.load(); } else { this.filter(); } }

	private filter(): void {
		this.entries = filterFileBrowserEntries(this.children, this.query, this.hidden);
		if (!this.entries.some(entry => isEqual(entry.stat.resource, this.selected))) { this.selected = this.entries[0]?.stat.resource; }
		this.changed.fire();
	}

	private async load(restoring = false): Promise<void> {
		const directory = this.directory;
		if (!directory) { return; }
		const generation = ++this.generation;
		this.loading = true;
		this.error = undefined;
		this.changed.fire();
		try {
			const stat = await this.fileService.resolve(directory);
			if (!stat.isDirectory) { throw new Error(localize('browserNotDirectory', "The path is no longer a folder.")); }
			if (generation !== this.generation) { return; }
			if (this.browser === 'folders' && this.root) {
				const root = this.root;
				const pending = [root];
				const folders: IFileStat[] = [];
				while (pending.length && generation === this.generation) {
					const batch = pending.splice(0, 8);
					const results = await Promise.all(batch.map(async resource => {
						try { return (await this.fileService.resolve(resource)).children ?? []; }
						catch { return []; }
					}));
					if (generation !== this.generation) { return; }
					for (const children of results) {
						for (const child of children) {
							if (!child.isDirectory || (!this.hidden && child.name.startsWith('.'))) { continue; }
							folders.push({ ...child, name: relativePath(root, child.resource) ?? child.name });
							if (!child.isSymbolicLink) { pending.push(child.resource); }
						}
					}
				}
				this.children = folders;
			} else {
				this.children = stat.children ?? [];
			}
		} catch (error) {
			if (generation !== this.generation) { return; }
			if (restoring && this.sessionRoot && !isEqual(directory, this.sessionRoot)) {
				this.notice = localize('browserRestoredFallback', "The previous folder is unavailable. Returned to the session folder.");
				this.root = this.sessionRoot;
				this.navigate(this.sessionRoot);
				return;
			}
			this.children = [];
			this.error = error instanceof Error ? error.message : String(error);
		}
		if (generation !== this.generation) { return; }
		this.loading = false;
		this.filter();
	}

	hide(): void {
		if (this.sessionId && this.directory && this.root) {
			this.remembered.set(this.sessionId, { directory: this.directory, root: this.root, hidden: this.hidden });
		}
		this.sessionId = '';
		this.marked.clear();
		this.generation++;
		this.watch.clear();
		this.refresh.cancel();
		this.directory = undefined;
		this.root = undefined;
		this.children = [];
		this.entries = [];
		this.selected = undefined;
		this.loading = false;
	}

	override dispose(): void { this.hide(); super.dispose(); }
}
