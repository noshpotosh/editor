/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { deepStrictEqual, strictEqual } from 'assert';
import { DeferredPromise } from '../../../../../base/common/async.js';
import { Emitter, Event } from '../../../../../base/common/event.js';
import { clearMarks, getMarks } from '../../../../../base/common/performance.js';
import { upcastPartial } from '../../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { IFileService, IFileStatWithMetadata } from '../../../../../platform/files/common/files.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import { IWorkbenchEnvironmentService } from '../../../../services/environment/common/environmentService.js';
import { LifecyclePhase } from '../../../../services/lifecycle/common/lifecycle.js';
import { ITimerService } from '../../../../services/timer/browser/timerService.js';
import { ITerminalInstance } from '../../../terminal/browser/terminal.js';
import { IStartupPerfArgs, renderStartupMarks, TerminalFirstStartupTimings } from '../../browser/startupTimings.js';

suite('Terminal First startup marks', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();
	setup(() => { for (const name of ['prompt', 'input']) { clearMarks(`code/terminalFirst/${name}`); } });
	const countMarks = (name: string) => getMarks().filter(entry => entry.name === `code/terminalFirst/${name}`).length;

	function fixture(input = true, reconnected = false, writeGate?: DeferredPromise<void>) {
		const data = store.add(new Emitter<string>());
		const replayComplete = store.add(new Emitter<void>());
		const didSend = store.add(new Emitter<void>());
		const didWrite = store.add(new Emitter<string>());
		const timerReady = new DeferredPromise<boolean>();
		const sent: string[] = [];
		const sendOptions: [boolean, boolean | undefined][] = [];
		const written: string[] = [];
		let writes = 0;
		const terminal = upcastPartial<ITerminalInstance>({
			shellLaunchConfig: reconnected ? { attachPersistentProcess: upcastPartial<NonNullable<ITerminalInstance['shellLaunchConfig']['attachPersistentProcess']>>({ id: 1 }) } : {},
			onData: data.event,
			onProcessReplayComplete: replayComplete.event,
			processReady: Promise.resolve(),
			sendText: async (text, shouldExecute, forceBracketedPasteMode) => { sent.push(text); sendOptions.push([shouldExecute, forceBracketedPasteMode]); didSend.fire(); },
		});
		const environment = upcastPartial<IWorkbenchEnvironmentService & { args: IStartupPerfArgs }>({
			args: { 'prof-duration-markers': input ? ['code/didStartMain-code/terminalFirst/input'] : [], 'prof-duration-markers-file': '/perf/test.tsv' }
		});
		const timing = store.add(new TerminalFirstStartupTimings(
			upcastPartial<ITimerService>({
				whenReady: () => timerReady.p,
				startupMetrics: upcastPartial<ITimerService['startupMetrics']>({ didUseCachedData: true }),
				setPerformanceMarks: () => { },
				getPerformanceMarks: () => [],
			}),
			environment,
			upcastPartial<IFileService>({ writeFile: async (_resource, content) => {
				if (writes++ === 0) { await writeGate?.p; }
				const text = content.toString();
				written.push(text);
				didWrite.fire(text);
				return upcastPartial<IFileStatWithMetadata>({});
			} }),
			store.add(new NullLogService()),
		));
		return { timing, terminal, data, replayComplete, didSend, didWrite, timerReady, sent, sendOptions, written, get writes() { return writes; } };
	}

	/** Decodes the printf payload so the fake pty can return the result rather than echoing the command. */
	function response(command: string): string {
		return [...command.matchAll(/\\(?<octal>[0-7]{3})/g)].map(match => String.fromCharCode(parseInt(match.groups!.octal, 8))).join('');
	}

	test('attachment alone does not mark a prompt or send a command in an ordinary launch', async () => {
		const state = fixture(false, true);
		state.timing.track(state.terminal);
		const beforeOutput = countMarks('prompt');
		const report = Event.toPromise(state.didWrite.event);
		state.data.fire('replayed prompt> ');
		await report;
		deepStrictEqual({ beforeOutput, prompt: countMarks('prompt'), input: countMarks('input'), sent: state.sent }, { beforeOutput: 0, prompt: 1, input: 0, sent: [] });
	});

	test('input needs a decoded response, including when it spans output chunks', async () => {
		const state = fixture();
		state.timing.track(state.terminal);
		const sent = Event.toPromise(state.didSend.event);
		state.data.fire('prompt> ');
		await sent;
		state.data.fire(state.sent[0]);
		state.data.fire('unrelated startup output');
		const beforeResponse = countMarks('input');
		const token = response(state.sent[0]);
		const report = Event.toPromise(Event.filter(state.didWrite.event, text => text.includes('"code/terminalFirst/input"')));
		state.data.fire(token.slice(0, 5));
		state.data.fire(token.slice(5) + 'x'.repeat(1000));
		await report;
		deepStrictEqual({ beforeResponse, input: countMarks('input'), decoded: /^\[[0-9a-f]{8}\]$/.test(token), sendOptions: state.sendOptions, pastedNewline: state.sent[0].includes('\n') }, { beforeResponse: 0, input: 1, decoded: true, sendOptions: [[true, true]], pastedNewline: false });
	});

	test('a replayed shell retries dropped input after replay completes', async () => {
		const state = fixture(true, true);
		state.timing.track(state.terminal);
		const initialSend = Event.toPromise(state.didSend.event);
		state.data.fire('replayed prompt> ');
		await initialSend;
		state.data.fire('more replayed output');
		const beforeResponse = countMarks('input');
		const retry = Event.toPromise(state.didSend.event);
		state.replayComplete.fire();
		await retry;
		const report = Event.toPromise(Event.filter(state.didWrite.event, text => text.includes('"code/terminalFirst/input"')));
		state.data.fire(response(state.sent[1]));
		await report;
		deepStrictEqual({ beforeResponse, input: countMarks('input'), sendOptions: state.sendOptions, sameProbe: state.sent[0] === state.sent[1] }, { beforeResponse: 0, input: 1, sendOptions: [[true, true], [true, true]], sameProbe: true });
	});

	test('reports serialize writes and refresh the cache estimate once available', async () => {
		const firstWrite = new DeferredPromise<void>();
		const state = fixture(false, false, firstWrite);
		state.timing.track(state.terminal);
		state.data.fire('prompt> ');
		state.timing.publish();
		await state.timerReady.complete(true);
		const writesBeforeRelease = state.writes;
		const cachedReport = Event.toPromise(Event.filter(state.didWrite.event, text => text.includes('"didUseCachedData": true')));
		await firstWrite.complete();
		await cachedReport;
		deepStrictEqual({ writesBeforeRelease, hasCacheEstimate: state.written.at(-1)?.includes('"didUseCachedData": true') }, { writesBeforeRelease: 1, hasCacheEstimate: true });
	});

	test('renders marks since main start and the slowest constructors', () => {
		const published: [string, { name: string; startTime: number }[]][] = [
			['main', [{ name: 'code/didStartMain', startTime: 1000 }, { name: 'code/ignored', startTime: 1001 }]],
			['renderer', [{ name: 'code/terminalFirst/presented', startTime: 1800 }, { name: 'code/terminal/didConnectPtyHost', startTime: 1500 }]],
		];
		// Live renderer marks win over the stale published copy.
		const live = [{ name: 'code/terminalFirst/presented', startTime: 1700 }, { name: 'code/terminalFirst/prompt', startTime: 1900 }];
		const timings = new Map<LifecyclePhase, [string, number][]>([
			[LifecyclePhase.Ready, [['fast', 0.2], ['slow', 12.5]]],
			[LifecyclePhase.Restored, [['medium', 3]]],
		]);
		strictEqual(renderStartupMarks(published, live, timings), [
			'# Terminal First Startup',
			'',
			'Times are milliseconds since `code/didStartMain`.',
			'',
			'| Mark | Since start | Epoch |',
			'| --- | ---: | ---: |',
			'| code/didStartMain | 0 | 1000 |',
			'| code/terminal/didConnectPtyHost | 500 | 1500 |',
			'| code/terminalFirst/presented | 700 | 1700 |',
			'| code/terminalFirst/prompt | 900 | 1900 |',
			'',
			'## Slowest contribution constructors',
			'',
			'| Phase | Contribution | ms |',
			'| --- | --- | ---: |',
			'| Ready | slow | 12.5 |',
			'| Restored | medium | 3 |',
			'| Ready | fast | 0.2 |',
			'',
		].join('\n'));
	});
});
