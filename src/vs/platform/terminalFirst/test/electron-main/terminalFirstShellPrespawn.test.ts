/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { DeferredPromise } from '../../../../base/common/async.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { deepFreeze } from '../../../../base/common/objects.js';
import { join } from '../../../../base/common/path.js';
import { URI } from '../../../../base/common/uri.js';
import { upcastPartial } from '../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { IConfigurationOverrides, IConfigurationValue } from '../../../configuration/common/configuration.js';
import { TestConfigurationService } from '../../../configuration/test/common/testConfigurationService.js';
import { ILifecycleMainService } from '../../../lifecycle/electron-main/lifecycleMainService.js';
import { NullLogService } from '../../../log/common/log.js';
import { IProductService } from '../../../product/common/productService.js';
import { ISetTerminalLayoutInfoArgs } from '../../../terminal/common/terminalProcess.js';
import { IPtyService, TerminalSettingId } from '../../../terminal/common/terminal.js';
import { INativeWindowConfiguration } from '../../../window/common/window.js';
import { ICodeWindow, LoadReason } from '../../../window/electron-main/window.js';
import { ISingleFolderWorkspaceIdentifier } from '../../../workspace/common/workspace.js';
import { IWorkspacesManagementMainService } from '../../../workspaces/electron-main/workspacesManagementMainService.js';
import { terminalFirstPrespawn, TerminalFirstPrespawnRequest } from '../../common/terminalFirstPrespawn.js';
import { canPrespawnTerminalFirstProfile, canPrespawnTerminalFirstWorkspace, hasTerminalFirstPrespawnOverrides, startTerminalFirstPrespawn, terminalFirstPrespawnLaunch, terminalFirstPrespawnSettings, TerminalFirstShellPrespawn } from '../../electron-main/terminalFirstShellPrespawn.js';

class PrespawnConfigurationService extends TestConfigurationService {
	override inspect<T>(key: string, overrides?: IConfigurationOverrides): IConfigurationValue<T> {
		const inspected = super.inspect<T>(key, overrides);
		return { ...inspected, defaultValue: inspected.userValue };
	}
}

