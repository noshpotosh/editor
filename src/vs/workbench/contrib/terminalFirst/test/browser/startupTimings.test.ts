/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { strictEqual } from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { LifecyclePhase } from '../../../../services/lifecycle/common/lifecycle.js';
import { renderStartupMarks } from '../../browser/startupTimings.js';

suite('Terminal First startup marks', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

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
