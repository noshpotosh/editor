/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { status } from '../../../../base/browser/ui/aria/aria.js';
import { EditorResourceAccessor, EditorsOrder, SideBySideEditor } from '../../../common/editor.js';
import { FloatingJumpList } from './floatingJumpList.js';
import { JumpListModel } from './jumpListModel.js';
import { Sequencer } from '../../../../base/common/async.js';
import { createTextBufferFactory } from '../../../../editor/common/model/textModel.js';
import { VSBuffer } from '../../../../base/common/buffer.js';
import { Emitter } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { mainWindow } from '../../../../base/browser/window.js';
import { mark } from '../../../../base/common/performance.js';
import { IUserDataProfileService } from '../../../services/userDataProfile/common/userDataProfile.js';
import { IWorkspaceTrustManagementService, IWorkspaceTrustRequestService } from '../../../../platform/workspace/common/workspaceTrust.js';
import { FileAccess, Schemas } from '../../../../base/common/network.js';
import { URI } from '../../../../base/common/uri.js';
import { dirname, joinPath, isEqual, isEqualOrParent, basename } from '../../../../base/common/resources.js';
import { localize } from '../../../../nls.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IDialogService } from '../../../../platform/dialogs/common/dialogs.js';
import { ExtensionIdentifier } from '../../../../platform/extensions/common/extensions.js';
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
import { TerminalFirstJumpListVisibleContext, TerminalFirstBrowserVisibleContext, TerminalFirstFloatingEnabledContext, TerminalFirstFloatingVisibleContext, TerminalFirstFloatingFocusedContext, TerminalFirstEnabledContext, TerminalFirstShellContext, terminalFirstPolicy } from '../../../services/terminalFirst/common/terminalFirstPolicy.js';
import { ITextFileService } from '../../../services/textfile/common/textfiles.js';
import { IWorkspaceEditingService } from '../../../services/workspaces/common/workspaceEditing.js';
import { ITerminalEditorService, ITerminalGroupService, ITerminalInstance, ITerminalService } from '../../terminal/browser/terminal.js';
import { FloatingFileBrowser } from './floatingFileBrowser.js';
import { FloatingTerminal } from './floatingTerminal.js';
import { TerminalFirstLaunch } from './terminalPolicy.js';

export { ITerminalFirstService } from '../../../services/terminalFirst/common/terminalFirst.js';

interface Session {
	id: string;
	nonce: string;
	title: string;
	mode: 'shell' | 'editor';
	cwd?: string;
	terminal?: ITerminalInstance;
	floatingTerminal?: ITerminalInstance;
	floatingNonce?: string;
	floatingCwd?: string;
	tileNonces?: string[];
}

interface StoredSessions {
	active?: string;
	managedWorkspace?: string;
	sessions: Omit<Session, 'terminal' | 'floatingTerminal'>[];
}

/** Owns terminal sessions and serializes every change of the visible surface. */
export class TerminalFirstService extends Disposable implements ITerminalFirstService {
	declare readonly _serviceBrand: undefined;
	private static readonly STORAGE_KEY = 'terminalFirst.sessions';
	private readonly transitions = new Sequencer();
	private readonly sessionList: Session[] = [];
	private active: Session | undefined;
	private initialized = false;
	private trustRequested = false;
	private changingSession = false;
	private managedWorkspace: URI | undefined;
	private readonly changed = this._register(new Emitter<void>());
	readonly onDidChangeSessions = this.changed.event;
	private readonly shellContext;
	private readonly floatingEnabledContext;
	private readonly floatingVisibleContext;
	private readonly floatingFocusedContext;
	private jumpListHost: FloatingJumpList | undefined;
	private jumpListModel: JumpListModel | undefined;
	private jumpListVisible = false;
	private jumpListGeneration = 0;
	private readonly jumpListVisibleContext;
	get floatingJumpListVisible(): boolean { return this.jumpListVisible; }
	private browserHost: FloatingFileBrowser | undefined;
	private browserVisible = false;
	private browserGeneration = 0;
	private readonly browserVisibleContext;
	get floatingFileBrowserVisible(): boolean { return this.browserVisible; }
	private floatingHost: FloatingTerminal | undefined;
	private floatingVisible = false;
	get floatingTerminalVisible(): boolean { return this.floatingVisible; }

