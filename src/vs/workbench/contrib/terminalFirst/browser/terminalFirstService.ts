/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Sequencer } from '../../../../base/common/async.js';
import { Disposable, MutableDisposable } from '../../../../base/common/lifecycle.js';
import { Schemas } from '../../../../base/common/network.js';
import { URI } from '../../../../base/common/uri.js';
import { localize } from '../../../../nls.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { createDecorator, IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IQuickInputService } from '../../../../platform/quickinput/common/quickInput.js';
import { TerminalCapability } from '../../../../platform/terminal/common/capabilities/capabilities.js';
import { TerminalLocation } from '../../../../platform/terminal/common/terminal.js';
import { whenEditorClosed } from '../../../browser/editor.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { IEditorGroupsService } from '../../../services/editor/common/editorGroupsService.js';
import { IWorkbenchEnvironmentService } from '../../../services/environment/common/environmentService.js';
import { IExtensionService } from '../../../services/extensions/common/extensions.js';
import { IWorkbenchLayoutService, Parts, Position } from '../../../services/layout/browser/layoutService.js';
import { ITerminalGroupService, ITerminalInstance, ITerminalService } from '../../terminal/browser/terminal.js';

export const ITerminalFirstService = createDecorator<ITerminalFirstService>('terminalFirstService');

export interface ITerminalFirstService {
	readonly _serviceBrand: undefined;
	initialize(): Promise<void>;
	toggle(): Promise<void>;
	showShell(): Promise<void>;
	showEditor(focus?: boolean): Promise<void>;
	newTerminal(): Promise<void>;
	switchTerminal(offset: number): Promise<void>;
	pickTerminal(): Promise<void>;
	toggleTools(): Promise<void>;
	openFiles(fileURIs: string[], terminalSession: string, wait: boolean): Promise<void>;
}

/** Keeps the shell and editor alive while switching the primary workbench surface. */
export class TerminalFirstService extends Disposable implements ITerminalFirstService {
	declare readonly _serviceBrand: undefined;
	private readonly transitions = new Sequencer();
	private mode: 'shell' | 'editor' = 'editor';
	private returnTerminal: ITerminalInstance | undefined;
	private toolsVisible = false;
	private initialized = false;
	private readonly editorOptions = this._register(new MutableDisposable());

	constructor(
		@ITerminalService private readonly terminalService: ITerminalService,
		@ITerminalGroupService private readonly terminalGroupService: ITerminalGroupService,
		@IEditorService private readonly editorService: IEditorService,
		@IEditorGroupsService private readonly editorGroupsService: IEditorGroupsService,
		@IWorkbenchLayoutService private readonly layoutService: IWorkbenchLayoutService,
		@ICommandService private readonly commandService: ICommandService,
		@IQuickInputService private readonly quickInputService: IQuickInputService,
		@IWorkbenchEnvironmentService private readonly environmentService: IWorkbenchEnvironmentService,
		@IExtensionService private readonly extensionService: IExtensionService,
		@IFileService private readonly fileService: IFileService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@ILogService private readonly logService: ILogService,
	) {
		super();
		this._register(editorService.onDidActiveEditorChange(() => {
			if (this.initialized && this.mode === 'shell' && editorService.activeEditor && editorService.activeEditor.resource?.scheme !== Schemas.vscodeTerminal) {
				void this.showEditor(false).catch(error => this.logService.error(error));
			}
		}));
		this._register(editorService.onDidCloseEditor(() => {
			// A close can replace an editor or activate another group. Inspect the settled state.
			queueMicrotask(() => {
				if (this.initialized && this.mode === 'editor' && !this.editorService.editors.length) {
					void this.showShell().catch(error => this.logService.error(error));
				}
			});
		}));
	}

	async initialize(): Promise<void> {
		await this.layoutService.whenRestored;
		await this.extensionService.whenInstalledExtensionsRegistered();
		// Activation installs the CLI environment before the first shell starts.
		try {
			await this.commandService.executeCommand('terminalFirst.initializeShell');
		} catch (error) {
			this.logService.error('Terminal First shell integration could not initialize', error);
		}
		await this.terminalService.whenConnected;
		this.initialized = true;
		this.setToolsVisible(false);
		const explicitFiles = this.environmentService.filesToOpenOrCreate?.length || this.environmentService.filesToDiff?.length || this.environmentService.filesToMerge?.length;
		if (explicitFiles) {
			await this.showEditor();
		} else {
			await this.showShell();
		}
	}

	toggle(): Promise<void> {
		return this.transitions.queue(() => this.mode === 'shell' ? this.enterEditor(true) : this.enterShell());
	}

	showShell(): Promise<void> {
		return this.transitions.queue(() => this.enterShell());
	}

