/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Codicon } from '../../../../base/common/codicons.js';
import { localize } from '../../../../nls.js';
import { registerIcon } from '../../../../platform/theme/common/iconRegistry.js';

export const sessionShellIcon = registerIcon('terminal-first-session-shell', Codicon.terminal, localize('sessionShellIcon', "Icon for a session tab that shows its shell."));
export const sessionEditorIcon = registerIcon('terminal-first-session-editor', Codicon.file, localize('sessionEditorIcon', "Icon for a session tab that shows its editor."));
export const sessionDirtyIcon = registerIcon('terminal-first-session-dirty', Codicon.circleFilled, localize('sessionDirtyIcon', "Icon for a session tab with unsaved changes."));
export const sessionCloseIcon = registerIcon('terminal-first-session-close', Codicon.closeCompact, localize('sessionCloseIcon', "Icon for closing a session."));
export const sessionNewIcon = registerIcon('terminal-first-session-new', Codicon.add, localize('sessionNewIcon', "Icon for creating a session."));
export const sessionNotificationsIcon = registerIcon('terminal-first-session-notifications', Codicon.bellDot, localize('sessionNotificationsIcon', "Icon for the session strip notifications button."));
export const fileBrowserPromptIcon = registerIcon('terminal-first-file-browser-prompt', Codicon.chevronRight, localize('fileBrowserPromptIcon', "Icon for the file browser filter prompt."));
export const fileBrowserMarkedIcon = registerIcon('terminal-first-file-browser-marked', Codicon.check, localize('fileBrowserMarkedIcon', "Icon for a marked file browser row."));
