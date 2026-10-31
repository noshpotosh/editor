/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Sequencer } from '../../../../base/common/async.js';
import { VSBuffer } from '../../../../base/common/buffer.js';
import { Event } from '../../../../base/common/event.js';
import { Disposable, DisposableStore } from '../../../../base/common/lifecycle.js';
import { getMarks, mark, PerformanceMark } from '../../../../base/common/performance.js';
import { URI } from '../../../../base/common/uri.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { localize2 } from '../../../../nls.js';
import { Categories } from '../../../../platform/action/common/actionCommonCategories.js';
import { Action2, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { Extensions as WorkbenchExtensions, IWorkbenchContributionsRegistry } from '../../../common/contributions.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { IWorkbenchEnvironmentService } from '../../../services/environment/common/environmentService.js';
import { LifecyclePhase, LifecyclePhaseToString } from '../../../services/lifecycle/common/lifecycle.js';
import { ITerminalFirstService } from '../../../services/terminalFirst/common/terminalFirst.js';
import { terminalFirstEnabled } from '../../../services/terminalFirst/common/terminalFirstPolicy.js';
import { ITimerService } from '../../../services/timer/browser/timerService.js';
import { ITerminalInstance } from '../../terminal/browser/terminal.js';

/** The timer-service source under which the fork publishes its marks. */
export const STARTUP_MARKS_SOURCE = 'terminalFirst';
const MARK_PREFIX = 'code/terminalFirst/';
const PROMPT_MARK = `${MARK_PREFIX}prompt`;
const INPUT_MARK = `${MARK_PREFIX}input`;

/** Upstream marks worth reading next to the fork's own when judging a shell launch. */
const REPORTED_UPSTREAM_MARKS = new Set([
	'code/didStartMain', 'code/willOpenNewWindow', 'code/willLoadWorkbenchMain', 'code/didLoadWorkbenchMain', 'code/willStartWorkbench', 'code/didStartWorkbench',
	'code/willCreateMainServices', 'code/didCreateMainServices', 'code/willInitMainServices', 'code/didInitMainServices', 'code/willStartMainServer', 'code/didStartMainServer',
	'code/willStartCodeApplication', 'code/willResolveMachineId', 'code/didResolveMachineId', 'code/willInitAppServices', 'code/didInitAppServices', 'code/willInitChannels', 'code/didInitChannels',
	'code/willSetupProtocolUrlHandlers', 'code/didSetupProtocolUrlHandlers', 'code/willOpenFirstWindow', 'code/didOpenFirstWindow',
	'code/didStartRenderer', 'code/willWaitForWindowConfig', 'code/didWaitForWindowConfig', 'code/willShowPartsSplash', 'code/didShowPartsSplash', 'code/willAddCssLoader', 'code/didAddCssLoader',
	'code/willCreateWorkbenchContributions/1', 'code/didCreateWorkbenchContributions/1', 'code/willCreateWorkbenchContributions/2', 'code/didCreateWorkbenchContributions/2', 'code/willCreateWorkbenchContributions/3', 'code/didCreateWorkbenchContributions/3',
	'code/terminal/willConnectPtyHost', 'code/terminal/didConnectPtyHost', 'code/terminal/willGetProfiles', 'code/terminal/didGetProfiles', 'code/terminal/willReconnect', 'code/terminal/didReconnect', 'code/terminal/willReplay', 'code/terminal/didReplay',
	'code/willLoadExtensions', 'code/didLoadExtensions', 'code/didRemovePartsSplash',
]);

/** The upstream profiling arguments a perf run passes; only native windows carry them. */
export interface IStartupPerfArgs {
	readonly 'prof-duration-markers'?: readonly string[];
	readonly 'prof-duration-markers-file'?: string;
}

/** Command-line arguments exist in native windows only; the browser-layer service reads them when present. */
function perfArgs(environmentService: IWorkbenchEnvironmentService): IStartupPerfArgs | undefined {
	return (environmentService as { readonly args?: IStartupPerfArgs }).args;
}

/**
 * Records when the startup shell first draws and, when a perf run asks for it, how long a
 * command takes to return a unique response. The marks are published to the timer service so
 * `--prof-duration-markers` can read them after the renderer snapshot is taken.
 */
export class TerminalFirstStartupTimings extends Disposable {
	private readonly tracking = this._register(new DisposableStore());
	private readonly reports = new Sequencer();
	private tracked = false;
	private reconnected = false;
	private didUseCachedData: boolean | undefined;
	private readonly inputRequested: boolean;
	private readonly markersFile: string | undefined;

	constructor(
		@ITimerService private readonly timerService: ITimerService,
		@IWorkbenchEnvironmentService environmentService: IWorkbenchEnvironmentService,
		@IFileService private readonly fileService: IFileService,
		@ILogService private readonly logService: ILogService,
	) {
		super();
		const args = perfArgs(environmentService);
		this.inputRequested = args?.['prof-duration-markers']?.some(pair => pair.endsWith(`-${INPUT_MARK}`)) === true;
		this.markersFile = args?.['prof-duration-markers-file'];
		void timerService.whenReady().then(() => {
			if (this._store.isDisposed) { return; }
			// Upstream estimates cache use from the commit and caching configuration; it is not a measured cache hit.
			this.didUseCachedData = timerService.startupMetrics.didUseCachedData;
			if (this.tracked) { this.publish(); }
		}).catch(error => this.logService.error('[terminalFirst-perf] Reading startup metrics failed', error));
	}

	/** Publishes the fork's marks so far and refreshes the dump; safe to call repeatedly. */
	publish(): void {
		this.timerService.setPerformanceMarks(STARTUP_MARKS_SOURCE, getMarks().filter(entry => entry.name.startsWith(MARK_PREFIX)));
		void this.reports.queue(() => this.report()).catch(error => this.logService.error('[terminalFirst-perf] Writing the startup marks failed', error));
	}

	/** Watches the startup session's terminal for its first rendered output and the optional command round trip. */
	track(terminal: ITerminalInstance): void {
		if (this.tracked) { return; }
		this.tracked = true;
		this.reconnected = !!terminal.shellLaunchConfig.attachPersistentProcess;
		if (this.reconnected && this.hasRenderedOutput(terminal)) {
			// Replay may have completed before adoption. Merely having an attached process does not mean it has drawn anything.
			mark(PROMPT_MARK);
			void this.afterPrompt(terminal);
			return;
		}
		this.tracking.add(Event.once(terminal.onData)(() => {
			mark(PROMPT_MARK);
			void this.afterPrompt(terminal);
		}));
	}

	private hasRenderedOutput(terminal: ITerminalInstance): boolean {
		const buffer = terminal.xterm?.raw.buffer.active;
		if (buffer) {
			for (let row = buffer.baseY; row < buffer.length; row++) {
				if (buffer.getLine(row)?.translateToString(true)) { return true; }
			}
		}
		return false;
	}

	private async afterPrompt(terminal: ITerminalInstance): Promise<void> {
		this.publish();
		if (!this.inputRequested) { return; }
		const probe = this.tracking.add(new DisposableStore());
		try {
			await terminal.processReady;
			if (probe.isDisposed) { return; }
			const token = `[${generateUuid().slice(0, 8)}]`;
			// The shell must execute printf: neither the echoed command nor unrelated startup/replay data contains the response.
			const encoded = [...token].map(character => `\\${character.charCodeAt(0).toString(8).padStart(3, '0')}`).join('');
			const command = `printf '${encoded}\\n'`;
			let output = '';
			let received = false;
			const response = new Promise<void>((resolve, reject) => {
				probe.add(terminal.onData(data => {
					output += data;
					if (output.includes(token)) { received = true; resolve(); }
					output = output.slice(-token.length);
				}));
				if (this.reconnected) {
					// LocalPty discards input during replay. Retry once after replay so that output cannot masquerade as an echo.
					probe.add(Event.once(terminal.onProcessReplayComplete)(() => {
						if (!received) { void terminal.sendText(command, true, true).catch(reject); }
					}));
				}
				// Paste as one edit when supported; execute after the closing bracket so shell plugins do not process every character.
				void terminal.sendText(command, true, true).catch(reject);
			});
			await response;
			if (probe.isDisposed) { return; }
			mark(INPUT_MARK);
			this.publish();
		} catch (error) {
			this.logService.error('[terminalFirst-perf] Startup timing failed', error);
		} finally {
			probe.dispose();
		}
	}

	private async report(): Promise<void> {
		const marks = Object.fromEntries(collectMarks(this.timerService.getPerformanceMarks(), getMarks()).map(entry => [entry.name, entry.startTime]));
		const contributions = slowestContributions(Registry.as<IWorkbenchContributionsRegistry>(WorkbenchExtensions.Workbench).timings).map(entry => [LifecyclePhaseToString(entry.phase), entry.id, Math.round(entry.time * 10) / 10]);
		const payload = { reconnected: this.reconnected, inputRequested: this.inputRequested, didUseCachedData: this.didUseCachedData, marks, contributions };
		this.logService.info(`[terminalFirst-perf] ${JSON.stringify(payload)}`);
		if (this.markersFile) {
			await this.fileService.writeFile(URI.file(`${this.markersFile}.terminalFirst.json`), VSBuffer.fromString(JSON.stringify(payload, null, '\t')));
		}
	}
}

/** Merges published marks from every process with the renderer's live marks (which win), keeping only the ones a shell launch cares about, in time order. */
function collectMarks(published: readonly (readonly [string, readonly PerformanceMark[]])[], live: readonly PerformanceMark[]): PerformanceMark[] {
	const byName = new Map<string, number>();
	for (const [, marks] of published) {
		for (const entry of marks) { byName.set(entry.name, entry.startTime); }
	}
	for (const entry of live) { byName.set(entry.name, entry.startTime); }
	return [...byName].filter(([name]) => name.startsWith(MARK_PREFIX) || name.startsWith('code/terminal/') || REPORTED_UPSTREAM_MARKS.has(name))
		.map(([name, startTime]) => ({ name, startTime })).sort((a, b) => a.startTime - b.startTime);
}

/** The 20 workbench contributions whose constructors took longest, slowest first. */
function slowestContributions(timings: ReadonlyMap<LifecyclePhase, readonly (readonly [string, number])[]>): { phase: LifecyclePhase; id: string; time: number }[] {
	return [...timings].flatMap(([phase, entries]) => entries.map(([id, time]) => ({ phase, id, time }))).sort((a, b) => b.time - a.time).slice(0, 20);
}

/** The Markdown shown by the Terminal First Startup Marks command. */
export function renderStartupMarks(published: readonly (readonly [string, readonly PerformanceMark[]])[], live: readonly PerformanceMark[], timings: ReadonlyMap<LifecyclePhase, readonly (readonly [string, number])[]>): string {
	const marks = collectMarks(published, live);
	const start = marks.find(entry => entry.name === 'code/didStartMain') ?? marks[0];
	const origin = start?.startTime ?? 0;
	const lines = ['# Terminal First Startup', '', `Times are milliseconds since \`${start?.name ?? 'code/didStartMain'}\`.`, '', '| Mark | Since start | Epoch |', '| --- | ---: | ---: |'];
	for (const entry of marks) {
		lines.push(`| ${entry.name} | ${entry.startTime - origin} | ${entry.startTime} |`);
	}
	lines.push('', '## Slowest contribution constructors', '', '| Phase | Contribution | ms |', '| --- | --- | ---: |');
	for (const entry of slowestContributions(timings)) {
		lines.push(`| ${LifecyclePhaseToString(entry.phase)} | ${entry.id} | ${entry.time} |`);
	}
	return lines.join('\n') + '\n';
}

if (terminalFirstEnabled) {
	registerAction2(class extends Action2 {
		constructor() {
			super({ id: 'terminalFirst.developer.startupMarks', title: localize2('startupMarks', "Terminal First Startup Marks"), category: Categories.Developer, f1: true });
		}
		async run(accessor: ServicesAccessor): Promise<void> {
			const contents = renderStartupMarks(accessor.get(ITimerService).getPerformanceMarks(), getMarks(), Registry.as<IWorkbenchContributionsRegistry>(WorkbenchExtensions.Workbench).timings);
			const editorService = accessor.get(IEditorService);
			await accessor.get(ITerminalFirstService).showEditor();
			await editorService.openEditor({ resource: undefined, contents, languageId: 'markdown', options: { pinned: true } });
		}
	});
}