	private async enterShell(): Promise<void> {
		this.mode = 'shell';
		this.applyToolsVisibility(false);
		let terminal = this.returnTerminal && this.terminalGroupService.instances.includes(this.returnTerminal) ? this.returnTerminal : this.terminalGroupService.activeInstance;
		terminal ??= await this.terminalService.createTerminal({ location: TerminalLocation.Panel });
		this.returnTerminal = terminal;
		this.terminalService.setActiveInstance(terminal);
		this.layoutService.setPanelPosition(Position.BOTTOM);
		this.layoutService.setPanelAlignment('center');
		await this.terminalGroupService.showPanel(false);
		if (!this.layoutService.isPanelMaximized()) {
			this.layoutService.toggleMaximizedPanel();
		}
		await terminal.focusWhenReady();
	}

	showEditor(focus = true): Promise<void> {
		return this.transitions.queue(() => this.enterEditor(focus));
	}

	private async enterEditor(focus: boolean): Promise<void> {
		if (this.mode === 'shell') {
			this.returnTerminal = this.terminalGroupService.activeInstance;
		}
		this.mode = 'editor';
		this.applyToolsVisibility(this.toolsVisible);
		if (this.layoutService.isPanelMaximized()) {
			this.layoutService.toggleMaximizedPanel();
		}
		this.layoutService.setPartHidden(true, Parts.PANEL_PART);
		if (focus) {
			if (this.editorService.activeEditorPane) {
				this.editorService.activeEditorPane.focus();
			} else {
				await this.commandService.executeCommand('workbench.action.quickOpen');
			}
		}
	}

	async newTerminal(): Promise<void> {
		this.returnTerminal = await this.terminalService.createTerminal({ location: TerminalLocation.Panel });
		await this.showShell();
	}

	async switchTerminal(offset: number): Promise<void> {
		const terminals = this.terminalGroupService.instances;
		if (terminals.length) {
			const index = this.terminalGroupService.activeInstance ? terminals.indexOf(this.terminalGroupService.activeInstance) : 0;
			this.returnTerminal = terminals[(index + offset + terminals.length) % terminals.length];
		}
		await this.showShell();
	}

	async pickTerminal(): Promise<void> {
		const selected = await this.quickInputService.pick(this.terminalGroupService.instances.map(terminal => ({
			label: terminal.title,
			description: terminal.capabilities.get(TerminalCapability.CwdDetection)?.getCwd() || terminal.initialCwd,
			terminal,
		})), { placeHolder: localize('terminalFirst.pickSession', "Switch Shell Session"), matchOnDescription: true });
		if (selected) {
			this.returnTerminal = selected.terminal;
			await this.showShell();
		}
	}

	async toggleTools(): Promise<void> {
		this.setToolsVisible(!this.toolsVisible);
		if (this.toolsVisible) {
			await this.showEditor(false);
			await this.commandService.executeCommand('workbench.view.explorer');
		}
	}

	private setToolsVisible(visible: boolean): void {
		this.toolsVisible = visible;
		this.applyToolsVisibility(visible && this.mode === 'editor');
	}

	private applyToolsVisibility(visible: boolean): void {
		this.layoutService.mainContainer.classList.toggle('terminal-first-minimal', !visible);
		this.editorOptions.value = this.editorGroupsService.enforcePartOptions({ showTabs: visible ? 'multiple' : 'none' });
		for (const part of [Parts.ACTIVITYBAR_PART, Parts.SIDEBAR_PART, Parts.AUXILIARYBAR_PART, Parts.STATUSBAR_PART]) {
			this.layoutService.setPartHidden(!visible, part);
		}
		this.layoutService.layout();
	}

	async openFiles(fileURIs: string[], terminalSession: string, wait: boolean): Promise<void> {
		if (!fileURIs.length || fileURIs.some(value => URI.parse(value).scheme !== Schemas.file)) {
			throw new Error(localize('terminalFirst.invalidFiles', "Expected one or more local file paths."));
		}
		const resources = fileURIs.map(value => URI.parse(value));
		const terminal = this.terminalGroupService.instances.find(instance => instance.shellIntegrationNonce === terminalSession);
		if (!terminal) {
			throw new Error(localize('terminalFirst.missingSession', "This shell session is no longer attached to the window. Open a new shell session and retry."));
		}
		await this.showEditor(false);
		this.returnTerminal = terminal;
		const editors = await Promise.all(resources.map(async resource => ({ resource, forceUntitled: !await this.fileService.exists(resource), options: { pinned: true } })));
		await this.editorService.openEditors(editors);
		if (wait) {
			await this.instantiationService.invokeFunction(accessor => whenEditorClosed(accessor, resources));
		}
	}
}
