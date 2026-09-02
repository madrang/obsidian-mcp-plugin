import { App } from 'obsidian';
import { ObsidianAPI, PatchParams } from '../utils/obsidian-api';
import {
	VaultSecurityManager,
	OperationType,
	SecuritySettings,
	SecurityLogEntry
} from './vault-security-manager';
import { SecurityError } from './path-validator';
import { MCPIgnoreManager } from './mcp-ignore-manager';
import { ObsidianConfig, ObsidianFile, ObsidianFileResponse, FileStatResponse } from '../types/obsidian';
import { BaseYAML } from '../types/bases-yaml';
import { BaseQueryOptions } from '../types/bases';
import { Debug } from '../utils/debug';

/** Minimal plugin interface for security-relevant properties.
 * Includes ObsidianAPIPluginRef fields so the same object can be passed to the base class. */
interface SecurePluginRef {
	settings?: {
		security?: Partial<SecuritySettings>;
		validation?: Partial<import('../validation/input-validator').ValidationConfig>;
		httpPort?: number;
		readOnlyMode?: boolean;
		allowSnippetEditing?: boolean;
		allowConfigEditing?: boolean;
	};
	ignoreManager?: MCPIgnoreManager;
	/** Scoped sessions: true when the path sits in a read-only scope. */
	scopeWriteGate?: (path?: string) => boolean;
	mcpServer?: { isServerRunning(): boolean; getConnectionCount(): number };
	manifest?: { dir?: string };
}

/**
 * Secure wrapper for ObsidianAPI that enforces path validation and operation permissions
 * This class intercepts all file operations and validates them through the security manager
 */
export class SecureObsidianAPI extends ObsidianAPI {
	private security: VaultSecurityManager;

	constructor(app: App, config?: ObsidianConfig, plugin?: SecurePluginRef, securitySettings?: Partial<SecuritySettings>) {
		super(app, config, plugin);

		// Initialize security manager with provided or default settings
		const settings: Partial<SecuritySettings> = securitySettings || plugin?.settings?.security || {};
		const ignoreManager: MCPIgnoreManager | undefined = plugin?.ignoreManager;

		// Read-only is read live off the plugin settings, not captured here
		// (ADR-108). Reading `plugin.settings.readOnlyMode` inside the closure
		// rather than dereferencing it now is what makes the toggle take effect
		// without a server restart — and it survives loadSettings() replacing the
		// settings object wholesale, which main.ts does.
		//
		// Without a plugin ref there is no setting to read, so read-only CANNOT be
		// enforced on this instance. Every production call site passes one; a
		// future one that forgets would silently lose read-only, so say so loudly
		// rather than leaving it to be discovered.
		const isReadOnly = plugin
			? (): boolean => plugin.settings?.readOnlyMode === true
			: undefined;
		// Same live-predicate shape as read-only, for the managed-namespace
		// write gates (ADR-113). Reads of the namespaces need no setting.
		const isSnippetWriteAllowed = plugin
			? (): boolean => plugin.settings?.allowSnippetEditing === true
			: undefined;
		const isConfigWriteAllowed = plugin
			? (): boolean => plugin.settings?.allowConfigEditing === true
			: undefined;
		if (!plugin) {
			Debug.error(
				'⚠️ SecureObsidianAPI built without a plugin reference: read-only mode ' +
				'cannot be enforced on this instance. Path validation still applies.'
			);
		}

		this.security = new VaultSecurityManager(app, settings, ignoreManager, isReadOnly, isSnippetWriteAllowed, isConfigWriteAllowed, plugin?.scopeWriteGate);
		
		Debug.log('🔐 SecureObsidianAPI initialized with security settings:', this.security.getSettings());
		Debug.log('🔐 SecureObsidianAPI has ignoreManager:', !!ignoreManager);
	}

	// File Operations - READ

	async getFile(path: string): Promise<ObsidianFileResponse> {
		const validated = await this.security.validateOperation({
			type: OperationType.READ
			, path: path
			, context: { method: 'getFile' }
		});

		return super.getFile(validated.path!);
	}

	async getFileStat(path: string): Promise<FileStatResponse> {
		const validated = await this.security.validateOperation({
			type: OperationType.READ
			, path: path
			, context: { method: 'getFileStat' }
		});

		return super.getFileStat(validated.path!);
	}

	async listFiles(directory?: string): Promise<string[]> {
		const validated = await this.security.validateOperation({
			type: OperationType.READ
			, path: directory || '.'
			, context: { method: 'listFiles' }
		});

		// Use validated path if directory was provided, undefined for vault root
		const listPath = !validated.path || validated.path === '.' ? undefined : validated.path;
		return super.listFiles(listPath);
	}

