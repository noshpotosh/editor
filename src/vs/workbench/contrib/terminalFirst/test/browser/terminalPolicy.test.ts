/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { deepStrictEqual, strictEqual, throws } from 'assert';
import { Emitter } from '../../../../../base/common/event.js';
import { upcastPartial } from '../../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { IDialogService } from '../../../../../platform/dialogs/common/dialogs.js';
import { TestDialogService } from '../../../../../platform/dialogs/test/common/testDialogService.js';
import { IShellLaunchConfig, TerminalLocation } from '../../../../../platform/terminal/common/terminal.js';
import { IRemoteAgentService } from '../../../../services/remote/common/remoteAgentService.js';
import { workbenchInstantiationService } from '../../../../test/browser/workbenchTestServices.js';
import { ITerminalInstance, ITerminalInstanceService, ITerminalService } from '../../../terminal/browser/terminal.js';
import { TerminalPolicy } from '../../../terminal/browser/terminalPolicy.js';
import { TerminalService } from '../../../terminal/browser/terminalService.js';
import { createTerminalFirstTerminalPolicy, TerminalFirstLaunch } from '../../browser/terminalPolicy.js';

suite('Terminal First - terminal policy', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();
	const policy = createTerminalFirstTerminalPolicy();

	test('only marked launches may create terminals, and each launch config is consumed once', () => {
		throws(() => policy.beforeCreate(undefined));
		throws(() => policy.beforeCreate({ config: { hideFromUser: true } }));
		for (const mark of [TerminalFirstLaunch.session, TerminalFirstLaunch.floating, TerminalFirstLaunch.tile]) {
			policy.beforeCreate(mark({}));
		}
		const config: IShellLaunchConfig = {};
		throws(() => policy.authorizeInstance(config));
		policy.prepareLaunchConfig(config, TerminalFirstLaunch.session({}));
		policy.authorizeInstance(config);
		throws(() => policy.authorizeInstance(config));
	});

	test('floating launches become hidden, persistent, detached shells; reconnects follow the same rule', () => {
		const floating: IShellLaunchConfig = {};
		policy.prepareLaunchConfig(floating, TerminalFirstLaunch.floating({}));
		const reconnected: IShellLaunchConfig = {};
		policy.prepareLaunchConfig(reconnected, policy.prepareReconnect({}, 'background'));
		const session: IShellLaunchConfig = {};
		policy.prepareLaunchConfig(session, policy.prepareReconnect({}, 'group'));
		const instance = (shellLaunchConfig: IShellLaunchConfig) => upcastPartial<ITerminalInstance>({ shellLaunchConfig });
		deepStrictEqual({
			floating: [floating.hideFromUser, floating.forcePersist, policy.isDetached(instance(floating))],
			reconnected: policy.isDetached(instance(reconnected)),
			session: [session.hideFromUser, policy.isDetached(instance(session))],
			tileOpensEditor: policy.opensEditorFor(TerminalFirstLaunch.tile({})),
			sessionOpensEditor: policy.opensEditorFor(TerminalFirstLaunch.session({})),
			skipsProfiles: [TerminalFirstLaunch.floating({}), TerminalFirstLaunch.tile({}), TerminalFirstLaunch.session({})].map(options => policy.skipContributedProfile(options)),
			layout: [policy.restoreGroupLayout, policy.autoCreateInView],
		}, {
			floating: [true, true, true],
			reconnected: true,
			session: [undefined, false],
			tileOpensEditor: false,
			sessionOpensEditor: true,
			skipsProfiles: [true, true, false],
			layout: [false, false],
		});
	});

	test('the shell integration nonce reaches the process environment', () => {
		const env: Record<string, string | undefined> = {};
		policy.decorateEnvironment(env, 'session-nonce');
		deepStrictEqual(env, { TERMINAL_FIRST_SESSION: 'session-nonce' });
	});

	test('group splits and editor terminals outside tiles are refused', () => {
		policy.assertCanAddToGroup(upcastPartial<Parameters<typeof policy.assertCanAddToGroup>[0]>({ terminalInstances: [] }));
		throws(() => policy.assertCanAddToGroup(upcastPartial<Parameters<typeof policy.assertCanAddToGroup>[0]>({ terminalInstances: [upcastPartial<ITerminalInstance>({})] })));
		throws(() => policy.assertCanMoveInGroup(upcastPartial<Parameters<typeof policy.assertCanMoveInGroup>[0]>({})));
		policy.assertCanOpenEditor(upcastPartial<ITerminalInstance>({ target: TerminalLocation.Editor }));
		throws(() => policy.assertCanOpenEditor(upcastPartial<ITerminalInstance>({ target: TerminalLocation.Panel })));
	});

	suite('with the terminal service', () => {
		let terminalService: TerminalService;
		let disposed: Emitter<ITerminalInstance>;

		setup(() => {
			store.add(TerminalPolicy.set(policy));
			const instantiationService = workbenchInstantiationService({
				configurationService: () => new TestConfigurationService({ files: {}, terminal: { integrated: { confirmOnKill: 'never', enablePersistentSessions: true } } }),
			}, store);
			instantiationService.stub(IDialogService, new TestDialogService());
			instantiationService.stub(ITerminalInstanceService, 'getBackend', undefined);
			instantiationService.stub(ITerminalInstanceService, 'getRegisteredBackends', []);
			instantiationService.stub(IRemoteAgentService, 'getConnection', null);
			terminalService = store.add(instantiationService.createInstance(TerminalService));
			instantiationService.stub(ITerminalService, terminalService);
			disposed = store.add(new Emitter<ITerminalInstance>());
			instantiationService.stub(ITerminalInstanceService, 'convertProfileToShellLaunchConfig', (config: IShellLaunchConfig) => config);
			instantiationService.stub(ITerminalInstanceService, 'createInstance', (shellLaunchConfig: IShellLaunchConfig) => {
				policy.authorizeInstance(shellLaunchConfig);
				return upcastPartial<ITerminalInstance>({ instanceId: 100, shellLaunchConfig, onDisposed: disposed.event });
			});
			terminalService.registerProcessSupport(true);
		});

		test('floating terminals remain backgrounded when activated or revealed', async () => {
			const instance = await terminalService.createTerminal(TerminalFirstLaunch.floating({ config: {} }));
			terminalService.setActiveInstance(instance);
			await terminalService.showBackgroundTerminal(instance);
			deepStrictEqual([terminalService.activeInstance === instance, terminalService.instances.includes(instance), terminalService.foregroundInstances.includes(instance)], [true, true, false]);
			disposed.fire(instance);
			strictEqual(terminalService.instances.includes(instance), false);
		});

		test('unmarked creation is refused', async () => {
			let message = '';
			await terminalService.createTerminal({ config: { hideFromUser: true } }).catch(error => { message = String(error); });
			strictEqual(message.includes('session strip'), true);
		});
	});
});
