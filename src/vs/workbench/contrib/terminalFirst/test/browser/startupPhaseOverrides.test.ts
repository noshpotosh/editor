/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { deepStrictEqual } from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { deferredStartupContributionIds, deferStartupContribution } from '../../../../../platform/terminalFirst/common/startupPhaseOverrides.js';
import { LifecyclePhase } from '../../../../services/lifecycle/common/lifecycle.js';
import { AgentHostChatDebugContribution } from '../../../chat/browser/chatDebug/agentHostChatDebugProvider.js';
import { CodexStatusBarEntry } from '../../../chat/browser/chatStatus/codexStatusEntry.js';
import { ChatPetContextContribution } from '../../../chat/browser/chatPetAchievements.contribution.js';

suite('Terminal First startup phase overrides', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	/** Every deferred id must still be the id of a real contribution class, so upstream renames are caught here. */
	const knownIds = new Set<string>([AgentHostChatDebugContribution.ID, CodexStatusBarEntry.ID, ChatPetContextContribution.ID]);

	test('listed BlockRestore contributions move after restore; everything else keeps its phase', () => {
		const [deferred] = deferredStartupContributionIds();
		deepStrictEqual({
			unknownIds: deferredStartupContributionIds().filter(id => !knownIds.has(id)),
			deferred: deferredStartupContributionIds().map(id => deferStartupContribution(id, LifecyclePhase.Ready)),
			blockStartupKept: deferStartupContribution(deferred, LifecyclePhase.Starting),
			otherKept: deferStartupContribution('workbench.contrib.somethingElse', LifecyclePhase.Ready),
			anonymousKept: deferStartupContribution(undefined, LifecyclePhase.Ready),
		}, { unknownIds: [], deferred: [...knownIds].map(() => LifecyclePhase.Restored), blockStartupKept: LifecyclePhase.Starting, otherKept: LifecyclePhase.Ready, anonymousKept: LifecyclePhase.Ready });
	});
});
