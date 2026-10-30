/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ISerializedNode } from '../../../../base/browser/ui/grid/grid.js';
import { Disposable, IDisposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { IEditorGroupView } from '../../../browser/parts/editor/editor.js';
import type { IEditorPartUIState } from '../../../browser/parts/editor/editorPart.js';
import { EditorPartHooks, IEditorPartExtension, IEditorPartExtensionContext } from '../../../browser/parts/editor/editorPartHooks.js';
import { GroupIdentifier } from '../../../common/editor.js';
import { isSerializedEditorGroupModel } from '../../../common/editor/editorGroupModel.js';
import { GroupsOrder, IEditorGroup, IEditorPart } from '../../../services/editor/common/editorGroupsService.js';
import { terminalFirstEnabled } from '../../../services/terminalFirst/common/terminalFirstPolicy.js';
import { terminalFirstStartup } from '../../../services/terminalFirst/common/terminalFirstStartup.js';

const STORAGE_KEY = 'editorpart.sessions';

interface ISessionsMemento {
	active: string;
	states: Record<string, IEditorPartUIState>;
}

interface IRetainedSession {
	state: IEditorPartUIState;
	/** Live group views, or empty when the session was restored from storage and not shown yet. */
	groups: IEditorGroupView[];
}

/** Per-session editor layouts of one editor part. The session controller drives it; tiles use `swapGroups`. */
export interface IEditorPartSessions {
	/** Shows the session's groups and hides the current ones, keeping them alive. */
	activate(id: string): void;
	owns(id: string, groupId: GroupIdentifier): boolean;
	/** Closes every editor of the session after save, discard, or cancel decisions. False when cancelled. */
	close(id: string): Promise<boolean>;
	ids(): readonly string[];
	/** Exchanges the grid positions of two groups; each takes the other's cell size. */
	swapGroups(group: IEditorGroup, other: IEditorGroup): void;
}

const instances = new WeakMap<IEditorPart, IEditorPartSessions>();

/**
 * Retains live editor groups while another terminal session is active. Retained groups stay
 * registered with the part, so Save All, backups, and shutdown include them, but they are hidden
 * from `groups` and navigation.
 */
export class EditorPartSessions extends Disposable implements IEditorPartExtension, IEditorPartSessions {

	/** The sessions of an editor part, when the part has one. */
	static for(part: IEditorPart): IEditorPartSessions | undefined {
		return instances.get(part);
	}

	/** Lets tests pair a fake part with fake sessions. */
	static attach(part: IEditorPart, sessions: IEditorPartSessions): IDisposable {
		instances.set(part, sessions);
		return toDisposable(() => {
			if (instances.get(part) === sessions) {
				instances.delete(part);
			}
		});
	}

	private activeSession: string | undefined;
	private readonly retainedSessions = new Map<string, IRetainedSession>();
	private activeSessionGroups: Set<GroupIdentifier> | undefined;

	constructor(private readonly context: IEditorPartExtensionContext) {
		super();
		this._register(EditorPartSessions.attach(context.part, this));
	}

	private get visibleGroups(): IEditorGroupView[] {
		return Array.from(this.context.groupViews.values()).filter(group => this.isGroupVisible(group));
	}

	private groupsInGridOrder(): IEditorGroupView[] {
		return this.context.part.getGroups(GroupsOrder.GRID_APPEARANCE).map(group => this.context.groupViews.get(group.id)!);
	}

	isGroupVisible(group: IEditorGroupView): boolean {
		return !this.activeSessionGroups || this.activeSessionGroups.has(group.id);
	}

	onDidCreateGroupView(group: IEditorGroupView): void {
		this.activeSessionGroups?.add(group.id);
	}

	async onDidRestore(): Promise<void> {
		// Register retained inputs before backup recovery looks for missing editors, but only once
		// the shell is on screen: hidden session layouts must not compete with the first prompt.
		const sessions = this.context.willRestoreState() ? this.context.memento[STORAGE_KEY] as ISessionsMemento | undefined : undefined;
		if (!sessions) {
			return;
		}
		await terminalFirstStartup.whenPresented();
		const active = this.activeSession ?? sessions.active;
		for (const id of Object.keys(sessions.states)) {
			this.activate(id);
		}
		this.activate(active);
	}

	ids(): readonly string[] {
		return [...this.retainedSessions.keys(), ...(this.activeSession ? [this.activeSession] : [])];
	}

	owns(id: string, groupId: GroupIdentifier): boolean {
		return id === this.activeSession ? !!this.activeSessionGroups?.has(groupId) : !!this.retainedSessions.get(id)?.groups.some(group => group.id === groupId);
	}

	activate(id: string): void {
		if (this.activeSession === id) {
			return;
		}
		if (!this.activeSession) {
			const restored = this.context.memento[STORAGE_KEY] as ISessionsMemento | undefined;
			if (restored) {
				this.activeSession = restored.active;
				for (const [key, state] of Object.entries(restored.states)) {
					if (key !== restored.active) {
						this.retainedSessions.set(key, { state, groups: [] });
					}
				}
			} else {
				this.activeSession = id;
			}
			this.activeSessionGroups = new Set(this.context.groupViews.keys());
			if (this.activeSession === id) {
				return;
			}
		}
		for (const group of this.visibleGroups) {
			group.setVisible(false);
		}
		this.retainedSessions.set(this.activeSession, { state: this.context.createState(), groups: this.groupsInGridOrder() });
		this.activeSession = id;
		this.activeSessionGroups = new Set();
		this.context.setMostRecentActiveGroups([]);
		const newGroups: IEditorGroupView[] = [];
		const retained = this.retainedSessions.get(id);
		if (retained) {
			if (!retained.groups.length) {
				retained.state = this.resolveSessionGroupIds(retained.state);
			}
			for (const group of retained.groups) {
				this.activeSessionGroups.add(group.id);
			}
			this.context.restoreGrid(retained.state.serializedGrid, retained.state.activeGroup, retained.groups.length ? retained.groups : undefined);
			// Deserialized groups need the same registration as freshly created groups.
			if (!retained.groups.length) {
				newGroups.push(...this.visibleGroups);
			}
			this.context.setMostRecentActiveGroups(retained.state.mostRecentActiveGroups);
			this.context.setGroupActive(this.context.groupViews.get(retained.state.activeGroup) ?? this.visibleGroups[0]);
			this.retainedSessions.delete(id);
		} else {
			const group = this.context.createSingleGroupGrid();
			newGroups.push(group);
			this.context.setGroupActive(group);
		}
		this.context.relayout();
		for (const group of this.visibleGroups) {
			group.setVisible(true);
		}
		for (const group of newGroups) {
			this.context.fireDidAddGroup(group);
		}
	}

	/** Old session snapshots can share IDs. Never overwrite another session's live group. */
	private resolveSessionGroupIds(state: IEditorPartUIState): IEditorPartUIState {
		const occupied = new Set(this.context.groupViews.keys());
		const serializedIds = new Set<GroupIdentifier>();
		const collect = (node: ISerializedNode): void => {
			if (node.type === 'branch') {
				node.data.forEach(collect);
			} else if (isSerializedEditorGroupModel(node.data)) {
				serializedIds.add(node.data.id);
			}
		};
		collect(state.serializedGrid.root);
		let nextId = Math.max(-1, ...occupied, ...serializedIds) + 1;
		const replacements = new Map<GroupIdentifier, GroupIdentifier>();
		const remap = (node: ISerializedNode): ISerializedNode => {
			if (node.type === 'branch') {
				return { ...node, data: node.data.map(remap) };
			}
			if (!isSerializedEditorGroupModel(node.data) || !occupied.has(node.data.id)) {
				return node;
			}
			const id = nextId++;
			replacements.set(node.data.id, id);
			return { ...node, data: { ...node.data, id } };
		};
		const root = remap(state.serializedGrid.root);
		return {
			serializedGrid: { ...state.serializedGrid, root },
			activeGroup: replacements.get(state.activeGroup) ?? state.activeGroup,
			mostRecentActiveGroups: state.mostRecentActiveGroups.map(id => replacements.get(id) ?? id)
		};
	}

	async close(id: string): Promise<boolean> {
		const groups = id === this.activeSession ? this.visibleGroups : this.retainedSessions.get(id)?.groups ?? [];
		for (const group of groups) {
			if (!await group.confirmCloseAllEditors()) {
				return false;
			}
		}
		for (const group of groups) {
			if (!await group.closeAllEditors()) {
				return false;
			}
		}
		// The active grid must remain valid until the controller activates its successor.
		if (id !== this.activeSession) {
			for (const group of groups) {
				group.dispose();
				this.context.fireDidRemoveGroup(group);
			}
			this.retainedSessions.delete(id);
		}
		return true;
	}

	swapGroups(group: IEditorGroup, other: IEditorGroup): void {
		const groupView = this.context.groupViews.get(group.id);
		const otherView = this.context.groupViews.get(other.id);
		if (!groupView || !otherView || groupView === otherView) {
			return;
		}
		const restoreFocus = this.context.shouldRestoreFocus(groupView.element) || this.context.shouldRestoreFocus(otherView.element);
		this.context.swapViews(groupView, otherView);
		if (restoreFocus) {
			this.context.part.activeGroup.focus();
		}
		this.context.fireDidMoveGroup(groupView);
		this.context.fireDidMoveGroup(otherView);
		this.context.relayout();
	}

	saveState(): void {
		if (!this.activeSession) {
			return;
		}
		const states: Record<string, IEditorPartUIState> = { [this.activeSession]: this.context.createState() };
		for (const [id, session] of this.retainedSessions) {
			let index = 0;
			const refresh = (node: ISerializedNode): ISerializedNode => node.type === 'branch'
				? { ...node, data: node.data.map(refresh) }
				: { ...node, data: session.groups[index++]?.toJSON() ?? node.data };
			states[id] = { ...session.state, serializedGrid: { ...session.state.serializedGrid, root: refresh(session.state.serializedGrid.root) } };
		}
		this.context.memento[STORAGE_KEY] = { active: this.activeSession, states } satisfies ISessionsMemento;
	}

	override dispose(): void {
		// Retained groups remain registered until the part is disposed.
		for (const session of this.retainedSessions.values()) {
			for (const group of session.groups) {
				group.dispose();
				this.context.fireDidRemoveGroup(group);
			}
		}
		this.retainedSessions.clear();
		super.dispose();
	}
}

if (terminalFirstEnabled) {
	EditorPartHooks.registerExtension(context => new EditorPartSessions(context));
}
