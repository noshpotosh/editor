/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { deepStrictEqual, strictEqual } from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { TerminalFirstBrowserKeyRouter } from '../../common/terminalFirstBrowserKeys.js';
import type { IBrowserViewKeyDownEvent } from '../../../browserView/common/browserView.js';
import { runWithFakedTimers } from '../../../../base/test/common/timeTravelScheduler.js';

suite('Terminal First browser shortcuts', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	const input = { type: 'keyDown', code: 'KeyH', key: 'h', control: true, shift: false, alt: false, meta: false, isAutoRepeat: false };

	function route(overrides: Partial<Parameters<TerminalFirstBrowserKeyRouter['forward']>[0]> = {}, router = new TerminalFirstBrowserKeyRouter(true)) {
		const calls: string[] = [];
		const dispatched: IBrowserViewKeyDownEvent[] = [];
		const forwarded = router.forward({ ...input, ...overrides }, {
			preventDefault: () => calls.push('prevent'),
			focusWorkbench: () => calls.push('focus'),
			dispatch: event => { calls.push('dispatch'); dispatched.push(event); },
		});
		return { forwarded, calls, dispatched };
	}

	test('leader transfers focus before dispatch so immediate unmodified keys reach the workbench', () => {
		const result = route({ code: 'Space', key: ' ' });
		strictEqual(result.forwarded, true);
		deepStrictEqual(result.calls, ['prevent', 'focus', 'dispatch']);
		strictEqual(result.dispatched.length, 1);
	});

	test('swap forwards its unmodified continuation or cancellation once while keeping native focus', () => {
		for (const [code, key] of [['KeyH', 'h'], ['KeyJ', 'j'], ['KeyK', 'k'], ['KeyL', 'l'], ['Escape', 'Escape'], ['KeyA', 'a']]) {
			const router = new TerminalFirstBrowserKeyRouter(true);
			deepStrictEqual(route({ code: 'KeyX', key: 'x', alt: true }, router).calls, ['prevent', 'dispatch']);
			deepStrictEqual(route({ code: 'KeyX', key: 'x', alt: true, isAutoRepeat: true }, router).calls, ['prevent']);
			deepStrictEqual(route({ code: 'ControlLeft', key: 'Control' }, router).calls, []);
			deepStrictEqual(route({ code, key, control: false }, router).calls, ['prevent', 'dispatch']);
			deepStrictEqual(route({ code: 'KeyA', key: 'a', control: false }, router).calls, []);
		}
	});

	test('blur, navigation, composition, and the workbench timeout stop claiming page input', async () => {
		await runWithFakedTimers({}, async () => {
			const router = new TerminalFirstBrowserKeyRouter(true);
			const start = () => route({ code: 'KeyX', key: 'x', alt: true }, router);
			start();
			router.reset();
			strictEqual(route({ control: false }, router).forwarded, false);
			start();
			strictEqual(route({ control: false, isComposing: true }, router).forwarded, false);
			strictEqual(route({ control: false }, router).forwarded, false);
			start();
			await new Promise(resolve => setTimeout(resolve, 5001));
			strictEqual(route({ control: false }, router).forwarded, false);
		});
	});

	test('fork-disabled windows leave every input to the upstream path', () => {
		const router = new TerminalFirstBrowserKeyRouter(false);
		for (const overrides of [{ code: 'Space', key: ' ' }, { alt: true, code: 'KeyX' }, { alt: true, code: 'KeyN' }, {}]) {
			deepStrictEqual(route(overrides, router), { forwarded: false, calls: [], dispatched: [] });
		}
	});

	test('a priority shortcut is claimed once and its keyup does not redispatch', () => {
		const router = new TerminalFirstBrowserKeyRouter(true);
		const down = route({ code: 'Space', key: ' ' }, router);
		strictEqual(down.forwarded, true);
		strictEqual(down.dispatched.length, 1);
		deepStrictEqual(route({ type: 'keyUp', code: 'Space', key: ' ' }, router), { forwarded: false, calls: [], dispatched: [] });
	});

	test('pane navigation and tile/space commands bypass page handlers without stealing focus first', () => {
		for (const code of ['KeyH', 'KeyJ', 'KeyK', 'KeyL']) {
			deepStrictEqual(route({ code }).calls, ['prevent', 'dispatch']);
		}
		for (const code of ['Enter', 'KeyE', 'KeyG', 'KeyT', 'KeyB', 'KeyC', 'KeyQ', 'KeyF', 'KeyO', 'Equal', 'KeyH', 'KeyJ', 'KeyK', 'KeyL', 'ArrowLeft', 'ArrowDown', 'ArrowUp', 'ArrowRight', 'KeyN', 'BracketLeft', 'BracketRight', 'Digit1', 'Digit9']) {
			deepStrictEqual(route({ code, alt: true }).calls, ['prevent', 'dispatch'], code);
		}
		for (const code of ['KeyH', 'KeyJ', 'KeyK', 'KeyL']) {
			deepStrictEqual(route({ code, alt: true, shift: true }).calls, ['prevent', 'dispatch']);
		}
	});

	test('preserves text, website shortcuts, native editing, keyup, composition, and AltGraph', () => {
		for (const overrides of [
			{ control: false }, { control: false, code: 'Space', key: ' ' },
			{ control: false, meta: true, code: 'KeyC', key: 'c' },
			{ control: false, alt: true }, { code: 'KeyW', key: 'w' },
			{ shift: true }, { alt: true, code: 'KeyA', key: 'a' },
			{ alt: true, shift: true, code: 'KeyN', key: 'N' },
			{ meta: true, code: 'Space', key: ' ' }, { type: 'keyUp' },
			{ isComposing: true }, { alt: true, modifiers: ['control', 'alt', 'altGr'] },
		]) {
			deepStrictEqual(route(overrides), { forwarded: false, calls: [], dispatched: [] }, JSON.stringify(overrides));
		}
	});

	test('preserves the physical key and repeat metadata when Option changes the produced character', () => {
		deepStrictEqual(route({ alt: true, key: '˙', isAutoRepeat: true }).dispatched, [{
			key: '˙', keyCode: 72, code: 'KeyH', ctrlKey: true, shiftKey: false, altKey: true, metaKey: false, repeat: true,
		}]);
	});
});
