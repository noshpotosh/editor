/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { status } from '../../../../base/browser/ui/aria/aria.js';
import { EditorResourceAccessor, EditorsOrder, SideBySideEditor } from '../../../common/editor.js';
import { FloatingJumpList } from './floatingJumpList.js';
import { JumpListModel } from './jumpListModel.js';
import { raceTimeout, Sequencer } from '../../../../base/common/async.js';
import { createTextBufferFactory } from '../../../../editor/common/model/textModel.js';
import { VSBuffer } from '../../../../base/common/buffer.js';
import { Emitter } from '../../../../base/common/event.js';
import { Disposable, DisposableStore } from '../../../../base/common/lifecycle.js';
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
import { TerminalFirstJumpListVisibleContext, TerminalFirstBrowserVisibleContext, TerminalFirstFloatingEnabledContext, TerminalFirstFloatingVisibleContext, TerminalFirstFloatingFocusedContext, TerminalFirstEnabledContext, TerminalFirstShellContext, terminalFirstPolicy, onDidBlockTerminalFirstCommand } from '../../../services/terminalFirst/common/terminalFirstPolicy.js';
import { ITextFileService } from '../../../services/textfile/common/textfiles.js';
import { IWorkspaceEditingService } from '../../../services/workspaces/common/workspaceEditing.js';
import { ITerminalEditorService, ITerminalGroupService, ITerminalInstance, ITerminalService, TerminalConnectionState } from '../../terminal/browser/terminal.js';
import { FloatingFileBrowser } from './floatingFileBrowser.js';
import { FloatingTerminal } from './floatingTerminal.js';
import { TerminalFirstLaunch } from './terminalPolicy.js';
import { EditorPartSessions, IEditorPartSessions } from './editorPartSessions.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { ITextEditorSelection } from '../../../../platform/editor/common/editor.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { IKeybindingService } from '../../../../platform/keybinding/common/keybinding.js';
import { DEFAULT_SPACE_ID, defaultSpaceName, nextSpaceName, parseSpaceLayoutKey, spaceLayoutKey } from '../common/spaces.js';
import { defaultSpacePresets, describeSpacePreset, ISpacePreset, SPACE_PRESETS_SETTING, validateSpacePresets } from '../common/spacePresets.js';
import { IViewDescriptorService } from '../../../common/views.js';
import { IPathService } from '../../../services/path/common/pathService.js';
import { untildify } from '../../../../base/common/labels.js';
import { isAbsolute, join } from '../../../../base/common/path.js';
import { viewContainerDisplayName } from './tileCatalog.js';
import { TerminalFirstStartupTimings } from './startupTimings.js';
import { terminalFirstStartup } from '../../../services/terminalFirst/common/terminalFirstStartup.js';

export { ITerminalFirstService } from '../../../services/terminalFirst/common/terminalFirst.js';

interface Space {
	id: string;
	name: string;
}

interface Session {
	id: string;
	nonce: string;
	title: string;
	/** A user-chosen title that outlives the terminal's own title. */
	customTitle?: string;
	mode: 'shell' | 'editor';
	cwd?: string;
	terminal?: ITerminalInstance;
	floatingTerminal?: ITerminalInstance;
	floatingNonce?: string;
	floatingCwd?: string;
	tileNonces?: string[];
	/** Tile layouts over the session directory, in tab order; never empty. */
	spaces: Space[];
	activeSpace: string;
}

type StoredSession = Omit<Session, 'terminal' | 'floatingTerminal' | 'spaces' | 'activeSpace'> & Partial<Pick<Session, 'spaces' | 'activeSpace'>>;

interface StoredSessions {
	active?: string;
	managedWorkspace?: string;
	sessions: StoredSession[];
}

function defaultSpaces(): Space[] {
	return [{ id: DEFAULT_SPACE_ID, name: defaultSpaceName(1) }];
}

