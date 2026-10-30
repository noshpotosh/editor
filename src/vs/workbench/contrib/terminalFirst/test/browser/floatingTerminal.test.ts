/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { deepStrictEqual } from 'assert';
import { Event, Emitter } from '../../../../../base/common/event.js';
import { toDisposable } from '../../../../../base/common/lifecycle.js';
import { upcastPartial } from '../../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { IEditorGroupsService, IEditorPart } from '../../../../services/editor/common/editorGroupsService.js';
import { IWorkbenchLayoutService } from '../../../../services/layout/browser/layoutService.js';
import { workbenchInstantiationService } from '../../../../test/browser/workbenchTestServices.js';
import { ITerminalInstance } from '../../../terminal/browser/terminal.js';
import { FloatingTerminal } from '../../browser/floatingTerminal.js';

suite('Floating Terminal Host', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	test('hiding detaches presentation without disposing the process; editor clicks preserve focus', () => {
		const instantiation = workbenchInstantiationService(undefined, store);
		const container = document.createElement('div');
		const editor = container.appendChild(document.createElement('div'));
		const input = editor.appendChild(document.createElement('input'));
		const menu = editor.appendChild(document.createElement('div'));
		menu.className = 'context-view';
		document.body.appendChild(container);
		store.add(toDisposable(() => container.remove()));
		instantiation.stub(IWorkbenchLayoutService, upcastPartial<IWorkbenchLayoutService>({ mainContainer: container, getContainer: () => editor, onDidLayoutMainContainer: Event.None }));
		instantiation.stub(IEditorGroupsService, upcastPartial<IEditorGroupsService>({ mainPart: upcastPartial<IEditorPart>({ onDidLayout: Event.None }) }));
		const calls: string[] = [];
		const title = store.add(new Emitter<ITerminalInstance>());
		const terminal = upcastPartial<ITerminalInstance>({
			title: 'Companion', onTitleChanged: title.event,
			attachToElement: () => { calls.push('attach'); },
			detachFromElement: () => { calls.push('detach'); },
			setVisible: visible => { calls.push(`visible:${visible}`); },
			layout: () => { },
			dispose: () => { calls.push('dispose'); },
		});
		const host = store.add(instantiation.createInstance(FloatingTerminal, (focus: boolean) => { calls.push(`hide:${focus}`); host.hideTerminal(); }, () => { }));
		host.show(terminal);
		menu.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
		input.focus();
		input.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
		deepStrictEqual([calls, document.activeElement === input, title.hasListeners()], [['attach', 'visible:true', 'hide:false', 'visible:false', 'detach'], true, false]);
		host.show(terminal);
		host.hideTerminal();
		deepStrictEqual([calls.slice(5), container.querySelector('.floating-terminal-header button')], [['attach', 'visible:true', 'visible:false', 'detach'], null]);
	});
});
