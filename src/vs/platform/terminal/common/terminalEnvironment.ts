/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IProcessEnvironment, isMacintosh, isWindows, language, OperatingSystem, OS } from '../../../base/common/platform.js';
import { IShellLaunchConfig, ITerminalEnvironment, TerminalShellType, PosixShellType, WindowsShellType, GeneralShellType } from './terminal.js';
import { sanitizeProcessEnvironment } from '../../../base/common/processes.js';
import { isString } from '../../../base/common/types.js';

/**
 * Aggressively escape non-windows paths to prepare for being sent to a shell. This will do some
 * escaping inaccurately to be careful about possible script injection via the file path. For
 * example, we're trying to prevent this sort of attack: `/foo/file$(echo evil)`.
 */
export function escapeNonWindowsPath(path: string, shellType?: TerminalShellType): string {
	let newPath = path;
	if (newPath.includes('\\')) {
		newPath = newPath.replace(/\\/g, '\\\\');
	}

	// Define shell-specific escaping rules
	interface ShellEscapeConfig {
		// How to handle paths with both single and double quotes
		bothQuotes: (path: string) => string;
		// How to handle paths with only single quotes
		singleQuotes: (path: string) => string;
		// How to handle paths with no single quotes (may have double quotes)
		noSingleQuotes: (path: string) => string;
	}

	let escapeConfig: ShellEscapeConfig;
	switch (shellType) {
		case PosixShellType.Bash:
		case PosixShellType.Sh:
		case PosixShellType.Zsh:
		case WindowsShellType.GitBash:
			escapeConfig = {
				bothQuotes: (path) => `$'${path.replace(/'/g, '\\\'')}'`,
				// A backslash does not escape inside single quotes, so close, escape, and reopen them
				singleQuotes: (path) => `'${path.replace(/'/g, '\'\\\'\'')}'`,
				noSingleQuotes: (path) => `'${path}'`
			};
			break;
		case PosixShellType.Fish:
			escapeConfig = {
				bothQuotes: (path) => `"${path.replace(/"/g, '\\"')}"`,
				singleQuotes: (path) => `'${path.replace(/'/g, '\\\'')}'`,
				noSingleQuotes: (path) => `'${path}'`
			};
			break;
		case GeneralShellType.PowerShell:
			// PowerShell should be handled separately in preparePathForShell
			// but if we get here, use PowerShell escaping
			escapeConfig = {
				bothQuotes: (path) => `"${path.replace(/"/g, '`"')}"`,
				singleQuotes: (path) => `'${path.replace(/'/g, '\'\'')}'`,
				noSingleQuotes: (path) => `'${path}'`
			};
			break;
		default:
			// Default to POSIX shell escaping for unknown shells
			escapeConfig = {
				bothQuotes: (path) => `$'${path.replace(/'/g, '\\\'')}'`,
				singleQuotes: (path) => `'${path.replace(/'/g, '\'\\\'\'')}'`,
				noSingleQuotes: (path) => `'${path}'`
			};
			break;
	}

	// Remove dangerous characters except single and double quotes, which we'll escape properly
	const bannedChars = /[\`\$\|\&\>\~\#\!\^\*\;\<]/g;
	newPath = newPath.replace(bannedChars, '');

	// Apply shell-specific escaping based on quote content
	if (newPath.includes('\'') && newPath.includes('"')) {
		return escapeConfig.bothQuotes(newPath);
	} else if (newPath.includes('\'')) {
		return escapeConfig.singleQuotes(newPath);
	} else {
		return escapeConfig.noSingleQuotes(newPath);
	}
}

/**
 * Collapses the user's home directory into `~` if it exists within the path, this gives a shorter
 * path that is more suitable within the context of a terminal.
 */
export function collapseTildePath(path: string | undefined, userHome: string | undefined, separator: string): string {
	if (!path) {
		return '';
	}
	if (!userHome) {
		return path;
	}
	// Trim the trailing separator from the end if it exists
	if (userHome.match(/[\/\\]$/)) {
		userHome = userHome.slice(0, userHome.length - 1);
	}
	const normalizedPath = path.replace(/\\/g, '/').toLowerCase();
	const normalizedUserHome = userHome.replace(/\\/g, '/').toLowerCase();
	if (!normalizedPath.includes(normalizedUserHome)) {
		return path;
	}
	return `~${separator}${path.slice(userHome.length + 1)}`;
}

/**
 * Sanitizes a cwd string, removing any wrapping quotes and making the Windows drive letter
 * uppercase.
 * @param cwd The directory to sanitize.
 */
export function sanitizeCwd(cwd: string): string {
	// Sanity check that the cwd is not wrapped in quotes (see #160109)
	if (cwd.match(/^['"].*['"]$/)) {
		cwd = cwd.substring(1, cwd.length - 1);
	}
	// Make the drive letter uppercase on Windows (see #9448)
	if (OS === OperatingSystem.Windows && cwd && cwd[1] === ':') {
		return cwd[0].toUpperCase() + cwd.substring(1);
	}
	return cwd;
}

/**
 * Determines whether the given shell launch config should use the environment variable collection.
 * @param slc The shell launch config to check.
 */
export function shouldUseEnvironmentVariableCollection(slc: IShellLaunchConfig): boolean {
	return !slc.strictEnv;
}

export function mergeEnvironments(parent: IProcessEnvironment, other: ITerminalEnvironment | undefined): void {
	if (!other) {
		return;
	}

	// On Windows apply the new values ignoring case, while still retaining
	// the case of the original key.
	if (isWindows) {
		for (const configKey in other) {
			let actualKey = configKey;
			for (const envKey in parent) {
				if (configKey.toLowerCase() === envKey.toLowerCase()) {
					actualKey = envKey;
					break;
				}
			}
			const value = other[configKey];
			if (value !== undefined) {
				_mergeEnvironmentValue(parent, actualKey, value);
			}
		}
	} else {
		Object.keys(other).forEach((key) => {
			const value = other[key];
			if (value !== undefined) {
				_mergeEnvironmentValue(parent, key, value);
			}
		});
	}
}

function _mergeEnvironmentValue(env: ITerminalEnvironment, key: string, value: string | null): void {
	if (isString(value)) {
		env[key] = value;
	} else {
		delete env[key];
	}
}

export function addTerminalEnvironmentKeys(env: IProcessEnvironment, version: string | undefined, locale: string | undefined, detectLocale: 'auto' | 'off' | 'on'): void {
	env.TERM_PROGRAM = 'vscode';
	if (version) {
		env.TERM_PROGRAM_VERSION = version;
	}
	if (shouldSetLangEnvVariable(env, detectLocale)) {
		env.LANG = getLangEnvVariable(locale);
	}
	env.COLORTERM = 'truecolor';
}

function mergeNonNullKeys(env: IProcessEnvironment, other: ITerminalEnvironment | undefined) {
	if (!other) {
		return;
	}
	for (const key of Object.keys(other)) {
		const value = other[key];
		if (value !== undefined && value !== null) {
			env[key] = value;
		}
	}
}

async function resolveConfigurationVariables(variableResolver: VariableResolver, env: ITerminalEnvironment): Promise<ITerminalEnvironment> {
	await Promise.all(Object.entries(env).map(async ([key, value]) => {
		if (isString(value)) {
			try {
				env[key] = await variableResolver(value);
			} catch (e) {
				env[key] = value;
			}
		}
	}));

	return env;
}

export function shouldSetLangEnvVariable(env: IProcessEnvironment, detectLocale: 'auto' | 'off' | 'on'): boolean {
	if (detectLocale === 'on') {
		return true;
	}
	if (detectLocale === 'auto') {
		const lang = env.LANG;
		return !lang || (lang.search(/\.UTF\-8$/) === -1 && lang.search(/\.utf8$/) === -1 && lang.search(/\.euc.+/) === -1);
	}
	return false; // 'off'
}

export function getLangEnvVariable(locale?: string): string {
	const parts = locale ? locale.split('-') : [];
	const n = parts.length;
	if (n === 0) {
		// Fallback to en_US if the locale is unknown
		return 'en_US.UTF-8';
	}
	if (n === 1) {
		// The local may only contain the language, not the variant, if this is the case guess the
		// variant such that it can be used as a valid $LANG variable. The language variant chosen
		// is the original and/or most prominent with help from
		// https://stackoverflow.com/a/2502675/1156119
		// The list of locales was generated by running `locale -a` on macOS
		const languageVariants: { [key: string]: string } = {
			af: 'ZA',
			am: 'ET',
			be: 'BY',
			bg: 'BG',
			ca: 'ES',
			cs: 'CZ',
			da: 'DK',
			// de: 'AT',
			// de: 'CH',
			de: 'DE',
			el: 'GR',
			// en: 'AU',
			// en: 'CA',
			// en: 'GB',
			// en: 'IE',
			// en: 'NZ',
			en: 'US',
			es: 'ES',
			et: 'EE',
			eu: 'ES',
			fi: 'FI',
			// fr: 'BE',
			// fr: 'CA',
			// fr: 'CH',
			fr: 'FR',
			he: 'IL',
			hr: 'HR',
			hu: 'HU',
			hy: 'AM',
			is: 'IS',
			// it: 'CH',
			it: 'IT',
			ja: 'JP',
			kk: 'KZ',
			ko: 'KR',
			lt: 'LT',
			// nl: 'BE',
			nl: 'NL',
			no: 'NO',
			pl: 'PL',
			pt: 'BR',
			// pt: 'PT',
			ro: 'RO',
			ru: 'RU',
			sk: 'SK',
			sl: 'SI',
			sr: 'YU',
			sv: 'SE',
			tr: 'TR',
			uk: 'UA',
			zh: 'CN',
		};
		if (Object.prototype.hasOwnProperty.call(languageVariants, parts[0])) {
			parts.push(languageVariants[parts[0]]);
		}
	} else {
		// Ensure the variant is uppercase to be a valid $LANG
		parts[1] = parts[1].toUpperCase();
	}
	return parts.join('_') + '.UTF-8';
}

export type VariableResolver = (str: string) => Promise<string>;

export async function createTerminalEnvironment(
	shellLaunchConfig: IShellLaunchConfig,
	envFromConfig: ITerminalEnvironment | undefined,
	variableResolver: VariableResolver | undefined,
	version: string | undefined,
	detectLocale: 'auto' | 'off' | 'on',
	baseEnv: IProcessEnvironment
): Promise<IProcessEnvironment> {
	// Create a terminal environment based on settings, launch config and permissions
	const env: IProcessEnvironment = {};
	if (shellLaunchConfig.strictEnv) {
		// strictEnv is true, only use the requested env (ignoring null entries)
		mergeNonNullKeys(env, shellLaunchConfig.env);
	} else {
		// Merge process env with the env from config and from shellLaunchConfig
		mergeNonNullKeys(env, baseEnv);

		const allowedEnvFromConfig = { ...envFromConfig };

		// Resolve env vars from config and shell
		if (variableResolver) {
			if (allowedEnvFromConfig) {
				await resolveConfigurationVariables(variableResolver, allowedEnvFromConfig);
			}
			if (shellLaunchConfig.env) {
				await resolveConfigurationVariables(variableResolver, shellLaunchConfig.env);
			}
		}

		// Workaround for https://github.com/microsoft/vscode/issues/204005
		// We should restore the following environment variables when a user
		// launches the application using the CLI so that integrated terminal
		// can still inherit these variables.
		// We are not bypassing the restrictions implied in https://github.com/electron/electron/pull/40770
		// since this only affects integrated terminal and not the application itself.
		if (isMacintosh) {
			// Restore NODE_OPTIONS if it was set
			if (env.VSCODE_NODE_OPTIONS) {
				env.NODE_OPTIONS = env.VSCODE_NODE_OPTIONS;
				delete env.VSCODE_NODE_OPTIONS;
			}

			// Restore NODE_REPL_EXTERNAL_MODULE if it was set
			if (env.VSCODE_NODE_REPL_EXTERNAL_MODULE) {
				env.NODE_REPL_EXTERNAL_MODULE = env.VSCODE_NODE_REPL_EXTERNAL_MODULE;
				delete env.VSCODE_NODE_REPL_EXTERNAL_MODULE;
			}
		}

		// Sanitize the environment, removing any undesirable VS Code and Electron environment
		// variables
		sanitizeProcessEnvironment(env, 'VSCODE_IPC_HOOK_CLI');

		// Merge config (settings) and ShellLaunchConfig environments
		mergeEnvironments(env, allowedEnvFromConfig);
		mergeEnvironments(env, shellLaunchConfig.env);

		// Adding other env keys necessary to create the process
		addTerminalEnvironmentKeys(env, version, language, detectLocale);
	}
	return env;
}