/** Owns terminal sessions and serializes every change of the visible surface. */
export class TerminalFirstService extends Disposable implements ITerminalFirstService {
	declare readonly _serviceBrand: undefined;
	private static readonly STORAGE_KEY = 'terminalFirst.sessions';
	/** How long the first shell waits for persisted terminals to reconnect before starting anyway. */
	private static readonly RECONNECT_BUDGET = 1500;
	private readonly transitions = new Sequencer();
	private readonly startupTimings: TerminalFirstStartupTimings;
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
		const dirtyGroups = new Set(this.editorService.getEditors(EditorsOrder.SEQUENTIAL, { includeInactive: true }).filter(({ editor }) => editor.isDirty()).map(({ groupId }) => groupId));
		return this.sessionList.map(session => {
			const spaces = session.spaces.map(space => ({
				id: space.id, name: space.name, active: space.id === session.activeSpace,
				dirty: [...dirtyGroups].some(groupId => this.editorSessions?.owns(spaceLayoutKey(session.id, space.id), groupId)),
			}));
			return { id: session.id, title: session.customTitle || session.terminal?.title || session.title, mode: session.mode, dirty: spaces.some(space => space.dirty), active: session === this.active, spaces };
		});
	}

	/** The retained-layout keys of a session's spaces. */
	private layoutKeys(session: Session): string[] {
		return session.spaces.map(space => spaceLayoutKey(session.id, space.id));
	}

	private activeLayoutKey(session: Session): string {
		return spaceLayoutKey(session.id, session.activeSpace);
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
		@INotificationService private readonly notificationService: INotificationService,
		@IKeybindingService private readonly keybindingService: IKeybindingService,
		@IViewDescriptorService private readonly viewDescriptors: IViewDescriptorService,
		@IPathService private readonly pathService: IPathService,
	) {
		super();
		this.startupTimings = this._register(instantiationService.createInstance(TerminalFirstStartupTimings));
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
		this._register(onDidBlockTerminalFirstCommand(id => this.reportBlockedCommand(id)));
		this.browserVisibleContext = TerminalFirstBrowserVisibleContext.bindTo(contextKeyService);
		this.shellContext = TerminalFirstShellContext.bindTo(contextKeyService);
		this.floatingEnabledContext = TerminalFirstFloatingEnabledContext.bindTo(contextKeyService);
		this.floatingVisibleContext = TerminalFirstFloatingVisibleContext.bindTo(contextKeyService);
		this.floatingFocusedContext = TerminalFirstFloatingFocusedContext.bindTo(contextKeyService);
		this._register(storageService.onWillSaveState(() => this.saveSessions()));
		this._register(terminalService.onAnyInstanceTitleChange(() => this.changed.fire()));
		this._register(editorService.onDidEditorsChange(() => this.changed.fire()));
		this._register(terminalService.onDidCreateInstance(terminal => this.adoptReconnected(terminal)));

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
		terminalFirstStartup.begin({ deferExtensionHost: this.configurationService.getValue<boolean>('terminalFirst.startup.deferExtensionHost') !== false });
		return this.transitions.queue(async () => {
			try {
				await this.initializeSessions();
			} finally {
				// Reveal only the settled layout, but keep startup failures recoverable.
				this.layoutService.mainContainer.classList.remove('terminal-first-starting');
				terminalFirstStartup.presented();
			}
		});
	}

	private async initializeSessions(): Promise<void> {
		mark('code/terminalFirst/start');
		const stored = this.storageService.getObject<StoredSessions>(TerminalFirstService.STORAGE_KEY, StorageScope.WORKSPACE);
		this.managedWorkspace = stored?.managedWorkspace ? URI.parse(stored.managedWorkspace) : undefined;
		// Stored sessions show on the title bar at once; their shells attach as they reconnect.
		for (const session of stored?.sessions ?? []) {
			// Sessions saved before spaces existed hold one space whose layout key is the session id.
			const spaces = session.spaces?.length ? session.spaces : defaultSpaces();
			this.sessionList.push({ ...session, spaces, activeSpace: spaces.some(space => space.id === session.activeSpace) ? session.activeSpace! : spaces[0].id });
		}
		this.changed.fire();
		// The editor part becomes ready while the workbench renders; by the time this continues, the
		// grid exists and the parts have restored their visibility, so layout calls below stick.
		await this.editorGroupsService.whenReady;
		mark('code/terminalFirst/restored');
		// Enter the stable workspace before starting shells or accepting CLI requests.
		// Entering a workspace restarts the extension host that owns the CLI socket.
		await this.ensureManagedWorkspace(this.workspaceContextService.getWorkspace().folders[0]?.uri);
		mark('code/terminalFirst/workspace');
		await this.whenTerminalsReconnected();
		mark('code/terminalFirst/connected');
		for (const terminal of this.terminalService.instances) { this.adoptReconnected(terminal); }
		for (const terminal of this.terminalGroupService.instances) {
			if (!this.sessionList.some(session => session.terminal === terminal)) { this.addSession(terminal); }
		}
		if (!this.sessionList.length) { this.addSession(await this.createTerminal()); }
		this.active = this.sessionList.find(session => session.id === stored?.active) ?? this.sessionList.find(session => session.terminal === this.terminalGroupService.activeInstance) ?? this.sessionList[0];
		this.editorSessions?.activate(this.activeLayoutKey(this.active));
		this.initialized = true;
		const explicitFiles = this.environmentService.filesToOpenOrCreate?.length || this.environmentService.filesToDiff?.length || this.environmentService.filesToMerge?.length;
		this.layoutService.setPartHidden(true, Parts.SIDEBAR_PART);
		if (!explicitFiles) {
			// The panel exists before the shell is created, so the new instance attaches to its container at once.
			await this.terminalGroupService.showPanel(false);
		}
		this.startupTimings.track(await this.ensureTerminal(this.active));
		mark('code/terminalFirst/created');
		await this.present(this.active, explicitFiles ? 'editor' : 'shell');
		mark('code/terminalFirst/presented');
		this.startupTimings.publish();
		this.recoverRetainedLayouts();
		void this.initializeCLI();
	}

	/** Resolves when every persisted terminal has an instance again (replay may still be running), or when the budget runs out. */
	private async whenTerminalsReconnected(): Promise<void> {
		if (this.terminalService.connectionState === TerminalConnectionState.Connected) { return; }
		const listeners = new DisposableStore();
		const connected = new Promise<boolean>(resolve => listeners.add(this.terminalService.onDidChangeConnectionState(() => {
			if (this.terminalService.connectionState === TerminalConnectionState.Connected) { resolve(true); }
		})));
		try {
			if (!await raceTimeout(connected, TerminalFirstService.RECONNECT_BUDGET)) {
				this.logService.trace('[terminalFirst] Starting the shell before the persisted terminals reconnected.');
			}
		} finally { listeners.dispose(); }
	}

	/** Binds a reconnected terminal to the stored session that owns its nonce; after startup, unclaimed reconnected shells become sessions. */
	private adoptReconnected(terminal: ITerminalInstance): void {
		const nonce = terminal.shellIntegrationNonce;
		if (TerminalFirstLaunch.isDetached(terminal)) {
			const owner = this.sessionList.find(session => session.floatingNonce === nonce && !session.floatingTerminal);
			if (owner) { owner.floatingTerminal = terminal; }
			return;
		}
		const owner = this.sessionList.find(session => session.nonce === nonce && !session.terminal);
		if (owner) {
			owner.terminal = terminal;
			this.changed.fire();
		} else if (this.initialized && terminal.shellLaunchConfig.attachPersistentProcess && terminal.target === TerminalLocation.Panel && !this.sessionList.some(session => session.terminal === terminal || session.tileNonces?.includes(nonce))) {
			this.addSession(terminal);
			this.changed.fire();
		}
	}

	/** Lists every retained space so closing, saving, and shutdown include it; the hidden layouts themselves materialize after presentation. */
	private recoverRetainedLayouts(): void {
		for (const key of this.editorSessions?.ids() ?? []) {
			const { sessionId, spaceId } = parseSpaceLayoutKey(key);
			let session = this.sessionList.find(session => session.id === sessionId);
			if (!session) {
				session = { id: sessionId, nonce: sessionId, title: localize('recovered', "Recovered Session"), mode: 'editor', spaces: defaultSpaces(), activeSpace: DEFAULT_SPACE_ID };
				this.sessionList.push(session);
			}
			if (!session.spaces.some(space => space.id === spaceId)) {
				session.spaces.push({ id: spaceId, name: localize('recoveredSpace', "Recovered Space") });
			}
		}
		this.saveSessions();
		this.changed.fire();
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
		const session: Session = { id: terminal.shellIntegrationNonce, nonce: terminal.shellIntegrationNonce, title: terminal.title || localize('terminal', "Terminal"), mode: 'shell', terminal, spaces: defaultSpaces(), activeSpace: DEFAULT_SPACE_ID };
		this.sessionList.push(session);
		return session;
	}

	/** Per-session editor layouts of the main editor part. */
	private get editorSessions(): IEditorPartSessions | undefined {
		return EditorPartSessions.for(this.editorGroupsService.mainPart);
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
			sessions: this.sessionList.map(({ id, nonce, title, customTitle, mode, cwd: savedCwd, terminal, floatingTerminal, floatingNonce, floatingCwd, tileNonces, spaces, activeSpace }) => {
				const cwd = terminal?.capabilities.get(TerminalCapability.CwdDetection)?.getCwd();
				return {
					id, nonce, mode, title: terminal?.title || title, customTitle, spaces, activeSpace,
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

	/** Asks for a new title for the active session; an empty answer restores the terminal's own title. */
	renameSession(): Promise<void> {
		return this.transitions.queue(async () => {
			const session = this.active;
			if (!session) { return; }
			const value = await this.quickInputService.input({ prompt: localize('renameSessionPrompt', "Session title (leave empty to use the shell title)"), value: session.customTitle ?? '', placeHolder: session.terminal?.title || session.title });
			if (value === undefined) { return; }
			session.customTitle = value.trim() || undefined;
			this.saveSessions();
			this.changed.fire();
		});
	}

	private readonly blockedCommands = new Set<string>();
	private blockedHintShown = false;

	/** Blocked commands are silent at the call site; log each ID once and hint at the editor the first time it happens in the shell. */
	private reportBlockedCommand(id: string): void {
		if (!this.blockedCommands.has(id)) {
			this.blockedCommands.add(id);
			this.logService.info(`[terminalFirst] Blocked command '${id}' while the ${terminalFirstPolicy.mode} surface is shown.`);
		}
		if (!this.blockedHintShown && terminalFirstPolicy.shell && id.startsWith('workbench.')) {
			this.blockedHintShown = true;
			this.notificationService.info(localize('blockedCommandHint', "That command is available in the editor. Press Ctrl+Space e to open it."));
		}
	}

	/** Opens the jump list entry at a 1-based slot without showing the list. */
	jumpToSlot(slot: number): Promise<void> {
		return this.transitions.queue(async () => {
			if (this.active?.mode !== 'editor' || this.jumpListVisible) { return; }
			const list = await this.loadJumpList();
			const resource = list?.model.entries[slot - 1];
			if (!resource) { status(localize('emptySlot', "Jump list slot {0} is empty.", slot)); return; }
			if (!await this.fileService.exists(resource)) { throw new Error(localize('jumpFileMissing', "The file no longer exists: {0}", resource.fsPath)); }
			await this.editorService.openEditor({ resource, options: { pinned: true } });
		});
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
				this.floatingHost.show(session.floatingTerminal, session.customTitle || session.terminal?.title || session.title);
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
			this.editorSessions?.activate(this.activeLayoutKey(session));
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
				if (!await this.closeLayouts(this.layoutKeys(session))) { return; }
				this.sessionList.splice(this.sessionList.indexOf(session), 1);
				if (session === this.active) { this.hideBrowser(); this.hideFloating(); this.hideJumpList(); }
				this.browserHost?.forgetSession(session.id);
				session.floatingTerminal?.dispose(TerminalExitReason.User);
				session.terminal?.dispose(TerminalExitReason.User);
				if (!this.sessionList.length) { this.addSession(await this.createTerminal()); }
				const next = this.active === session ? this.sessionList[0] : this.active!;
				await this.present(next, next.mode);
				await this.disposeLayouts(this.layoutKeys(session));
			} finally { this.changingSession = false; }
		});
	}

	/**
	 * First half of closing layouts: every editor of every key is closed after save, discard, or
	 * cancel decisions. Each layout is activated first so the dialogs refer to visible files.
	 * Resolves false, with the active layout restored, when the user cancels.
	 */
	private async closeLayouts(keys: readonly string[]): Promise<boolean> {
		if (!this.editorSessions) { return true; }
		for (const key of keys) {
			this.editorSessions.activate(key);
			if (!await this.editorSessions.close(key)) {
				this.editorSessions.activate(this.activeLayoutKey(this.active!));
				return false;
			}
		}
		return true;
	}

	/** Second half: once a successor layout is shown, the emptied layouts are disposed. */
	private async disposeLayouts(keys: readonly string[]): Promise<void> {
		for (const key of keys) {
			await this.editorSessions?.close(key);
		}
	}

	private get activeEditorSession(): Session | undefined {
		return this.active?.mode === 'editor' ? this.active : undefined;
	}

	/** The configured presets; the setting's default holds the built-in ones, which also stand in when no value is registered. */
	private presets(): ISpacePreset[] {
		const value = this.configurationService.getValue(SPACE_PRESETS_SETTING);
		return Array.isArray(value) ? validateSpacePresets(value) : [...defaultSpacePresets];
	}

	/** Empty (`null`), one of the presets, or `undefined` when the user cancels. */
	private async pickPreset(): Promise<ISpacePreset | null | undefined> {
		const viewName = (id: string): string | undefined => {
			const container = this.viewDescriptors.getViewContainerById(id);
			return container ? viewContainerDisplayName(container, this.viewDescriptors.getViewContainerModel(container)) : this.viewDescriptors.getViewDescriptorById(id)?.name.value;
		};
		const picks = [
			{ label: localize('presetEmpty', "Empty"), description: localize('presetEmptyDescription', "Start from the New Tile picker"), preset: null },
			...this.presets().map(preset => ({ label: preset.name, description: describeSpacePreset(preset, viewName), preset })),
		];
		const selected = await this.quickInputService.pick(picks, { placeHolder: localize('pickPreset', "Start the space from a preset"), matchOnDescription: true });
		return selected?.preset;
	}

	/** `base`, or `base 2`, `base 3`, … when the session already has a space of that name. */
	private uniqueSpaceName(session: Session, base: string): string {
		const names = session.spaces.map(space => space.name);
		for (let n = 1; ; n++) {
			const name = n === 1 ? base : `${base} ${n}`;
			if (!names.includes(name)) { return name; }
		}
	}

	/** Empty spaces open the New Tile picker; presets open their tiles. The tile controller depends on this service, so both go by command. */
	private applyPreset(preset: ISpacePreset | null): Promise<unknown> {
		return preset ? this.commandService.executeCommand('_terminalFirst.tile.applyPreset', preset) : this.commandService.executeCommand('terminalFirst.tile.new');
	}

	async newSpace(): Promise<void> {
		const created = await this.transitions.queue(async (): Promise<{ preset: ISpacePreset | null } | undefined> => {
			const session = this.activeEditorSession;
			if (!session) { return undefined; }
			const preset = await this.pickPreset();
			if (preset === undefined) { return undefined; }
			let name: string;
			if (preset) {
				name = this.uniqueSpaceName(session, preset.name);
			} else {
				const suggested = nextSpaceName(session.spaces.map(space => space.name));
				const value = await this.quickInputService.input({ prompt: localize('newSpacePrompt', "Name of the new space"), value: suggested, ignoreFocusLost: true });
				if (value === undefined) { return undefined; }
				name = value.trim() || suggested;
			}
			session.spaces.push({ id: generateUuid(), name });
			session.activeSpace = session.spaces[session.spaces.length - 1].id;
			await this.present(session, 'editor');
			return { preset };
		});
		if (created && this.activeEditorSession) { await this.applyPreset(created.preset); }
	}

	async newSessionFromPreset(): Promise<void> {
		const created = await this.transitions.queue(async (): Promise<{ preset: ISpacePreset | null } | undefined> => {
			const current = this.active;
			const start = current?.cwd ? URI.parse(current.cwd).fsPath : current?.terminal?.capabilities.get(TerminalCapability.CwdDetection)?.getCwd() || current?.terminal?.initialCwd || this.workspaceContextService.getWorkspace().folders[0]?.uri.fsPath || '';
			const home = (await this.pathService.userHome({ preferLocal: true })).fsPath;
			const resolve = (value: string): URI => {
				const expanded = untildify(value.trim(), home);
				return URI.file(isAbsolute(expanded) ? expanded : join(start, expanded));
			};
			const value = await this.quickInputService.input({
				prompt: localize('sessionDirectoryPrompt', "Directory for the new session"),
				value: start,
				ignoreFocusLost: true,
				validateInput: async value => {
					if (!value.trim()) { return localize('sessionDirectoryEmpty', "Enter a directory."); }
					try {
						return (await this.fileService.stat(resolve(value))).isDirectory ? undefined : localize('sessionDirectoryNotDirectory', "Not a directory.");
					} catch {
						return localize('sessionDirectoryMissing', "The directory does not exist.");
					}
				},
			});
			if (value === undefined) { return undefined; }
			const preset = await this.pickPreset();
			if (preset === undefined) { return undefined; }
			const cwd = resolve(value);
			const session = this.addSession(await this.createTerminal(cwd.fsPath));
			if (preset) { session.spaces[0].name = preset.name; }
			await this.present(session, 'editor', true, cwd.toString());
			return { preset };
		});
		if (created && this.activeEditorSession) { await this.applyPreset(created.preset); }
	}

	selectSpace(id: string): Promise<void> {
		return this.transitions.queue(async () => {
			const session = this.active;
			if (!session || !session.spaces.some(space => space.id === id)) { return; }
			session.activeSpace = id;
			await this.present(session, 'editor');
		});
	}

	selectSpaceAt(index: number): Promise<void> {
		const space = this.active?.spaces[index - 1];
		return space ? this.selectSpace(space.id) : Promise.resolve();
	}

	switchSpace(offset: number): Promise<void> {
		const session = this.active;
		if (!session) { return Promise.resolve(); }
		const index = session.spaces.findIndex(space => space.id === session.activeSpace);
		return this.selectSpace(session.spaces[(index + offset + session.spaces.length) % session.spaces.length].id);
	}

	renameSpace(): Promise<void> {
		return this.transitions.queue(async () => {
			const session = this.activeEditorSession;
			const space = session?.spaces.find(space => space.id === session.activeSpace);
			if (!session || !space) { return; }
			const value = await this.quickInputService.input({ prompt: localize('renameSpacePrompt', "Space name"), value: space.name, ignoreFocusLost: true });
			if (value === undefined || !value.trim()) { return; }
			space.name = value.trim();
			this.saveSessions();
			this.changed.fire();
		});
	}

	closeSpace(id?: string): Promise<void> {
		return this.transitions.queue(async () => {
			const session = this.activeEditorSession;
			const space = session?.spaces.find(space => space.id === (id ?? session.activeSpace));
			if (!session || !space) { return; }
			const key = spaceLayoutKey(session.id, space.id);
			this.changingSession = true;
			try {
				if (!await this.closeLayouts([key])) { return; }
				const index = session.spaces.indexOf(space);
				session.spaces.splice(index, 1);
				// Like closing the final session, closing the final space leaves a fresh empty one.
				if (!session.spaces.length) { session.spaces.push({ id: generateUuid(), name: defaultSpaceName(1) }); }
				if (session.activeSpace === space.id) { session.activeSpace = session.spaces[Math.min(index, session.spaces.length - 1)].id; }
				await this.present(session, 'editor');
				await this.disposeLayouts([key]);
			} finally { this.changingSession = false; }
		});
	}

	async pickSpace(): Promise<void> {
		const session = this.activeEditorSession;
		if (!session) { return; }
		const selected = await this.quickInputService.pick(session.spaces.map((space, index) => ({
			id: space.id,
			label: space.name,
			description: space.id === session.activeSpace ? localize('activeSpace', "Active") : undefined,
			keybinding: index < 9 ? this.keybindingService.lookupKeybinding(`terminalFirst.space.select${index + 1}`) : undefined,
		})), { placeHolder: localize('pickSpace', "Switch Space") });
		if (selected) { await this.selectSpace(selected.id); }
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
		// `e --goto file:line:col` arrives as a `#L<line>,<col>` fragment on the file URI.
		const targets = fileURIs.map(value => parseGotoFragment(URI.parse(value)));
		const resources = targets.map(target => target.resource);
		let closed: Promise<void> | undefined;
		await this.transitions.queue(async () => {
			const session = this.sessionList.find(session => session.terminal?.shellIntegrationNonce === terminalSession || session.floatingTerminal?.shellIntegrationNonce === terminalSession || session.tileNonces?.includes(terminalSession));
			if (!session) { throw new Error(localize('missingSession', "This shell session is no longer attached to the window. Open a new shell session and retry.")); }
			await this.present(session, 'editor', resources.length === 0, cwd);
			if (!resources.length) { return; }
			const editors = await Promise.all(targets.map(async ({ resource, selection }) => ({ resource, forceUntitled: !await this.fileService.exists(resource), options: { pinned: true, selection } })));
			await this.editorService.openEditors(editors);
			if (wait) { closed = this.instantiationService.invokeFunction(accessor => whenEditorClosed(accessor, resources, groupId => !this.editorSessions || this.layoutKeys(session).some(key => this.editorSessions!.owns(key, groupId)))); }
		});
		await closed;
	}
}

/** Splits a `#L<line>[,<column>]` fragment off a CLI file URI into an editor selection. */
function parseGotoFragment(uri: URI): { resource: URI; selection?: ITextEditorSelection } {
	const match = /^L(?<line>\d+)(?:,(?<column>\d+))?$/.exec(uri.fragment);
	if (!match?.groups) {
		return { resource: uri };
	}
	return { resource: uri.with({ fragment: '' }), selection: { startLineNumber: Number(match.groups.line), startColumn: match.groups.column ? Number(match.groups.column) : 1 } };
}
