/**
 * The settings tab: binds the declarative definitions (settings/ui.ts) to
 * the plugin and carries every side effect of a settings write — server
 * restarts, notices, tool-list notifications.
 */
import { App, PluginSettingTab, Notice, SettingDefinitionItem } from 'obsidian';
import type ObsidianMCPPlugin from '../main';
import { PluginDetector } from '../utils/plugin-detector';
import { getActionsForOperation } from '../tools/tool-factory';
import { BindMode, normalizeBindInput } from '../utils/network-classifier';
import { Debug } from '../utils/debug';
import { buildSettingsUI, renderJsonConfigBlock } from './ui';
import type { SettingsUIHost } from './host-types';
import { ConfirmationModal, NoteTakingEnthusiastModal } from './modals';

export class MCPSettingTab extends PluginSettingTab {
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
			case 'allowSnippetEditing': {
				s.allowSnippetEditing = bool;
				await plugin.saveSettings();
				if (bool) {
					new Notice('✅ Snippet editing enabled. Agents can now write CSS snippets. Delete is permanent.');
				} else {
					new Notice('🔒 Snippet editing disabled. Snippet reads stay available.');
				}
				return;
			}
			case 'allowConfigEditing': {
				s.allowConfigEditing = bool;
				await plugin.saveSettings();
				if (bool) {
					new Notice('✅ Config editing enabled. Agents can now change app settings. Changes apply when Obsidian reloads them.');
				} else {
					new Notice('🔒 Config editing disabled. Config reads stay available.');
				}
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
