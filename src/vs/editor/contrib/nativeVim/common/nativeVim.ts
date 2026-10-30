/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export type VimMode = 'normal' | 'insert' | 'replace' | 'visual' | 'visualLine' | 'visualBlock' | 'operator' | 'search' | 'command';
export interface VimRegister { text: string; line: boolean; block?: boolean }
export interface VimHost {
	text(): string;
	position(): number;
	move(offset: number, anchor?: number, line?: boolean, block?: boolean): void;
	edit(start: number, end: number, text: string): void;
	boundary(): void;
	command(id: string, argument?: string): void;
	readonly(): boolean;
	document?(): string;
	eol?(): string;
}

/** Window-owned history, deliberately independent of editor widgets and document lifetime. */
export class VimSharedState {
	readonly registers = new Map<string, VimRegister>();
	readonly marks = new Map<string, Map<string, number>>();
	readonly macros = new Map<string, string[]>();
	lastChange: string[] = [];
	lastMacro = '';
	search = '';
	searchBackwards = false;
}

/** Storable form of the shared state: registers, file marks, macros, and the last search. */
export interface VimSharedStateData {
	readonly version: 1;
	readonly registers: Record<string, VimRegister>;
	readonly marks: Record<string, Record<string, number>>;
	readonly macros: Record<string, string[]>;
	readonly search: string;
	readonly searchBackwards: boolean;
}

export function serializeVimSharedState(state: VimSharedState): VimSharedStateData {
	return {
		version: 1,
		registers: Object.fromEntries(state.registers),
		marks: Object.fromEntries(Array.from(state.marks, ([document, marks]) => [document, Object.fromEntries(marks)])),
		macros: Object.fromEntries(state.macros),
		search: state.search,
		searchBackwards: state.searchBackwards,
	};
}

/** Restores saved state into `state`, skipping anything malformed. Returns false when `data` is not recognizable. */
export function restoreVimSharedState(state: VimSharedState, data: unknown): boolean {
	if (!data || typeof data !== 'object' || (data as Partial<VimSharedStateData>).version !== 1) {
		return false;
	}
	const saved = data as Partial<VimSharedStateData>;
	for (const [name, register] of Object.entries(saved.registers ?? {})) {
		if (register && typeof register.text === 'string' && typeof register.line === 'boolean') {
			state.registers.set(name, { text: register.text, line: register.line, ...(register.block ? { block: true } : {}) });
		}
	}
	for (const [document, marks] of Object.entries(saved.marks ?? {})) {
		if (marks && typeof marks === 'object') {
			const restored = new Map(Object.entries(marks).filter((entry): entry is [string, number] => typeof entry[1] === 'number' && entry[1] >= 0));
			if (restored.size) {
				state.marks.set(document, restored);
			}
		}
	}
	for (const [name, keys] of Object.entries(saved.macros ?? {})) {
		if (Array.isArray(keys) && keys.every(key => typeof key === 'string')) {
			state.macros.set(name, keys);
		}
	}
	if (typeof saved.search === 'string') {
		state.search = saved.search;
		state.searchBackwards = saved.searchBackwards === true;
	}
	return true;
}

/** Modal grammar. Offsets are UTF-16 model offsets; character steps preserve surrogate pairs. */
export class NativeVim {
	mode: VimMode = 'normal';
	pending = '';
	error = '';
	commandLine = '';
	private count = '';
	private operator = '';
	private operatorCount = 1;
	private prefix = '';
	private register = '"';
	private anchor = 0;
	private visualKeys: string[] = [];
	private recording = '';
	private recorded: string[] = [];
	private change: string[] = [];
	private replayDepth = 0;
	private replaySteps = 0;
	private blockInsert: { lines: number[]; column: number; text: string } | undefined;
	get clipboardRegister(): boolean { return this.register === '+' || this.register === '*'; }
	private lastFind: { key: string; character: string } | undefined;
	private get marks(): Map<string, number> {
		const document = this.host.document?.() ?? '';
		let marks = this.shared.marks.get(document);
		if (!marks) { marks = new Map(); this.shared.marks.set(document, marks); }
		return marks;
	}
	private readonly jumps: number[] = [];
	private jumpIndex = 0;

