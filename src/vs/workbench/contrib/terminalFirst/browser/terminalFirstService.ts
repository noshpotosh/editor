/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Sequencer } from '../../../../base/common/async.js';
import { createTextBufferFactory } from '../../../../editor/common/model/textModel.js';
import { VSBuffer } from '../../../../base/common/buffer.js';
import { Emitter } from '../../../../base/common/event.js';
import { Disposable, MutableDisposable } from '../../../../base/common/lifecycle.js';
import { Schemas } from '../../../../base/common/network.js';
import { URI } from '../../../../base/common/uri.js';
import { joinPath, isEqual } from '../../../../base/common/resources.js';
import { localize } from '../../../../nls.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IDialogService } from '../../../../platform/dialogs/common/dialogs.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IQuickInputService } from '../../../../platform/quickinput/common/quickInput.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { TerminalCapability } from '../../../../platform/terminal/common/capabilities/capabilities.js';
import { TerminalExitReason, TerminalLocation } from '../../../../platform/terminal/common/terminal.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { whenEditorClosed } from '../../../browser/editor.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { IEditorGroupsService } from '../../../services/editor/common/editorGroupsService.js';
import { IWorkbenchEnvironmentService } from '../../../services/environment/common/environmentService.js';
import { IExtensionService } from '../../../services/extensions/common/extensions.js';
import { IWorkbenchLayoutService, Parts, Position } from '../../../services/layout/browser/layoutService.js';
import { ITerminalFirstService, ITerminalFirstSession } from '../../../services/terminalFirst/common/terminalFirst.js';
import { TerminalFirstEnabledContext, TerminalFirstShellContext, terminalFirstPolicy } from '../../../services/terminalFirst/common/terminalFirstPolicy.js';
import { ITextFileService } from '../../../services/textfile/common/textfiles.js';
import { IWorkspaceEditingService } from '../../../services/workspaces/common/workspaceEditing.js';
import { ITerminalGroupService, ITerminalInstance, ITerminalService } from '../../terminal/browser/terminal.js';

export { ITerminalFirstService } from '../../../services/terminalFirst/common/terminalFirst.js';

interface Session {
	id: string;
	nonce: string;
	title: string;
	mode: 'shell' | 'editor';
	cwd?: string;
	terminal?: ITerminalInstance;
}

interface StoredSessions {
	active?: string;
	managedWorkspace?: string;
	sessions: Omit<Session, 'terminal'>[];
}

/** Owns terminal sessions and serializes every change of the visible surface. */
export class TerminalFirstService extends Disposable implements ITerminalFirstService {
	declare readonly _serviceBrand: undefined;
	private static readonly STORAGE_KEY = 'terminalFirst.sessions';
	private readonly transitions = new Sequencer();
	private readonly sessionList: Session[] = [];
	private active: Session | undefined;
	private initialized = false;
	private changingSession = false;
	private managedWorkspace: URI | undefined;
	private readonly editorOptions = this._register(new MutableDisposable());
	private readonly changed = this._register(new Emitter<void>());
	readonly onDidChangeSessions = this.changed.event;
	private readonly shellContext;

