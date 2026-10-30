/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { deepStrictEqual, strictEqual } from 'assert';
import { timeout } from '../../../../../base/common/async.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { upcastPartial } from '../../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { IContext, IContextKeyService, IScopedContextKeyService } from '../../../../../platform/contextkey/common/contextkey.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { TestInstantiationService } from '../../../../../platform/instantiation/test/common/instantiationServiceMock.js';
import { INotificationService } from '../../../../../platform/notification/common/notification.js';
import { GroupDirection, GroupsOrder, IEditorGroup, IEditorGroupsService } from '../../../../services/editor/common/editorGroupsService.js';
import { tileSplitDirection } from '../../common/tileLayout.js';
import { ITerminalFirstService } from '../../../../services/terminalFirst/common/terminalFirst.js';
import { terminalFirstPolicy } from '../../../../services/terminalFirst/common/terminalFirstPolicy.js';
import { TileChrome } from '../../browser/tileChrome.js';
import { createEditorParts, TestFileEditorInput, TestViewsService, workbenchInstantiationService, workbenchTeardown } from '../../../../test/browser/workbenchTestServices.js';
import { TileService, webAppTiles } from '../../browser/tiles.js';
import { IViewTileComposites, ViewTileComposites, ViewTileEditor, ViewTileInput, ViewTileSerializer } from '../../browser/tileEditor.js';
import { ViewContainerHostRegistry } from '../../../../services/views/browser/viewContainerHost.js';
import { localize2 } from '../../../../../nls.js';
import { SyncDescriptor } from '../../../../../platform/instantiation/common/descriptors.js';
import { ServiceCollection } from '../../../../../platform/instantiation/common/serviceCollection.js';
import { ContextKeyService } from '../../../../../platform/contextkey/browser/contextKeyService.js';
import { Registry } from '../../../../../platform/registry/common/platform.js';
import { Extensions as ViewExtensions, IViewContainersRegistry, IViewDescriptorService, IViewsRegistry, ViewContainer, ViewContainerLocation } from '../../../../common/views.js';
import { ViewDescriptorService } from '../../../../services/views/browser/viewDescriptorService.js';
import { IViewsService } from '../../../../services/views/common/viewsService.js';
import { IPaneCompositePartService } from '../../../../services/panecomposite/browser/panecomposite.js';
import { PaneComposite, PaneCompositeDescriptor } from '../../../../browser/panecomposite.js';
import { EditorPaneDescriptor, IEditorPaneRegistry } from '../../../../browser/editor.js';
import { EditorExtensions } from '../../../../common/editor.js';
import { EditorInput } from '../../../../common/editor/editorInput.js';
import { IEditorService } from '../../../../services/editor/common/editorService.js';
import { IEditorOptions, IResourceEditorInput } from '../../../../../platform/editor/common/editor.js';
import { IQuickInputService, IQuickPickItem, IQuickPickSeparator } from '../../../../../platform/quickinput/common/quickInput.js';
import { INativeVimService } from '../../../../../editor/contrib/nativeVim/common/nativeVimService.js';
import { Event } from '../../../../../base/common/event.js';