	constructor(private readonly host: VimHost, readonly shared: VimSharedState) { }

	recordInsertion(text: string, removed = 0): void {
		if (this.mode !== 'insert') { return; }
		for (let i = 0; i < removed; i++) { this.key('<BS>'); }
		for (const key of text) { this.key(key); }
	}

	reset(): void {
		if (this.mode === 'insert' || this.mode === 'replace') { this.finishChange(); }
		this.mode = 'normal'; this.clear(); this.commandLine = ''; this.blockInsert = undefined;
	}

	private clear(): void { this.pending = ''; this.count = ''; this.operator = ''; this.operatorCount = 1; this.prefix = ''; this.register = '"'; }
	private startChange(keys: string[]): void { if (!this.replayDepth) { this.change = keys; } this.host.boundary(); }
	private finishChange(): void {
		this.host.boundary();
		if (!this.replayDepth && this.change.length) { this.shared.lastChange = [...this.change]; }
		this.change = [];
	}
	private step(position: number, direction: number): number {
		const text = this.host.text();
		if (direction > 0) { return Math.min(text.length, position + ((text.codePointAt(position) ?? 0) > 0xffff ? 2 : 1)); }
		const code = text.charCodeAt(position - 1);
		return Math.max(0, position - (code >= 0xdc00 && code <= 0xdfff ? 2 : 1));
	}
	private lineStart(p: number): number { return p <= 0 ? 0 : this.host.text().lastIndexOf('\n', p - 1) + 1; }
	private lineEnd(p: number): number { const end = this.host.text().indexOf('\n', p); return end < 0 ? this.host.text().length : end > 0 && this.host.text()[end - 1] === '\r' ? end - 1 : end; }
	private nextLine(p: number): number { const end = this.host.text().indexOf('\n', p); return end < 0 ? this.host.text().length : end + 1; }
	private previousLine(p: number): number { return this.lineStart(Math.max(0, this.lineStart(p) - 1)); }
	private move(p: number): void {
		const visual = this.mode.startsWith('visual');
		this.host.move(Math.max(0, Math.min(this.host.text().length, p)), visual ? this.anchor : undefined, this.mode === 'visualLine', this.mode === 'visualBlock');
	}
	private writable(): boolean { if (this.host.readonly()) { this.error = 'readOnly'; return false; } return true; }
	private jump(p: number): void { this.host.command('recordJump', String(this.host.position())); this.jumps.splice(this.jumpIndex); this.jumps.push(this.host.position()); this.jumpIndex = this.jumps.length; this.move(p); }

