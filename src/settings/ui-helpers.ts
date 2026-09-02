/**
 * Shared building blocks of the settings groups: the copy button, the JSON
 * config block, the row/description render helpers, and the control
 * validators.
 */
import { Notice, Setting, setIcon } from 'obsidian';
import type { SettingDefinitionGroup } from 'obsidian';
import { Debug } from '../utils/debug';
import type { MCPPluginSettings } from './plugin-settings';

export type Group = SettingDefinitionGroup;

/** Copy-to-clipboard button with the 2-second success flash. */
export function addCopyButton(container: HTMLElement, textToCopy: string): void {
  container.classList.add('mcp-config-container');
  const copyButton = container.createEl('button', { cls: 'mcp-copy-button' });
  copyButton.setAttribute('aria-label', 'Copy to clipboard');
  setIcon(copyButton, 'copy');
  copyButton.addEventListener('click', () => {
    void (async () => {
      try {
        await navigator.clipboard.writeText(textToCopy);
        copyButton.classList.add('success');
        setIcon(copyButton, 'check');
        window.setTimeout(() => {
          setIcon(copyButton, 'copy');
          copyButton.classList.remove('success');
        }, 2000);
      } catch (error) {
        new Notice('Failed to copy to clipboard');
        Debug.error('Failed to copy to clipboard:', error);
      }
    })();
  });
}

/**
 * The JSON-config snippet block, shared by the getting-started render row
 * and the tab's 3-second live updater. Empties the container first.
 */
export function renderJsonConfigBlock(container: HTMLElement, settings: MCPPluginSettings, vaultName: string): void {
  container.empty();
  const protocol = settings.httpsEnabled ? 'https' : 'http';
  const port = settings.httpsEnabled ? settings.httpsPort : settings.httpPort;
  const mcpUrl = `${protocol}://localhost:${port}/mcp`;
  const configJson = settings.dangerouslyDisableAuth ? {
    "mcpServers": { [vaultName]: { "transport": { "type": "http", "url": mcpUrl } } }
  } : {
    "mcpServers": {
      [vaultName]: {
        "transport": { "type": "http", "url": mcpUrl, "headers": { "Authorization": `Bearer ${settings.apiKey}` } }
      }
    }
  };
  const configJsonText = JSON.stringify(configJson, null, 2);
  const configEl = container.createEl('pre');
  configEl.classList.add('mcp-config-example');
  configEl.textContent = configJsonText;
  addCopyButton(container, configJsonText);
}

export function validatePort(value: number): string | void {
  if (!Number.isInteger(value) || value <= 0 || value >= 65536) {
    return 'Port must be a whole number between 1 and 65535';
  }
}

export function validateMinutes(value: number): string | void {
  if (!Number.isInteger(value) || value < 1) {
    return 'Timeout must be at least 1 minute';
  }
}

export function validateSessionCap(value: number): string | void {
  if (!Number.isInteger(value) || value < 1) {
    return 'The limit must be at least 1';
  }
}

// The shipped default is "never" (sessionTimeoutMs 0). 60 minutes is the
// suggested value once expiry is on, so it is both the placeholder and the
// refill when the field is emptied.
export const DEFAULT_SESSION_TIMEOUT_MINUTES = 60;

export function validateRateLimit(value: number): string | void {
  if (!Number.isInteger(value) || value < 0) {
    return 'Rate limit must be 0 (disabled) or a whole number of calls per minute';
  }
}

/**
 * One div per line. An empty div has no line box, so blank separator lines
 * use a no-break space to keep the paragraph gap without CSS. The framework
 * reads the fragment's textContent for search.
 */
export function multilineDesc(lines: string[]): DocumentFragment {
  const frag = createFragment();
  for (const line of lines) {
    frag.appendChild(createDiv({ text: line === '' ? '\u00A0' : line }));
  }
  return frag;
}

/**
 * A switch's description: the permanent one-line summary first, the
 * tool-level or action-owned description lines boxed below it. The box keeps
 * the wall of text off the summary line while the description stays one
 * keystroke away.
 */
export function boxedDesc(intro: string, lines: string[]): DocumentFragment {
  const frag = createFragment();
  frag.appendChild(createDiv({ text: intro }));
  const box = createDiv({ cls: 'mcp-action-desc-box' });
  box.appendChild(multilineDesc(lines));
  frag.appendChild(box);
  return frag;
}

/**
 * update() re-invokes a render callback into the same Setting element rather
 * than rebuilding the row. A render callback must therefore reset the areas
 * it fills — the control area (addText/addButton and friends append there)
 * and its `.mcp-render-block` child — or every update() appends a second
 * copy of the row's content. The framework-managed name and description sit
 * outside both areas and survive.
 */
export function resetRenderRow(setting: Setting): HTMLElement {
  setting.settingEl.addClass('mcp-has-render-block');
  setting.controlEl.empty();
  const existing = setting.settingEl.querySelector<HTMLElement>(':scope > .mcp-render-block');
  if (existing) {
    existing.empty();
    return existing;
  }
  return setting.settingEl.createDiv('mcp-render-block');
}
