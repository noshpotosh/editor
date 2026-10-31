/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { promises as fs } from 'fs';
import { Disposable } from '../../../base/common/lifecycle.js';
import { parse, ParseError } from '../../../base/common/json.js';
import { FileAccess, Schemas } from '../../../base/common/network.js';
import { basename, parse as parsePath } from '../../../base/common/path.js';
import { IProcessEnvironment, OperatingSystem } from '../../../base/common/platform.js';
import { mark } from '../../../base/common/performance.js';
import { joinPath } from '../../../base/common/resources.js';
import { hasKey } from '../../../base/common/types.js';
import { URI } from '../../../base/common/uri.js';
import { generateUuid } from '../../../base/common/uuid.js';
import { getSystemShell } from '../../../base/node/shell.js';
import { IConfigurationService } from '../../configuration/common/configuration.js';
import { ILifecycleMainService } from '../../lifecycle/electron-main/lifecycleMainService.js';
import { ILogService } from '../../log/common/log.js';
import { IProductService } from '../../product/common/productService.js';
import { IPtyService, IShellLaunchConfig, ITerminalEnvironment, ITerminalProcessOptions, ITerminalProfile, TerminalSettingId } from '../../terminal/common/terminal.js';
import { createTerminalEnvironment } from '../../terminal/common/terminalEnvironment.js';
import { detectAvailableProfiles } from '../../terminal/node/terminalProfiles.js';
import { INativeWindowConfiguration } from '../../window/common/window.js';
import { LoadReason } from '../../window/electron-main/window.js';
import { isSingleFolderWorkspaceIdentifier, isWorkspaceIdentifier } from '../../workspace/common/workspace.js';
import { IWorkspacesManagementMainService } from '../../workspaces/electron-main/workspacesManagementMainService.js';
import { terminalFirstShellEnvironment, TERMINAL_FIRST_PRESPAWN_OWNER } from '../common/terminalFirstEnvironment.js';
import { terminalFirstPrespawn, TerminalFirstPrespawnRequest } from '../common/terminalFirstPrespawn.js';

interface IPendingShell {
	readonly workspaceId: string;
	readonly request: TerminalFirstPrespawnRequest;
	processId?: number;
}

/** Settings whose renderer defaults are safe to reproduce before workbench configuration loads. */
export interface ITerminalFirstPrespawnSettings {
	readonly env?: ITerminalEnvironment;
	readonly defaultProfile?: string;
	readonly profiles?: Record<string, unknown>;
	readonly detectLocale: 'auto' | 'off' | 'on';
	readonly unicodeVersion: '6' | '11';
	readonly shellIntegration: boolean;
	readonly environmentReporting: boolean;
	readonly suggest: boolean;
}

/** Speculation is optional: settings requiring renderer services use the normal launch path. */
export function terminalFirstPrespawnSettings(settings: Record<string, unknown>): ITerminalFirstPrespawnSettings | undefined {
	const cwd = settings[TerminalSettingId.Cwd];
	if (hasNestedTerminalSettings(settings) ||
		(typeof cwd === 'string' && cwd.length > 0) ||
		settings[TerminalSettingId.InheritEnv] === true ||
		settings[TerminalSettingId.EnablePersistentSessions] === false ||
		settings[TerminalSettingId.AllowInUntrustedWorkspace] === false ||
		settings[TerminalSettingId.EnvironmentChangesRelaunch] === true ||
		settings['editor.accessibilitySupport'] === 'on' || settings['editor.accessibilitySupport'] === 'off' ||
		(isSettingsObject(settings.editor) && hasKey(settings.editor, { accessibilitySupport: true })) ||
		(settings[TerminalSettingId.PersistentSessionReviveProcess] !== undefined && settings[TerminalSettingId.PersistentSessionReviveProcess] !== 'never')) {
		return undefined;
	}
	const env = settings['terminal.integrated.env.osx'];
	const profiles = settings[TerminalSettingId.ProfilesMacOs];
	const defaultProfile = settings[TerminalSettingId.DefaultProfileMacOs];
	if ((env !== undefined && (!isSettingsObject(env) || Object.values(env).some(value => value !== null && typeof value !== 'string'))) ||
		(profiles !== undefined && !isSettingsObject(profiles)) ||
		(defaultProfile !== undefined && defaultProfile !== null && typeof defaultProfile !== 'string') ||
		JSON.stringify([env, profiles]).includes('${')) {
		return undefined;
	}
	const detectLocale = settings[TerminalSettingId.DetectLocale];
	return {
		env: env as ITerminalEnvironment | undefined,
		profiles: profiles as Record<string, unknown> | undefined,
		defaultProfile: typeof defaultProfile === 'string' ? defaultProfile : undefined,
		detectLocale: detectLocale === 'off' || detectLocale === 'on' ? detectLocale : 'auto',
		unicodeVersion: settings[TerminalSettingId.UnicodeVersion] === '6' ? '6' : '11',
		shellIntegration: settings[TerminalSettingId.ShellIntegrationEnabled] !== false,
		environmentReporting: settings[TerminalSettingId.ShellIntegrationEnvironmentReporting] === true,
		suggest: settings['terminal.integrated.suggest.enabled'] !== false,
	};
}

