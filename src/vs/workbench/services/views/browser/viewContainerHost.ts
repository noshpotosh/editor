/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter } from '../../../../base/common/event.js';
import { Disposable, IDisposable, toDisposable } from '../../../../base/common/lifecycle.js';
import type { PaneComposite } from '../../../browser/panecomposite.js';

/** A presentation host for a view container outside the sidebar/panel parts. */
export interface IViewContainerHost {
	isEnabled(): boolean;
	open(focus?: boolean): Promise<PaneComposite | undefined>;
	get(): PaneComposite | undefined;
	close(): Promise<void>;
}

/** Window-local registry shared by view commands and the composite parts. */
export class ViewContainerHostRegistry extends Disposable {
	private readonly changed = this._register(new Emitter<{ id: string; visible: boolean }>());
	readonly onDidChangeVisibility = this.changed.event;

	setVisible(id: string, visible: boolean): void { this.changed.fire({ id, visible }); }
	private resolver: ((id: string) => IViewContainerHost | undefined) | undefined;

	/** Routes view containers to a host; a container the resolver declines stays in its part. */
	registerResolver(resolve: (id: string) => IViewContainerHost | undefined): IDisposable {
		if (this.resolver) {
			throw new Error('View container host resolver already registered');
		}
		this.resolver = resolve;
		return toDisposable(() => { if (this.resolver === resolve) { this.resolver = undefined; } });
	}

	get(id: string): IViewContainerHost | undefined {
		const host = this.resolver?.(id);
		return host?.isEnabled() ? host : undefined;
	}
}

export const viewContainerHosts = new ViewContainerHostRegistry();
