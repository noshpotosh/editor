/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Aggregates the per-run files that scripts/terminal-first-perf.sh collects into medians and
// p90s, prints a Markdown table for docs/specs/07, and appends a history row.
// Usage: node scripts/terminal-first-perf.mjs aggregate <runDir> --label <text> [--baseline <summary.json>] [--history <file>]

import { readFileSync, readdirSync, writeFileSync, appendFileSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';

/** Duration pairs the harness asks the app to report; `ellapsed` is upstream's start-to-workbench number. */
export const DURATION_MARKERS = ['code/didStartMain-code/terminalFirst/presented', 'code/didStartMain-code/terminalFirst/prompt', 'code/didStartMain-code/terminalFirst/input', 'ellapsed'];

/** Fork marks measured from the launcher's own clock, so Electron boot is included. */
const LAUNCH_MARKS = ['code/terminalFirst/presented', 'code/terminalFirst/prompt', 'code/terminalFirst/input'];

/** Parses one upstream `--prof-duration-markers-file` line: alternating marker and millisecond columns. */
export function parseDurations(tsv) {
	const result = {};
	for (const line of tsv.split('\n')) {
		const columns = line.trim().split('\t');
		for (let i = 0; i + 1 < columns.length; i += 2) {
			const value = Number(columns[i + 1]);
			if (columns[i] && Number.isFinite(value)) { result[columns[i]] = value; }
		}
	}
	return result;
}

export function median(values) {
	const sorted = [...values].sort((a, b) => a - b);
	if (!sorted.length) { return undefined; }
	const middle = Math.floor(sorted.length / 2);
	return sorted.length % 2 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}

export function p90(values) {
	const sorted = [...values].sort((a, b) => a - b);
	if (!sorted.length) { return undefined; }
	return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.9) - 1)];
}

/**
 * Turns the runs into `{ metric: { values, median, p90, missing } }`.
 * A run is `{ durations, launchEpoch, marks, quitMs }`; `marks` are epoch milliseconds from the fork's JSON dump.
 */
export function aggregate(runs) {
	const metrics = {};
	const add = (name, value) => {
		const metric = metrics[name] ??= { values: [], missing: 0 };
		if (typeof value === 'number' && Number.isFinite(value)) { metric.values.push(Math.round(value)); } else { metric.missing++; }
	};
	for (const run of runs) {
		for (const marker of DURATION_MARKERS) { add(marker, run.durations?.[marker]); }
		for (const markName of LAUNCH_MARKS) {
			const epoch = run.marks?.[markName];
			add(`launch->${basename(markName)}`, typeof epoch === 'number' && typeof run.launchEpoch === 'number' ? epoch - run.launchEpoch : undefined);
		}
		if (run.marks?.['code/terminalFirst/prompt'] !== undefined && run.marks?.['code/terminalFirst/presented'] !== undefined) {
			add('prompt-presented', run.marks['code/terminalFirst/prompt'] - run.marks['code/terminalFirst/presented']);
		}
		if (run.quitMs !== undefined) { add('quit', run.quitMs); }
	}
	for (const metric of Object.values(metrics)) {
		metric.median = median(metric.values);
		metric.p90 = p90(metric.values);
	}
	return { runs: runs.length, metrics };
}

/** Reads the files one harness invocation wrote into `runDir`. */
export function readRuns(runDir) {
	const runs = [];
	for (const file of readdirSync(runDir).filter(name => /^run-\d+\.launch$/.test(name)).sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]))) {
		const stem = file.replace(/\.launch$/, '');
		const read = (name) => existsSync(join(runDir, name)) ? readFileSync(join(runDir, name), 'utf8') : undefined;
		const tsv = read(`${stem}.tsv`);
		const json = read(`${stem}.tsv.terminalFirst.json`);
		const quit = read(`${stem}.quit`);
		runs.push({
			launchEpoch: Number(read(file)),
			durations: tsv ? parseDurations(tsv) : undefined,
			marks: json ? JSON.parse(json).marks : undefined,
			quitMs: quit ? Number(quit) : undefined,
		});
	}
	return runs;
}

const shortName = name => name.replace('code/didStartMain-code/terminalFirst/', 'main->').replace('code/terminalFirst/', '');

/** A Markdown table of medians with p90 in parentheses, plus deltas against a baseline summary when given. */
export function formatTable(summary, label, baseline) {
	const lines = [`| Metric (${label}, ${summary.runs} runs) | Median ms (p90) |${baseline ? ' vs baseline |' : ''}`, `| --- | ---: |${baseline ? ' ---: |' : ''}`];
	for (const [name, metric] of Object.entries(summary.metrics)) {
		if (metric.median === undefined) {
			lines.push(`| ${shortName(name)} | missing in ${metric.missing} runs |${baseline ? ' |' : ''}`);
			continue;
		}
		const base = baseline?.metrics?.[name]?.median;
		const delta = base === undefined ? '' : ` ${metric.median - base >= 0 ? '+' : ''}${metric.median - base} |`;
		lines.push(`| ${shortName(name)} | ${metric.median} (${metric.p90})${metric.missing ? `, missing ${metric.missing}` : ''} |${delta}`);
	}
	return lines.join('\n') + '\n';
}

/** Names of metrics that no run reported at least twice; the shell script fails on these. */
export function missingMetrics(summary, expected) {
	return expected.filter(name => (summary.metrics[name]?.missing ?? summary.runs) >= Math.min(2, summary.runs));
}

function main(argv) {
	const [command, runDir, ...rest] = argv;
	if (command !== 'aggregate' || !runDir) {
		console.error('Usage: node scripts/terminal-first-perf.mjs aggregate <runDir> --label <text> [--baseline <summary.json>] [--history <file>] [--expect <metric,...>]');
		process.exit(2);
	}
	const option = (name) => { const index = rest.indexOf(name); return index >= 0 ? rest[index + 1] : undefined; };
	const label = option('--label') ?? basename(runDir);
	const baselineFile = option('--baseline');
	const baseline = baselineFile ? JSON.parse(readFileSync(baselineFile, 'utf8')) : undefined;
	const summary = aggregate(readRuns(runDir));
	summary.label = label;
	writeFileSync(join(runDir, 'summary.json'), JSON.stringify(summary, null, '\t'));
	process.stdout.write(formatTable(summary, label, baseline));
	const history = option('--history');
	if (history) {
		const row = [new Date().toISOString(), label, summary.runs, ...Object.entries(summary.metrics).map(([name, metric]) => `${shortName(name)}=${metric.median ?? 'NA'}`)].join('\t') + '\n';
		if (!existsSync(history)) { appendFileSync(history, 'date\tlabel\truns\tmedians...\n'); }
		appendFileSync(history, row);
	}
	const expected = option('--expect')?.split(',').filter(Boolean) ?? [];
	const missing = missingMetrics(summary, expected);
	if (missing.length) {
		console.error(`Marks never fired in at least two runs: ${missing.join(', ')}`);
		process.exit(1);
	}
}

if (process.argv[1] && basename(process.argv[1]) === 'terminal-first-perf.mjs') {
	main(process.argv.slice(2));
}
