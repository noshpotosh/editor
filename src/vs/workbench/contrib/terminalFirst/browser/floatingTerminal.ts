/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import './floatingOverlay.css';
import './floatingTerminal.css';
import { $, append, addDisposableListener, EventType, getWindow, trackFocus } from '../../../../base/browser/dom.js';
import { onUnexpectedError } from '../../../../base/common/errors.js';
import { IMenuService, MenuId } from '../../../../platform/actions/common/actions.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IContextMenuService } from '../../../../platform/contextview/browser/contextView.js';
import { Disposable, DisposableStore, toDisposable } from '../../../../base/common/lifecycle.js';
import { localize } from '../../../../nls.js';
import { layoutFloatingOverlay } from './floatingOverlay.js';
import { IEditorGroupsService } from '../../../services/editor/common/editorGroupsService.js';
import { IWorkbenchLayoutService, Parts } from '../../../services/layout/browser/layoutService.js';
import { openContextMenu } from '../../terminal/browser/terminalContextMenu.js';
import { ITerminalConfigurationService, ITerminalInstance } from '../../terminal/browser/terminal.js';

/** Presentation only: hiding or disposing the host never kills its session's shell. */
export class FloatingTerminal extends Disposable {
	private readonly element: HTMLElement;
	private readonly title: HTMLElement;
	private readonly body: HTMLElement;
	private readonly attachment = this._register(new DisposableStore());
	private terminal: ITerminalInstance | undefined;

	constructor(
		private readonly hide: (focusEditor: boolean) => void,
		private readonly focusChanged: (focused: boolean) => void,
		@IWorkbenchLayoutService private readonly layoutService: IWorkbenchLayoutService,
		@IEditorGroupsService editorGroupsService: IEditorGroupsService,
		@IMenuService menuService: IMenuService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IContextMenuService contextMenuService: IContextMenuService,
		@ITerminalConfigurationService terminalConfigurationService: ITerminalConfigurationService,
	) {
		super();
		this.element = append(layoutService.mainContainer, $('.terminal-first-floating'));
		this.element.hidden = true;
		this.element.setAttribute('role', 'region');
		this.element.setAttribute('aria-label', localize('floatingTerminal', "Floating Terminal"));
		const header = append(this.element, $('.floating-terminal-header'));
		this.title = append(header, $('span'));
		this.body = append(this.element, $('.floating-terminal-body.terminal-editor'));
		const menu = this._register(menuService.createMenu(MenuId.TerminalInstanceContext, contextKeyService));
		let cancelContextMenu = false;
		this._register(addDisposableListener(this.body, EventType.MOUSE_DOWN, event => {
			cancelContextMenu = false;
			void this.terminal?.handleMouseEvent(event, menu).then(result => { cancelContextMenu = result?.cancelContextMenu ?? false; }).catch(onUnexpectedError);
		}));
		this._register(addDisposableListener(this.body, EventType.CONTEXT_MENU, event => {
			const behavior = terminalConfigurationService.config.rightClickBehavior;
			if (this.terminal && !cancelContextMenu && !event.shiftKey && behavior !== 'nothing' && behavior !== 'copyPaste' && behavior !== 'paste') {
				openContextMenu(getWindow(this.element), event, this.terminal, menu, contextMenuService);
			}
			event.preventDefault();
			event.stopPropagation();
			cancelContextMenu = false;
		}));
		const focus = this._register(trackFocus(this.element));
		this._register(focus.onDidFocus(() => this.focusChanged(true)));
		this._register(focus.onDidBlur(() => this.focusChanged(false)));
		this._register(layoutService.onDidLayoutMainContainer(() => this.layout()));
		this._register(editorGroupsService.mainPart.onDidLayout(() => this.layout()));
		const editor = layoutService.getContainer(getWindow(this.element), Parts.EDITOR_PART);
		if (editor) {
			this._register(addDisposableListener(editor, EventType.MOUSE_DOWN, event => {
				const target = event.target;
				if (!this.element.hidden && target instanceof getWindow(this.element).Element && !target.closest('.context-view, .suggest-widget, .monaco-hover, .quick-input-widget')) {
					this.hide(false);
				}
			}, true));
		}
		this._register(toDisposable(() => this.element.remove()));
	}

	show(terminal: ITerminalInstance): void {
		this.hideTerminal();
		this.terminal = terminal;
		this.title.textContent = terminal.title;
		this.attachment.add(terminal.onTitleChanged(() => this.title.textContent = terminal.title));
		this.element.hidden = false;
		terminal.attachToElement(this.body);
		terminal.setVisible(true);
		this.layout();
	}

	hideTerminal(): void {
		this.attachment.clear();
		this.terminal?.setVisible(false);
		this.terminal?.detachFromElement();
		this.terminal = undefined;
		this.element.hidden = true;
		this.focusChanged(false);
	}

	private layout(): void {
		if (!this.terminal) { return; }
		layoutFloatingOverlay(this.element, this.layoutService);
		this.terminal.layout({ width: this.body.clientWidth, height: this.body.clientHeight });
	}

	override dispose(): void {
		this.hideTerminal();
		super.dispose();
	}
}
