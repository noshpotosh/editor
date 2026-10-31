/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * This module contains utility functions related to the environment, cwd and paths.
 */

import * as path from '../../../../base/common/path.js';
import { URI, uriToFsPath } from '../../../../base/common/uri.js';
import { IWorkspaceContextService, IWorkspaceFolder } from '../../../../platform/workspace/common/workspace.js';
import { IConfigurationResolverService } from '../../../services/configurationResolver/common/configurationResolver.js';
import { IShellLaunchConfig, ITerminalBackend, ShellIntegrationTimeoutOverride, TerminalSettingId, TerminalShellType, WindowsShellType } from '../../../../platform/terminal/common/terminal.js';
import { IProcessEnvironment, isWindows, OperatingSystem } from '../../../../base/common/platform.js';
import { escapeNonWindowsPath, sanitizeCwd, type VariableResolver } from '../../../../platform/terminal/common/terminalEnvironment.js';
import { isNumber, isString } from '../../../../base/common/types.js';
import { IHistoryService } from '../../../services/history/common/history.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import type { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';

export async function getCwd(
	shell: IShellLaunchConfig,
	userHome: string | undefined,
	variableResolver: VariableResolver | undefined,
	root: URI | undefined,
	customCwd: string | undefined,
	logService?: ILogService
): Promise<string> {
	if (shell.cwd) {
		const unresolved = (typeof shell.cwd === 'object') ? shell.cwd.fsPath : shell.cwd;
		const resolved = await _resolveCwd(unresolved, variableResolver);
		return sanitizeCwd(resolved || unresolved);
	}

	let cwd: string | undefined;

	if (!shell.ignoreConfigurationCwd && customCwd) {
		if (variableResolver) {
			customCwd = await _resolveCwd(customCwd, variableResolver, logService);
		}
		if (customCwd) {
			if (path.isAbsolute(customCwd)) {
				cwd = customCwd;
			} else if (root) {
				cwd = path.join(root.fsPath, customCwd);
			}
		}
	}

	// If there was no custom cwd or it was relative with no workspace
	if (!cwd) {
		cwd = root ? root.fsPath : userHome || '';
	}

	return sanitizeCwd(cwd);
}

async function _resolveCwd(cwd: string, variableResolver: VariableResolver | undefined, logService?: ILogService): Promise<string | undefined> {
	if (variableResolver) {
		try {
			return await variableResolver(cwd);
		} catch (e) {
			logService?.error('Could not resolve terminal cwd', e);
			return undefined;
		}
	}
	return cwd;
}

export { addTerminalEnvironmentKeys, createTerminalEnvironment, getLangEnvVariable, mergeEnvironments, shouldSetLangEnvVariable } from '../../../../platform/terminal/common/terminalEnvironment.js';
export type { VariableResolver } from '../../../../platform/terminal/common/terminalEnvironment.js';

export function createVariableResolver(lastActiveWorkspace: IWorkspaceFolder | undefined, env: IProcessEnvironment, configurationResolverService: IConfigurationResolverService | undefined): VariableResolver | undefined {
	if (!configurationResolverService) {
		return undefined;
	}
	return (str) => configurationResolverService.resolveWithEnvironment(env, lastActiveWorkspace, str);
}

/**
 * Takes a path and returns the properly escaped path to send to a given shell. On Windows, this
 * included trying to prepare the path for WSL if needed.
 *
 * @param originalPath The path to be escaped and formatted.
 * @param executable The executable off the shellLaunchConfig.
 * @param title The terminal's title.
 * @param shellType The type of shell the path is being sent to.
 * @param backend The backend for the terminal.
 * @param isWindowsFrontend Whether the frontend is Windows, this is only exposed for injection via
 * tests.
 * @returns An escaped version of the path to be executed in the terminal.
 */
