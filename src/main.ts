import { App, Plugin, PluginSettingTab, Notice, TFolder, Modal, FileSystemAdapter, SettingDefinitionItem } from 'obsidian';
import { MCPHttpServer } from './mcp-server';
import { getVersion } from './version';
import { Debug } from './utils/debug';
import { MCPIgnoreManager } from './security/mcp-ignore-manager';
import { randomBytes } from 'crypto';
import { PluginDetector } from './utils/plugin-detector';
import { getActionsForOperation } from './tools/semantic-tools';
import { BindMode, normalizeBindInput } from './utils/network-classifier';
import { normalizeScopedTokens } from './security/http-auth';
import { MCPPluginSettings, MCPServerInfo, DEFAULT_SETTINGS } from './settings/plugin-settings';
import { buildSettingsUI, renderJsonConfigBlock } from './settings/ui';
import type { SettingsUIHost } from './settings/host-types';


export default class ObsidianMCPPlugin extends Plugin {
	settings!: MCPPluginSettings;
	mcpServer?: MCPHttpServer;
	ignoreManager?: MCPIgnoreManager;
	private currentVaultName: string = '';
	private currentVaultPath: string = '';
	private vaultSwitchTimeout?: number;
	private statsUpdateInterval?: number;

	async onload() {
		Debug.log(`🚀 Starting Scoped Vault MCP v${getVersion()}`);
		
		try {
			// ADR-107: snapshot raw persisted data BEFORE loadSettings(),
			// since loadSettings may write a fresh apiKey and (with merged
			// defaults) bake in bindMode='loopback', erasing the "this is
			// an upgrading install" signal we need below.
			const rawDataBeforeLoad = (await this.loadData()) as Partial<MCPPluginSettings> | null;
			const wasExistingPreBindModeInstall = !!rawDataBeforeLoad && rawDataBeforeLoad.bindMode === undefined;

			await this.loadSettings();
			Debug.setDebugMode(this.settings.debugLogging);
			Debug.log('✅ Settings loaded');

			// ADR-107: one-time post-upgrade migration notice when defaults
			// flipped the implicit 0.0.0.0 bind to loopback. Suppresses on
			// fresh installs where the user already saw the default; only
			// fires when settings existed but the field did not.
			if (this.settings.hasShownBindMigrationNotice === false) {
				if (wasExistingPreBindModeInstall) {
					new Notice(
						'MCP plugin: network binding now defaults to loopback only. ' +
							'If you previously accessed the MCP server from another machine on your LAN, ' +
							'open MCP settings → Network binding and switch to "All interfaces" or "Custom".',
						20000
					);
				}
				this.settings.hasShownBindMigrationNotice = true;
				await this.saveSettings();
			}
			
			// Debug log read-only mode status at startup
			if (this.settings.readOnlyMode) {
				Debug.log('🔒 READ-ONLY MODE detected in settings - will activate on server start');
			} else {
				Debug.log('✅ READ-ONLY MODE not enabled - normal operations mode');
			}

			// Initialize ignore manager
			this.ignoreManager = new MCPIgnoreManager(this.app);
			this.ignoreManager.setEnabled(this.settings.pathExclusionsEnabled);
			if (this.settings.pathExclusionsEnabled) {
				await this.ignoreManager.loadIgnoreFile();
				Debug.log('✅ Path exclusions initialized');
			} else {
				Debug.log('✅ Path exclusions disabled');
			}

			// Initialize vault context tracking
			this.initializeVaultContext();

			// Add settings tab
			this.addSettingTab(new MCPSettingTab(this.app, this));
			Debug.log('✅ Settings tab added');

			// Add command
			this.addCommand({
				id: 'restart-mcp-server'
				, name: 'Restart MCP server'
				, callback: async () => {
					Debug.log('🔄 MCP Server restart requested');
					await this.stopMCPServer();
					if (this.settings.httpEnabled || this.settings.httpsEnabled) {
						await this.startMCPServer();
					}
				}
			});
			Debug.log('✅ Command added');

			// Setup vault monitoring
			this.setupVaultMonitoring();

			// Register context menu for path exclusions
			if (this.settings.pathExclusionsEnabled && this.settings.enableIgnoreContextMenu) {
				this.registerContextMenu();
			}

			// Start MCP server if either HTTP or HTTPS is enabled
			if (this.settings.httpEnabled || this.settings.httpsEnabled) {
				await this.startMCPServer();
			} else {
				Debug.log('⚠️ Both HTTP and HTTPS servers are disabled in settings');
			}

			// Add status bar item
			this.updateStatusBar();
			Debug.log('✅ Status bar added');

			// Start stats update interval
			this.startStatsUpdates();

			Debug.log('🎉 Obsidian MCP Plugin loaded successfully');
		} catch (error) {
			Debug.error('❌ Error loading Obsidian MCP Plugin:', error);
			throw error; // Re-throw to show in Obsidian's plugin list
		}
	}