function isSettingsObject(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Let the configuration service interpret nested forms rather than treating them as absent. */
function hasNestedTerminalSettings(settings: Record<string, unknown>): boolean {
	return ['terminal', 'terminal.integrated', 'terminal.integrated.profiles', 'terminal.integrated.defaultProfile', 'terminal.integrated.env', 'terminal.integrated.shellIntegration', 'terminal.integrated.suggest']
		.some(key => isSettingsObject(settings[key]));
}

/** The ordinary session path currently handles profile env/name differently when pre-resolving the executable. */
export function canPrespawnTerminalFirstProfile(profile: ITerminalProfile): boolean {
	return !profile.overrideName && (!profile.env || Object.keys(profile.env).length === 0);
}

/** Multiple roots require renderer history to choose the shell's last active workspace folder. */
export function canPrespawnTerminalFirstWorkspace(folders: readonly URI[]): boolean {
	return folders.length === 1 && folders[0].scheme === Schemas.file;
}

/** Workspace terminal settings must be resolved by the renderer, including trust restrictions. */
export function hasTerminalFirstPrespawnOverrides(settings: Record<string, unknown>): boolean {
	return Object.keys(settings).some(key => key === 'terminal' || key === 'terminal.integrated' || key.startsWith('terminal.integrated.') || key === 'editor.accessibilitySupport') ||
		(isSettingsObject(settings.editor) && hasKey(settings.editor, { accessibilitySupport: true }));
}

/** Starts only local initial windows; reload and workspace switches retain their existing shell path. */
export class TerminalFirstShellPrespawn extends Disposable {
	private readonly pending = new Map<number, IPendingShell>();

	constructor(
		private readonly ptyService: IPtyService,
		private readonly lifecycleService: ILifecycleMainService,
		private readonly workspacesService: IWorkspacesManagementMainService,
		private readonly configurationService: IConfigurationService,
		private readonly productService: IProductService,
		private readonly logService: ILogService,
	) {
		super();
		this._register(this.lifecycleService.onWillLoadWindow(event => {
			this.cancel(event.window.id);
			const config = event.window.config;
			// LOAD exposes the previous config until navigation finishes; do not guess its profile or env.
			if (event.reason !== LoadReason.INITIAL || !config || config.remoteAuthority || config.isSessionsWindow || config.extensionDevelopmentPath || config.extensionTestsPath || !event.workspace || config.workspace?.id !== event.workspace.id) {
				return;
			}
			const request = terminalFirstPrespawn.begin(event.workspace.id);
			if (request) {
				const pending: IPendingShell = { workspaceId: event.workspace.id, request };
				this.pending.set(event.window.id, pending);
				void this.prepare(event.window.id, config, pending);
			}
		}));
		this._register(this.lifecycleService.onBeforeCloseWindow(window => this.cancel(window.id)));
	}

	private cancel(windowId: number): void {
		const pending = this.pending.get(windowId);
		if (pending) {
			this.pending.delete(windowId);
			pending.request.cancel();
			terminalFirstPrespawn.release(pending.workspaceId, pending.request);
			if (!pending.request.isClaimed && pending.processId !== undefined) {
				void this.ptyService.shutdown(pending.processId, true).catch(error => this.logService.trace('[terminalFirst] Discarding speculative shell', error));
			}
		}
	}

	private async readSettings(resource: URI): Promise<Record<string, unknown>> {
		try {
			const errors: ParseError[] = [];
			const settings: unknown = parse(await fs.readFile(resource.fsPath, 'utf8'), errors);
			if (errors.length || !isSettingsObject(settings)) {
				throw new Error('Invalid settings');
			}
			return settings;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
				return {};
			}
			throw error;
		}
	}

	private async prepare(windowId: number, config: INativeWindowConfiguration, pending: IPendingShell): Promise<void> {
		let published = false;
		try {
			const workspace = config.workspace;
			let folders: URI[];
			if (isSingleFolderWorkspaceIdentifier(workspace)) {
				folders = [workspace.uri];
			} else if (isWorkspaceIdentifier(workspace) && workspace.configPath.scheme === Schemas.file) {
				const [resolved, contents] = await Promise.all([
					this.workspacesService.resolveLocalWorkspace(workspace.configPath),
					this.readSettings(workspace.configPath),
				]);
				if (isSettingsObject(contents.settings) && hasTerminalFirstPrespawnOverrides(contents.settings)) {
					return;
				}
				folders = resolved?.folders.map(folder => folder.uri) ?? [];
			} else {
				return;
			}
			if (!canPrespawnTerminalFirstWorkspace(folders)) {
				return;
			}
			const [rawSettings, ...folderSettings] = await Promise.all([
				this.readSettings(URI.revive(config.profiles.profile.settingsResource)),
				...folders.map(folder => this.readSettings(joinPath(folder, '.vscode/settings.json'))),
			]);
			const settings = terminalFirstPrespawnSettings(rawSettings);
			if (!settings || folderSettings.some(hasTerminalFirstPrespawnOverrides) || pending.request.isCancelled) {
				return;
			}
			// Match the ordinary inheritEnv=false path, including later windows opened from another CLI.
			const baseEnvironment = await this.ptyService.getEnvironment();
			if (pending.request.isCancelled) {
				return;
			}
			// Defaults come from the registry; user settings come from this window's selected profile.
			const defaults = this.configurationService.inspect<Record<string, unknown>>(TerminalSettingId.ProfilesMacOs).defaultValue;
			const profiles = await detectAvailableProfiles({ ...defaults, ...settings.profiles }, settings.defaultProfile ?? null, false, this.configurationService, baseEnvironment, undefined, this.logService);
			let profile = settings.defaultProfile ? profiles.find(profile => profile.profileName === settings.defaultProfile) : undefined;
			if (settings.defaultProfile && !profile) {
				return;
			}
			if (!profile) {
				const path = await getSystemShell(OperatingSystem.Macintosh, baseEnvironment);
				profile = profiles.find(profile => parsePath(profile.path).name === parsePath(path).name) ?? {
					profileName: basename(path), path, args: /^(zsh|bash)$/.test(basename(path)) ? ['--login'] : [], isDefault: true,
				};
			}
			if (pending.request.isCancelled || !canPrespawnTerminalFirstProfile(profile)) {
				return;
			}
			const nonce = generateUuid();
			const launch = await terminalFirstPrespawnLaunch(profile, settings, baseEnvironment, terminalFirstShellEnvironment(
				joinPath(FileAccess.asFileUri(''), '../extensions/terminal-first/bin').fsPath,
				URI.revive(config.profiles.profile.globalStorageHome), windowId, config.execPath, baseEnvironment.PATH ?? '',
			), nonce, folders[0].fsPath, this.productService.version, !!config.accessibilitySupport);
			published = await startTerminalFirstPrespawn(this.ptyService, pending.request, pending.workspaceId, basename(folders[0].fsPath), launch, id => pending.processId = id);
		} catch (error) {
			this.logService.trace('[terminalFirst] Speculative shell fell back to renderer launch', error);
		} finally {
			if (!published) {
				pending.request.cancel();
				terminalFirstPrespawn.release(pending.workspaceId, pending.request);
				if (this.pending.get(windowId) === pending) {
					this.pending.delete(windowId);
				}
			}
		}
	}

	override dispose(): void {
		for (const windowId of this.pending.keys()) {
			this.cancel(windowId);
		}
		super.dispose();
	}
}