	async listFilesPaginated(directory?: string, page: number = 1, pageSize: number = 20, recursive: boolean = false, pattern?: string): ReturnType<ObsidianAPI['listFilesPaginated']> {
		const validated = await this.security.validateOperation({
			type: OperationType.READ
			, path: directory || '.'
			, context: { method: 'listFilesPaginated', page, pageSize, recursive, pattern }
		});

		// Use validated path if directory was provided, undefined for vault root
		const listPath = !validated.path || validated.path === '.' ? undefined : validated.path;
		return super.listFilesPaginated(listPath, page, pageSize, recursive, pattern);
	}

	async getActiveFile(): Promise<ObsidianFile> {
		// Validate the active file's path when there is one: an .mcpignore-excluded
		// or folder-scoped-out note must not leak through the active-file channel
		// (ADR-110). An out-of-scope active file answers as if no file were
		// open — the same masking an excluded path gets in getFile — so the
		// refusal names no path and proves no existence. With no active file
		// the path is undefined, path checks skip, and the base class throws
		// 'No active file' as before: masked and genuine are indistinguishable.
		try {
			await this.security.validateOperation({
				type: OperationType.READ
				, path: this.getApp().workspace.getActiveFile()?.path
				, context: { method: 'getActiveFile' }
			});
		} catch (error) {
			if (error instanceof SecurityError) {
				throw new Error('No active file');
			}
			throw error;
		}

		return super.getActiveFile();
	}

	// Note: searchSimple doesn't exist in base ObsidianAPI
	// Use searchPaginated instead

	// File Operations - CREATE

	async createFile(path: string, content: string): ReturnType<ObsidianAPI['createFile']> {
		const validated = await this.security.validateOperation({
			type: OperationType.CREATE
			, path: path
			, context: { method: 'createFile', contentSize: content.length }
		});
		
		return super.createFile(validated.path!, content);
	}

	// Note: createFolder doesn't exist in base ObsidianAPI
	// Folders are created automatically when creating files

	// File Operations - UPDATE

	async updateFile(path: string, content: string): ReturnType<ObsidianAPI['updateFile']> {
		const validated = await this.security.validateOperation({
			type: OperationType.UPDATE
			, path: path
			, context: { method: 'updateFile', contentSize: content.length }
		});
		
		return super.updateFile(validated.path!, content);
	}

	async appendToFile(path: string, content: string): ReturnType<ObsidianAPI['appendToFile']> {
		const validated = await this.security.validateOperation({
			type: OperationType.UPDATE
			, path: path
			, context: { method: 'appendToFile', contentSize: content.length }
		});
		
		return super.appendToFile(validated.path!, content);
	}

	async patchVaultFile(path: string, params: PatchParams): ReturnType<ObsidianAPI['patchVaultFile']> {
		const validated = await this.security.validateOperation({
			type: OperationType.UPDATE
			, path: path
			, context: { method: 'patchVaultFile', params }
		});
		
		return super.patchVaultFile(validated.path!, params);
	}

	// File Operations - DELETE

	async deleteFile(path: string): ReturnType<ObsidianAPI['deleteFile']> {
		const validated = await this.security.validateOperation({
			type: OperationType.DELETE
			, path: path
			, context: { method: 'deleteFile' }
		});
		
		return super.deleteFile(validated.path!);
	}

	// File Operations - MOVE

	/**
	 * Validates BOTH source and destination before a move/rename.
	 *
	 * validateOperation already understands targetPath, so the destination goes
	 * through the same path validator as the source (and the blocked-path check,
	 * which is why .mcpignore protection now covers move destinations too).
	 * Before this override the router called app.fileManager.renameFile directly
	 * and a `../` destination relocated files outside the vault root.
	 *
	 * Move and rename are one Obsidian primitive and one method here: the tool
	 * surface merged rename into move, and the separate RENAME charge went with
	 * it — a permission no caller can exercise independently is dead config.
	 */
	async moveFile(path: string, newPath: string): ReturnType<ObsidianAPI['moveFile']> {
		const validated = await this.security.validateOperation({
			type: OperationType.MOVE
			, path: path
			, targetPath: newPath
			, context: { method: 'moveFile' }
		});

		return super.moveFile(validated.path!, validated.targetPath!);
	}

