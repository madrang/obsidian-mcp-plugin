/**
 * The host surface the declarative settings UI needs from the settings tab.
 * Structural, so the test suite can drive buildSettingsUI with a fake.
 */
import { App } from 'obsidian';
import type { MCPIgnoreManager } from '../security/mcp-ignore-manager';
import type { MCPPluginSettings, MCPServerInfo } from './plugin-settings';

export interface SettingsUIHost {
  app: App;
  settings: MCPPluginSettings;
  ignoreManager?: MCPIgnoreManager;
  saveSettings(): Promise<void>;
  generateApiKey(): string;
  getServerInfo(): MCPServerInfo | undefined;
  restartIfRunning(what: string): Promise<void>;
  /** Normalize and apply the custom bind address (the Apply action row). */
  applyCustomBindHost(): Promise<void>;
  notifyToolListChanged(): void;
  updateStatusBar(): void;
  registerContextMenu(): void;
  /** Confirmation modal for destructive actions. */
  confirm(message: string, onConfirm: () => void | Promise<void>): void;
  /** Version-label click in the status grid (easter egg counter lives on the tab). */
  onVersionClick(): void;
  isDataviewAvailable(): boolean;
  dataviewVersion(): string;
  /** Structural re-read of the definitions (added/removed rows, visibility). */
  update(): void;
}