interface IPrespawnLaunch {
	readonly config: IShellLaunchConfig;
	readonly cwd: string;
	readonly env: IProcessEnvironment;
	readonly options: ITerminalProcessOptions;
	readonly unicodeVersion: '6' | '11';
}

/** Uses the same environment builder and merge order as renderer-created shells. */
export async function terminalFirstPrespawnLaunch(profile: ITerminalProfile, settings: ITerminalFirstPrespawnSettings, baseEnvironment: IProcessEnvironment, cliEnvironment: Record<string, string>, nonce: string, cwd: string, version: string, isScreenReaderOptimized: boolean): Promise<IPrespawnLaunch> {
	const config: IShellLaunchConfig = {
		executable: profile.path, args: profile.args, cwd,
		env: cliEnvironment,
		icon: profile.icon, color: profile.color,
		useShellEnvironment: false,
		shellIntegrationEnvironmentReporting: settings.environmentReporting,
		reconnectionProperties: { ownerId: TERMINAL_FIRST_PRESPAWN_OWNER },
	};
	const env = await createTerminalEnvironment(config, settings.env, undefined, version, settings.detectLocale, baseEnvironment);
	// Match the renderer policy after profile/config env overrides.
	const decoratedEnvironment = { ...env, TERMINAL_FIRST_SESSION: nonce };
	return {
		config, cwd, env: decoratedEnvironment, unicodeVersion: settings.unicodeVersion,
		options: {
			shellIntegration: { enabled: settings.shellIntegration, suggestEnabled: settings.suggest, nonce },
			windowsUseConptyDll: false, environmentVariableCollections: undefined,
			workspaceFolder: undefined, isScreenReaderOptimized,
		},
	};
}