	/** Returns false only when native text input should handle the key (Insert mode). */
	key(key: string): boolean {
		this.error = '';
		if (this.mode.startsWith('visual')) { this.visualKeys.push(key); }
		if (this.recording && !(key === 'q' && this.mode === 'normal' && !this.prefix)) { this.recorded.push(key); }
		if (key === '<Esc>') {
			if (this.mode === 'insert' || this.mode === 'replace') {
				this.change.push(key);
				if (this.blockInsert) {
					const insertion = this.blockInsert; this.blockInsert = undefined; const p = this.host.position();
					for (const line of [...insertion.lines].reverse()) { let start = 0; for (let n = 0; n < line; n++) { start = this.nextLine(start); } const end = this.lineEnd(start); const at = Math.min(end, start + insertion.column); this.host.edit(at, at, ' '.repeat(Math.max(0, start + insertion.column - end)) + insertion.text); }
					this.host.move(p);
				}
				this.finishChange();
				const p = this.host.position(); if (p > this.lineStart(p)) { this.host.move(this.step(p, -1)); }
			}
			this.mode = 'normal'; this.clear(); this.commandLine = ''; this.host.move(this.host.position()); return true;
		}
		if (this.mode === 'insert') {
			if (!this.replayDepth) { this.change.push(key); }
			if (this.blockInsert) { if (key === '<BS>') { this.blockInsert.text = this.blockInsert.text.slice(0, -1); } else if (key === '<CR>') { this.blockInsert = undefined; } else if (!key.startsWith('<')) { this.blockInsert.text += key; } }
			return false;
		}
		if (this.mode === 'replace') {
			if (key.length && !key.startsWith('<') && this.writable()) {
				const p = this.host.position(); this.host.edit(p, p < this.lineEnd(p) ? this.step(p, 1) : p, key); this.host.move(p + key.length); this.change.push(key);
			}
			return true;
		}
		if (this.mode === 'search' || this.mode === 'command') {
			if (key === '<BS>') { this.commandLine = this.commandLine.slice(0, -1); }
			else if (key === '<CR>') {
				const line = this.commandLine; const search = this.mode === 'search'; this.mode = 'normal'; this.commandLine = '';
				if (search) { this.shared.search = line || this.shared.search; this.search(this.shared.searchBackwards); }
				else { this.host.command('ex', line); }
			} else if (!key.startsWith('<')) { this.commandLine += key; }
			return true;
		}
		if (this.prefix) { return this.completePrefix(key); }
		if (/^[0-9]$/.test(key) && (key !== '0' || this.count)) { this.count += key; this.pending += key; return true; }
		const count = Math.min(10000, Number(this.count) || 1);
		const keys = [...this.pending, key];
		if (['"', 'f', 'F', 't', 'T', 'r', 'm', '\'', '`', '@', 'g'].includes(key) || (key === 'q' && !this.recording)) {
			this.prefix = key; this.pending += key; return true;
		}
		if ((this.operator || this.mode.startsWith('visual')) && (key === 'i' || key === 'a')) { this.prefix = key; this.pending += key; return true; }
		if (key === 'q' && this.recording) { this.shared.macros.set(this.recording, [...this.recorded]); this.recording = ''; this.recorded = []; this.clear(); return true; }
		if (['d', 'c', 'y', '>', '<', '~'].includes(key) && (key !== '~' || this.mode.startsWith('visual'))) {
			if (this.mode.startsWith('visual')) { this.applyVisual(key, keys); }
			else if (this.operator === key) {
				let end = this.host.position(); for (let i = 0; i < Math.min(10000, count * this.operatorCount); i++) { end = this.nextLine(end); }
				this.apply(key, this.lineStart(this.host.position()), end, true, keys);
			} else if (!this.operator) { this.operator = key; this.operatorCount = count; this.count = ''; this.pending += key; this.mode = 'operator'; }
			else { this.reset(); }
			return true;
		}
		if (this.mode.startsWith('visual') && (key === 'u' || key === 'U')) { this.applyVisual(key === 'u' ? 'lower' : 'upper', keys); return true; }
		const effectiveKey = this.operator === 'c' && (key === 'w' || key === 'W') && !/\s/.test(this.host.text()[this.host.position()] ?? ' ') ? (key === 'w' ? 'e' : 'E') : key;
		const motion = effectiveKey !== key && count * this.operatorCount === 1 ? this.step(this.wordObject(this.host.position(), false, key === 'W')[1], -1) : this.motion(effectiveKey, Math.min(10000, count * this.operatorCount));
		if (motion !== undefined) {
			if (this.operator) {
				const p = this.host.position(); const inclusive = ['e', 'E', '$', '%'].includes(effectiveKey);
				const line = ['j', 'k', 'G'].includes(key);
				this.apply(this.operator, line ? this.lineStart(Math.min(p, motion)) : Math.min(p, motion), line ? this.nextLine(Math.max(p, motion)) : inclusive ? this.step(Math.max(p, motion), 1) : Math.max(p, motion), line, keys);
			} else { if (key === 'G' || key === '%') { this.jump(motion); } else { this.move(motion); } this.clear(); }
			return true;
		}
		if (this.operator) { this.error = 'invalidMotion'; this.mode = 'normal'; this.clear(); return true; }
		const p = this.host.position();
		switch (key) {
			case 'i': case 'a': case 'I': case 'A': case 'o': case 'O': case 'R':
				if (!this.writable()) { break; }
				this.startChange(keys);
				if (key === 'a') { this.move(p < this.lineEnd(p) ? this.step(p, 1) : p); }
				if (key === 'I') { this.move(this.lineStart(p) + (this.host.text().slice(this.lineStart(p), this.lineEnd(p)).match(/^\s*/)?.[0].length ?? 0)); }
				if (key === 'A') { this.move(this.lineEnd(p)); }
				if (key === 'o' || key === 'O') { const at = key === 'o' ? this.lineEnd(p) : this.lineStart(p); const eol = this.host.eol?.() ?? '\n'; this.host.edit(at, at, eol); this.move(at + (key === 'o' ? eol.length : 0)); }
				this.mode = key === 'R' ? 'replace' : 'insert'; break;
			case 'v': case 'V': case '<C-v>':
				this.anchor = p; this.visualKeys = [key]; this.mode = key === 'v' ? 'visual' : key === 'V' ? 'visualLine' : 'visualBlock'; this.move(p); break;
			case 'x': case 'X': { let end = p; for (let i = 0; i < count; i++) { end = key === 'x' ? Math.min(this.lineEnd(p), this.step(end, 1)) : Math.max(this.lineStart(p), this.step(end, -1)); } this.apply('d', Math.min(p, end), Math.max(p, end), false, keys); break; }
			case 'D': case 'C': this.apply(key === 'D' ? 'd' : 'c', p, this.lineEnd(p), false, keys); break;
			case 'Y': this.apply('y', this.lineStart(p), this.nextLine(p), true, keys); break;
			case 's': this.apply('c', p, this.step(p, 1), false, keys); break;
			case 'p': case 'P': this.put(key === 'P', count, keys); break;
			case 'u': case '<C-r>': if (this.writable()) { this.host.command(key === 'u' ? 'undo' : 'redo'); } break;
			case '.': this.replay(this.shared.lastChange, count); break;
			case '/': case '?': this.mode = 'search'; this.shared.searchBackwards = key === '?'; this.commandLine = ''; break;
			case ':': this.commandLine = this.mode.startsWith('visual') ? '\'<,\'>' : ''; this.mode = 'command'; break;
			case 'n': case 'N': for (let i = 0; i < count; i++) { this.search(key === 'N' ? !this.shared.searchBackwards : this.shared.searchBackwards); } break;
			case '*': case '#': {
				const range = this.wordObject(p, false, false); this.shared.search = this.host.text().slice(range[0], range[1]).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); this.shared.searchBackwards = key === '#'; this.search(key === '#'); break;
			}
			case 'J': if (this.writable()) { this.startChange(keys); for (let i = 0; i < Math.max(1, count - 1); i++) { const end = this.lineEnd(p); if (end < this.host.text().length) { const next = this.host.text().slice(end + 1).match(/^\s*/)?.[0].length ?? 0; this.host.edit(end, end + 1 + next, ' '); } } this.move(p); this.finishChange(); } break;
			case '~': if (this.writable()) { this.startChange(keys); let end = p; for (let i = 0; i < count; i++) { end = this.step(end, 1); } this.host.edit(p, end, this.toggle(this.host.text().slice(p, end))); this.move(end); this.finishChange(); } break;
			case '<C-o>': this.host.command('jumpBack'); if (this.host.document) { break; } if (this.jumpIndex > 0) { if (this.jumpIndex === this.jumps.length) { this.jumps.push(p); } this.move(this.jumps[--this.jumpIndex]); } break;
			case '<C-i>': this.host.command('jumpForward'); if (this.host.document) { break; } if (this.jumpIndex < this.jumps.length - 1) { this.move(this.jumps[++this.jumpIndex]); } break;
			case '<C-d>': case '<C-u>': case '<C-f>': case '<C-b>': this.host.command('scroll', key); break;
			default: this.error = 'unsupported';
		}
		this.clear(); return true;
	}

	private completePrefix(key: string): boolean {
		const prefix = this.prefix; this.prefix = '';
		const count = Math.min(10000, (Number(this.count) || 1) * this.operatorCount);
		const keys = [...this.pending, key]; const p = this.host.position();
		if (prefix === '"') { if (/^[a-zA-Z0-9"_+*]$/.test(key)) { this.register = key; this.pending += key; } else { this.clear(); } return true; }
		if (prefix === 'q') { if (/^[a-z]$/.test(key)) { this.recording = key; this.recorded = []; } this.clear(); return true; }
		if (prefix === '@') { const name = key === '@' ? this.shared.lastMacro : key; this.shared.lastMacro = name; this.clear(); this.replay(this.shared.macros.get(name) ?? [], count); return true; }
		if (prefix === 'm') { this.marks.set(key, p); this.clear(); return true; }
		if (prefix === '\'' || prefix === '`') { const mark = this.marks.get(key); if (mark !== undefined) { this.jump(prefix === '\'' ? this.lineStart(mark) : mark); } this.clear(); return true; }
		if (prefix === 'r') { if (!key.startsWith('<') && this.writable()) { this.startChange(keys); let end = p; for (let i = 0; i < count; i++) { end = Math.min(this.lineEnd(p), this.step(end, 1)); } this.host.edit(p, end, key.repeat([...this.host.text().slice(p, end)].length)); this.move(p); this.finishChange(); } this.clear(); return true; }
		if (prefix === 'i' || prefix === 'a') {
			const range = this.textObject(key, prefix === 'a');
			if (range) { if (this.mode.startsWith('visual')) { this.anchor = range[0]; this.move(this.step(range[1], -1)); this.clear(); } else { this.apply(this.operator, range[0], range[1], key === 'p', keys); } } else { this.error = 'invalidObject'; this.mode = 'normal'; this.clear(); }
			return true;
		}
		let target: number | undefined;
		if (prefix === 'g' && ['u', 'U', '~'].includes(key) && this.mode.startsWith('visual')) { this.applyVisual(key === 'u' ? 'lower' : key === 'U' ? 'upper' : '~', keys); return true; }
		if (prefix === 'g' && ['u', 'U', '~'].includes(key)) { this.operator = key === 'u' ? 'lower' : key === 'U' ? 'upper' : '~'; this.mode = 'operator'; this.pending += key; return true; }
		if (prefix === 'g' && key === 'g') { target = 0; for (let i = 1; i < count; i++) { target = this.nextLine(target); } }
		else if (['f', 'F', 't', 'T'].includes(prefix)) { this.lastFind = { key: prefix, character: key }; target = this.find(prefix, key, count); }
		if (target !== undefined) {
			if (this.operator) { this.apply(this.operator, Math.min(p, target), prefix === 'g' ? this.nextLine(Math.max(p, target)) : this.step(Math.max(p, target), 1), prefix === 'g', keys); }
			else { this.move(target); this.clear(); }
		} else { this.error = 'unsupported'; this.mode = 'normal'; this.clear(); }
		return true;
	}

	private motion(key: string, count: number): number | undefined {
		const text = this.host.text(); let p = this.host.position();
		const column = p - this.lineStart(p);
		if (key === 'G') { if (!this.count) { return this.lineStart(text.length); } p = 0; for (let i = 1; i < count; i++) { p = this.nextLine(p); } return p; }
		for (let i = 0; i < count; i++) {
			switch (key) {
				case 'h': p = Math.max(this.lineStart(p), this.step(p, -1)); break;
				case 'l': p = Math.min(Math.max(this.lineStart(p), this.step(this.lineEnd(p), -1)), this.step(p, 1)); break;
				case 'j': { const next = this.nextLine(p); p = Math.min(this.lineEnd(next), next + column); break; }
				case 'k': { const previous = this.previousLine(p); p = Math.min(this.lineEnd(previous), previous + column); break; }
				case '0': p = this.lineStart(p); break;
				case '^': p = this.lineStart(p) + (text.slice(this.lineStart(p), this.lineEnd(p)).match(/^[\t ]*/)?.[0].length ?? 0); break;
				case '$': p = Math.max(this.lineStart(p), this.step(this.lineEnd(p), -1)); break;
				case 'w': case 'W': { const kind = this.kind(text[p], key === 'W'); while (p < text.length && this.kind(text[p], key === 'W') === kind) { p = this.step(p, 1); } while (p < text.length && /\s/.test(text[p])) { p = this.step(p, 1); } break; }
				case 'b': case 'B': { p = this.step(p, -1); while (p > 0 && /\s/.test(text[p])) { p = this.step(p, -1); } const kind = this.kind(text[p], key === 'B'); while (p > 0 && this.kind(text[this.step(p, -1)], key === 'B') === kind) { p = this.step(p, -1); } break; }
				case 'e': case 'E': { p = this.step(p, 1); while (p < text.length && /\s/.test(text[p])) { p = this.step(p, 1); } const kind = this.kind(text[p], key === 'E'); while (this.step(p, 1) < text.length && this.kind(text[this.step(p, 1)], key === 'E') === kind) { p = this.step(p, 1); } break; }
				case '}': { const match = /\n[\t ]*\n/g; match.lastIndex = p + 1; p = match.exec(text)?.index ?? text.length; break; }
				case '{': { const matches = [...text.slice(0, p).matchAll(/\n[\t ]*\n/g)]; p = matches.at(-1)?.index ?? 0; break; }
				case '%': { const pairs = '()[]{}'; let at = p; while (at < this.lineEnd(p) && !pairs.includes(text[at])) { at++; } const index = pairs.indexOf(text[at]); if (index < 0) { return p; } const direction = index % 2 === 0 ? 1 : -1; const other = pairs[index + direction]; let depth = 1; let q = at + direction; for (; q >= 0 && q < text.length; q += direction) { if (text[q] === text[at]) { depth++; } if (text[q] === other && --depth === 0) { break; } } p = q >= 0 && q < text.length ? q : p; break; }
				case ';': case ',': if (this.lastFind) { const findKey = key === ';' ? this.lastFind.key : this.lastFind.key === this.lastFind.key.toLowerCase() ? this.lastFind.key.toUpperCase() : this.lastFind.key.toLowerCase(); return this.find(findKey, this.lastFind.character, count); } return p;
				default: return undefined;
			}
		}
		return p;
	}
	private kind(character: string | undefined, big: boolean): number { return !character || /\s/.test(character) ? 0 : big || /[\p{L}\p{N}_]/u.test(character) ? 1 : 2; }
	private find(key: string, character: string, count: number): number | undefined {
		const text = this.host.text(); const backwards = key === key.toUpperCase(); let p = this.host.position();
		for (let i = 0; i < count; i++) { const at = backwards ? text.lastIndexOf(character, p - 1) : text.indexOf(character, p + 1); if (at < this.lineStart(p) || at >= this.lineEnd(p)) { return undefined; } p = at; }
		return key.toLowerCase() === 't' ? this.step(p, backwards ? 1 : -1) : p;
	}
	private wordObject(p: number, around: boolean, big: boolean): [number, number] {
		const text = this.host.text(); const kind = this.kind(text[p], big); let start = p; let end = p;
		while (start > 0 && this.kind(text[this.step(start, -1)], big) === kind) { start = this.step(start, -1); }
		while (end < text.length && this.kind(text[end], big) === kind) { end = this.step(end, 1); }
		if (around) { const oldEnd = end; while (end < text.length && /[\t ]/.test(text[end])) { end++; } if (end === oldEnd) { while (start > 0 && /[\t ]/.test(text[start - 1])) { start--; } } }
		return [start, end];
	}
	private textObject(key: string, around: boolean): [number, number] | undefined {
		const text = this.host.text(); const p = this.host.position();
		if (key === 'w' || key === 'W') { return this.wordObject(p, around, key === 'W'); }
		if (key === 'p') { let start = this.lineStart(p); let end = this.nextLine(p); while (start > 0 && text.slice(this.previousLine(start), start).trim()) { start = this.previousLine(start); } while (end < text.length && text.slice(end, this.nextLine(end)).trim()) { end = this.nextLine(end); } if (around) { while (end < text.length && !text.slice(end, this.nextLine(end)).trim()) { end = this.nextLine(end); } } return [start, end]; }
		const pairs: Record<string, string> = { '(': ')', ')': ')', 'b': ')', '[': ']', ']': ']', '{': '}', '}': '}', 'B': '}', '<': '>', '>': '>' };
		const close = pairs[key]; const open = close ? ({ ')': '(', ']': '[', '}': '{', '>': '<' }[close]) : key;
		if (!open || (!close && !['"', '\'', '`'].includes(key))) { return undefined; }
		let start = p; let depth = 0;
		for (; start >= 0; start--) { if (close && text[start] === close && start !== p) { depth++; } if (text[start] === open && (depth-- <= 0)) { break; } }
		if (start < 0) { return undefined; }
		let end = start + 1; depth = 0;
		for (; end < text.length; end++) { if (close && text[end] === open) { depth++; } if (text[end] === (close ?? open) && depth-- <= 0) { break; } }
		return end < text.length ? [start + (around ? 0 : 1), end + (around ? 1 : 0)] : undefined;
	}
	private applyVisual(operator: string, keys: string[]): void {
		keys = this.visualKeys.length ? [...this.visualKeys] : keys;
		this.visualKeys = [];
		const p = this.host.position();
		if (this.mode === 'visualBlock') {
			const text = this.host.text(); const left = Math.min(p - this.lineStart(p), this.anchor - this.lineStart(this.anchor)); const right = Math.max(p - this.lineStart(p), this.anchor - this.lineStart(this.anchor)) + 1;
			const ranges: [number, number][] = []; let line = this.lineStart(Math.min(p, this.anchor)); const end = this.lineStart(Math.max(p, this.anchor));
			while (line <= end) { ranges.push([Math.min(this.lineEnd(line), line + left), Math.min(this.lineEnd(line), line + right)]); const next = this.nextLine(line); if (next <= line) { break; } line = next; }
			if (operator !== 'y' && !this.writable()) { return; }
			if (['d', 'c', 'y'].includes(operator)) { this.writeRegister({ text: ranges.map(([a, b]) => text.slice(a, b)).join('\n'), line: false, block: true }, operator === 'y'); }
			if (operator === 'c') { this.blockInsert = { lines: ranges.slice(1).map(([start]) => text.slice(0, start).split('\n').length - 1), column: left, text: '' }; }
			this.startChange(keys); if (operator !== 'y') { for (const [a, b] of ranges.reverse()) { this.host.edit(a, b, operator === '~' ? this.toggle(text.slice(a, b)) : operator === 'upper' ? text.slice(a, b).toUpperCase() : operator === 'lower' ? text.slice(a, b).toLowerCase() : operator === '>' ? '\t' + text.slice(a, b) : operator === '<' ? text.slice(a, b).replace(/^(\t| {1,4})/, '') : ''); } }
			this.mode = operator === 'c' ? 'insert' : 'normal'; this.host.move(Math.min(p, this.anchor)); if (operator !== 'c') { this.finishChange(); } this.clear(); return;
		}
		const line = this.mode === 'visualLine'; this.apply(operator, line ? this.lineStart(Math.min(p, this.anchor)) : Math.min(p, this.anchor), line ? this.nextLine(Math.max(p, this.anchor)) : this.step(Math.max(p, this.anchor), 1), line, keys);
	}
	private writeRegister(value: VimRegister, yank: boolean): void {
		if (this.register === '_') { return; }
		this.shared.registers.set('"', value);
		if (yank) { this.shared.registers.set('0', value); }
		else { for (let i = 9; i > 1; i--) { const prior = this.shared.registers.get(String(i - 1)); if (prior) { this.shared.registers.set(String(i), prior); } } this.shared.registers.set('1', value); }
		if (/^[A-Z]$/.test(this.register)) { const lower = this.register.toLowerCase(); this.shared.registers.set(lower, { ...value, text: (this.shared.registers.get(lower)?.text ?? '') + value.text }); }
		else { this.shared.registers.set(this.register, value); }
		if (this.register === '+' || this.register === '*') { this.host.command('clipboardWrite', value.text); }
	}
	private toggle(text: string): string { return [...text].map(c => c === c.toUpperCase() ? c.toLowerCase() : c.toUpperCase()).join(''); }
	private apply(operator: string, start: number, end: number, line: boolean, keys: string[]): void {
		if (operator !== 'y' && !this.writable()) { this.mode = 'normal'; this.clear(); return; }
		const text = this.host.text().slice(start, end);
		if (['d', 'c', 'y'].includes(operator)) { this.writeRegister({ text, line }, operator === 'y'); }
		if (operator !== 'y') {
			this.startChange(keys);
			let replacement = operator === 'lower' ? text.toLowerCase() : operator === 'upper' ? text.toUpperCase() : operator === '~' ? this.toggle(text) : operator === '>' ? text.replace(/^/gm, '\t') : operator === '<' ? text.replace(/^(\t| {1,4})/gm, '') : '';
			if (line && operator === 'c') { replacement = end < this.host.text().length ? this.host.eol?.() ?? '\n' : ''; }
			if (line && operator === 'd' && end === this.host.text().length && start > 0 && !text.endsWith('\n')) { start = this.step(start, -1); if (this.host.text()[start - 1] === '\r') { start--; } }
			this.host.edit(start, end, replacement);
		}
		this.mode = operator === 'c' ? 'insert' : 'normal'; this.host.move(start); if (operator !== 'c' && operator !== 'y') { this.finishChange(); } this.clear();
	}
	private put(before: boolean, count: number, keys: string[]): void {
		if (!this.writable()) { return; }
		const value = this.shared.registers.get(this.register); if (!value) { return; }
		let p = this.host.position(); let text = value.text.repeat(count);
		if (value.block) {
			this.startChange(keys); const column = p - this.lineStart(p) + (before ? 0 : 1); let line = this.lineStart(p);
			for (const row of value.text.split('\n')) { const end = this.lineEnd(line); const at = Math.min(end, line + column); this.host.edit(at, at, ' '.repeat(Math.max(0, line + column - end)) + row.repeat(count)); if (this.nextLine(line) === this.host.text().length && !this.host.text().endsWith('\n')) { this.host.edit(this.host.text().length, this.host.text().length, '\n'); } line = this.nextLine(line); }
			this.move(p); this.finishChange(); return;
		}
		if (value.line) { p = before ? this.lineStart(p) : this.nextLine(p); if (!text.endsWith('\n')) { text += '\n'; } if (!before && p === this.host.text().length && p > 0 && !this.host.text().endsWith('\n')) { text = '\n' + text.slice(0, -1); } }
		else if (!before && p < this.lineEnd(p)) { p = this.step(p, 1); }
		this.startChange(keys); this.host.edit(p, p, text); this.move(p); this.finishChange();
	}
	private search(backwards: boolean): void {
		try {
			const matches = [...this.host.text().matchAll(new RegExp(this.shared.search, 'gu'))]; const p = this.host.position();
			const match = backwards ? matches.filter(m => m.index < p).at(-1) ?? matches.at(-1) : matches.find(m => m.index > p) ?? matches[0];
			if (match) { this.jump(match.index); } else { this.error = 'notFound'; }
		} catch { this.error = 'invalidPattern'; }
	}
	private replay(keys: readonly string[], count: number): void {
		if (this.replayDepth >= 20) { this.error = 'recursiveMacro'; return; }
		if (!this.replayDepth) { this.replaySteps = 0; }
		this.replayDepth++;
		try { for (let i = 0; i < count; i++) { for (const key of keys) { if (++this.replaySteps > 100000) { this.error = 'recursiveMacro'; this.reset(); return; } if (!this.key(key)) { const p = this.host.position(); if (key === '<BS>') { this.host.edit(this.step(p, -1), p, ''); } else { const text = key === '<CR>' ? this.host.eol?.() ?? '\n' : key; this.host.edit(p, p, text); this.host.move(p + text.length); } } } } }
		finally { this.replayDepth--; }
	}
}
