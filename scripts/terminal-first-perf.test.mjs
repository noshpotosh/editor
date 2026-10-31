/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { test } from 'node:test';
import { deepStrictEqual, strictEqual } from 'node:assert';
import { execFile } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { aggregate, formatTable, missingMetrics, parseDurations } from './terminal-first-perf.mjs';

test('parses the upstream duration markers line and ignores junk', () => {
	deepStrictEqual(parseDurations('code/didStartMain-code/terminalFirst/presented\t812\tellapsed\t1204\n\nbroken\n'), { 'code/didStartMain-code/terminalFirst/presented': 812, 'ellapsed': 1204 });
});

test('aggregates medians, p90s, launch-relative marks, and missing counts', () => {
	const runs = [1, 2, 3].map(i => ({
		launchEpoch: 1000 * i,
		durations: { 'code/didStartMain-code/terminalFirst/presented': 700 + 10 * i, 'ellapsed': 900 },
		marks: { 'code/terminalFirst/presented': 1000 * i + 800 + 10 * i, 'code/terminalFirst/prompt': 1000 * i + 1000 },
	}));
	runs.push({ launchEpoch: 4000, durations: {}, marks: undefined, quitMs: 300 });
	const summary = aggregate(runs);
	deepStrictEqual({
		presented: summary.metrics['code/didStartMain-code/terminalFirst/presented'],
		launchPresented: summary.metrics['launch->presented'],
		launchPrompt: summary.metrics['launch->prompt'],
		gap: summary.metrics['prompt-presented'],
		input: summary.metrics['code/didStartMain-code/terminalFirst/input'],
		quit: summary.metrics['quit'],
	}, {
		presented: { values: [710, 720, 730], missing: 1, median: 720, p90: 730 },
		launchPresented: { values: [810, 820, 830], missing: 1, median: 820, p90: 830 },
		launchPrompt: { values: [1000, 1000, 1000], missing: 1, median: 1000, p90: 1000 },
		gap: { values: [190, 180, 170], missing: 0, median: 180, p90: 190 },
		input: { values: [], missing: 4, median: undefined, p90: undefined },
		quit: { values: [300], missing: 0, median: 300, p90: 300 },
	});
	deepStrictEqual(missingMetrics(summary, ['code/didStartMain-code/terminalFirst/input', 'launch->prompt']), ['code/didStartMain-code/terminalFirst/input']);
	strictEqual(formatTable(summary, 'warm', { metrics: { 'launch->prompt': { median: 1100 } } }).split('\n').find(line => line.startsWith('| launch->prompt')), '| launch->prompt | 1000 (1000), missing 1 | -100 |');
});

/** Runs the real shell harness against an isolated fake packaged app; no GUI application is launched. */
function harnessFixture(t) {
	const directory = mkdtempSync(join(tmpdir(), 'terminal-first-harness-'));
	const root = join(directory, 'editor');
	const scripts = join(root, 'scripts');
	const commands = join(directory, 'commands');
	const appDirectory = join(directory, 'VSCode-darwin-arm64', 'VS NOSH.app', 'Contents', 'MacOS');
	for (const path of [scripts, commands, appDirectory, join(root, '.build/terminal-first/perf/user-data-stock/CachedData')]) { mkdirSync(path, { recursive: true }); }
	const sourceScripts = dirname(fileURLToPath(import.meta.url));
	for (const name of ['terminal-first-perf.sh', 'terminal-first-perf.mjs']) { copyFileSync(join(sourceScripts, name), join(scripts, name)); }
	const executable = (path, contents) => writeFileSync(path, contents, { mode: 0o755 });
	executable(join(commands, 'git'), '#!/bin/sh\ncase "$*" in *rev-parse*) printf "fixture\\n";; esac\n');
	// Accelerate only the harness polling deadlines, leaving the fake app and real clock untouched.
	executable(join(commands, 'sleep'), '#!/bin/sh\nexec /bin/sleep 0.03\n');
	executable(join(commands, 'osascript'), `#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
const args = process.argv.slice(2);
writeFileSync(process.env.HARNESS_QUIT_REQUEST, JSON.stringify(args));
const started = Date.now();
process.kill(Number(args.at(-1)), 'SIGTERM');
process.stdout.write(String(started));
`);
	executable(join(appDirectory, 'VS NOSH'), `#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
writeFileSync(process.env.HARNESS_APP_PID, String(process.pid));
if (process.env.HARNESS_MODE === 'hang') {
	setInterval(() => {}, 1000);
} else {
	const markerIndex = process.argv.indexOf('--prof-duration-markers-file');
	const markersFile = process.argv[markerIndex + 1];
	const now = Date.now();
	writeFileSync(markersFile + '.terminalFirst.json', JSON.stringify({ marks: { 'code/terminalFirst/presented': now, 'code/terminalFirst/prompt': now + 1 } }));
	writeFileSync(markersFile, 'ellapsed\\t100\\n');
	if (process.env.HARNESS_MODE === 'quit') { setInterval(() => {}, 1000); }
}
`);
	const appPidFile = join(directory, 'app.pid');
	const quitRequestFile = join(directory, 'quit.json');
	t.after(() => {
		try { process.kill(Number(readFileSync(appPidFile, 'utf8')), 'SIGKILL'); } catch { /* Already exited. */ }
		rmSync(directory, { recursive: true, force: true });
	});
	return {
		appPid: () => Number(readFileSync(appPidFile, 'utf8')),
		quitRequest: () => JSON.parse(readFileSync(quitRequestFile, 'utf8')),
		run: (mode, ...args) => promisify(execFile)('bash', [join(scripts, 'terminal-first-perf.sh'), '--runs', '1', ...args], {
			env: { ...process.env, PATH: `${commands}:${process.env.PATH}`, HARNESS_MODE: mode, HARNESS_APP_PID: appPidFile, HARNESS_QUIT_REQUEST: quitRequestFile },
			timeout: 10000,
		}),
	};
}

test('the shell harness fails when input never becomes usable', async t => {
	const fixture = harnessFixture(t);
	let stderr = '';
	try { await fixture.run('no-input'); } catch (error) { stderr = error.stderr; }
	strictEqual(stderr.includes('Marks never fired in at least two runs: launch->input'), true);
});

test('the shell harness bounds a hung startup and terminates its own process', async t => {
	const fixture = harnessFixture(t);
	let stderr = '';
	try { await fixture.run('hang'); } catch (error) { stderr = error.stderr; }
	let alive = true;
	try { process.kill(fixture.appPid(), 0); } catch { alive = false; }
	deepStrictEqual({ timeout: stderr.includes('Startup exceeded 90 seconds'), alive }, { timeout: true, alive: false });
});

test('quit requests target the exact launched process', async t => {
	const fixture = harnessFixture(t);
	await fixture.run('quit', '--quit');
	const request = fixture.quitRequest();
	deepStrictEqual({ pid: Number(request.at(-1)), targeted: request[3].includes('runningApplicationWithProcessIdentifier'), clock: request[3].includes('Date.now()') }, { pid: fixture.appPid(), targeted: true, clock: true });
});
