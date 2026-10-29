/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $ } from '../../../base/browser/dom.js';
import { Disposable, toDisposable } from '../../../base/common/lifecycle.js';
import { isMacintosh } from '../../../base/common/platform.js';
import { ICodeEditor, IOverlayWidget, IOverlayWidgetPosition, OverlayWidgetPositionPreference } from '../../../editor/browser/editorBrowser.js';
import { EditorContributionInstantiation, registerEditorContribution } from '../../../editor/browser/editorExtensions.js';
import { IEditorContribution } from '../../../editor/common/editorCommon.js';
import { IExtensionStatusBarItemService } from './statusBarExtensionPoint.js';
import './media/terminalFirst.css';

/** Keeps Vim's mode, pending keys and command line visible when the workbench status bar is hidden. */
class TerminalFirstVimStatus extends Disposable implements IEditorContribution, IOverlayWidget {
	static readonly ID = 'editor.contrib.terminalFirstVimStatus';
	private readonly node = $('.terminal-first-vim-status');

	constructor(
		private readonly editor: ICodeEditor,
		@IExtensionStatusBarItemService private readonly statusbarService: IExtensionStatusBarItemService,
	) {
		super();
		this.node.setAttribute('role', 'status');
		this._register(statusbarService.onDidChange(() => this.update()));
		this._register(editor.onDidFocusEditorWidget(() => this.update()));
		this._register(editor.onDidBlurEditorWidget(() => this.update()));
		editor.addOverlayWidget(this);
		this._register(toDisposable(() => editor.removeOverlayWidget(this)));
		this.update();
	}

	private update(): void {
		const entries = [...this.statusbarService.getEntries()].filter(([, item]) => item.entry.extensionId?.toLowerCase() === 'vscodevim.vim');
		this.node.textContent = this.editor.hasWidgetFocus() ? entries.map(([, item]) => item.entry.text).filter(Boolean).join('  ') : '';
		this.node.classList.toggle('error', entries.some(([, item]) => item.entry.kind === 'error'));
	}

	getId(): string { return TerminalFirstVimStatus.ID; }
	getDomNode(): HTMLElement { return this.node; }
	getPosition(): IOverlayWidgetPosition {
		return { preference: OverlayWidgetPositionPreference.BOTTOM_RIGHT_CORNER };
	}
}

if (isMacintosh) {
	registerEditorContribution(TerminalFirstVimStatus.ID, TerminalFirstVimStatus, EditorContributionInstantiation.AfterFirstRender);
}