	get sessions(): readonly ITerminalFirstSession[] {
		return this.sessionList.map(session => ({ id: session.id, title: session.terminal?.title || session.title, mode: session.mode, active: session === this.active }));
	}

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
		@IContextKeyService contextKeyService: IContextKeyService,
		@IStorageService private readonly storageService: IStorageService,
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
		@IWorkspaceEditingService private readonly workspaceEditingService: IWorkspaceEditingService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IDialogService private readonly dialogService: IDialogService,
		@ITextFileService private readonly textFileService: ITextFileService,
	) {
		super();
		TerminalFirstEnabledContext.bindTo(contextKeyService);
		this.shellContext = TerminalFirstShellContext.bindTo(contextKeyService);
		this._register(storageService.onWillSaveState(() => this.saveSessions()));
		this._register(terminalService.onAnyInstanceTitleChange(() => this.changed.fire()));
		this._register(editorService.onDidCloseEditor(() => {
			if (this.changingSession) { return; }
			queueMicrotask(() => {
				if (this.initialized && !this.changingSession && this.active?.mode === 'editor' && !this.editorService.editors.length) {
					void this.showShell().catch(error => this.logService.error(error));
				}
			});
		}));
		this._register(terminalService.onDidDisposeInstance(terminal => {
			const session = this.sessionList.find(session => session.terminal === terminal);
			if (session) {
				session.terminal = undefined;
				if (this.initialized && session === this.active && session.mode === 'shell') {
					void this.showShell().catch(error => this.logService.error(error));
				}
				this.changed.fire();
			}
		}));
	}

	initialize(): Promise<void> { return this.transitions.queue(() => this.initializeSessions()); }

	private async initializeSessions(): Promise<void> {
		await this.layoutService.whenRestored;
		await this.extensionService.whenInstalledExtensionsRegistered();
		const stored = this.storageService.getObject<StoredSessions>(TerminalFirstService.STORAGE_KEY, StorageScope.WORKSPACE);
		this.managedWorkspace = stored?.managedWorkspace ? URI.parse(stored.managedWorkspace) : undefined;
		// Enter the stable workspace before starting shells or accepting CLI requests.
		// Entering a workspace restarts the extension host that owns the CLI socket.
		await this.ensureManagedWorkspace(this.workspaceContextService.getWorkspace().folders[0]?.uri);
		try { await this.commandService.executeCommand('terminalFirst.initializeShell'); }
		catch (error) { this.logService.error('VS NOSH shell integration could not initialize', error); }
		await this.terminalService.whenConnected;
		if (stored) {
			for (const session of stored.sessions) {
				this.sessionList.push({ ...session, terminal: this.terminalGroupService.instances.find(instance => instance.shellIntegrationNonce === session.nonce) });
			}
		}
		for (const terminal of this.terminalGroupService.instances) {
			if (!this.sessionList.some(session => session.terminal === terminal)) { this.addSession(terminal); }
		}
		if (!this.sessionList.length) { this.addSession(await this.createTerminal()); }
		this.active = this.sessionList.find(session => session.id === stored?.active) ?? this.sessionList.find(session => session.terminal === this.terminalGroupService.activeInstance) ?? this.sessionList[0];
		this.editorGroupsService.mainPart.sessions?.activate(this.active.id);
		// Restore inactive editors too, so backups and shutdown include every session.
		for (const id of this.editorGroupsService.mainPart.sessions?.ids() ?? []) {
			this.editorGroupsService.mainPart.sessions?.activate(id);
			if (!this.sessionList.some(session => session.id === id)) {
				this.sessionList.push({ id, nonce: id, title: localize('recovered', "Recovered Session"), mode: 'editor' });
			}
		}
		this.editorGroupsService.mainPart.sessions?.activate(this.active.id);
		this.initialized = true;
		const explicitFiles = this.environmentService.filesToOpenOrCreate?.length || this.environmentService.filesToDiff?.length || this.environmentService.filesToMerge?.length;
		await this.present(this.active, explicitFiles ? 'editor' : 'shell');
	}

	private addSession(terminal: ITerminalInstance): Session {
		const session: Session = { id: terminal.shellIntegrationNonce, nonce: terminal.shellIntegrationNonce, title: terminal.title || localize('terminal', "Terminal"), mode: 'shell', terminal };
		this.sessionList.push(session);
		return session;
	}

	private createTerminal(cwd?: string): Promise<ITerminalInstance> {
		return this.terminalService.createTerminal({ location: TerminalLocation.Panel, terminalFirstSession: true, cwd });
	}

	private async ensureTerminal(session: Session): Promise<ITerminalInstance> {
		if (!session.terminal || !this.terminalGroupService.instances.includes(session.terminal)) {
			session.terminal = await this.createTerminal(session.cwd ? URI.parse(session.cwd).fsPath : undefined);
			session.nonce = session.terminal.shellIntegrationNonce;
		}
		return session.terminal;
	}

	private saveSessions(): void {
		if (!this.initialized) { return; }
		const state: StoredSessions = {
			active: this.active?.id,
			managedWorkspace: this.managedWorkspace?.toString(),
			sessions: this.sessionList.map(({ terminal, ...session }) => {
				const cwd = terminal?.capabilities.get(TerminalCapability.CwdDetection)?.getCwd();
				return { ...session, title: terminal?.title || session.title, cwd: cwd ? URI.file(cwd).toString() : session.cwd || (terminal?.initialCwd ? URI.file(terminal.initialCwd).toString() : undefined) };
			}),
		};
		this.storageService.store(TerminalFirstService.STORAGE_KEY, state, StorageScope.WORKSPACE, StorageTarget.MACHINE);
	}

	toggle(): Promise<void> { return this.transitions.queue(() => this.present(this.active!, this.active?.mode === 'shell' ? 'editor' : 'shell')); }
	showShell(): Promise<void> { return this.transitions.queue(() => this.present(this.active!, 'shell')); }
	showEditor(focus = true): Promise<void> { return this.transitions.queue(() => this.present(this.active!, 'editor', focus)); }

	private async present(session: Session, mode: 'shell' | 'editor', focus = true, cwd?: string): Promise<void> {
		if (!session) { return; }
		this.changingSession = true;
		try {
			const terminal = await this.ensureTerminal(session);
			if (mode === 'editor') { await this.updateDirectory(session, cwd); }
			this.editorGroupsService.mainPart.sessions?.activate(session.id);
			this.active = session;
			session.mode = mode;
			terminalFirstPolicy.mode = mode;
			this.shellContext.set(mode === 'shell');
			this.terminalService.setActiveInstance(terminal);
			this.layoutService.mainContainer.classList.toggle('terminal-first-shell', mode === 'shell');
			this.layoutService.mainContainer.classList.remove('terminal-first-minimal');
			this.editorOptions.value = this.editorGroupsService.enforcePartOptions({ showTabs: 'multiple' });
			for (const part of [Parts.ACTIVITYBAR_PART, Parts.SIDEBAR_PART, Parts.STATUSBAR_PART]) {
				this.layoutService.setPartHidden(mode === 'shell', part);
			}
			this.layoutService.setPartHidden(true, Parts.AUXILIARYBAR_PART);
			if (mode === 'shell') {
				this.layoutService.setPanelPosition(Position.BOTTOM);
				this.layoutService.setPanelAlignment('center');
				await this.terminalGroupService.showPanel(false);
				if (!this.layoutService.isPanelMaximized()) { this.layoutService.toggleMaximizedPanel(); }
				if (focus) { await terminal.focusWhenReady(); }
			} else {
				if (this.layoutService.isPanelMaximized()) { this.layoutService.toggleMaximizedPanel(); }
				this.layoutService.setPartHidden(true, Parts.PANEL_PART);
				await this.commandService.executeCommand('workbench.view.explorer');
				if (focus) { this.editorGroupsService.activeGroup.focus(); }
			}
			this.layoutService.layout();
			this.saveSessions();
			this.changed.fire();
		} finally { this.changingSession = false; }
	}

	private async ensureManagedWorkspace(cwd?: URI): Promise<void> {
		const workspace = this.workspaceContextService.getWorkspace();
		if (!this.managedWorkspace || !isEqual(workspace.configuration ?? undefined, this.managedWorkspace)) {
			const target = joinPath(this.environmentService.workspaceStorageHome, workspace.id, 'vs-nosh.code-workspace');
			await this.fileService.createFolder(joinPath(this.environmentService.workspaceStorageHome, workspace.id));
			const settings = Object.fromEntries(this.configurationService.keys().workspace.map(key => [key, this.configurationService.inspect(key).workspaceValue]));
			const contents = JSON.stringify({ folders: cwd ? [{ path: cwd.fsPath }] : [], settings }, null, '\t');
			await this.fileService.writeFile(target, VSBuffer.fromString(contents));
			const model = await this.textFileService.files.resolve(target, { contents: createTextBufferFactory(contents) });
			model.textEditorModel?.setValue(contents);
			await model.save();
			await this.workspaceEditingService.enterWorkspace(target);
			if (!isEqual(this.workspaceContextService.getWorkspace().configuration ?? undefined, target)) { throw new Error(localize('workspaceCancelled', "Opening the editor workspace was cancelled.")); }
			this.managedWorkspace = target;
		}
	}

	private async updateDirectory(session: Session, explicitCwd?: string): Promise<void> {
		const detected = session.terminal?.capabilities.get(TerminalCapability.CwdDetection)?.getCwd();
		const cwd = explicitCwd ? URI.parse(explicitCwd) : detected ? URI.file(detected) : session.cwd ? URI.parse(session.cwd) : session.terminal?.initialCwd ? URI.file(session.terminal.initialCwd) : this.workspaceContextService.getWorkspace().folders[0]?.uri;
		if (!cwd || cwd.scheme !== Schemas.file) { return; }
		if (!await this.fileService.exists(cwd)) { throw new Error(localize('missingDirectory', "The terminal directory no longer exists: {0}", cwd.fsPath)); }
		await this.ensureManagedWorkspace(cwd);
		const workspace = this.workspaceContextService.getWorkspace();
		if (workspace.folders.length !== 1 || !isEqual(workspace.folders[0].uri, cwd)) {
			await this.workspaceEditingService.updateFolders(0, workspace.folders.length, [{ uri: cwd }]);
			const folders = this.workspaceContextService.getWorkspace().folders;
			if (folders.length !== 1 || !isEqual(folders[0].uri, cwd)) { throw new Error(localize('directoryCancelled', "Changing the editor directory was cancelled.")); }
		}
		session.cwd = cwd.toString();
	}

	newTerminal(): Promise<void> {
		return this.transitions.queue(async () => {
			const cwd = this.active?.terminal?.capabilities.get(TerminalCapability.CwdDetection)?.getCwd() || (this.active?.cwd ? URI.parse(this.active.cwd).fsPath : undefined);
			const session = this.addSession(await this.createTerminal(cwd));
			await this.present(session, 'shell');
		});
	}

	selectSession(id: string): Promise<void> {
		return this.transitions.queue(async () => {
			const session = this.sessionList.find(session => session.id === id);
			if (session) { await this.present(session, session.mode); }
		});
	}

	switchTerminal(offset: number): Promise<void> {
		return this.transitions.queue(async () => {
			if (!this.sessionList.length) { return; }
			const index = this.active ? this.sessionList.indexOf(this.active) : 0;
			const session = this.sessionList[(index + offset + this.sessionList.length) % this.sessionList.length];
			await this.present(session, session.mode);
		});
	}

	async pickTerminal(): Promise<void> {
		const selected = await this.quickInputService.pick(this.sessions.map(session => ({ label: session.title, id: session.id })), { placeHolder: localize('pickSession', "Switch Terminal Session") });
		if (selected) { await this.selectSession(selected.id); }
	}

	closeSession(id: string): Promise<void> {
		return this.transitions.queue(async () => {
			const session = this.sessionList.find(session => session.id === id);
			if (!session) { return; }
			const confirm = this.configurationService.getValue<string>('terminal.integrated.confirmOnKill');
			if (session.terminal?.hasChildProcesses && (confirm === 'always' || confirm === 'panel')) {
				const result = await this.dialogService.confirm({ message: localize('closeRunning', "Close this terminal and its running processes?"), primaryButton: localize('close', "Close") });
				if (!result.confirmed) { return; }
			}
			this.changingSession = true;
			try {
				// Activate before close so normal dirty-editor dialogs refer to visible files.
				this.editorGroupsService.mainPart.sessions?.activate(id);
				if (this.editorGroupsService.mainPart.sessions && !await this.editorGroupsService.mainPart.sessions.close(id)) {
					this.editorGroupsService.mainPart.sessions.activate(this.active!.id);
					return;
				}
				this.sessionList.splice(this.sessionList.indexOf(session), 1);
				session.terminal?.dispose(TerminalExitReason.User);
				if (!this.sessionList.length) { this.addSession(await this.createTerminal()); }
				const next = this.active === session ? this.sessionList[0] : this.active!;
				await this.present(next, next.mode);
				await this.editorGroupsService.mainPart.sessions?.close(id);
			} finally { this.changingSession = false; }
		});
	}

	async openFiles(fileURIs: string[], terminalSession: string, wait: boolean, cwd?: string): Promise<void> {
		if (!fileURIs.length || fileURIs.some(value => URI.parse(value).scheme !== Schemas.file) || (cwd && URI.parse(cwd).scheme !== Schemas.file)) {
			throw new Error(localize('invalidFiles', "Expected one or more local file paths."));
		}
		const resources = fileURIs.map(value => URI.parse(value));
		let closed: Promise<void> | undefined;
		await this.transitions.queue(async () => {
			const session = this.sessionList.find(session => session.terminal?.shellIntegrationNonce === terminalSession);
			if (!session) { throw new Error(localize('missingSession', "This shell session is no longer attached to the window. Open a new shell session and retry.")); }
			await this.present(session, 'editor', false, cwd);
			const editors = await Promise.all(resources.map(async resource => ({ resource, forceUntitled: !await this.fileService.exists(resource), options: { pinned: true } })));
			await this.editorService.openEditors(editors);
			if (wait) { closed = this.instantiationService.invokeFunction(accessor => whenEditorClosed(accessor, resources, groupId => !this.editorGroupsService.mainPart.sessions || this.editorGroupsService.mainPart.sessions.owns(session.id, groupId))); }
		});
		await closed;
	}
}