	get sessions(): readonly ITerminalFirstSession[] {
		return this.sessionList.map(session => ({ id: session.id, title: session.terminal?.title || session.title, mode: session.mode, dirty: this.editorService.getEditors(EditorsOrder.SEQUENTIAL, { includeInactive: true }).some(({ editor, groupId }) => editor.isDirty() && this.editorGroupsService.mainPart.sessions?.owns(session.id, groupId)), active: session === this.active }));
	}

	constructor(
		@ITerminalService private readonly terminalService: ITerminalService,
		@ITerminalGroupService private readonly terminalGroupService: ITerminalGroupService,
		@ITerminalEditorService private readonly terminalEditorService: ITerminalEditorService,
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
		@IUserDataProfileService private readonly profiles: IUserDataProfileService,
		@IWorkspaceTrustManagementService private readonly trust: IWorkspaceTrustManagementService,
		@IWorkspaceTrustRequestService private readonly trustRequests: IWorkspaceTrustRequestService,
	) {
		super();
		const updatePadding = () => {
			const padding = Math.max(0, Math.min(100, configurationService.getValue<number>('terminalFirst.terminal.padding') ?? 12));
			layoutService.mainContainer.style.setProperty('--terminal-first-padding', `${padding}px`);
			if (this.initialized) { layoutService.layout(); }
		};
		updatePadding();
		this._register(configurationService.onDidChangeConfiguration(event => { if (event.affectsConfiguration('terminalFirst.terminal.padding')) { updatePadding(); } }));
		// The active tile is only outlined when there is another tile to distinguish it from.
		const updateTileCount = () => layoutService.mainContainer.classList.toggle('terminal-first-single-tile', editorGroupsService.mainPart.count <= 1);
		updateTileCount();
		this._register(editorGroupsService.mainPart.onDidAddGroup(updateTileCount));
		this._register(editorGroupsService.mainPart.onDidRemoveGroup(updateTileCount));
		TerminalFirstEnabledContext.bindTo(contextKeyService);
		this.jumpListVisibleContext = TerminalFirstJumpListVisibleContext.bindTo(contextKeyService);
		this.browserVisibleContext = TerminalFirstBrowserVisibleContext.bindTo(contextKeyService);
		this.shellContext = TerminalFirstShellContext.bindTo(contextKeyService);
		this.floatingEnabledContext = TerminalFirstFloatingEnabledContext.bindTo(contextKeyService);
		this.floatingVisibleContext = TerminalFirstFloatingVisibleContext.bindTo(contextKeyService);
		this.floatingFocusedContext = TerminalFirstFloatingFocusedContext.bindTo(contextKeyService);
		this._register(storageService.onWillSaveState(() => this.saveSessions()));
		this._register(terminalService.onAnyInstanceTitleChange(() => this.changed.fire()));
		this._register(editorService.onDidEditorsChange(() => this.changed.fire()));

		this._register(terminalService.onDidDisposeInstance(terminal => {
			const owner = this.sessionList.find(session => session.floatingTerminal === terminal);
			if (owner) {
				owner.floatingTerminal = undefined;
				owner.floatingNonce = undefined;
				if (owner === this.active) { this.hideFloating(true); }
				this.saveSessions();
			}
			// Closed tile terminals no longer route `e` back to their session. Shutdown keeps
			// the nonce so the persisted terminal still matches after it reconnects.
			const tileOwner = terminal.exitReason === TerminalExitReason.Shutdown ? undefined : this.sessionList.find(session => session.tileNonces?.includes(terminal.shellIntegrationNonce));
			if (tileOwner) {
				tileOwner.tileNonces = tileOwner.tileNonces!.filter(nonce => nonce !== terminal.shellIntegrationNonce);
				this.saveSessions();
			}
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

	initialize(): Promise<void> {
		return this.transitions.queue(async () => {
			try {
				await this.initializeSessions();
			} finally {
				// Reveal only the settled layout, but keep startup failures recoverable.
				this.layoutService.mainContainer.classList.remove('terminal-first-starting');
			}
		});
	}

	private async initializeSessions(): Promise<void> {
		mark('code/terminalFirst/start');
		await this.layoutService.whenRestored;
		mark('code/terminalFirst/restored');
		const stored = this.storageService.getObject<StoredSessions>(TerminalFirstService.STORAGE_KEY, StorageScope.WORKSPACE);
		this.managedWorkspace = stored?.managedWorkspace ? URI.parse(stored.managedWorkspace) : undefined;
		// Enter the stable workspace before starting shells or accepting CLI requests.
		// Entering a workspace restarts the extension host that owns the CLI socket.
		await this.ensureManagedWorkspace(this.workspaceContextService.getWorkspace().folders[0]?.uri);
		mark('code/terminalFirst/workspace');
		await this.terminalService.whenConnected;
		mark('code/terminalFirst/connected');
		if (stored) {
			for (const session of stored.sessions) {
				this.sessionList.push({
					...session,
					terminal: this.terminalGroupService.instances.find(instance => instance.shellIntegrationNonce === session.nonce),
					floatingTerminal: this.terminalService.instances.find(instance => TerminalFirstLaunch.isDetached(instance) && instance.shellIntegrationNonce === session.floatingNonce),
				});
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
		this.layoutService.setPartHidden(true, Parts.SIDEBAR_PART);
		mark('code/terminalFirst/created');
		await this.present(this.active, explicitFiles ? 'editor' : 'shell');
		mark('code/terminalFirst/presented');
		void this.initializeCLI();
	}

	private async initializeCLI(): Promise<void> {
		try {
			await this.extensionService.whenInstalledExtensionsRegistered();
			mark('code/terminalFirst/extensions');
			const extensionId = new ExtensionIdentifier('vscode.terminal-first');
			await this.extensionService.activateById(extensionId, { extensionId, activationEvent: 'onCommand:terminalFirst.initializeShell', startup: false });
			await this.commandService.executeCommand('terminalFirst.initializeShell');
			mark('code/terminalFirst/cli');
		} catch (error) { this.logService.error('VS NOSH shell integration could not initialize', error); }
	}

	private shellEnvironment(): Record<string, string> {
		return {
			PATH: `${joinPath(FileAccess.asFileUri(''), '../extensions/terminal-first/bin').fsPath}:\${env:PATH}`,
			TERMINAL_FIRST_NODE: '${execPath}',
			TERMINAL_FIRST_CLI_POINTER: joinPath(this.profiles.currentProfile.globalStorageHome, 'vscode.terminal-first', `window-${mainWindow.vscodeWindowId}.json`).fsPath,
		};
	}

	private addSession(terminal: ITerminalInstance): Session {
		const session: Session = { id: terminal.shellIntegrationNonce, nonce: terminal.shellIntegrationNonce, title: terminal.title || localize('terminal', "Terminal"), mode: 'shell', terminal };
		this.sessionList.push(session);
		return session;
	}

	private createTerminal(cwd?: string): Promise<ITerminalInstance> {
		return this.terminalService.createTerminal(TerminalFirstLaunch.session({ location: TerminalLocation.Panel, cwd, config: { env: this.shellEnvironment() } }));
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
			sessions: this.sessionList.map(({ id, nonce, title, mode, cwd: savedCwd, terminal, floatingTerminal, floatingNonce, floatingCwd, tileNonces }) => {
				const cwd = terminal?.capabilities.get(TerminalCapability.CwdDetection)?.getCwd();
				return {
					id, nonce, mode, title: terminal?.title || title,
					cwd: cwd ? URI.file(cwd).toString() : savedCwd || (terminal?.initialCwd ? URI.file(terminal.initialCwd).toString() : undefined),
					floatingNonce, tileNonces,
					floatingCwd: floatingTerminal?.capabilities.get(TerminalCapability.CwdDetection)?.getCwd() || floatingCwd,
				};
			}),
		};
		this.storageService.store(TerminalFirstService.STORAGE_KEY, state, StorageScope.WORKSPACE, StorageTarget.MACHINE);
	}

	private activeFile(): URI | undefined {
		const resource = EditorResourceAccessor.getOriginalUri(this.editorService.activeEditor, { supportSideBySide: SideBySideEditor.PRIMARY });
		return resource?.scheme === Schemas.file ? resource : undefined;
	}

	private async loadJumpList(): Promise<{ model: JumpListModel; project: URI } | undefined> {
		const file = this.activeFile();
		const directory = this.active?.cwd ? URI.parse(this.active.cwd) : this.workspaceContextService.getWorkspace().folders[0]?.uri
			?? (this.active?.terminal?.initialCwd ? URI.file(this.active.terminal.initialCwd) : file ? dirname(file) : undefined);
		if (!directory || directory.scheme !== Schemas.file) { return undefined; }
		const model = this.jumpListModel ??= this.instantiationService.createInstance(JumpListModel);
		const project = await model.resolveProject(directory);
		model.load(project);
		return { model, project };
	}

	addToJumpList(): Promise<void> {
		return this.transitions.queue(async () => {
			const resource = this.activeFile();
			if (this.active?.mode !== 'editor' || !resource || this.jumpListVisible || this.browserVisible || this.floatingVisible) { return; }
			const list = await this.loadJumpList();
			if (!list) { return; }
			status(list.model.add(resource)
				? localize('jumpListAdded', "Added {0} to the jump list.", resource.fsPath)
				: localize('jumpListAlreadyAdded', "{0} is already in the jump list.", resource.fsPath));
		});
	}

	toggleFloatingJumpList(): Promise<void> {
		return this.transitions.queue(async () => {
			if (this.active?.mode !== 'editor') { return; }
			if (this.jumpListVisible) { this.hideJumpList(true); return; }
			const list = await this.loadJumpList();
			if (!list) { return; }
			this.hideBrowser();
			this.hideFloating();
			this.jumpListHost ??= this._register(this.instantiationService.createInstance(FloatingJumpList, list.model,
				(focus: boolean) => { void this.hideFloatingJumpList(focus).catch(error => this.logService.error(error)); },
				(resource: URI) => {
					const owner = this.active;
					const generation = this.jumpListGeneration;
					return this.transitions.queue(async () => {
						if (!this.jumpListVisible || generation !== this.jumpListGeneration || this.active !== owner || owner?.mode !== 'editor') { return false; }
						if (!await this.fileService.exists(resource)) { throw new Error(localize('jumpFileMissing', "The file no longer exists: {0}", resource.fsPath)); }
						const editor = await this.editorService.openEditor({ resource, options: { pinned: true } });
						if (!editor) { throw new Error(localize('jumpFileOpenFailed', "The file could not be opened.")); }
						this.hideJumpList(true);
						return true;
					});
				}));
			this.jumpListVisible = true;
			this.jumpListVisibleContext.set(true);
			try { this.jumpListHost.show(list.project, this.activeFile()); }
			catch (error) { this.hideJumpList(true); throw error; }
		});
	}

	hideFloatingJumpList(focusEditor = true): Promise<void> {
		return this.transitions.queue(async () => this.hideJumpList(focusEditor));
	}

	private hideJumpList(focusEditor = false): void {
		if (!this.jumpListVisible) { return; }
		this.jumpListGeneration++;
		this.jumpListHost?.hideList();
		this.jumpListVisible = false;
		this.jumpListVisibleContext.set(false);
		if (focusEditor) { this.editorGroupsService.activeGroup.focus(); }
	}

	toggleFloatingFileBrowser(): Promise<void> {
		return this.transitions.queue(async () => {
			const session = this.active;
			if (!session || session.mode !== 'editor') { return; }
			if (this.browserVisible) { this.hideBrowser(true); return; }
			const root = session.cwd ? URI.parse(session.cwd) : this.workspaceContextService.getWorkspace().folders[0]?.uri ?? (session.terminal?.initialCwd ? URI.file(session.terminal.initialCwd) : undefined);
			if (!root) { throw new Error(localize('browserDirectoryUnavailable', "The session directory is not available yet. Try again after the shell starts.")); }
			this.hideJumpList();
			this.hideFloating();
			this.browserHost ??= this._register(this.instantiationService.createInstance(FloatingFileBrowser,
				(focus: boolean) => { void this.hideFloatingFileBrowser(focus).catch(error => this.logService.error(error)); },
				(resource: URI) => {
					const owner = this.active;
					const generation = this.browserGeneration;
					return this.transitions.queue(async () => {
						if (!this.browserVisible || this.browserGeneration !== generation || this.active !== owner || owner?.mode !== 'editor') { return false; }
						const editor = await this.editorService.openEditor({ resource, options: { pinned: true } });
						if (!editor) { throw new Error(localize('fileOpenCancelled', "The file could not be opened.")); }
						this.hideBrowser(true);
						return true;
					});
				}));
			this.browserVisible = true;
			this.browserVisibleContext.set(true);
			this.changed.fire();
			try { this.browserHost.show(root, session.id); }
			catch (error) { this.hideBrowser(true); throw error; }
		});
	}

	hideFloatingFileBrowser(focusEditor = true): Promise<void> {
		return this.transitions.queue(async () => this.hideBrowser(focusEditor));
	}

	private hideBrowser(focusEditor = false): void {
		if (!this.browserVisible) { return; }
		this.browserGeneration++;
		this.browserHost?.hideBrowser();
		this.browserVisible = false;
		this.browserVisibleContext.set(false);
		this.changed.fire();
		if (focusEditor) { this.editorGroupsService.activeGroup.focus(); }
	}

	toggleFloatingTerminal(): Promise<void> {
		return this.transitions.queue(async () => {
			const session = this.active;
			if (!session || session.mode !== 'editor') { return; }
			if (this.floatingVisible) { this.hideFloating(true); return; }
			this.hideBrowser();
			this.hideJumpList();
			if (!session.floatingTerminal) {
				const terminal = await this.terminalService.createTerminal(TerminalFirstLaunch.floating({
					location: TerminalLocation.Panel,
					config: { env: this.shellEnvironment() },
					cwd: session.floatingCwd || (session.cwd ? URI.parse(session.cwd).fsPath : session.terminal?.initialCwd),
				}));
				session.floatingTerminal = terminal;
				session.floatingNonce = terminal.shellIntegrationNonce;
				session.floatingCwd = terminal.initialCwd;
			}
			this.floatingHost ??= this._register(this.instantiationService.createInstance(FloatingTerminal,
				(focusEditor: boolean) => { void this.hideFloatingTerminal(focusEditor).catch(error => this.logService.error(error)); },
				(focused: boolean) => {
					this.floatingFocusedContext.set(focused);
				}));
			try {
				this.floatingHost.show(session.floatingTerminal);
				this.floatingVisible = true;
				terminalFirstPolicy.floatingVisible = true;
				this.floatingVisibleContext.set(true);
				this.terminalService.setActiveInstance(session.floatingTerminal);
				this.saveSessions();
				this.changed.fire();
				await session.floatingTerminal.focusWhenReady();
			} catch (error) {
				this.hideFloating(true);
				throw error;
			}
		});
	}

	hideFloatingTerminal(focusEditor = true): Promise<void> {
		return this.transitions.queue(async () => this.hideFloating(focusEditor));
	}

	private hideFloating(focusEditor = false): void {
		const wasVisible = this.floatingVisible;
		this.floatingHost?.hideTerminal();
		this.floatingVisible = false;
		this.floatingVisibleContext.set(false);
		this.floatingFocusedContext.set(false);
		terminalFirstPolicy.floatingVisible = false;
		if (wasVisible) {
			if (this.active?.terminal) { this.terminalService.setActiveInstance(this.active.terminal); }
			if (focusEditor) { this.editorGroupsService.activeGroup.focus(); }
			this.changed.fire();
		}
	}

	toggle(): Promise<void> { return this.transitions.queue(() => this.present(this.active!, this.active?.mode === 'shell' ? 'editor' : 'shell')); }
	showShell(): Promise<void> { return this.transitions.queue(() => this.present(this.active!, 'shell')); }
	showEditor(focus = true): Promise<void> { return this.transitions.queue(() => this.present(this.active!, 'editor', focus)); }

	private async present(session: Session, mode: 'shell' | 'editor', focus = true, cwd?: string): Promise<void> {
		if (!session) { return; }
		this.changingSession = true;
		this.hideBrowser();
		this.hideFloating();
		this.hideJumpList();
		try {
			const terminal = await this.ensureTerminal(session);
			if (mode === 'editor') { await this.updateDirectory(session, cwd); }
			this.editorGroupsService.mainPart.sessions?.activate(session.id);
			this.active = session;
			session.mode = mode;
			terminalFirstPolicy.mode = mode;
			this.shellContext.set(mode === 'shell');
			if (mode === 'editor' && !this.trustRequested && !this.trust.isWorkspaceTrusted()) {
				this.trustRequested = true;
				void this.trustRequests.requestWorkspaceTrust().catch(error => this.logService.error(error));
			}
			this.floatingEnabledContext.set(mode === 'editor');
			this.terminalService.setActiveInstance(terminal);
			this.layoutService.mainContainer.classList.toggle('terminal-first-shell', mode === 'shell');
			this.layoutService.mainContainer.classList.remove('terminal-first-minimal');
			this.layoutService.mainContainer.classList.add('terminal-first-tiles');
			this.layoutService.setPartHidden(true, Parts.ACTIVITYBAR_PART);
			for (const part of [Parts.STATUSBAR_PART]) {
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
				if (focus) { this.editorGroupsService.activeGroup.focus(); }
			}
			this.layoutService.layout();
			this.saveSessions();
			this.changed.fire();
		} finally { this.changingSession = false; }
	}

	private async ensureManagedWorkspace(cwd?: URI): Promise<void> {
		const workspace = this.workspaceContextService.getWorkspace();
		if (workspace.configuration && basename(workspace.configuration) === 'vs-nosh.code-workspace' && isEqualOrParent(workspace.configuration, this.environmentService.workspaceStorageHome)) {
			this.managedWorkspace = workspace.configuration;
			return;
		}
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
			if ((session.terminal?.hasChildProcesses || session.floatingTerminal?.hasChildProcesses) && (confirm === 'always' || confirm === 'panel')) {
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
				if (session === this.active) { this.hideBrowser(); this.hideFloating(); this.hideJumpList(); }
				this.browserHost?.forgetSession(session.id);
				session.floatingTerminal?.dispose(TerminalExitReason.User);
				session.terminal?.dispose(TerminalExitReason.User);
				if (!this.sessionList.length) { this.addSession(await this.createTerminal()); }
				const next = this.active === session ? this.sessionList[0] : this.active!;
				await this.present(next, next.mode);
				await this.editorGroupsService.mainPart.sessions?.close(id);
			} finally { this.changingSession = false; }
		});
	}

	openTerminalTile(groupId: number): Promise<boolean> {
		return this.transitions.queue(async () => {
			const session = this.active;
			const group = this.editorGroupsService.mainPart.groups.find(group => group.id === groupId);
			if (this.changingSession || !session || session.mode !== 'editor' || !group) { return false; }
			const terminal = await this.terminalService.createTerminal(TerminalFirstLaunch.tile({
				location: TerminalLocation.Editor,
				cwd: session.cwd ? URI.parse(session.cwd).fsPath : session.terminal?.initialCwd,
				config: { env: this.shellEnvironment(), forcePersist: true },
			}));
			try {
				await this.terminalEditorService.openEditor(terminal, { viewColumn: groupId });
				(session.tileNonces ??= []).push(terminal.shellIntegrationNonce);
				this.saveSessions();
				return true;
			} catch (error) { terminal.dispose(TerminalExitReason.User); throw error; }
		});
	}

	async openFiles(fileURIs: string[], terminalSession: string, wait: boolean, cwd?: string): Promise<void> {
		if ((!fileURIs.length && !cwd) || fileURIs.some(value => URI.parse(value).scheme !== Schemas.file) || (cwd && URI.parse(cwd).scheme !== Schemas.file)) {
			throw new Error(localize('invalidFiles', "Expected local file paths or a local working directory."));
		}
		const resources = fileURIs.map(value => URI.parse(value));
		let closed: Promise<void> | undefined;
		await this.transitions.queue(async () => {
			const session = this.sessionList.find(session => session.terminal?.shellIntegrationNonce === terminalSession || session.floatingTerminal?.shellIntegrationNonce === terminalSession || session.tileNonces?.includes(terminalSession));
			if (!session) { throw new Error(localize('missingSession', "This shell session is no longer attached to the window. Open a new shell session and retry.")); }
			await this.present(session, 'editor', resources.length === 0, cwd);
			if (!resources.length) { return; }
			const editors = await Promise.all(resources.map(async resource => ({ resource, forceUntitled: !await this.fileService.exists(resource), options: { pinned: true } })));
			await this.editorService.openEditors(editors);
			if (wait) { closed = this.instantiationService.invokeFunction(accessor => whenEditorClosed(accessor, resources, groupId => !this.editorGroupsService.mainPart.sessions || this.editorGroupsService.mainPart.sessions.owns(session.id, groupId))); }
		});
		await closed;
	}
}
