/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { VSBuffer } from '../../../../base/common/buffer.js';
import { Event } from '../../../../base/common/event.js';
import { Disposable, DisposableStore } from '../../../../base/common/lifecycle.js';
import { getMarks, mark, PerformanceMark } from '../../../../base/common/performance.js';
import { URI } from '../../../../base/common/uri.js';
import { localize2 } from '../../../../nls.js';
import { Categories } from '../../../../platform/action/common/actionCommonCategories.js';
import { Action2, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { INativeEnvironmentService } from '../../../../platform/environment/common/environment.js';
import { NativeParsedArgs } from '../../../../platform/environment/common/argv.js';
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
	'code/willCreateWorkbenchContributions/1', 'code/didCreateWorkbenchContributions/1', 'code/willCreateWorkbenchContributions/2', 'code/didCreateWorkbenchContributions/2', 'code/willCreateWorkbenchContributions/3', 'code/didCreateWorkbenchContributions/3',
	'code/terminal/willConnectPtyHost', 'code/terminal/didConnectPtyHost', 'code/terminal/willGetProfiles', 'code/terminal/didGetProfiles', 'code/terminal/willReconnect', 'code/terminal/didReconnect', 'code/terminal/willReplay', 'code/terminal/didReplay',
	'code/willLoadExtensions', 'code/didLoadExtensions', 'code/didRemovePartsSplash',
]);

/** Command-line arguments exist in native windows only; the browser-layer service sees them when the environment is native. */
function nativeArgs(environmentService: IWorkbenchEnvironmentService): NativeParsedArgs | undefined {
	return (environmentService as Partial<INativeEnvironmentService>).args;
}

/**
 * Records when the startup shell first draws and, when a perf run asks for it, how long a
 * keystroke takes to echo. The marks are published to the timer service so
 * `--prof-duration-markers` can read them after the renderer snapshot is taken.
 */
export class TerminalFirstStartupTimings extends Disposable {
	private readonly tracking = this._register(new DisposableStore());
	private tracked = false;
	private readonly inputRequested: boolean;
	private readonly markersFile: string | undefined;

	constructor(
		@ITimerService private readonly timerService: ITimerService,
		@IWorkbenchEnvironmentService environmentService: IWorkbenchEnvironmentService,
		@IFileService private readonly fileService: IFileService,
		@ILogService private readonly logService: ILogService,
	) {
		super();
		const args = nativeArgs(environmentService);
		this.inputRequested = args?.['prof-duration-markers']?.some(pair => pair.endsWith(`-${INPUT_MARK}`)) === true;
		this.markersFile = args?.['prof-duration-markers-file'];
	}

	/** Publishes the fork's marks so far; safe to call repeatedly. */
	publish(): void {
		this.timerService.setPerformanceMarks(STARTUP_MARKS_SOURCE, getMarks().filter(entry => entry.name.startsWith(MARK_PREFIX)));
	}

	/** Watches the startup session's terminal for its first output and the optional echo round trip. */
	track(terminal: ITerminalInstance): void {
		if (this.tracked) { return; }
		this.tracked = true;
		if (terminal.shellLaunchConfig.attachPersistentProcess) {
			// A revived terminal replayed its buffer before the fork adopted it; its prompt is already drawn.
			mark(PROMPT_MARK);
			void this.afterPrompt(terminal, true);
			return;
		}
		this.tracking.add(Event.once(terminal.onData)(() => {
			mark(PROMPT_MARK);
			void this.afterPrompt(terminal, false);
		}));
	}

	private async afterPrompt(terminal: ITerminalInstance, reconnected: boolean): Promise<void> {
		try {
			if (this.inputRequested) {
				await terminal.processReady;
				const echoed = new Promise<void>(resolve => this.tracking.add(Event.once(terminal.onData)(() => resolve())));
				await terminal.sendText('\n', false);
				await echoed;
				mark(INPUT_MARK);
			}
			this.publish();
			await this.report(reconnected);
		} catch (error) {
			this.logService.error('[terminalFirst-perf] Startup timing failed', error);
		}
	}

	private async report(reconnected: boolean): Promise<void> {
		const marks = Object.fromEntries(collectMarks(this.timerService.getPerformanceMarks(), getMarks()).map(entry => [entry.name, entry.startTime]));
		const payload = { reconnected, inputRequested: this.inputRequested, marks };
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

/** The Markdown shown by the Terminal First Startup Marks command. */
export function renderStartupMarks(published: readonly (readonly [string, readonly PerformanceMark[]])[], live: readonly PerformanceMark[], timings: ReadonlyMap<LifecyclePhase, readonly (readonly [string, number])[]>): string {
	const marks = collectMarks(published, live);
	const start = marks.find(entry => entry.name === 'code/didStartMain') ?? marks[0];
	const origin = start?.startTime ?? 0;
	const lines = ['# Terminal First Startup', '', `Times are milliseconds since \`${start?.name ?? 'code/didStartMain'}\`.`, '', '| Mark | Since start | Epoch |', '| --- | ---: | ---: |'];
	for (const entry of marks) {
		lines.push(`| ${entry.name} | ${entry.startTime - origin} | ${entry.startTime} |`);
	}
	const slowest = [...timings].flatMap(([phase, entries]) => entries.map(([id, time]) => ({ phase, id, time }))).sort((a, b) => b.time - a.time).slice(0, 20);
	lines.push('', '## Slowest contribution constructors', '', '| Phase | Contribution | ms |', '| --- | --- | ---: |');
	for (const entry of slowest) {
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
