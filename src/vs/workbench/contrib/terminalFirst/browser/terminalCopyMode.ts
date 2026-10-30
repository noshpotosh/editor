/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { $, append, addDisposableListener, getWindow } from '../../../../base/browser/dom.js';
import { Disposable, DisposableStore, MutableDisposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { NativeVim, VimHost, VimSharedState } from '../../../../editor/contrib/nativeVim/common/nativeVim.js';
import { IClipboardService } from '../../../../platform/clipboard/common/clipboardService.js';
import { IContextKeyService, RawContextKey } from '../../../../platform/contextkey/common/contextkey.js';
import { createDecorator, ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { Action2, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { TerminalCapability } from '../../../../platform/terminal/common/capabilities/capabilities.js';
import { ITerminalService } from '../../terminal/browser/terminal.js';
import { IWorkbenchLayoutService } from '../../../services/layout/browser/layoutService.js';
import { ITerminalFirstService } from '../../../services/terminalFirst/common/terminalFirst.js';
import { terminalFirstEnabled, terminalFirstPolicy } from '../../../services/terminalFirst/common/terminalFirstPolicy.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { localize, localize2 } from '../../../../nls.js';
import type { IDecoration } from '@xterm/xterm';

/** A stable, read-only snapshot lets Vim motions ignore concurrently appended output. */
export class TerminalCopyHost implements VimHost {
	private offset = 0;
	readonly starts: number[] = [];
	private readonly contents: string;
	constructor(readonly lines: readonly string[], private readonly render: (offset: number, anchor?: number, line?: boolean) => void) {
		let start = 0;
		for (const line of lines) { this.starts.push(start); start += line.length + 1; }
		this.contents = lines.join('\n');
	}
	text(): string { return this.contents; }
	position(): number { return this.offset; }
	move(offset: number, anchor?: number, line?: boolean): void { this.offset = Math.max(0, Math.min(this.contents.length, offset)); this.render(this.offset, anchor, line); }
	edit(): void { /* Scrollback is immutable. */ }
	boundary(): void { }
	command(): void { }
	readonly(): boolean { return true; }
	row(offset: number): number { let row = 0; while (row + 1 < this.starts.length && this.starts[row + 1] <= offset) { row++; } return row; }
}

const ITerminalCopyMode = createDecorator<TerminalCopyMode>('terminalCopyMode');

/** Captures keys only while the terminal scrollback cursor is active. */
class TerminalCopyMode extends Disposable {
	declare readonly _serviceBrand: undefined;
	private generation = 0;
	private readonly session = this._register(new DisposableStore());
	constructor(
		@ITerminalService private readonly terminals: ITerminalService,
		@IWorkbenchLayoutService private readonly layout: IWorkbenchLayoutService,
		@IContextKeyService private readonly contexts: IContextKeyService,
		@IClipboardService private readonly clipboard: IClipboardService,
		@INotificationService private readonly notifications: INotificationService,
		@ITerminalFirstService sessions: ITerminalFirstService,
	) { super(); this._register(sessions.onDidChangeSessions(() => this.session.clear())); }
	enter(): void {
		this.session.clear();
		const generation = ++this.generation;
		if (!terminalFirstPolicy.shell && !terminalFirstPolicy.floatingVisible) { return; }
		const terminal = this.terminals.activeInstance;
		const raw = terminal?.xterm?.raw;
		if (!terminal || !raw || raw.buffer.active.type !== 'normal') { return; }
		const buffer = raw.buffer.active;
		const last = buffer.baseY + buffer.cursorY;
		const marker = raw.registerMarker(0);
		if (!marker) { return; }
		this.session.add(marker);
		const lines: string[] = [];
		const columns: number[][] = [];
		for (let row = 0; row <= last; row++) {
			const line = buffer.getLine(row)!;
			const text = line.translateToString(true);
			lines.push(text);
			const cells: number[] = [];
			for (let column = 0; column < line.length; column++) {
				const cell = line.getCell(column)!;
				if (!cell.getWidth()) { continue; }
				const chars = cell.getChars() || ' ';
				for (let i = 0; i < chars.length; i++) { cells.push(column); }
			}
			cells.push(line.length); columns.push(cells);
		}
		const context = new RawContextKey<boolean>('terminalFirstCopyMode', false).bindTo(this.contexts);
		context.set(true); this.session.add(toDisposable(() => context.reset()));
		const badge = append(raw.element ?? this.layout.mainContainer, $('.terminal-first-copy-badge'));
		badge.setAttribute('role', 'status');
		this.session.add(toDisposable(() => { badge.remove(); raw.clearSelection(); }));
		const decoration = this.session.add(new MutableDisposable<IDecoration>());
		const cursor = this.session.add(new DisposableStore());
		const host = new TerminalCopyHost(lines, (offset, anchor, linewise) => {
			if (marker.isDisposed) { this.session.clear(); return; }
			const delta = marker.line - last;
			const row = host.row(offset);
			const column = columns[row][offset - host.starts[row]] ?? 0;
			if (row + delta < 0) { this.session.clear(); return; }
			decoration.clear(); cursor.clear();
			const point = raw.registerMarker(row + delta - (raw.buffer.active.baseY + raw.buffer.active.cursorY));
			if (point) {
				cursor.add(point);
				decoration.value = raw.registerDecoration({ marker: point, x: column, width: 1, layer: 'top' });
				if (decoration.value) { cursor.add(decoration.value.onRender(element => { element.classList.add('terminal-first-copy-cursor'); })); }
			}
			if (anchor !== undefined) {
				const start = Math.min(offset, anchor); const end = Math.max(offset, anchor);
				const first = host.row(start); const final = host.row(end);
				const firstColumn = linewise ? 0 : columns[first][start - host.starts[first]] ?? 0;
				const finalColumn = linewise ? raw.cols : (columns[final][end - host.starts[final] + 1] ?? raw.cols);
				if (first + delta >= 0) { raw.select(firstColumn, first + delta, (final - first) * raw.cols + finalColumn - firstColumn); }
			} else { raw.clearSelection(); }
			if (row + delta < raw.buffer.active.viewportY || row + delta >= raw.buffer.active.viewportY + raw.rows) { raw.scrollToLine(row + delta); }
		});
		const shared = new VimSharedState(); const vim = new NativeVim(host, shared);
		let bracket = '';
		const refresh = () => { badge.textContent = localize('copyBadge', "COPY") + (vim.mode === 'search' ? ` ${shared.searchBackwards ? '?' : '/'}${vim.commandLine}` : ` ${vim.pending}`); };
		host.move(host.starts[last]); refresh();
		this.session.add(marker.onDispose(() => this.session.clear()));
		this.session.add(raw.onResize(() => this.session.clear()));
		this.session.add(terminal.onDisposed(() => this.session.clear()));
		this.session.add(addDisposableListener(getWindow(this.layout.mainContainer), 'keydown', event => {
			event.preventDefault(); event.stopImmediatePropagation();
			if (['Shift', 'Control', 'Alt', 'Meta'].includes(event.key)) { return; }
			const key = event.key === 'Escape' ? '<Esc>' : event.key === 'Enter' ? '<CR>' : event.key === 'Backspace' ? '<BS>' : event.ctrlKey ? `<C-${event.key.toLowerCase()}>` : event.key;
			if (key === '<Esc>' || (key === 'q' && vim.mode !== 'search')) { this.session.clear(); return; }
			if (vim.mode === 'normal' && (key === '[' || key === ']')) {
				if (bracket === key) {
					const row = host.row(host.position()) + marker.line - last;
					const prompts = terminal.capabilities.get(TerminalCapability.CommandDetection)?.commands.map(command => command.marker?.line).filter((line): line is number => line !== undefined && line >= 0) ?? [];
					const target = key === '[' ? prompts.filter(line => line < row).at(-1) : prompts.find(line => line > row);
					const snapshotRow = target === undefined ? -1 : target - marker.line + last;
					if (snapshotRow >= 0 && snapshotRow < host.starts.length) { host.move(host.starts[snapshotRow]); }
					bracket = '';
				} else { bracket = key; }
				return;
			}
			bracket = '';
			const before = shared.registers.get('"');
			if (key === '<CR>' && vim.mode !== 'search') {
				if (vim.mode.startsWith('visual')) { vim.key('y'); } else { vim.key('y'); vim.key('y'); }
			} else { vim.key(key); }
			const register = shared.registers.get('"');
			if (register && register !== before) {
				void this.clipboard.writeText(register.text).then(() => { if (generation === this.generation) { this.session.clear(); } }, error => this.notifications.error(error));
			}
			refresh();
		}, true));
	}
}
registerSingleton(ITerminalCopyMode, TerminalCopyMode, InstantiationType.Delayed);
if (terminalFirstEnabled) {
	registerAction2(class extends Action2 {
		constructor() { super({ id: 'terminalFirst.copyMode.enter', title: localize2('copyMode', "Copy Terminal Scrollback"), f1: true }); }
		run(accessor: ServicesAccessor): void {
			accessor.get(ITerminalCopyMode).enter();
		}
	});
}
