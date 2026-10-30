/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { basename, dirname, joinPath } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { IBulkEditService, ResourceFileEdit } from '../../../../editor/browser/services/bulkEditService.js';
import { localize } from '../../../../nls.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IDialogService } from '../../../../platform/dialogs/common/dialogs.js';
import { FileSystemProviderCapabilities, IFileService, IFileStat } from '../../../../platform/files/common/files.js';
import { IQuickInputService } from '../../../../platform/quickinput/common/quickInput.js';
import { UndoRedoGroup } from '../../../../platform/undoRedo/common/undoRedo.js';
import { IUriIdentityService } from '../../../../platform/uriIdentity/common/uriIdentity.js';
import { IFilesConfigurationService } from '../../../services/filesConfiguration/common/filesConfigurationService.js';
import { IWorkingCopyFileService } from '../../../services/workingCopy/common/workingCopyFileService.js';

export type FileBrowserOperation = 'create' | 'rename' | 'move' | 'copy' | 'delete';

/** Preflights complete batches before handing changes to the working-copy aware bulk edit service. */
export class FileBrowserOperations {
	constructor(
		@IFileService private readonly files: IFileService,
		@IBulkEditService private readonly edits: IBulkEditService,
		@IQuickInputService private readonly input: IQuickInputService,
		@IDialogService private readonly dialogs: IDialogService,
		@IConfigurationService private readonly configuration: IConfigurationService,
		@IWorkingCopyFileService private readonly workingCopies: IWorkingCopyFileService,
		@IFilesConfigurationService private readonly filesConfiguration: IFilesConfigurationService,
		@IUriIdentityService private readonly identity: IUriIdentityService,
	) { }

	private path(base: URI, value: string): URI {
		const parts = value.replace(/\/$/, '').split('/');
		if (!value.trim() || parts.some(part => !part || part === '.' || part === '..' || /[\x00-\x1f\\]/.test(part))) {
			throw new Error(localize('invalidBrowserName', "Enter a relative path without empty, '.' or '..' components."));
		}
		return joinPath(base, ...parts);
	}

	async run(operation: FileBrowserOperation, directory: URI, entries: readonly IFileStat[], marked: boolean, prompt?: string, cancelled: () => boolean = () => false, onCompleted: (resource: URI) => void = () => {}): Promise<URI[]> {
		const ext = this.identity.extUri;
		const sources = entries.filter(entry => !entries.some(other => other !== entry && ext.isEqualOrParent(entry.resource, other.resource)));
		const changes: ResourceFileEdit[] = [];
		if (operation === 'create') {
			const value = prompt ?? await this.input.input({ prompt: localize('createBrowserEntry', "Create File or Folder (end with / for a folder)") });
			if (value === undefined || cancelled()) { return []; }
			changes.push(new ResourceFileEdit(undefined, this.path(directory, value), { folder: value.endsWith('/'), overwrite: false }));
		} else {
			if (!sources.length) { return []; }
			for (const source of sources) {
				if (operation !== 'copy' && this.filesConfiguration.isReadonly(source.resource, source)) {
					throw new Error(localize('readonlyBrowserEntry', "'{0}' is read-only.", source.name));
				}
				if (operation === 'delete') {
					const trash = this.configuration.getValue<boolean>('files.enableTrash') !== false && this.files.hasCapability(source.resource, FileSystemProviderCapabilities.Trash);
					changes.push(new ResourceFileEdit(source.resource, undefined, { recursive: true, folder: source.isDirectory, skipTrashBin: !trash }));
				} else {
					let target: URI;
					if (marked && operation !== 'rename') {
						target = joinPath(directory, basename(source.resource));
					} else {
						const value = await this.input.input({ prompt: localize('browserDestination', "Destination for {0} (relative to {1})", source.name, (operation === 'rename' ? dirname(source.resource) : directory).fsPath), value: basename(source.resource) });
						if (value === undefined || cancelled()) { return []; }
						target = this.path(operation === 'rename' ? dirname(source.resource) : directory, value);
					}
					if (ext.isEqual(target, source.resource) || (source.isDirectory && ext.isEqualOrParent(target, source.resource))) {
						throw new Error(localize('browserSelfMove', "The destination must be outside the source."));
					}
					changes.push(new ResourceFileEdit(source.resource, target, { copy: operation === 'copy', overwrite: false }));
				}
			}
		}
		for (const change of changes) {
			if (!change.newResource) { continue; }
			if (this.filesConfiguration.isReadonly(change.newResource) || this.filesConfiguration.isReadonly(dirname(change.newResource))) {
				throw new Error(localize('browserReadonlyDestination', "The destination is read-only."));
			}
			if (await this.files.exists(change.newResource)) {
				throw new Error(localize('browserCollision', "'{0}' already exists. Nothing was changed.", change.newResource.fsPath));
			}
			if (changes.some(other => other !== change && ((other.newResource && (ext.isEqualOrParent(change.newResource!, other.newResource) || ext.isEqualOrParent(other.newResource, change.newResource!))) || (other.oldResource && ext.isEqualOrParent(change.newResource!, other.oldResource))))) {
				throw new Error(localize('browserOverlappingTargets', "The batch contains overlapping sources or destinations. Nothing was changed."));
			}
		}
		if (operation === 'delete') {
			const permanent = changes.some(change => change.options?.skipTrashBin);
			const dirty = sources.some(source => this.workingCopies.getDirty(source.resource).length > 0);
			if (permanent || dirty || this.configuration.getValue<boolean>('explorer.confirmDelete') !== false) {
				const confirmed = await this.dialogs.confirm({
					type: 'warning',
					message: permanent ? localize('browserPermanentDelete', "Permanently delete {0} selected items?", sources.length) : localize('browserTrash', "Move {0} selected items to Trash?", sources.length),
					detail: sources.map(source => source.resource.fsPath).join('\n') + (dirty ? '\n' + localize('browserDirtyDelete', "These items contain unsaved changes that will be lost.") : ''),
					primaryButton: localize('browserDeleteConfirm', "Delete")
				});
				if (!confirmed.confirmed) { return []; }
			}
		}
		if (cancelled()) { return []; }
		const group = new UndoRedoGroup();
		const completed: URI[] = [];
		for (const change of changes) {
			if (cancelled()) { break; }
			try {
				const result = await this.edits.apply([change], { label: localize('browserFileOperation', "File Browser Operation"), confirmBeforeUndo: true, undoRedoGroupId: group.id });
				if (!result.isApplied) { break; }
				if (change.oldResource) { completed.push(change.oldResource); onCompleted(change.oldResource); }
			} catch (error) {
				throw new Error(localize('browserPartialFailure', "Completed {0} of {1} operations. {2}", completed.length, changes.length, error instanceof Error ? error.message : String(error)));
			}
		}
		return completed;
	}
}