	onunload() {
		Debug.log('👋 Unloading Obsidian MCP Plugin');

		// Clear vault monitoring
		if (this.vaultSwitchTimeout) {
			window.clearTimeout(this.vaultSwitchTimeout);
		}

		// Clear stats updates
		if (this.statsUpdateInterval) {
			window.clearInterval(this.statsUpdateInterval);
		}

		void this.stopMCPServer();
	}

	async startMCPServer(): Promise<void> {
		try {
			// Determine which port to check based on whether HTTPS is enabled
			const isHttps = this.settings.httpsEnabled && this.settings.certificateConfig?.enabled;
			const portToUse = isHttps ? this.settings.httpsPort : this.settings.httpPort;
			const protocol = isHttps ? 'HTTPS' : 'HTTP';
			
			// Check for port conflicts and auto-switch if needed
			if (this.settings.autoDetectPortConflicts) {
				const status = await this.checkPortConflict(portToUse);
				if (status === 'in-use') {
					const suggestedPort = await this.findAvailablePort(portToUse);
					
					if (suggestedPort === 0) {
						// All alternate ports are busy
						const portsChecked = `${portToUse}, ${portToUse + 1}, ${portToUse + 2}, ${portToUse + 3}`;
						Debug.error(`❌ Failed to find available port after 3 attempts. Ports checked: ${portsChecked}`);
						Debug.error('Please check for other applications using these ports or firewall/security software blocking access.');
						new Notice(`Cannot start MCP server: Ports ${portToUse}-${portToUse + 3} are all in use. Check console for details.`);
						this.updateStatusBar();
						return;
					}
					
					Debug.log(`⚠️ ${protocol} Port ${portToUse} is in use, switching to port ${suggestedPort}`);
					new Notice(`${protocol} Port ${portToUse} is in use. Switching to port ${suggestedPort}`);
					
					// Temporarily use the suggested port for this session
					this.mcpServer = new MCPHttpServer(this.app, suggestedPort, this);
					await this.mcpServer.start();
					this.updateStatusBar();
					Debug.log(`✅ MCP server started on alternate ${protocol} port ${suggestedPort}`);
					if (this.settings.showConnectionStatus) {
						new Notice(`MCP server started on ${protocol} port ${suggestedPort} (default port was in use)`);
					}
					return;
				}
			}

			Debug.log(`🚀 Starting MCP server on ${protocol} port ${portToUse}...`);
			this.mcpServer = new MCPHttpServer(this.app, portToUse, this);
			await this.mcpServer.start();
			this.updateStatusBar();
			Debug.log('✅ MCP server started successfully');
			if (this.settings.showConnectionStatus) {
				new Notice(`MCP server started on ${protocol} port ${portToUse}`);
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			Debug.error('❌ Failed to start MCP server:', error);
			new Notice(`Failed to start MCP server: ${message}`);
			this.updateStatusBar();
		}
	}

	async stopMCPServer(): Promise<void> {
		if (this.mcpServer) {
			Debug.log('🛑 Stopping MCP server...');
			await this.mcpServer.stop();
			this.mcpServer = undefined;
			this.updateStatusBar();
			Debug.log('✅ MCP server stopped');
		}
	}

	private statusBarItem?: HTMLElement;

	updateStatusBar(): void {
		// Create the status bar element exactly once and mutate it thereafter.
		// Previously this remove()'d + addStatusBarItem()'d on every call;
		// updateStatusBar() fires several times during async startup, so
		// concurrent calls could each add an element while only the last was
		// tracked in this.statusBarItem — orphaning a transient "Mcp: error"
		// element that survived until the next Obsidian reload (#178).
		if (!this.statusBarItem) {
			this.statusBarItem = this.addStatusBarItem();
		}
		const item = this.statusBarItem;

		item.removeClass('mcp-statusbar-disabled', 'mcp-statusbar-running', 'mcp-statusbar-error', 'mcp-hidden');

		if (!this.settings.showConnectionStatus) {
			item.setText('');
			item.addClass('mcp-hidden');
			return;
		}

		if (!this.settings.httpEnabled && !this.settings.httpsEnabled) {
			item.setText('MCP: disabled');
			item.addClass('mcp-statusbar-disabled');
		} else if (this.mcpServer?.isServerRunning()) {
			const vaultName = this.app.vault.getName();
			const protocols: string[] = [];
			if (this.settings.httpEnabled) protocols.push(`HTTP:${this.settings.httpPort}`);
			if (this.settings.httpsEnabled) protocols.push(`HTTPS:${this.settings.httpsPort}`);
			item.setText(`MCP: ${vaultName} (${protocols.join(', ')})`);
			item.addClass('mcp-statusbar-running');
		} else {
			item.setText('MCP: error');
			item.addClass('mcp-statusbar-error');
		}
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData() as Partial<MCPPluginSettings>);

		// Coerce the security booleans loaded from data.json.
		//
		// loadData() returns whatever is on disk, and data.json is hand-editable.
		// The security predicate tests `=== true` while the settings toggle renders
		// with truthiness, so a string "true" would show the toggle ON while
		// read-only was NOT enforced — belief diverging from reality, which is the
		// exact shape of the bug this hardening came out of. Normalising here means
		// UI and enforcement read one value.
		this.settings.readOnlyMode = this.settings.readOnlyMode === true;
		this.settings.dangerouslyDisableAuth = this.settings.dangerouslyDisableAuth === true;
		this.settings.enableWebFetch = this.settings.enableWebFetch === true;
		this.settings.allowCreateOverwrite = this.settings.allowCreateOverwrite === true;

		// ADR-109: fetch_web moved from the visibility tree to the dedicated
		// enableWebFetch setting. A leftover visibility key would be a second
		// switch for the same capability — with AND semantics nobody chose — so
		// retire it. The key could only have expressed "off", which is what the
		// new default already says.
		if ('system.fetch_web' in this.settings.toolVisibility) {
			delete this.settings.toolVisibility['system.fetch_web'];
			await this.saveSettings();
		}

		// Generate API key on first load if not present
		if (!this.settings.apiKey) {
			this.settings.apiKey = this.generateApiKey();
			await this.saveSettings();
			Debug.log('🔐 Generated new API key for authentication');
		}

		// ADR-110: drop malformed scoped tokens and normalize folders
		this.settings.scopedTokens = normalizeScopedTokens(this.settings.scopedTokens);

		// ADR-111: session lifetime policy. Both fail closed on hand-edited
		// values: an invalid timespan means never expire, an invalid cap means 1.
		this.settings.sessionTimeoutMs = typeof this.settings.sessionTimeoutMs === 'number' && this.settings.sessionTimeoutMs >= 0
			? this.settings.sessionTimeoutMs
			: 0;
		this.settings.sessionsPerToken = typeof this.settings.sessionsPerToken === 'number' && this.settings.sessionsPerToken >= 1
			? Math.floor(this.settings.sessionsPerToken)
			: 1;
	}

	
	public generateApiKey(): string {
		// Generate a secure random API key
		const bytes = randomBytes(32);
		return bytes.toString('base64url');
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	async checkPortConflict(port: number): Promise<'available' | 'this-server' | 'in-use'> {
		try {
			// Check if this is our own server
			if (this.mcpServer?.isServerRunning() && this.settings.httpPort === port) {
				return 'this-server';
			}

			// Try to create a temporary server to test port availability
			// eslint-disable-next-line @typescript-eslint/no-require-imports -- Dynamic require needed for Node.js http module in Obsidian desktop environment
			const http = require('http') as typeof import('http');
			const testServer = http.createServer();
			return new Promise((resolve) => {
				testServer.listen(port, '127.0.0.1', () => {
					testServer.close(() => resolve('available')); // Port is available
				});
				testServer.on('error', () => resolve('in-use')); // Port is in use
			});
		} catch {
			return 'available'; // Assume available if we can't test
		}
	}

	private async findAvailablePort(startPort: number): Promise<number> {
		const maxRetries = 3;
		for (let i = 1; i <= maxRetries; i++) {
			const port = startPort + i;
			const status = await this.checkPortConflict(port);
			if (status === 'available') {
				return port;
			}
			Debug.log(`Port ${port} is also in use, trying next...`);
		}
		// If all 3 alternate ports are busy, return 0 to indicate failure
		return 0;
	}

	getMCPServerInfo(): MCPServerInfo {
		const poolStats = this.mcpServer?.getConnectionPoolStats();

		return {
			version: getVersion()
			, running: this.mcpServer?.isServerRunning() || false
			, httpEnabled: this.settings.httpEnabled
			, httpsEnabled: this.settings.httpsEnabled
			, httpPort: this.settings.httpPort
			, httpsPort: this.settings.httpsPort
			, vaultName: this.app.vault.getName()
			, vaultPath: this.getVaultPath()
			, toolsCount: 6
			, resourcesCount: 2 // vault-info + session-info
			, connections: this.mcpServer?.getConnectionCount() ?? -1
			, poolStats: poolStats
		};
	}

	private startStatsUpdates(): void {
		// Update stats every 3 seconds
		this.statsUpdateInterval = window.setInterval(() => {
			// Update status bar with latest info
			this.updateStatusBar();
			
			// Update live stats in settings panel if it's open
			const appWithSetting = this.app as unknown as { setting?: { activeTab?: PluginSettingTab } };
			const settingsTab = appWithSetting.setting?.activeTab;
			if (settingsTab && settingsTab instanceof MCPSettingTab) {
				settingsTab.updateLiveStats();
			}
		}, 3000);
	}

	private initializeVaultContext(): void {
		this.currentVaultName = this.app.vault.getName();
		this.currentVaultPath = this.getVaultPath();
		Debug.log(`📁 Initial vault context: ${this.currentVaultName} at ${this.currentVaultPath}`);
	}

	private getVaultPath(): string {
		try {
			// Try to get the vault path from the adapter
			const adapter = this.app.vault.adapter;
			if (adapter instanceof FileSystemAdapter) {
				return adapter.getBasePath();
			}
			return '';
		} catch {
			return '';
		}
	}

	public registerContextMenu(): void {
		// Register file menu
		this.registerEvent(
			this.app.workspace.on('file-menu', (menu, file) => {
				if (!this.ignoreManager || !this.settings.pathExclusionsEnabled || !this.settings.enableIgnoreContextMenu) {
					return;
				}

				menu.addItem((item) => {
					item
						.setTitle('Add to .mcpignore')
						.setIcon('x-circle')
						.onClick(async () => {
							try {
								// Ensure .mcpignore exists
								const exists = await this.ignoreManager!.ignoreFileExists();
								if (!exists) {
									await this.ignoreManager!.createDefaultIgnoreFile();
								}

								// Get relative path from vault root
								const relativePath = file.path;
								let pattern = relativePath;

								// If it's a folder, add trailing slash
								if (file instanceof TFolder) {
									pattern = relativePath + '/';
								}

								// Read current content or use empty string if file doesn't exist
								let currentContent = '';
								try {
									currentContent = await this.app.vault.adapter.read('.mcpignore');
								} catch {
									Debug.log('.mcpignore not found when reading, will create new');
									currentContent = '';
								}
								
								// Append new pattern
								const newContent = currentContent.trimEnd() + '\n' + pattern + '\n';
								await this.app.vault.adapter.write('.mcpignore', newContent);

								// Reload patterns
								await this.ignoreManager!.forceReload();

								new Notice(`✅ Added "${pattern}" to .mcpignore`);
								Debug.log(`Added pattern to .mcpignore: ${pattern}`);
							} catch (error: unknown) {
								Debug.log('Failed to add to .mcpignore:', error);
								const errorMsg = error instanceof Error ? error.message : 'Unknown error';
								new Notice(`❌ Failed to add to .mcpignore: ${errorMsg}`);
							}
						});
				});
			})
		);
	}

	private setupVaultMonitoring(): void {
		// Monitor layout changes which might indicate vault context changes
		this.registerEvent(
			this.app.workspace.on('layout-change', () => {
				this.checkVaultContext();
			})
		);

		// Monitor file operations that can help detect vault changes
		this.registerEvent(
			this.app.vault.on('create', () => {
				this.checkVaultContext();
			})
		);

		// Also monitor on active leaf changes
		this.registerEvent(
			this.app.workspace.on('active-leaf-change', () => {
				this.checkVaultContext();
			})
		);

		// Periodic check as fallback (every 30 seconds)
		this.registerInterval(
			window.setInterval(() => {
				this.checkVaultContext();
			}, 30000)
		);
	}

	private checkVaultContext(): void {
		const newVaultName = this.app.vault.getName();
		const newVaultPath = this.getVaultPath();

		// Check if vault has changed (name or path)
		if (newVaultName !== this.currentVaultName ||
			(newVaultPath && newVaultPath !== this.currentVaultPath)) {

			void this.handleVaultSwitch(
				this.currentVaultName,
				newVaultName,
				this.currentVaultPath,
				newVaultPath
			);
		}
	}

	private handleVaultSwitch(
		oldVaultName: string,
		newVaultName: string,
		oldVaultPath: string,
		newVaultPath: string
	): void {
		Debug.log(`🔄 Vault switch detected: ${oldVaultName} → ${newVaultName}`);
		Debug.log(`📁 Path change: ${oldVaultPath} → ${newVaultPath}`);

		// Update current context
		this.currentVaultName = newVaultName;
		this.currentVaultPath = newVaultPath;

		// Show notification if enabled
		if (this.settings.showConnectionStatus) {
			new Notice(`MCP Plugin: Switched to vault "${newVaultName}"`);
		}

		// Restart MCP server to use new vault context
		if ((this.settings.httpEnabled || this.settings.httpsEnabled) && this.mcpServer?.isServerRunning()) {
			Debug.log('🔄 Restarting MCP server for new vault context...');
			
			// Use a small delay to avoid rapid restarts
			if (this.vaultSwitchTimeout) {
				window.clearTimeout(this.vaultSwitchTimeout);
			}
			
			this.vaultSwitchTimeout = window.setTimeout(() => {
				void (async () => {
					await this.stopMCPServer();
					await this.startMCPServer();
					Debug.log(`✅ MCP server restarted for vault: ${newVaultName}`);
				})();
			}, 1000); // 1 second delay
		}

		// Update status bar to reflect new vault
		this.updateStatusBar();
	}
}

class MCPSettingTab extends PluginSettingTab {
	plugin: ObsidianMCPPlugin;
	private easterEggClicks = 0;
	private easterEggTimeout?: number;