import { Codicon } from '../../../../../base/common/codicons.js';
import { URI } from '../../../../../base/common/uri.js';
import { ExtensionIdentifier } from '../../../../../platform/extensions/common/extensions.js';
import { IContextMenuService } from '../../../../../platform/contextview/browser/contextView.js';
suite('Terminal First Tiles', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	test('automatic splits prefer the longer axis and fall back only when it fits', () => {
		deepStrictEqual([
			tileSplitDirection({ width: 1200, height: 800 }),
			tileSplitDirection({ width: 500, height: 800 }),
			tileSplitDirection({ width: 400, height: 400 }),
			tileSplitDirection({ width: 400, height: 300 }),
			tileSplitDirection({ width: 1000, height: 100 }),
		], [GroupDirection.RIGHT, GroupDirection.DOWN, GroupDirection.DOWN, undefined, undefined]);
	});

	test('explicit splits do not silently change direction', () => {
		deepStrictEqual([
			tileSplitDirection({ width: 400, height: 800 }, GroupDirection.RIGHT),
			tileSplitDirection({ width: 800, height: 300 }, GroupDirection.DOWN),
			tileSplitDirection({ width: 464, height: 190 }, GroupDirection.RIGHT),
			tileSplitDirection({ width: 230, height: 384 }, GroupDirection.DOWN),
		], [undefined, undefined, GroupDirection.RIGHT, GroupDirection.DOWN]);
	});

	/** A view tile composite cache whose containers instantiate counted fake composites. */
	function viewTileServices() {
		const instantiation = store.add(new TestInstantiationService());
		const created: string[] = [];
		const descriptors = upcastPartial<IViewDescriptorService>({
			onDidChangeViewContainers: () => ({ dispose() { } }),
			getViewContainerById: id => upcastPartial<ViewContainer>({ id }),
			getViewContainerLocation: () => ViewContainerLocation.Sidebar,
			getViewContainerModel: () => undefined!,
		});
		instantiation.stub(IViewDescriptorService, descriptors);
		instantiation.stub(IContextKeyService, upcastPartial<IContextKeyService>({ createScoped: () => upcastPartial<IScopedContextKeyService>({ dispose() { }, createKey: () => ({ set() { }, reset() { }, get: () => undefined }) }) }));
		instantiation.stub(IPaneCompositePartService, upcastPartial<IPaneCompositePartService>({
			getPaneComposite: id => upcastPartial<PaneCompositeDescriptor>({
				instantiate: () => {
					created.push(id);
					let visible = false;
					return upcastPartial<PaneComposite>({ getId: () => id, create: () => { }, isVisible: () => visible, setVisible: value => { visible = value; }, getViewPaneContainer: () => undefined, dispose: () => created.push(`disposed ${id}`) });
				},
			}),
		}));
		instantiation.stub(INativeVimService, upcastPartial<INativeVimService>({ enabled: false, onDidChange: Event.None }));
		instantiation.stub(IContextMenuService, upcastPartial<IContextMenuService>({ onDidShowContextMenu: Event.None, onDidHideContextMenu: Event.None, showContextMenu: () => { } }));
		const composites = store.add(instantiation.createInstance(ViewTileComposites));
		instantiation.stub(IViewTileComposites, composites);
		return { instantiation, composites, created };
	}

	test('view tile identity and serialized state are scoped to the outer session', () => {
		const { instantiation } = viewTileServices();
		const serializer = new ViewTileSerializer();
		const input = store.add(instantiation.createInstance(ViewTileInput, 'workbench.view.extension.sample', 'session-a'));
		const restored = store.add(serializer.deserialize(instantiation, serializer.serialize(input))!);
		const otherSession = store.add(instantiation.createInstance(ViewTileInput, 'workbench.view.extension.sample', 'session-b'));
		const legacy = store.add(serializer.deserialize(instantiation, '{"kind":"scm","sessionId":"a"}')!);
		deepStrictEqual([restored.containerId, restored.sessionId, input.matches(restored), input.matches(otherSession), legacy.containerId], ['workbench.view.extension.sample', 'session-a', true, false, 'workbench.view.scm']);
		deepStrictEqual(['{', '{}', '{"kind":"unknown","sessionId":"a"}'].map(value => serializer.deserialize(instantiation, value)), [undefined, undefined, undefined]);
	});

	test('sessions share one composite per view container until the last tile closes', () => {
		const { instantiation, composites, created } = viewTileServices();
		const detached: string[] = [];
		const first = store.add(instantiation.createInstance(ViewTileInput, 'sample', 'session-a'));
		const second = instantiation.createInstance(ViewTileInput, 'sample', 'session-b');
		const a = composites.acquire('sample', { detach: () => detached.push('a') })!;
		const b = composites.acquire('sample', { detach: () => detached.push('b') })!;
		second.dispose();
		const afterOneClose = [...created];
		first.dispose();
		deepStrictEqual({ shared: a.composite === b.composite, detached, afterOneClose, created }, { shared: true, detached: ['a', 'b'], afterOneClose: ['sample'], created: ['sample', 'disposed sample'] });
	});

	test('view host routing respects enablement, declined containers, and disposal', async () => {
		const registry = store.add(new ViewContainerHostRegistry());
		let enabled = false;
		let opens = 0;
		const registration = store.add(registry.registerResolver(id => id === 'terminal' ? undefined : {
			isEnabled: () => enabled,
			get: () => undefined,
			open: async () => { opens++; return undefined; },
			close: async () => { },
		}));
		strictEqual(registry.get('explorer'), undefined);
		enabled = true;
		await registry.get('explorer')?.open();
		const declined = registry.get('terminal');
		registration.dispose();
		deepStrictEqual([opens, declined, registry.get('explorer')], [1, undefined, undefined]);
	});

	suite('TileService', () => {
		/** Runs a scenario against a real 1080×800 editor grid with one active session. */
		async function withTiles(run: (tiles: {
			service: TileService;
			groups: IEditorGroupsService;
			/** Grid order of named tiles with their sizes, plus the focused tile. */
			shape(): { tiles: [string, number, number][]; active: string; maximized: boolean };
			name(group: IEditorGroup | undefined, label: string): void;
			layout(width: number, height: number): void;
			/** Tile container elements in grid order. */
			elements(): HTMLElement[];
			notifications: string[];
			/** Settings written, web app URL prompts shown, and browser views opened. */
			web: { written: [string, unknown][]; prompts: number; opened: IResourceEditorInput[] };
			/** Items shown by each quick pick, in order. */
			picks: (IQuickPickItem | IQuickPickSeparator)[][];
		}) => Promise<void>, options: { terminalOpens?: boolean; focusFollowsMouse?: boolean; jiraBoardUrl?: string; webAppAnswer?: string } = {}): Promise<void> {
			const instantiation = workbenchInstantiationService(undefined, store);
			const contexts = instantiation.get(IContextKeyService);
			instantiation.stub(IContextKeyService, 'getContext', () => upcastPartial<IContext>({ getValue: key => contexts.getContextKeyValue(key) }));
			const configuration = new TestConfigurationService({ terminalFirst: { tiles: { resizeStep: 40, focusFollowsMouse: options.focusFollowsMouse ?? true }, jira: { boardUrl: options.jiraBoardUrl ?? '' } } });
			const web: { written: [string, unknown][]; prompts: number; opened: IResourceEditorInput[] } = { written: [], prompts: 0, opened: [] };
			configuration.updateValue = async (key: string, value: unknown) => { web.written.push([key, value]); };
			instantiation.stub(IConfigurationService, configuration);
			instantiation.stub(IQuickInputService, 'input', async () => { web.prompts++; return options.webAppAnswer; });
			const picks: (IQuickPickItem | IQuickPickSeparator)[][] = [];
			instantiation.stub(IQuickInputService, 'pick', (async (items: (IQuickPickItem | IQuickPickSeparator)[]) => { picks.push(items); return undefined; }) as IQuickInputService['pick']);
			instantiation.stub(IPaneCompositePartService, 'getVisiblePaneCompositeIds', () => []);
			const parts = await createEditorParts(instantiation, store.add(new DisposableStore()));
			instantiation.stub(IEditorGroupsService, parts);
			const notifications: string[] = [];
			instantiation.stub(INotificationService, upcastPartial<INotificationService>({ info: message => { notifications.push(String(message)); return undefined!; } }));
			instantiation.stub(ITerminalFirstService, upcastPartial<ITerminalFirstService>({
				sessions: [{ id: 'session', title: 'session', mode: 'editor', active: true }],
				showEditor: async () => { },
				openTerminalTile: async () => options.terminalOpens ?? true,
			}));
			// The test editor service does not open editors; tiles only open into an explicit group.
			// Browser views stand in as file inputs on the same resource, since the browser editor is desktop-only.
			instantiation.stub(IEditorService, upcastPartial<IEditorService>({
				openEditor: ((input: EditorInput | IResourceEditorInput, options: IEditorOptions | IEditorGroup, group: IEditorGroup) => {
					if (input instanceof EditorInput) { return group.openEditor(input, options as IEditorOptions); }
					web.opened.push(input);
					return (options as IEditorGroup).openEditor(store.add(new TestFileEditorInput(input.resource!, 'testBrowser')), input.options);
				}) as IEditorService['openEditor'],
			}));
			// No pane composites are registered, so view tiles show their placeholder.
			instantiation.stub(IPaneCompositePartService, 'getPaneComposite', () => undefined);
			// Views are active only when their context matches, which the mock context key service never does.
			const viewContexts = store.add(instantiation.createInstance(ContextKeyService));
			instantiation.stub(IViewDescriptorService, store.add(store.add(instantiation.createChild(new ServiceCollection([IContextKeyService, viewContexts]))).createInstance(ViewDescriptorService)));
			instantiation.stub(IViewsService, new TestViewsService());
			instantiation.stub(INativeVimService, upcastPartial<INativeVimService>({ enabled: false, onDidChange: Event.None }));
			instantiation.stub(IContextMenuService, upcastPartial<IContextMenuService>({ onDidShowContextMenu: Event.None, onDidHideContextMenu: Event.None, showContextMenu: () => { } }));
			instantiation.stub(IViewTileComposites, store.add(instantiation.createInstance(ViewTileComposites)));
			const service = store.add(instantiation.createInstance(TileService));
			const names = new Map<number, string>([[parts.mainPart.activeGroup.id, 'a']]);
			try {
				await run({
					service, groups: parts, notifications, web, picks,
					name: (group, label) => { if (group) { names.set(group.id, label); } },
					layout: (width, height) => parts.testMainPart.layout(width, height, 0, 0),
					elements: () => parts.testMainPart.getGroups(GroupsOrder.GRID_APPEARANCE).map(group => parts.testMainPart.groups.find(view => view.id === group.id)!.element),
					shape: () => ({
						tiles: parts.mainPart.getGroups(GroupsOrder.GRID_APPEARANCE).map(group => { const size = parts.getSize(group); return [names.get(group.id) ?? '?', size.width, size.height]; }),
						active: names.get(parts.mainPart.activeGroup.id) ?? '?',
						maximized: parts.mainPart.hasMaximizedGroup(),
					}),
				});
			} finally {
				await workbenchTeardown(instantiation);
			}
		}

		test('new tiles halve the focused tile along its longer side', () => withTiles(async ({ service, shape, name }) => {
			name(await service.open('editor', GroupDirection.RIGHT), 'b');
			name(await service.open('editor'), 'c');
			deepStrictEqual(shape(), { tiles: [['a', 540, 800], ['b', 540, 400], ['c', 540, 400]], active: 'c', maximized: false });
		}));

		test('splits that would leave an unusable half change nothing', () => withTiles(async ({ service, layout, shape, notifications }) => {
			layout(300, 250);
			const opened = await service.open('editor', GroupDirection.RIGHT);
			deepStrictEqual({ opened, shape: shape(), notifications: notifications.length }, { opened: undefined, shape: { tiles: [['a', 300, 250]], active: 'a', maximized: false }, notifications: 1 });
		}));

		test('a terminal tile that cannot open does not leave an empty tile', () => withTiles(async ({ service, shape }) => {
			const opened = await service.open('terminal', GroupDirection.RIGHT);
			deepStrictEqual({ opened, shape: shape() }, { opened: undefined, shape: { tiles: [['a', 1080, 800]], active: 'a', maximized: false } });
		}, { terminalOpens: false }));

		test('swap exchanges tiles, toggle split stacks the pair, and balance evens sizes', () => withTiles(async ({ service, groups, shape, name }) => {
			name(await service.open('editor', GroupDirection.RIGHT), 'b');
			service.swap(GroupDirection.LEFT);
			const swapped = shape();
			service.toggleSplit();
			const stacked = shape();
			service.resize(GroupDirection.DOWN);
			groups.mainPart.toggleMaximizeGroup();
			service.balance();
			deepStrictEqual({ swapped, stacked, balanced: shape() }, {
				swapped: { tiles: [['b', 540, 800], ['a', 540, 800]], active: 'b', maximized: false },
				stacked: { tiles: [['b', 1080, 400], ['a', 1080, 400]], active: 'b', maximized: false },
				balanced: { tiles: [['b', 1080, 400], ['a', 1080, 400]], active: 'b', maximized: false },
			});
		}));

		test('resize moves the edge toward a neighbor, or shrinks from the far side', () => withTiles(async ({ service, groups, shape, name }) => {
			name(await service.open('editor', GroupDirection.RIGHT), 'b');
			groups.mainPart.groups.find(group => group !== groups.mainPart.activeGroup)!.focus();
			service.resize(GroupDirection.RIGHT);
			const grown = shape();
			service.resize(GroupDirection.LEFT);
			service.resize(GroupDirection.LEFT);
			service.resize(GroupDirection.UP);
			deepStrictEqual({ grown, shrunk: shape() }, {
				grown: { tiles: [['a', 580, 800], ['b', 500, 800]], active: 'a', maximized: false },
				shrunk: { tiles: [['a', 500, 800], ['b', 580, 800]], active: 'a', maximized: false },
			});
		}));

		test('closing a tile focuses the neighbor that takes its space', () => withTiles(async ({ service, shape, name }) => {
			name(await service.open('editor', GroupDirection.RIGHT), 'b');
			name(await service.open('editor', GroupDirection.DOWN), 'c');
			service.focus(GroupDirection.UP);
			await service.close();
			deepStrictEqual(shape(), { tiles: [['a', 540, 800], ['c', 540, 800]], active: 'c', maximized: false });
		}));

		test('closing by ID targets an inactive tile and ignores a stale ID', () => withTiles(async ({ service, groups, shape, name }) => {
			const first = groups.mainPart.activeGroup;
			name(await service.open('editor', GroupDirection.RIGHT), 'b');
			await service.close(first.id);
			await service.close(first.id);
			deepStrictEqual(shape(), { tiles: [['b', 1080, 800]], active: 'b', maximized: false });
		}));

		test('move and swap restore a maximized tile first', () => withTiles(async ({ service, groups, shape, name }) => {
			name(await service.open('editor', GroupDirection.RIGHT), 'b');
			groups.mainPart.toggleMaximizeGroup();
			service.swap(GroupDirection.LEFT);
			deepStrictEqual(shape(), { tiles: [['b', 540, 800], ['a', 540, 800]], active: 'b', maximized: false });
		}));

		test('views open as one tile per container, and a shared view gets a container of its own', () => withTiles(async ({ service, shape, name }) => {
			const views = Registry.as<IViewsRegistry>(ViewExtensions.ViewsRegistry);
			const containers = Registry.as<IViewContainersRegistry>(ViewExtensions.ViewContainersRegistry);
			const container = containers.registerViewContainer({ id: 'test.tiles.container', title: localize2('test', "Test"), ctorDescriptor: new SyncDescriptor(class { }) }, ViewContainerLocation.Panel);
			const descriptors = [{ id: 'test.tiles.one', name: localize2('one', "One"), ctorDescriptor: new SyncDescriptor(class { }), canMoveView: true }, { id: 'test.tiles.two', name: localize2('two', "Two"), ctorDescriptor: new SyncDescriptor(class { }), canMoveView: true }];
			views.registerViews(descriptors, container);
			const pane = Registry.as<IEditorPaneRegistry>(EditorExtensions.EditorPane).registerEditorPane(EditorPaneDescriptor.create(ViewTileEditor, ViewTileEditor.ID, 'View Tile'), [new SyncDescriptor(ViewTileInput)]);
			try {
				const containerOf = (group: IEditorGroup | undefined) => (group?.activeEditor as ViewTileInput | undefined)?.containerId;
				const whole = await service.openView(container.id, GroupDirection.RIGHT);
				name(whole, 'container');
				const again = await service.openView(container.id);
				const single = await service.openView('test.tiles.two', GroupDirection.DOWN);
				name(single, 'single');
				const singleContainer = containerOf(single);
				deepStrictEqual({
					reused: again === whole,
					wholeContainer: containerOf(whole),
					singleMoved: singleContainer !== undefined && singleContainer !== container.id,
					singleName: single?.activeEditor?.getName(),
					terminal: await service.openView('terminal'),
					tiles: shape().tiles.map(([label]) => label),
				}, { reused: true, wholeContainer: container.id, singleMoved: true, singleName: 'Two', terminal: undefined, tiles: ['a', 'container', 'single'] });
			} finally {
				pane.dispose();
				views.deregisterViews(views.getViews(container), container);
				for (const generated of containers.all.filter(candidate => candidate.id !== container.id && views.getViews(candidate).length === 0 && candidate.id.startsWith('workbench.views.service.'))) {
					containers.deregisterViewContainer(generated);
				}
				containers.deregisterViewContainer(container);
			}
		}));

		test('the New Tile picker groups rows and gives every row an icon, a name, and a description', () => withTiles(async ({ service, picks }) => {
			const views = Registry.as<IViewsRegistry>(ViewExtensions.ViewsRegistry);
			const containers = Registry.as<IViewContainersRegistry>(ViewExtensions.ViewContainersRegistry);
			const tool = containers.registerViewContainer({ id: 'test.picker.tool', title: localize2('pickerTool', "Picker Tool"), icon: Codicon.beaker, ctorDescriptor: new SyncDescriptor(class { }) }, ViewContainerLocation.Sidebar);
			const extension = containers.registerViewContainer({ id: 'test.picker.extension', title: localize2('pickerExtension', "Picker Extension"), icon: URI.parse('file:///icon.svg'), extensionId: new ExtensionIdentifier('vendor.picker'), ctorDescriptor: new SyncDescriptor(class { }) }, ViewContainerLocation.AuxiliaryBar);
			const untitled = containers.registerViewContainer({ id: 'test.picker.untitled', title: { value: '', original: '' }, ctorDescriptor: new SyncDescriptor(class { }) }, ViewContainerLocation.Panel);
			views.registerViews([{ id: 'test.picker.toolView', name: localize2('toolView', "Tool View"), ctorDescriptor: new SyncDescriptor(class { }) }], tool);
			views.registerViews([{ id: 'test.picker.extensionView', name: localize2('extensionView', "Extension View"), ctorDescriptor: new SyncDescriptor(class { }) }], extension);
			views.registerViews([{ id: 'test.picker.untitledView', name: localize2('untitledView', "Named by View"), ctorDescriptor: new SyncDescriptor(class { }) }], untitled);
			try {
				await service.pick();
				const shown = picks[0] ?? [];
				const groups = shown.filter(item => item.type === 'separator').map(item => item.label);
				const groupOf = (label: string) => { let group: string | undefined; for (const item of shown) { if (item.type === 'separator') { group = item.label; } else if (item.label === label) { return group; } } return undefined; };
				const row = (label: string) => { const item = shown.find((item): item is IQuickPickItem => item.type !== 'separator' && item.label === label); return item && [item.description, !!(item.iconClass || item.iconPath)]; };
				deepStrictEqual({
					groups,
					editor: row('Editor'), terminal: row('Terminal'), jira: row('Jira Board'),
					tool: [row('Picker Tool'), groupOf('Picker Tool')], extension: [row('Picker Extension'), groupOf('Picker Extension')], untitled: [row('Named by View'), groupOf('Named by View')],
					allRowsHaveIconAndDescription: shown.filter((item): item is IQuickPickItem => item.type !== 'separator').every(item => !!item.label && !!item.description && !!(item.iconClass || item.iconPath)),
				}, {
					groups: ['Workspace', 'Tools', 'Web', 'Extensions'],
					editor: ['Empty editor tile', true], terminal: ['Shell in the session directory', true], jira: ['Asks for the URL the first time', true],
					tool: [['View', true], 'Tools'], extension: [['Extension view', true], 'Extensions'], untitled: [['View', true], 'Tools'],
					allRowsHaveIconAndDescription: true,
				});
			} finally {
				for (const container of [tool, extension, untitled]) {
					views.deregisterViews(views.getViews(container), container);
					containers.deregisterViewContainer(container);
				}
			}
		}));

		test('a background view open without room changes nothing and stays quiet', () => withTiles(async ({ service, layout, shape, notifications }) => {
			layout(300, 250);
			const opened = await service.open({ container: 'workbench.view.explorer' }, GroupDirection.RIGHT, false);
			deepStrictEqual({ opened, shape: shape(), notifications }, { opened: undefined, shape: { tiles: [['a', 300, 250]], active: 'a', maximized: false }, notifications: [] });
		}));

		test('the Jira board asks for its URL once, opens a browser tile, and reopening focuses it', () => withTiles(async ({ service, groups, shape, name, web }) => {
			name(await service.openWebApp('jira', GroupDirection.RIGHT), 'jira');
			groups.mainPart.groups.find(group => group !== groups.mainPart.activeGroup)!.focus();
			const again = await service.openWebApp('jira');
			deepStrictEqual({ web, shape: shape(), reused: again === groups.mainPart.activeGroup }, {
				web: {
					written: [['terminalFirst.jira.boardUrl', 'https://example.atlassian.net/jira/software/projects/KEY/boards/1']],
					prompts: 1,
					opened: [{ resource: webAppTiles.jira.resource, options: { pinned: true, viewState: { url: 'https://example.atlassian.net/jira/software/projects/KEY/boards/1', chromeless: true } } }],
				},
				shape: { tiles: [['a', 540, 800], ['jira', 540, 800]], active: 'jira', maximized: false },
				reused: true,
			});
		}, { webAppAnswer: ' https://example.atlassian.net/jira/software/projects/KEY/boards/1 ' }));

		test('a configured Jira board opens without asking', () => withTiles(async ({ service, web }) => {
			await service.openWebApp('jira');
			deepStrictEqual({ prompts: web.prompts, written: web.written, urls: web.opened.map(input => (input.options?.viewState as { url: string }).url) }, { prompts: 0, written: [], urls: ['https://example.atlassian.net/board'] });
		}, { jiraBoardUrl: 'https://example.atlassian.net/board' }));

		test('Bitbucket gets its own tile and setting beside a configured Jira board', () => withTiles(async ({ service, shape, name, web }) => {
			name(await service.openWebApp('jira', GroupDirection.RIGHT), 'jira');
			name(await service.openWebApp('bitbucket', GroupDirection.DOWN), 'bitbucket');
			await service.openWebApp('jira');
			deepStrictEqual({ written: web.written, prompts: web.prompts, opened: web.opened.map(input => input.resource?.toString()), shape: shape() }, {
				written: [['terminalFirst.bitbucket.url', 'https://bitbucket.org/team/repo/pull-requests/']],
				prompts: 1,
				opened: [webAppTiles.jira.resource.toString(), webAppTiles.bitbucket.resource.toString()],
				shape: { tiles: [['a', 540, 800], ['jira', 540, 400], ['bitbucket', 540, 400]], active: 'jira', maximized: false },
			});
		}, { jiraBoardUrl: 'https://example.atlassian.net/board', webAppAnswer: 'https://bitbucket.org/team/repo/pull-requests/' }));

		for (const answer of [undefined, 'not a url', 'file:///etc/passwd']) {
			test(`a Jira board URL of ${answer ?? 'nothing'} opens nothing and saves nothing`, () => withTiles(async ({ service, shape, web }) => {
				const opened = await service.openWebApp('jira', GroupDirection.RIGHT);
				deepStrictEqual({ opened, web, shape: shape() }, { opened: undefined, web: { written: [], prompts: 1, opened: [] }, shape: { tiles: [['a', 1080, 800]], active: 'a', maximized: false } });
			}, { webAppAnswer: answer }));
		}

		for (const enabled of [true, false]) {
			test(`focus ${enabled ? 'follows' : 'ignores'} a pointer that rests on a tile`, () => withTiles(async ({ service, shape, name, elements }) => {
				const previousMode = terminalFirstPolicy.mode;
				terminalFirstPolicy.mode = 'editor';
				try {
					name(await service.open('editor', GroupDirection.RIGHT), 'b');
					const [left] = elements();
					left.dispatchEvent(new MouseEvent('mouseenter'));
					left.dispatchEvent(new MouseEvent('mouseleave'));
					await timeout(TileChrome.HOVER_FOCUS_DELAY + 20);
					const passedOver = shape().active;
					left.dispatchEvent(new MouseEvent('mouseenter'));
					await timeout(TileChrome.HOVER_FOCUS_DELAY + 20);
					deepStrictEqual({ passedOver, rested: shape().active }, { passedOver: 'b', rested: enabled ? 'a' : 'b' });
				} finally {
					terminalFirstPolicy.mode = previousMode;
				}
			}, { focusFollowsMouse: enabled }));
		}
	});
});
