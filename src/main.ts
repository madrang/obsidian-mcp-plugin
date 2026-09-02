import { Plugin, Notice, TFolder, FileSystemAdapter } from 'obsidian';
import { MCPHttpServer } from './mcp-server';
import { getVersion } from './version';
import { Debug } from './utils/debug';
import { MCPIgnoreManager } from './security/mcp-ignore-manager';
import { randomBytes } from 'crypto';
import { checkPortConflict, findAvailablePort } from './utils/port-probe';
import { MCPPluginSettings, MCPServerInfo, DEFAULT_SETTINGS, normalizeLoadedSettings } from './settings/plugin-settings';
import { MCPSettingTab } from './settings/tab';

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
				const isOwnServer = (port: number) =>
					!!this.mcpServer?.isServerRunning() && this.settings.httpPort === port;
				const status = await checkPortConflict(portToUse, isOwnServer);
				if (status === 'in-use') {
					const suggestedPort = await findAvailablePort(portToUse, isOwnServer);

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
		this.settings = normalizeLoadedSettings(
			Object.assign({}, DEFAULT_SETTINGS, await this.loadData() as Partial<MCPPluginSettings>)
		);

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
	}


	public generateApiKey(): string {
		// Generate a secure random API key
		const bytes = randomBytes(32);
		return bytes.toString('base64url');
	}

	async saveSettings() {
		await this.saveData(this.settings);
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
			, resourcesCount: this.mcpServer?.getResourceCount() ?? 0
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
			const appWithSetting = this.app as unknown as { setting?: { activeTab?: MCPSettingTab } };
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