	constructor(app: App, plugin: ObsidianMCPPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	/**
	 * The settings UI is fully declarative (minAppVersion 1.13.0): Obsidian
	 * renders the tab from these definitions and indexes them for settings
	 * search. There is no imperative display() path — on 1.13 it is never
	 * called when definitions exist. The definitions live in settings/ui.ts;
	 * this class binds them to the plugin and carries the side effects.
	 */
	getSettingDefinitions(): SettingDefinitionItem[] {
		return buildSettingsUI(this.host);
	}

	/** The host surface the UI module renders against. Assembled per access;
	 * every method reads live state, so it never goes stale. */
	private get host(): SettingsUIHost {
		const plugin = this.plugin;
		return {
			app: this.app
			, settings: plugin.settings
			, ignoreManager: plugin.ignoreManager
			, saveSettings: () => plugin.saveSettings()
			, generateApiKey: () => plugin.generateApiKey()
			, getServerInfo: () => plugin.getMCPServerInfo()
			, restartIfRunning: (what) => this.restartIfRunning(what)
			, applyCustomBindHost: () => this.applyCustomBindHost()
			, notifyToolListChanged: () => plugin.mcpServer?.notifyToolListChanged()
			, updateStatusBar: () => plugin.updateStatusBar()
			, registerContextMenu: () => plugin.registerContextMenu()
			, confirm: (message, onConfirm) => new ConfirmationModal(this.app, message, onConfirm).open()
			, onVersionClick: () => this.handleEasterEggClick()
			, isDataviewAvailable: () => new PluginDetector(this.app).isPluginEnabled('dataview')
			, dataviewVersion: () => new PluginDetector(this.app).getDataviewStatus().version ?? 'unknown'
			, update: () => this.update()
		};
	}

	/**
	 * The 3-second stats ticker, called by the plugin's interval when this tab
	 * is open. Surgical DOM updates only: a full update() here would rebuild
	 * the tab and steal focus from any field being typed.
	 */
	updateLiveStats(): void {
		const info = this.plugin.getMCPServerInfo();
		const connectionEl = activeDocument.querySelector('.mcp-status-grid');
		if (connectionEl) {
			const connectionItems = connectionEl.querySelectorAll('div');
			for (let i = 0; i < connectionItems.length; i++) {
				const item = connectionItems[i];
				const text = item.textContent || '';
				const valueSpan = item.querySelector('span');

				if (text.includes('Status:') && valueSpan) {
					valueSpan.textContent = info.running ? 'Running' : 'Stopped';
					valueSpan.classList.remove('mcp-status-value', 'success', 'error');
					valueSpan.classList.add('mcp-status-value', info.running ? 'success' : 'error');
				} else if (text.includes('Port:') && valueSpan) {
					valueSpan.textContent = (info.httpsEnabled ? info.httpsPort : info.httpPort).toString();
				} else if (text.includes('Connections:') && valueSpan) {
					// The row keeps its grid slot: text when stopped, unknown
					// for the -1 sentinel, otherwise the count.
					valueSpan.textContent = !info.running
						? 'Server stopped'
						: info.connections >= 0 ? info.connections.toString() : 'unknown';
				}
			}
		}

		// Keep the JSON config snippet in step with live port/auth state.
		const protocolSection = activeDocument.querySelector('.protocol-command-example');
		if (protocolSection instanceof HTMLElement && info) {
			renderJsonConfigBlock(protocolSection, this.plugin.settings, this.app.vault.getName());
		}
	}

	/**
	 * Control-key resolution for the declarative rows. Plain settings keys
	 * read through; synthetic keys map to derived or nested state:
	 * 'sessionsNeverExpire' and 'sessionTimeoutMinutes' derive from
	 * sessionTimeoutMs, 'cert*' keys live in the certificateConfig object,
	 * and 'vis.<op>[.<action>]' keys live in the toolVisibility record.
	 */
	override getControlValue(key: string): unknown {
		const s = this.plugin.settings;
		if (key.startsWith('vis.')) {
			return s.toolVisibility[key.slice(4)] !== false;
		}
		switch (key) {
			case 'sessionsNeverExpire': return s.sessionTimeoutMs === 0;
			case 'sessionTimeoutMinutes': return Math.max(1, Math.round(s.sessionTimeoutMs / 60000));
			case 'certAutoGenerate': return s.certificateConfig.autoGenerate === true;
			case 'certPath': return s.certificateConfig.certPath ?? '';
			case 'certKeyPath': return s.certificateConfig.keyPath ?? '';
			case 'certMinTLSVersion': return s.certificateConfig.minTLSVersion ?? 'TLSv1.2';
			default: return (s as unknown as Record<string, unknown>)[key];
		}
	}

	/**
	 * Every settings write goes through here, so the side effects stay in one
	 * place: server restarts for listener changes, tool-list notifications
	 * for surface changes, and this.update() whenever rows, visibility, or
	 * row content must be re-read.
	 */
	override async setControlValue(key: string, value: unknown): Promise<void> {
		const s = this.plugin.settings;
		const plugin = this.plugin;
		const bool = value === true;
		const num = typeof value === 'number' ? value : Number(value);

		if (key.startsWith('vis.')) {
			const visKey = key.slice(4);
			const visibility = s.toolVisibility;
			visibility[visKey] = bool;
			if (!visKey.includes('.')) {
				// Operation toggle cascades to every advertised action.
				for (const action of getActionsForOperation(visKey)) {
					visibility[`${visKey}.${action}`] = bool;
				}
			} else {
				// Action toggle re-aggregates the operation key.
				const op = visKey.slice(0, visKey.indexOf('.'));
				const actions = getActionsForOperation(op);
				if (actions.every(a => visibility[`${op}.${a}`] !== false)) {
					delete visibility[op];
				} else if (actions.every(a => visibility[`${op}.${a}`] === false)) {
					visibility[op] = false;
				} else {
					delete visibility[op];
				}
			}
			await plugin.saveSettings();
			plugin.mcpServer?.notifyToolListChanged();
			this.update();
			return;
		}

		switch (key) {
			case 'httpEnabled': {
				s.httpEnabled = bool;
				await plugin.saveSettings();
				if (plugin.mcpServer?.isServerRunning()) {
					await plugin.stopMCPServer();
					await plugin.startMCPServer();
				} else if (bool) {
					await plugin.startMCPServer();
				}
				this.update();
				return;
			}
			case 'httpsEnabled': {
				s.httpsEnabled = bool;
				s.certificateConfig.enabled = bool;
				await plugin.saveSettings();
				if (plugin.mcpServer?.isServerRunning()) {
					new Notice('Restarting server with new protocol settings...');
					await plugin.stopMCPServer();
					await plugin.startMCPServer();
				} else if (bool && (s.httpEnabled || s.httpsEnabled)) {
					await plugin.startMCPServer();
				}
				this.update();
				return;
			}
			case 'httpPort':
			case 'httpsPort': {
				if (key === 'httpPort') s.httpPort = num; else s.httpsPort = num;
				await plugin.saveSettings();
				await this.restartIfRunning('port');
				this.update();
				return;
			}
			case 'bindMode': {
				s.bindMode = value as BindMode;
				if (s.bindMode !== 'custom') s.customBindHost = '';
				await plugin.saveSettings();
				await this.restartIfRunning('bind address');
				this.update();
				return;
			}
			case 'customBindHost': {
				// Saved raw on every commit. Normalization and the restart ride
				// the explicit Apply action row, so typing cannot flip the mode
				// mid-edit or restart the server per keystroke.
				s.customBindHost = String(value);
				await plugin.saveSettings();
				return;
			}
			case 'sessionsNeverExpire': {
				s.sessionTimeoutMs = bool ? 0 : 3600000;
				await plugin.saveSettings();
				this.update();
				return;
			}
			case 'sessionTimeoutMinutes': {
				s.sessionTimeoutMs = Math.max(1, Math.floor(num)) * 60000;
				await plugin.saveSettings();
				return;
			}
			case 'sessionsPerToken': {
				s.sessionsPerToken = Math.max(1, Math.floor(num));
				await plugin.saveSettings();
				return;
			}
			case 'rateLimitPerMinute': {
				// ADR-112: 0 = disabled. Malformed input falls back to disabled,
				// never to an accidental limit.
				s.rateLimitPerMinute = Number.isFinite(num) ? Math.max(0, Math.floor(num)) : 0;
				await plugin.saveSettings();
				return;
			}
			case 'certAutoGenerate': {
				s.certificateConfig.autoGenerate = bool;
				await plugin.saveSettings();
				this.update();
				return;
			}
			case 'certPath':
			case 'certKeyPath': {
				const v = String(value);
				if (key === 'certPath') s.certificateConfig.certPath = v || undefined;
				else s.certificateConfig.keyPath = v || undefined;
				await plugin.saveSettings();
				this.update();
				return;
			}
			case 'certMinTLSVersion': {
				s.certificateConfig.minTLSVersion = value as 'TLSv1.2' | 'TLSv1.3';
				await plugin.saveSettings();
				return;
			}
			case 'readOnlyMode': {
				s.readOnlyMode = bool;
				await plugin.saveSettings();
				if (bool) {
					Debug.log('🔒 READ-ONLY MODE ENABLED via settings - effective immediately');
					new Notice('🔒 Read-only mode enabled. Write operations are blocked.');
				} else {
					Debug.log('✅ READ-ONLY MODE DISABLED via settings - effective immediately');
					new Notice('✅ Read-only mode disabled. All operations are allowed.');
				}
				return;
			}
			case 'enableWebFetch': {
				s.enableWebFetch = bool;
				await plugin.saveSettings();
				plugin.mcpServer?.notifyToolListChanged();
				if (bool) {
					new Notice('🌐 Outbound web fetch enabled. Internal addresses remain blocked.');
				} else {
					new Notice('✅ Outbound web fetch disabled. The plugin makes no outbound connections.');
				}
				return;
			}
			case 'pathExclusionsEnabled': {
				s.pathExclusionsEnabled = bool;
				await plugin.saveSettings();
				if (plugin.ignoreManager) {
					plugin.ignoreManager.setEnabled(bool);
					if (bool) {
						await plugin.ignoreManager.loadIgnoreFile();
						new Notice('✅ Path exclusions enabled');
					} else {
						new Notice('🔓 Path exclusions disabled');
					}
				}
				this.update();
				return;
			}
			case 'enableIgnoreContextMenu': {
				s.enableIgnoreContextMenu = bool;
				await plugin.saveSettings();
				if (bool) {
					plugin.registerContextMenu();
					new Notice('✅ Context menu enabled - restart required for full effect');
				} else {
					new Notice('🔓 Context menu disabled - restart required for full effect');
				}
				return;
			}
			case 'dangerouslyDisableAuth': {
				s.dangerouslyDisableAuth = bool;
				await plugin.saveSettings();
				if (bool) {
					new Notice('⚠️ authentication disabled! Your vault is accessible without credentials.');
				} else {
					new Notice('✅ Authentication enabled. API key required for access.');
				}
				this.update();
				return;
			}
			case 'allowCreateOverwrite': {
				s.allowCreateOverwrite = bool;
				await plugin.saveSettings();
				plugin.mcpServer?.notifyToolListChanged();
				return;
			}
			case 'showConnectionStatus': {
				s.showConnectionStatus = bool;
				await plugin.saveSettings();
				plugin.updateStatusBar();
				return;
			}
			case 'debugLogging': {
				s.debugLogging = bool;
				Debug.setDebugMode(bool);
				await plugin.saveSettings();
				return;
			}
			case 'autoDetectPortConflicts': {
				s.autoDetectPortConflicts = bool;
				await plugin.saveSettings();
				return;
			}
			default: {
				(s as unknown as Record<string, unknown>)[key] = value;
				await plugin.saveSettings();
			}
		}
	}

	private async restartIfRunning(changedThing: string): Promise<void> {
		if (this.plugin.mcpServer?.isServerRunning()) {
			new Notice(`Restarting server with new ${changedThing}...`);
			await this.plugin.stopMCPServer();
			await this.plugin.startMCPServer();
		}
	}

	/** Normalize and apply the custom bind address (the Apply action row). */
	private async applyCustomBindHost(): Promise<void> {
		const s = this.plugin.settings;
		const normalized = normalizeBindInput('custom', s.customBindHost);
		s.bindMode = normalized.mode;
		s.customBindHost = normalized.customHost;
		await this.plugin.saveSettings();
		await this.restartIfRunning('bind address');
		this.update();
	}

	private handleEasterEggClick(): void {
		if (this.easterEggTimeout) {
			window.clearTimeout(this.easterEggTimeout);
		}
		this.easterEggClicks++;
		this.easterEggTimeout = window.setTimeout(() => {
			this.easterEggClicks = 0;
		}, 3000);
		if (this.easterEggClicks >= 7) {
			this.easterEggClicks = 0;
			new NoteTakingEnthusiastModal(this.app).open();
		}
	}
}

class NoteTakingEnthusiastModal extends Modal {
	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('mcp-easter-egg-modal');
		contentEl.createEl('h2', { text: 'You found the secret!' });
		const imageContainer = contentEl.createDiv('mcp-easter-egg-image-container');
		const img = imageContainer.createEl('img', { cls: 'mcp-easter-egg-image' });
		img.src = 'data:image/jpeg;base64,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';
		img.alt = 'Note Taking Enthusiast';
		contentEl.createEl('p', { text: 'Thanks for being an Obsidian enthusiast!', cls: 'mcp-easter-egg-thanks' });
	}
	onClose() {
		this.contentEl.empty();
	}
}

class ConfirmationModal extends Modal {
	private message: string;
	private onConfirm: () => void | Promise<void>;

	constructor(app: App, message: string, onConfirm: () => void | Promise<void>) {
		super(app);
		this.message = message;
		this.onConfirm = onConfirm;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl('p', { text: this.message });

		const buttonContainer = contentEl.createDiv('modal-button-container');

		const cancelButton = buttonContainer.createEl('button', { text: 'Cancel' });
		cancelButton.addEventListener('click', () => {
			this.close();
		});

		const confirmButton = buttonContainer.createEl('button', { text: 'Confirm', cls: 'mod-warning' });
		confirmButton.addEventListener('click', () => {
			void Promise.resolve(this.onConfirm()).then(() => this.close());
		});
	}

	onClose() {
		this.contentEl.empty();
	}
}
