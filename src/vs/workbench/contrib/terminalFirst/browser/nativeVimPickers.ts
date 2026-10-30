/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { addDisposableListener, EventType } from '../../../../base/browser/dom.js';
import { mainWindow } from '../../../../base/browser/window.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { localize } from '../../../../nls.js';
import { INativeVimService } from '../../../../editor/contrib/nativeVim/common/nativeVimService.js';
import { IQuickInputService, IQuickPick, IQuickPickItem, QuickInputType, QuickPickFocus } from '../../../../platform/quickinput/common/quickInput.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';

/** Modal navigation is confined to focused picker widgets, never global text inputs. */
export class NativeVimPickers extends Disposable {
	private normal = false;
	private pending = '';
	private originalPrompt: string | undefined;
	constructor(
		private readonly vim: INativeVimService,
		private readonly quick: IQuickInputService,
		private readonly commands: ICommandService,
		private readonly contexts: IContextKeyService,
	) {
		super();
		this._register(quick.onShow(() => { this.normal = false; this.pending = ''; this.originalPrompt = undefined; }));
		this._register(quick.onHide(() => { this.normal = false; this.pending = ''; vim.cancel(); }));
		this._register(addDisposableListener(mainWindow, EventType.FOCUS_IN, () => { this.pending = ''; vim.cancel(); }));
		this._register(addDisposableListener(mainWindow, EventType.KEY_DOWN, event => this.keydown(event), true));
	}
	private keydown(event: KeyboardEvent): void {
		if (!this.vim.enabled || event.isComposing || event.metaKey || event.altKey || event.ctrlKey || !(event.target instanceof mainWindow.HTMLElement)) { return; }
		const context = this.contexts.getContext(event.target);
		const browserNormal = context.getValue('terminalFirstBrowserFocused') && context.getValue('terminalFirstBrowserMode') === 'normal';
		const jumpList = context.getValue('terminalFirstJumpListFocused');
		if ((browserNormal || jumpList) && this.vim.key(event.key === 'Escape' ? '<Esc>' : event.key, 'normal', false)) { event.preventDefault(); event.stopImmediatePropagation(); return; }
		if (context.getValue('terminalFocus')) { return; }
		const current = this.quick.currentQuickInput;
		if (current?.type === QuickInputType.QuickPick && event.target.closest('.quick-input-widget')) {
			const picker = current as IQuickPick<IQuickPickItem>;
			if (event.key === 'Escape' && !this.normal) {
				this.normal = true; this.originalPrompt = picker.prompt;
				picker.prompt = localize('normalPicker', "NORMAL · j/k Navigate · gg/G First/Last · i Filter · q/Esc Close");
			} else if (this.normal) {
				const prior = this.pending; this.pending = '';
				switch (event.key) {
					case 'j': picker.focus(QuickPickFocus.Next); break;
					case 'k': picker.focus(QuickPickFocus.Previous); break;
					case 'G': picker.focus(QuickPickFocus.Last); break;
					case 'g': if (prior === 'g') { picker.focus(QuickPickFocus.First); } else { this.pending = 'g'; } break;
					case 'i': case '/': this.normal = false; picker.prompt = this.originalPrompt; this.quick.focus(); break;
					case 'q': case 'Escape': void this.quick.cancel(); break;
					case 'Enter': void this.quick.accept(); break;
					default: if (event.key.length !== 1) { return; }
				}
			} else { return; }
			event.preventDefault(); event.stopImmediatePropagation(); return;
		}
		if (browserNormal) {
			let command: string | undefined;
			if (event.key === 'h') { command = 'parent'; }
			if (event.key === 'l') { command = 'accept'; }
			if (event.key === '.') { command = 'hidden'; }
			if (event.key === 'G') { command = 'last'; }
			if (event.key === 'g') { if (this.pending === 'g') { command = 'first'; this.pending = ''; } else { this.pending = 'g'; event.preventDefault(); event.stopImmediatePropagation(); return; } }
			else { this.pending = ''; }
			if (command) { void this.commands.executeCommand(`terminalFirst.fileBrowser.${command}`); event.preventDefault(); event.stopImmediatePropagation(); }
		}
	}
}