/** Cancels late work at every asynchronous boundary so it cannot create a second session shell. */
export async function startTerminalFirstPrespawn(pty: Pick<IPtyService, 'createProcess' | 'start' | 'detachFromProcess' | 'setTerminalLayoutInfo' | 'shutdown'>, request: TerminalFirstPrespawnRequest, workspaceId: string, workspaceName: string, launch: IPrespawnLaunch, didCreate: (id: number) => void): Promise<boolean> {
	let id: number | undefined;
	let published = false;
	try {
		if (request.isCancelled) {
			return false;
		}
		mark('code/terminalFirst/main/willPrespawn');
		id = await pty.createProcess(launch.config, launch.cwd, 80, 30, launch.unicodeVersion, launch.env, {}, launch.options, true, workspaceId, workspaceName);
		didCreate(id);
		if (request.isCancelled) {
			return false;
		}
		const result = await pty.start(id);
		if (request.isCancelled || (result && hasKey(result, { message: true }))) {
			return false;
		}
		await pty.detachFromProcess(id, true);
		published = await request.publish(() => pty.setTerminalLayoutInfo({
			workspaceId, tabs: [{ isActive: true, activePersistentProcessId: id, terminals: [{ terminal: id!, relativeSize: 1 }] }], background: [],
		}));
		if (published) {
			mark('code/terminalFirst/main/didPrespawn');
		}
		return published;
	} finally {
		if (!published && id !== undefined) {
			await pty.shutdown(id, true);
		}
	}
}
