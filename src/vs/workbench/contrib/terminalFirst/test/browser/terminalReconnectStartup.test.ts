/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { deepStrictEqual, strictEqual } from 'assert';
import * as sinon from 'sinon';
import { DeferredPromise, timeout } from '../../../../../base/common/async.js';
import { Emitter, Event } from '../../../../../base/common/event.js';
import { toDisposable } from '../../../../../base/common/lifecycle.js';
import { upcastPartial } from '../../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { IPtyHostAttachTarget, IShellLaunchConfig, ITerminalBackend, TerminalLocation } from '../../../../../platform/terminal/common/terminal.js';
import { terminalFirstEnabled } from '../../../../../platform/terminalFirst/common/terminalFirst.js';
import { IRemoteAgentService } from '../../../../services/remote/common/remoteAgentService.js';
import { TestTerminalProfileService, workbenchInstantiationService } from '../../../../test/browser/workbenchTestServices.js';
import { ITerminalGroup, ITerminalGroupService, ITerminalInstance, ITerminalInstanceService, ITerminalService, TerminalConnectionState } from '../../../terminal/browser/terminal.js';
import { TerminalService } from '../../../terminal/browser/terminalService.js';
import { ITerminalProfileService } from '../../../terminal/common/terminal.js';
import { TerminalFirstLaunch } from '../../browser/terminalPolicy.js';

const terminalFirstSuite = terminalFirstEnabled ? suite : suite.skip;

terminalFirstSuite('Terminal First - reconnect startup', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	function fixture(backend: Promise<ITerminalBackend | undefined>) {
		const instantiationService = workbenchInstantiationService({
			configurationService: () => new TestConfigurationService({ files: {}, terminal: { integrated: { enablePersistentSessions: true } } }),
		}, store);
		instantiationService.stub(ITerminalInstanceService, 'getBackend', () => backend);
		instantiationService.stub(ITerminalInstanceService, 'getRegisteredBackends', []);
		instantiationService.stub(IRemoteAgentService, 'getConnection', null);
		return instantiationService;
	}

	test('Connected waits for recreated instances but not their output replay', async () => {
		const backendReady = new DeferredPromise<ITerminalBackend>();
		const instantiationService = fixture(backendReady.p);
		const replay = store.add(new Emitter<void>());
		const instance = upcastPartial<ITerminalInstance>({ instanceId: 1, onProcessReplayComplete: replay.event });
		const group = upcastPartial<ITerminalGroup>({ terminalInstances: [instance], resizePanes() { } });
		instantiationService.stub(ITerminalGroupService, 'getGroupForInstance', () => group);
		const service = store.add(instantiationService.createInstance(TerminalService));
		instantiationService.stub(ITerminalService, service);
		const creationStarted = new DeferredPromise<void>();
		const created = new DeferredPromise<ITerminalInstance>();
		const createTerminal = sinon.stub(service, 'createTerminal').callsFake(async () => {
			await creationStarted.complete();
			return created.p;
		});
		store.add(toDisposable(() => createTerminal.restore()));
		const connected = Event.toPromise(service.onDidChangeConnectionState);
		let replayFinished = false;
		service.whenConnected.then(() => replayFinished = true);
		await backendReady.complete(upcastPartial<ITerminalBackend>({
			onDidRequestDetach: Event.None,
			getTerminalLayoutInfo: async () => ({ tabs: [{ isActive: false, activePersistentProcessId: 1, terminals: [{ relativeSize: 1, terminal: upcastPartial<IPtyHostAttachTarget>({ id: 1, pid: 10, isOrphan: true }) }] }], background: [] }),
		}));
		await creationStarted.p;
		await timeout(0);
		const beforeCreation = service.connectionState;
		await created.complete(instance);
		await connected;
		const beforeReplay = { state: service.connectionState, replayFinished };
		await timeout(0);
		replay.fire();
		await service.whenConnected;
		deepStrictEqual({ beforeCreation, beforeReplay }, {
			beforeCreation: TerminalConnectionState.Connecting,
			beforeReplay: { state: TerminalConnectionState.Connected, replayFinished: false },
		});
	});

	test('an attached process can create its instance while profile detection is pending', async () => {
		const instantiationService = fixture(Promise.resolve(undefined));
		const profilesReady = new DeferredPromise<void>();
		const profileService = new TestTerminalProfileService();
		profileService.profilesReady = profilesReady.p;
		instantiationService.stub(ITerminalProfileService, profileService);
		const config: IShellLaunchConfig = { attachPersistentProcess: upcastPartial<IPtyHostAttachTarget>({ id: 1, pid: 10, isOrphan: true }) };
		const instance = upcastPartial<ITerminalInstance>({ instanceId: 1 });
		instantiationService.stub(ITerminalInstanceService, 'convertProfileToShellLaunchConfig', () => config);
		instantiationService.stub(ITerminalGroupService, 'createGroup', () => upcastPartial<ITerminalGroup>({ terminalInstances: [instance] }));
		const service = store.add(instantiationService.createInstance(TerminalService));
		instantiationService.stub(ITerminalService, service);
		service.registerProcessSupport(true);
		let resolved = false;
		const creating = service.createTerminal(TerminalFirstLaunch.session({ config, location: TerminalLocation.Panel, skipContributedProfileCheck: true })).then(() => resolved = true);
		await timeout(0);
		const resolvedBeforeProfiles = resolved;
		await profilesReady.complete();
		await creating;
		strictEqual(resolvedBeforeProfiles, true);
	});
});
