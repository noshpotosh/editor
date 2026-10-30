/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { deepStrictEqual } from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { DEFAULT_SPACE_ID, nextSpaceName, parseSpaceLayoutKey, spaceLayoutKey } from '../../common/spaces.js';
import { defaultSpacePresets, describeSpacePreset, validateSpacePresets } from '../../common/spacePresets.js';

suite('Terminal First - spaces', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('layout keys keep the first space on the session id and round-trip the others', () => {
		deepStrictEqual({
			defaultKey: spaceLayoutKey('session-1', DEFAULT_SPACE_ID),
			otherKey: spaceLayoutKey('session-1', 'review'),
			parsedDefault: parseSpaceLayoutKey('session-1'),
			parsedOther: parseSpaceLayoutKey('session-1#review'),
			parsedNested: parseSpaceLayoutKey('session-1#a#b'),
			names: [nextSpaceName([]), nextSpaceName(['Space 1']), nextSpaceName(['Space 1', 'Review', 'Space 3']), nextSpaceName(['Space 2'])],
		}, {
			defaultKey: 'session-1',
			otherKey: 'session-1#review',
			parsedDefault: { sessionId: 'session-1', spaceId: DEFAULT_SPACE_ID },
			parsedOther: { sessionId: 'session-1', spaceId: 'review' },
			parsedNested: { sessionId: 'session-1', spaceId: 'a#b' },
			names: ['Space 1', 'Space 2', 'Space 2', 'Space 1'],
		});
	});

	test('presets are validated entry by entry and described with readable tile names', () => {
		const valid = validateSpacePresets([
			{ name: ' Review ', tiles: [{ tile: 'editor' }, { tile: 'workbench.view.scm', direction: 'left', size: 0.3, from: 0 }, { tile: 'web:bitbucket', direction: 'diagonal', size: 2, from: 7 }, { tile: '' }, null] },
			{ name: '', tiles: [] },
			{ name: 'No tiles' },
			'junk',
		]);
		deepStrictEqual({
			valid,
			none: [validateSpacePresets(undefined), validateSpacePresets('x')],
			describedDefault: describeSpacePreset(defaultSpacePresets[0], id => id === 'workbench.view.explorer' ? 'Explorer' : undefined),
			describedUnknown: describeSpacePreset({ name: 'x', tiles: [{ tile: 'ext.view' }] }, () => undefined),
		}, {
			valid: [{ name: 'Review', tiles: [{ tile: 'editor', direction: undefined, size: undefined, from: undefined }, { tile: 'workbench.view.scm', direction: 'left', size: 0.3, from: 0 }, { tile: 'web:bitbucket', direction: undefined, size: undefined, from: undefined }] }],
			none: [[], []],
			describedDefault: 'Editor, Explorer, Terminal',
			describedUnknown: 'ext.view',
		});
	});
});