suite('Terminal first shell prespawn', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	test('initial window preparation publishes a shell from deeply frozen inspected profiles', async () => {
		const directory = await fs.mkdtemp(join(tmpdir(), 'vs-nosh-prespawn-'));
		try {
			const settingsResource = URI.file(join(directory, 'settings.json'));
			await fs.writeFile(settingsResource.fsPath, JSON.stringify({ [TerminalSettingId.DefaultProfileMacOs]: 'Test Shell' }));
			const workspace: ISingleFolderWorkspaceIdentifier = { id: directory, uri: URI.file(directory) };
			const profiles = deepFreeze({ 'Test Shell': { path: process.execPath } });
			const configuration = new PrespawnConfigurationService({ [TerminalSettingId.ProfilesMacOs]: profiles });
			const published = new DeferredPromise<void>();
			const calls: string[] = [];
			const executables: (string | undefined)[] = [];
			const pty = upcastPartial<IPtyService>({
				...ptyFixture(calls),
				getEnvironment: async () => ({ PATH: '/usr/bin:/bin' }),
				createProcess: async config => { calls.push('create'); executables.push(config.executable); return 42; },
				setTerminalLayoutInfo: async () => { calls.push('publish'); await published.complete(); },
			});
			const loading = store.add(new Emitter<{ window: ICodeWindow; workspace: ISingleFolderWorkspaceIdentifier; reason: LoadReason }>());
			const logService = new class extends NullLogService {
				override trace(message: string, ...args: unknown[]): void {
					if (message === '[terminalFirst] Speculative shell fell back to renderer launch') {
						void published.error(args[0] instanceof Error ? args[0] : new Error(String(args[0])));
					}
				}
			};
			store.add(new TerminalFirstShellPrespawn(pty,
				upcastPartial<ILifecycleMainService>({ onWillLoadWindow: loading.event, onBeforeCloseWindow: Event.None }),
				upcastPartial<IWorkspacesManagementMainService>({}), configuration,
				upcastPartial<IProductService>({ version: '1.0' }), logService));
			loading.fire({
				reason: LoadReason.INITIAL, workspace,
				window: upcastPartial<ICodeWindow>({
					id: 7,
					config: upcastPartial<INativeWindowConfiguration>({
						workspace, execPath: process.execPath,
						profiles: { home: workspace.uri, all: [], profile: upcastPartial<INativeWindowConfiguration['profiles']['profile']>({ settingsResource, globalStorageHome: workspace.uri }) },
					}),
				}),
			});
			await published.p;
			await terminalFirstPrespawn.beforeGetLayout(workspace.id);
			assert.deepStrictEqual({ calls, executables, profiles }, {
				calls: ['create', 'start', 'detach', 'publish'], executables: [process.execPath], profiles: { 'Test Shell': { path: process.execPath } },
			});
		} finally {
			await fs.rm(directory, { recursive: true, force: true });
		}
	});

	test('renderer-only settings fall back without guessing', () => {
		const cases = [
			{ 'terminal.integrated.inheritEnv': true },
			{ 'terminal.integrated.enablePersistentSessions': false },
			{ 'terminal.integrated.persistentSessionReviveProcess': 'onExit' },
			{ 'terminal.integrated.allowInUntrustedWorkspace': false },
			{ 'terminal.integrated.cwd': '/custom/start/path' },
			{ 'terminal.integrated.cwd': '${workspaceFolder}/src' },
			{ terminal: { integrated: { cwd: '/custom/start/path' } } },
			{ 'terminal.integrated': { inheritEnv: true } },
			{ 'terminal.integrated.shellIntegration': { enabled: false } },
			{ 'terminal.integrated.environmentChangesRelaunch': true },
			{ 'editor.accessibilitySupport': 'on' },
			{ 'editor.accessibilitySupport': 'off' },
			{ editor: { accessibilitySupport: 'on' } },
			{ 'terminal.integrated.env.osx': { TOKEN: '${env:TOKEN}' } },
			{ 'terminal.integrated.profiles.osx': { zsh: { path: '${env:SHELL}' } } },
			{ 'terminal.integrated.env.osx': { INVALID: 42 } },
		];
		assert.deepStrictEqual(cases.map(settings => terminalFirstPrespawnSettings(settings)), cases.map(() => undefined));
	});

	test('workspace terminal overrides require normal renderer configuration', () => {
		assert.deepStrictEqual([
			hasTerminalFirstPrespawnOverrides({ 'editor.fontSize': 12 }),
			hasTerminalFirstPrespawnOverrides({ 'terminal.integrated.env.osx': {} }),
			hasTerminalFirstPrespawnOverrides({ terminal: { integrated: {} } }),
			hasTerminalFirstPrespawnOverrides({ 'terminal.integrated': { cwd: '/workspace' } }),
			hasTerminalFirstPrespawnOverrides({ 'editor.accessibilitySupport': 'on' }),
		], [false, true, true, true, true]);
	});

	test('profiles whose environment or name requires the renderer keep the ordinary launch path', () => {
		const profile = { profileName: 'zsh', path: '/bin/zsh', args: ['-l'], isDefault: true };
		assert.deepStrictEqual([
			canPrespawnTerminalFirstProfile(profile),
			canPrespawnTerminalFirstProfile({ ...profile, env: {} }),
			canPrespawnTerminalFirstProfile({ ...profile, env: { CUSTOM: 'value' } }),
			canPrespawnTerminalFirstProfile({ ...profile, overrideName: true }),
		], [true, true, false, false]);
	});

	test('only a single local folder has an unambiguous initial shell cwd', () => {
		assert.deepStrictEqual([
			canPrespawnTerminalFirstWorkspace([]),
			canPrespawnTerminalFirstWorkspace([URI.file('/workspace')]),
			canPrespawnTerminalFirstWorkspace([URI.file('/workspace'), URI.file('/other')]),
			canPrespawnTerminalFirstWorkspace([URI.parse('vscode-remote://ssh-remote+host/workspace')]),
		], [false, true, false, false]);
	});

	test('configuration env, removals, sanitation, CLI pointer and nonce match ordinary launch', async () => {
		const settings = terminalFirstPrespawnSettings({
			'terminal.integrated.env.osx': { FROM_SETTINGS: 'configured', REMOVE: null, OVERRIDE: 'settings' },
			'terminal.integrated.shellIntegration.enabled': false,
			'terminal.integrated.shellIntegration.environmentReporting': true,
			'terminal.integrated.suggest.enabled': false,
		})!;
		const launch = await terminalFirstPrespawnLaunch({ profileName: 'Custom', path: '/bin/zsh', args: ['-l'], isDefault: true }, settings,
			{ PATH: '/usr/bin', REMOVE: 'old', ELECTRON_RUN_AS_NODE: '1', LANG: 'de_DE.UTF-8' },
			{ PATH: '/app/bin:/usr/bin', OVERRIDE: 'launch', TERMINAL_FIRST_NODE: '/app/Code', TERMINAL_FIRST_CLI_POINTER: '/profile/window-7.json' }, 'nonce', '/workspace', '1.0', false);
		assert.deepStrictEqual({ env: launch.env, config: { args: launch.config.args, name: launch.config.name, owner: launch.config.reconnectionProperties?.ownerId, report: launch.config.shellIntegrationEnvironmentReporting }, integration: launch.options.shellIntegration }, {
			env: { PATH: '/app/bin:/usr/bin', LANG: 'de_DE.UTF-8', FROM_SETTINGS: 'configured', OVERRIDE: 'launch', TERMINAL_FIRST_NODE: '/app/Code', TERMINAL_FIRST_CLI_POINTER: '/profile/window-7.json', TERM_PROGRAM: 'vscode', TERM_PROGRAM_VERSION: '1.0', COLORTERM: 'truecolor', TERMINAL_FIRST_SESSION: 'nonce' },
			config: { args: ['-l'], name: undefined, owner: 'vs-nosh.prespawn', report: true },
			integration: { enabled: false, suggestEnabled: false, nonce: 'nonce' },
		});
	});

	async function launchFixture() {
		return terminalFirstPrespawnLaunch({ profileName: 'zsh', path: '/bin/zsh', args: ['-l'], isDefault: true }, terminalFirstPrespawnSettings({})!, { PATH: '/usr/bin' }, {}, 'nonce', '/workspace', '1.0', false);
	}

	function ptyFixture(calls: string[]): Pick<IPtyService, 'createProcess' | 'start' | 'detachFromProcess' | 'setTerminalLayoutInfo' | 'shutdown'> {
		return {
			createProcess: async () => { calls.push('create'); return 42; },
			start: async () => { calls.push('start'); return undefined; },
			detachFromProcess: async () => { calls.push('detach'); },
			setTerminalLayoutInfo: async () => { calls.push('publish'); },
			shutdown: async () => { calls.push('shutdown'); },
		};
	}

	test('starts and detaches before publishing exactly one persistent shell', async () => {
		const calls: string[] = [];
		const pty = ptyFixture(calls);
		let layout: ISetTerminalLayoutInfoArgs | undefined;
		pty.setTerminalLayoutInfo = async args => { calls.push('publish'); layout = args; };
		const published = await startTerminalFirstPrespawn(pty, new TerminalFirstPrespawnRequest(), 'workspace', 'Workspace', await launchFixture(), id => calls.push(`id:${id}`));
		assert.deepStrictEqual({ published, calls, layout }, {
			published: true, calls: ['create', 'id:42', 'start', 'detach', 'publish'],
			layout: { workspaceId: 'workspace', tabs: [{ isActive: true, activePersistentProcessId: 42, terminals: [{ terminal: 42, relativeSize: 1 }] }], background: [] },
		});
	});

	for (const stage of ['create', 'start', 'detach'] as const) {
		test(`renderer wins while ${stage} is pending and the speculative process is shut down`, async () => {
			const calls: string[] = [];
			const pty = ptyFixture(calls);
			const reached = new DeferredPromise<void>();
			const proceed = new DeferredPromise<void>();
			const gate = async () => { calls.push(stage); await reached.complete(); await proceed.p; };
			if (stage === 'create') {
				pty.createProcess = async () => { await gate(); return 42; };
			} else if (stage === 'start') {
				pty.start = async () => { await gate(); return undefined; };
			} else {
				pty.detachFromProcess = gate;
			}
			const request = new TerminalFirstPrespawnRequest();
			const result = startTerminalFirstPrespawn(pty, request, 'workspace', 'Workspace', await launchFixture(), () => { });
			await reached.p;
			await request.claim();
			await proceed.complete();
			assert.deepStrictEqual({ published: await result, calls }, { published: false, calls: ['create', ...(stage !== 'create' ? ['start'] : []), ...(stage === 'detach' ? ['detach'] : []), 'shutdown'] });
		});
	}

	test('a launch error cleans up without publishing a layout', async () => {
		const calls: string[] = [];
		const pty = ptyFixture(calls);
		pty.start = async () => { calls.push('start'); return { message: 'missing shell' }; };
		const published = await startTerminalFirstPrespawn(pty, new TerminalFirstPrespawnRequest(), 'workspace', 'Workspace', await launchFixture(), () => { });
		assert.deepStrictEqual({ published, calls }, { published: false, calls: ['create', 'start', 'shutdown'] });
	});

	test('a layout failure shuts down the detached shell', async () => {
		const calls: string[] = [];
		const pty = ptyFixture(calls);
		pty.setTerminalLayoutInfo = async () => { calls.push('publish'); throw new Error('layout failure'); };
		await assert.rejects(startTerminalFirstPrespawn(pty, new TerminalFirstPrespawnRequest(), 'workspace', 'Workspace', await launchFixture(), () => { }), /layout failure/);
		assert.deepStrictEqual(calls, ['create', 'start', 'detach', 'publish', 'shutdown']);
	});

	test('closing the window during publication discards the unclaimed shell', async () => {
		const calls: string[] = [];
		const pty = ptyFixture(calls);
		const reached = new DeferredPromise<void>();
		const proceed = new DeferredPromise<void>();
		pty.setTerminalLayoutInfo = async () => { calls.push('publish'); await reached.complete(); await proceed.p; };
		const request = new TerminalFirstPrespawnRequest();
		const result = startTerminalFirstPrespawn(pty, request, 'workspace', 'Workspace', await launchFixture(), () => { });
		await reached.p;
		request.cancel();
		await proceed.complete();
		assert.deepStrictEqual({ published: await result, calls }, { published: false, calls: ['create', 'start', 'detach', 'publish', 'shutdown'] });
	});
});
