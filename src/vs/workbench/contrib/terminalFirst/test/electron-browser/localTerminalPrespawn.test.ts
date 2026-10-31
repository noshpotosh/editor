/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { Event } from '../../../../../base/common/event.js';
import { upcastPartial } from '../../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { TestInstantiationService } from '../../../../../platform/instantiation/test/common/instantiationServiceMock.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../../platform/storage/common/storage.js';
import { ILocalPtyService, IPtyHostAttachTarget, IPtyService, ITerminalLogService, ITerminalsLayoutInfo, TerminalSettingId } from '../../../../../platform/terminal/common/terminal.js';
import { terminalFirstEnabled } from '../../../../../platform/terminalFirst/common/terminalFirst.js';
import { IWorkspaceContextService } from '../../../../../platform/workspace/common/workspace.js';
import { TestContextService, TestStorageService } from '../../../../test/common/workbenchTestServices.js';
import { TerminalStorageKeys } from '../../../terminal/common/terminalStorageKeys.js';
import { LocalTerminalBackend } from '../../../terminal/electron-browser/localTerminalBackend.js';

const terminalFirstSuite = terminalFirstEnabled ? suite : suite.skip;

terminalFirstSuite('Terminal First local prespawn reconnect', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	function fixture(reviveProcess: 'never' | 'onExit') {
		const calls: string[] = [];
		const instantiationService = store.add(new TestInstantiationService());
		const storage = store.add(new TestStorageService());
		const context = new TestContextService();
		const liveLayout: ITerminalsLayoutInfo = {
			tabs: [{
				isActive: true, activePersistentProcessId: 42,
				terminals: [{ relativeSize: 1, terminal: upcastPartial<IPtyHostAttachTarget>({ id: 42, pid: 99, isOrphan: true, workspaceId: context.getWorkspace().id, shellIntegrationNonce: 'live-shell' }) }],
			}], background: [],
		};
		instantiationService.stub(IWorkspaceContextService, context);
		instantiationService.stub(ITerminalLogService, new NullLogService());
		instantiationService.stub(IStorageService, storage);
		instantiationService.stub(IConfigurationService, new TestConfigurationService({ [TerminalSettingId.PersistentSessionReviveProcess]: reviveProcess }));
		instantiationService.stub(ILocalPtyService, upcastPartial<ILocalPtyService>({
			onPtyHostExit: Event.None, onPtyHostStart: Event.None,
			onPtyHostUnresponsive: Event.None, onPtyHostResponsive: Event.None,
			onPtyHostRequestResolveVariables: Event.None,
			getTerminalLayoutInfo: async () => { calls.push('main:getLayout'); return liveLayout; },
			setTerminalLayoutInfo: async () => { calls.push('main:setLayout'); },
			reviveTerminalProcesses: async () => { calls.push('main:revive'); },
		}));
		const backend = store.add(instantiationService.createInstance(LocalTerminalBackend));
		Reflect.set(backend, '_directProxy', upcastPartial<IPtyService>({
			getTerminalLayoutInfo: async () => { calls.push('direct:getLayout'); return liveLayout; },
			setTerminalLayoutInfo: async () => { calls.push('direct:setLayout'); },
			reviveTerminalProcesses: async () => { calls.push('direct:revive'); },
		}));
		return { backend, storage, calls, liveLayout };
	}

	test('an already connected direct channel cannot bypass main prespawn coordination', async () => {
		const { backend, calls, liveLayout } = fixture('never');
		const layout = await backend.getTerminalLayoutInfo();
		assert.deepStrictEqual({ layout, calls }, { layout: liveLayout, calls: ['main:getLayout'] });
	});

	test('never discards pre-upgrade disk state while keeping the live shell layout for reload', async () => {
		const { backend, storage, calls, liveLayout } = fixture('never');
		storage.store(TerminalStorageKeys.TerminalBufferState, JSON.stringify({ version: 1, state: [{ id: 1, shellLaunchConfig: {}, processLaunchConfig: {} }] }), StorageScope.WORKSPACE, StorageTarget.MACHINE);
		storage.store(TerminalStorageKeys.TerminalLayoutInfo, JSON.stringify({ tabs: [{ activePersistentProcessId: 1 }] }), StorageScope.WORKSPACE, StorageTarget.MACHINE);
		const layout = await backend.getTerminalLayoutInfo();
		assert.deepStrictEqual({
			layout, calls,
			buffer: storage.get(TerminalStorageKeys.TerminalBufferState, StorageScope.WORKSPACE),
			savedLayout: storage.get(TerminalStorageKeys.TerminalLayoutInfo, StorageScope.WORKSPACE),
		}, { layout: liveLayout, calls: ['main:getLayout'], buffer: undefined, savedLayout: undefined });
	});

	test('an explicit revival opt-in retains its disk layout', async () => {
		const { backend, storage, calls } = fixture('onExit');
		const savedLayout = JSON.stringify({ tabs: [{ activePersistentProcessId: 1 }] });
		storage.store(TerminalStorageKeys.TerminalLayoutInfo, savedLayout, StorageScope.WORKSPACE, StorageTarget.MACHINE);
		await backend.getTerminalLayoutInfo();
		assert.deepStrictEqual({ calls, savedLayout: storage.get(TerminalStorageKeys.TerminalLayoutInfo, StorageScope.WORKSPACE) }, { calls: ['main:getLayout'], savedLayout });
	});
});