	/**
	 * The command palette contains mutators ("Delete current file", "Move file
	 * to…"), so an unwrapped executeCommand is a write path around the layer.
	 * Latent today — only getCommands() is wired to a tool — but wrapped for the
	 * same reason as the active-file writes above.
	 *
	 * Goes through validateOperation like every other write, rather than a
	 * separate synchronous permission check: one gate function, and no entry
	 * point that silently cannot validate a path.
	 */
	async executeCommand(commandId: string): ReturnType<ObsidianAPI['executeCommand']> {
		await this.security.validateOperation({
			type: OperationType.EXECUTE
			, context: { method: 'executeCommand', commandId }
		});

		return super.executeCommand(commandId);
	}

	// Note: These methods don't exist in base ObsidianAPI:
	// - trash(), copyFile()
	// They would need to be implemented in the base class first

	// Bases

	/**
	 * Routes base creation through the security layer.
	 *
	 * createBase writes with app.vault.create() and was the one write in the
	 * plugin that reached the vault without passing through here, so neither the
	 * read-only permission check nor path validation applied. A `../` path
	 * created files outside the vault root.
	 */
	async createBase(path: string, config: BaseYAML): Promise<void> {
		const validated = await this.security.validateOperation({
			type: OperationType.CREATE
			, path: path
			, context: { method: 'createBase' }
		});

		return super.createBase(validated.path!, config);
	}

	// Bases reads (ADR-110). These used to pass straight through to BasesAPI's
	// raw vault access, so a folder-scoped token could read any base config and
	// evaluate it over every note in the vault. The path now goes through
	// validateOperation like every other read; the enumerations inside
	// (listBases, the note set queryBase evaluates) are scoped by the ignore
	// manager injected into this instance's BasesAPI at construction.

	async readBase(path: string): Promise<BaseYAML> {
		const validated = await this.security.validateOperation({
			type: OperationType.READ
			, path: path
			, context: { method: 'readBase' }
		});

		return super.readBase(validated.path!);
	}

	async queryBase(path: string, viewName?: string, options?: BaseQueryOptions): ReturnType<ObsidianAPI['queryBase']> {
		const validated = await this.security.validateOperation({
			type: OperationType.READ
			, path: path
			, context: { method: 'queryBase', viewName }
		});

		return super.queryBase(validated.path!, viewName, options);
	}

	async exportBase(path: string, format: 'csv' | 'json' | 'markdown', viewName?: string, options?: BaseQueryOptions): ReturnType<ObsidianAPI['exportBase']> {
		const validated = await this.security.validateOperation({
			type: OperationType.READ
			, path: path
			, context: { method: 'exportBase', format }
		});

		return super.exportBase(validated.path!, format, viewName, options);
	}

	// File Operations - OPEN

	/**
	 * Charged as READ, not EXECUTE.
	 *
	 * Opening a note changes nothing in the vault — it asks Obsidian to show a
	 * document the caller is already allowed to read, so read-only has no reason
	 * to deny it. EXECUTE originally meant exactly this method, but it now also
	 * covers executeCommand, which can reach destructive commands ("Delete current
	 * file"). Sharing one permission between the two would force a choice between
	 * blocking a harmless open and permitting arbitrary commands under read-only.
	 * Splitting them keeps executeCommand denied while `system.open_in_obsidian`
	 * keeps working.
	 *
	 * Path validation still applies, so this cannot be used to probe outside the
	 * vault or to open an .mcpignore-excluded file.
	 */
	async openFile(path: string): ReturnType<ObsidianAPI['openFile']> {
		const validated = await this.security.validateOperation({
			type: OperationType.READ
			, path: path
			, context: { method: 'openFile' }
		});

		return super.openFile(validated.path!);
	}

	// Note: These methods don't exist in base ObsidianAPI:
	// - combineMergeFiles(), splitFile()
	// They would need to be implemented in the base class first

	// Security Management Methods

	/**
	 * Updates security settings
	 */
	updateSecuritySettings(settings: Partial<SecuritySettings>): void {
		this.security.updateSettings(settings);
		Debug.log('🔐 Security settings updated');
	}

	/**
	 * Gets current security settings
	 */
	getSecuritySettings(): SecuritySettings {
		return this.security.getSettings();
	}

	/**
	 * Gets security audit log
	 */
	getSecurityAuditLog(): SecurityLogEntry[] {
		return this.security.getAuditLog();
	}

	/**
	 * Clears security audit log
	 */
	clearSecurityAuditLog(): void {
		this.security.clearAuditLog();
	}

	/**
	 * Apply security preset
	 */
	applySecurityPreset(preset: 'readOnly' | 'safeMode' | 'fullAccess'): void {
		const presetSettings = VaultSecurityManager.presets[preset]();
		this.security.updateSettings(presetSettings);
		Debug.log(`🔐 Applied security preset: ${preset}`);
	}
}