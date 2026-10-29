/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { RunOnceScheduler } from '../../../../base/common/async.js';
import { compareFileNames } from '../../../../base/common/comparers.js';
import { Emitter } from '../../../../base/common/event.js';
import { createMatches, fuzzyScore, IMatch } from '../../../../base/common/filters.js';
import { Disposable, DisposableStore } from '../../../../base/common/lifecycle.js';
import { dirname, isEqual } from '../../../../base/common/resources.js';
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

	show(root: URI): void {
		this.hide();
		this.root = root;
		this.hidden = false;
		this.navigate(root);
	}

	navigate(directory: URI): void {
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
		void this.load();
	}

	parent(): void {
		if (this.directory && !isEqual(this.directory, dirname(this.directory))) { this.navigate(dirname(this.directory)); }
	}

	setQuery(query: string): void { this.query = query; this.filter(); }
	toggleHidden(): void { this.hidden = !this.hidden; this.filter(); }

	private filter(): void {
		this.entries = filterFileBrowserEntries(this.children, this.query, this.hidden);
		if (!this.entries.some(entry => isEqual(entry.stat.resource, this.selected))) { this.selected = this.entries[0]?.stat.resource; }
		this.changed.fire();
	}

	private async load(): Promise<void> {
		const directory = this.directory;
		if (!directory) { return; }
		const generation = ++this.generation;
		this.loading = true;
		this.error = undefined;
		this.changed.fire();
		try {
			const stat = await this.fileService.resolve(directory);
			if (generation !== this.generation) { return; }
			this.children = stat.children ?? [];
		} catch (error) {
			if (generation !== this.generation) { return; }
			this.children = [];
			this.error = error instanceof Error ? error.message : String(error);
		}
		if (generation !== this.generation) { return; }
		this.loading = false;
		this.filter();
	}

	hide(): void {
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