export async function preparePathForShell(resource: string | URI, executable: string | undefined, title: string, shellType: TerminalShellType | undefined, backend: Pick<ITerminalBackend, 'getWslPath'> | undefined, os: OperatingSystem | undefined, isWindowsFrontend: boolean = isWindows): Promise<string> {
	let originalPath: string;
	if (isString(resource)) {
		originalPath = resource;
	} else {
		originalPath = resource.fsPath;
		// Apply backend OS-specific formatting to the path since URI.fsPath uses the frontend's OS
		if (isWindowsFrontend && os !== OperatingSystem.Windows) {
			originalPath = originalPath.replace(/\\/g, '\/');
		} else if (!isWindowsFrontend && os === OperatingSystem.Windows) {
			originalPath = originalPath.replace(/\//g, '\\');
		}
	}

	// Control characters such as a carriage return would submit the line early
	originalPath = originalPath.replace(/[\x00-\x1F\x7F-\x9F]/g, '');

	if (!executable) {
		return originalPath;
	}

	const hasSpace = originalPath.includes(' ');
	const hasParens = originalPath.includes('(') || originalPath.includes(')');

	const pathBasename = path.basename(executable, '.exe');
	const isPowerShell = pathBasename === 'pwsh' ||
		title === 'pwsh' ||
		pathBasename === 'powershell' ||
		title === 'powershell';

	if (isPowerShell && (hasSpace || originalPath.includes('\''))) {
		return `& '${originalPath.replace(/'/g, '\'\'')}'`;
	}

	if (hasParens && isPowerShell) {
		return `& '${originalPath}'`;
	}

	if (os === OperatingSystem.Windows) {
		// 17063 is the build number where wsl path was introduced.
		// Update Windows uriPath to be executed in WSL.
		if (shellType !== undefined) {
			if (shellType === WindowsShellType.GitBash) {
				return escapeNonWindowsPath(originalPath.replace(/\\/g, '/'), shellType);
			}
			else if (shellType === WindowsShellType.Wsl) {
				return backend?.getWslPath(originalPath, 'win-to-unix') || originalPath;
			}
			else if (hasSpace) {
				return `"${originalPath}"`;
			}
			return originalPath;
		}
		const lowerExecutable = executable.toLowerCase();
		if (lowerExecutable.includes('wsl') || (lowerExecutable.includes('bash.exe') && !lowerExecutable.toLowerCase().includes('git'))) {
			return backend?.getWslPath(originalPath, 'win-to-unix') || originalPath;
		} else if (hasSpace) {
			return `"${originalPath}"`;
		}
		return originalPath;
	}

	return escapeNonWindowsPath(originalPath, shellType);
}

export function getWorkspaceForTerminal(cwd: URI | string | undefined, workspaceContextService: IWorkspaceContextService, historyService: IHistoryService): IWorkspaceFolder | undefined {
	const cwdUri = isString(cwd) ? URI.parse(cwd) : cwd;
	let workspaceFolder = cwdUri ? workspaceContextService.getWorkspaceFolder(cwdUri) ?? undefined : undefined;
	if (!workspaceFolder) {
		// fallback to last active workspace if cwd is not available or it is not in workspace
		// TOOD: last active workspace is known to be unreliable, we should remove this fallback eventually
		const activeWorkspaceRootUri = historyService.getLastActiveWorkspaceRoot();
		workspaceFolder = activeWorkspaceRootUri ? workspaceContextService.getWorkspaceFolder(activeWorkspaceRootUri) ?? undefined : undefined;
	}
	return workspaceFolder;
}

export async function getUriLabelForShell(uri: URI | string, backend: Pick<ITerminalBackend, 'getWslPath'>, shellType?: TerminalShellType, os?: OperatingSystem, isWindowsFrontend: boolean = isWindows): Promise<string> {
	let path = isString(uri) ? uri : uri.fsPath;
	if (os === OperatingSystem.Windows) {
		if (shellType === WindowsShellType.Wsl) {
			return backend.getWslPath(path.replaceAll('/', '\\'), 'win-to-unix');
		} else if (shellType === WindowsShellType.GitBash) {
			// Convert \ to / and replace 'c:\' with '/c/'.
			return path.replaceAll('\\', '/').replace(/^([a-zA-Z]):\//, '/$1/');
		} else {
			// If the frontend is not Windows but the terminal is, convert / to \.
			path = isString(uri) ? path : uriToFsPath(uri, true);
			return !isWindowsFrontend ? path.replaceAll('/', '\\') : path;
		}
	} else {
		// If the frontend is Windows but the terminal is not, convert \ to /.
		return isWindowsFrontend ? path.replaceAll('\\', '/') : path;
	}
}

/**
 * Gets the unified duration to wait for shell integration after the terminal launches before
 * declaring the terminal lacks shell integration.
 */
export function getShellIntegrationTimeout(
	configurationService: IConfigurationService,
	siInjectionEnabled: boolean,
	isRemote: boolean,
	processReadyTimestamp?: number
): number {
	const timeoutValue = configurationService.getValue<unknown>(TerminalSettingId.ShellIntegrationTimeout);
	let timeoutMs: number;
	if (isNumber(timeoutValue) && timeoutValue === ShellIntegrationTimeoutOverride.DisableForTests) {
		// Used for tests
		timeoutMs = 0;
	} else if (!isNumber(timeoutValue) || timeoutValue < 0) {
		timeoutMs = siInjectionEnabled ? 5000 : (isRemote ? 3000 : 2000);
	} else if (timeoutValue === 0) {
		timeoutMs = 0;
	} else {
		timeoutMs = Math.max(timeoutValue, 500);
	}

	// Adjust timeout based on how long the process has already been running
	if (processReadyTimestamp !== undefined) {
		const elapsed = Date.now() - processReadyTimestamp;
		timeoutMs = Math.max(0, timeoutMs - elapsed);
	}

	return timeoutMs;
}
