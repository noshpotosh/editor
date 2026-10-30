/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { test } from 'node:test';
import { deepStrictEqual, strictEqual } from 'node:assert';
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
