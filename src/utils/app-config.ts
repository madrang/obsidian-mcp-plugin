/**
 * The obsidian://config/ namespace: the app's own settings, exposed as
 * JSON text over the normal tool actions (ADR-113).
 *
 * One URI addresses one config key: obsidian://config/cssTheme,
 * obsidian://config/enabledCssSnippets. A read serves the current value
 * as pretty-printed JSON text, so every view action and edit action works
 * on it like any file. A write parses the edited text and applies it with
 * setConfig. Nothing reaches setConfig unless it parsed as JSON: a
 * malformed edit is refused with INVALID_CONFIG_JSON and the config stays
 * untouched.
 *
 * The config API is internal. Its verified shape in the live app bundle
 * (obsidian-1.13.7.asar, 2026-08-31):
 *   getConfig(key)   in-memory value, defaults fallback, deep-copied
 *   setConfig(key)   set + debounced save + "config-changed" event
 * getConfig answers undefined for an unknown key: that is the namespace's
 * not-found. Writes persist immediately and apply when the app next reads
 * that setting — nothing in the CSS subsystem listens to "config-changed",
 * so an enabledCssSnippets write applies at the next Obsidian restart.
 * The security layer gates writes behind the "Allow config editing"
 * setting (VaultSecurityManager, default off); reads are open.
 */
import { App } from 'obsidian';
import { applySnippetEnabledDelta } from './css-snippets';

export const CONFIG_URI_PREFIX = 'obsidian://config/';
const CONFIG_BARE_NAMESPACE = 'obsidian://config';
const MAX_CONFIG_KEY_LENGTH = 255;

/**
 * One catalog entry, shaped like a tool parameter definition: a
 * JSON-Schema-style type plus a one-line description.
 */
export interface ConfigKeyInfo {
  type: 'string' | 'boolean' | 'number' | 'array' | 'object';
  description: string;
}

/**
 * The curated catalog of config keys, for namespace discovery. The app has
 * no enumerable config registry: the defaults object in the bundle is
 * minified, so a runtime walk would depend on an unstable name.
 *
 * Each entry documents the key the way a tool parameter is documented:
 * the JSON type of the value and what the key controls. The type names the
 * shape a read serves as JSON text, so an agent knows what a write must
 * parse back into.
 *
 * Maintenance: keep this catalog current. After an Obsidian update,
 * re-read the defaults registry from the live app bundle and diff it
 * against these keys. The verification path: resolve the asar the wrapper
 * actually loads (on Linux the installed base package can lag the running
 * version — see ADR-113), then read the defaults object near
 * `alwaysUpdateLinks`. The keys and types below were verified against
 * obsidian-1.13.7.asar on 2026-08-31.
 *
 * Replacement: the day Obsidian exposes a way to enumerate config keys, a
 * typed registry or a documented listing method, replace this constant and
 * the folder branch that serves it with that enumeration. The catalog is a
 * stand-in for a missing API, not a design goal.
 *
 * The catalog is deliberately curated, not complete: a missing key still
 * reads and writes fine through obsidian://config/<key> — the catalog only
 * drives the folder listing. Mobile-only keys are left out.
 */
export const CONFIG_KEYS: Readonly<Record<string, ConfigKeyInfo>> = {
  // Links and file handling
  alwaysUpdateLinks: { type: 'boolean', description: 'Update internal links automatically on rename or move.' }
  , newLinkFormat: { type: 'string', description: 'Format for new links: shortest, longest, or absolute.' }
  , useMarkdownLinks: { type: 'boolean', description: 'Use Markdown links instead of Wikilinks.' }
  , attachmentFolderPath: { type: 'string', description: 'Folder for new attachments. "/" means the vault root.' }
  , newFileLocation: { type: 'string', description: 'Where new notes are created: the vault root, the current folder, or a fixed folder.' }
  , newFileFolderPath: { type: 'string', description: 'The fixed folder when newFileLocation names one.' }
  , showUnsupportedFiles: { type: 'boolean', description: 'Show files Obsidian cannot open.' }
  , focusNewTab: { type: 'boolean', description: 'Focus a new tab when it opens.' }
  , defaultViewMode: { type: 'string', description: 'Default view for new notes: source or reading.' }
  , openBehavior: { type: 'string', description: 'How a link opens when the app is already open. Empty means the default.' }
  , promptDelete: { type: 'boolean', description: 'Ask before deleting a file.' }
  , trashOption: { type: 'string', description: 'Where deleted files go: system trash, vault trash, or permanent.' }
  , deleteUnlinkedAttachments: { type: 'string', description: 'What happens to attachments no note links to when their note is deleted. The default asks.' }
  , uriCallbacks: { type: 'boolean', description: 'Allow obsidian:// callbacks to reach the app.' }
  , userIgnoreFilters: { type: 'array', description: 'User patterns for files Obsidian should ignore. Null means none.' }
  // Editor
  , spellcheck: { type: 'boolean', description: 'Spell checking in the editor.' }
  , spellcheckLanguages: { type: 'array', description: 'Languages for spell checking. Null means the app default.' }
  , readableLineLength: { type: 'boolean', description: 'Limit the line width for readability.' }
  , strictLineBreaks: { type: 'boolean', description: 'Treat every single line break as a paragraph end.' }
  , propertiesInDocument: { type: 'string', description: 'Where note properties show: visible, hidden, or only in source.' }
  , showInlineTitle: { type: 'boolean', description: 'Show the file name as a title inside the note.' }
  , autoPairBrackets: { type: 'boolean', description: 'Close brackets as you type.' }
  , autoPairMarkdown: { type: 'boolean', description: 'Close Markdown syntax as you type.' }
  , smartIndentList: { type: 'boolean', description: 'Indent list items automatically.' }
  , foldHeading: { type: 'boolean', description: 'Allow folding by heading.' }
  , foldIndent: { type: 'boolean', description: 'Allow folding by indent.' }
  , showLineNumber: { type: 'boolean', description: 'Show line numbers in the editor.' }
  , showIndentGuide: { type: 'boolean', description: 'Show indent guides in the editor.' }
  , useTab: { type: 'boolean', description: 'The Tab key inserts a tab. Off means spaces.' }
  , tabSize: { type: 'number', description: 'The tab width in spaces.' }
  , rightToLeft: { type: 'boolean', description: 'Right-to-left text direction in the editor.' }
  , autoConvertHtml: { type: 'boolean', description: 'Convert pasted HTML into Markdown.' }
  , vimMode: { type: 'boolean', description: 'Vim key bindings in the editor.' }
  , livePreview: { type: 'boolean', description: 'Live Preview as the default editing mode.' }
  , nativeMenus: { type: 'boolean', description: 'Native system menus. Null follows the platform default.' }
  // Appearance
  , theme: { type: 'string', description: 'Base color scheme: system, light, or dark.' }
  , accentColor: { type: 'string', description: 'The accent color as a hex value.' }
  , cssTheme: { type: 'string', description: 'The name of the community theme in use.' }
  , enabledCssSnippets: { type: 'array', description: 'Array of enabled snippet ids. The id is the file name without the .css suffix.' }
  , translucency: { type: 'boolean', description: 'Translucent window background.' }
  , textFontFamily: { type: 'string', description: 'Font family for note text. Empty means the default.' }
  , interfaceFontFamily: { type: 'string', description: 'Font family for the interface. Empty means the default.' }
  , monospaceFontFamily: { type: 'string', description: 'Font family for code. Empty means the default.' }
  , baseFontSize: { type: 'number', description: 'The base font size in pixels.' }
  , baseFontSizeAction: { type: 'boolean', description: 'Apply the base font size to more of the interface.' }
  // Workspace
  , showViewHeader: { type: 'boolean', description: 'Show the header above each note.' }
  , showRibbon: { type: 'boolean', description: 'Show the left ribbon.' }
  , slidingSidebar: { type: 'boolean', description: 'Sliding sidebars.' }
  , floatingNavigation: { type: 'boolean', description: 'Floating navigation elements.' }
  , autoFullScreen: { type: 'boolean', description: 'Automatic full screen behavior.' }
  // Structured values
  , hotkeys: { type: 'object', description: 'The keyboard shortcut map, keyed by command id.' }
  , pdfExportSettings: { type: 'object', description: 'The PDF export defaults: page size, orientation, margin, and scale.' }
  , types: { type: 'object', description: 'Property type definitions, keyed by type name.' }
};

/** Coded refusal or failure from the config namespace. */
export class ConfigError extends Error {
  constructor(message: string, public code: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

/** True for any URI of the config namespace. */
export function isConfigUri(path?: string | null): boolean {
  return !!path && path.startsWith(CONFIG_URI_PREFIX);
}

/** True only for the folder form, the namespace root. */
export function isConfigFolderUri(path?: string | null): boolean {
  return path === CONFIG_URI_PREFIX || path === CONFIG_BARE_NAMESPACE;
}

/**
 * The config-key segment of a config URI: one segment, no leading dot, no
 * separators, no traversal. The key is the only variable part of the
 * namespace, so its shape rules carry the whole containment story.
 */
export function configKeyFromUri(path: string): string {
  if (!path.startsWith(CONFIG_URI_PREFIX)) {
    throw new ConfigError(`Not a config URI: ${path}`, 'INVALID_CONFIG_KEY');
  }
  const key = path.slice(CONFIG_URI_PREFIX.length);
  const valid =
    key.length > 0 &&
    key.length <= MAX_CONFIG_KEY_LENGTH &&
    !key.startsWith('.') &&
    !key.includes('/') &&
    !key.includes('\\') &&
    !key.includes('..');
  if (!valid) {
    throw new ConfigError(
      `Invalid config key "${key}": one segment, no leading dot, no path separators.`
      , 'INVALID_CONFIG_KEY'
    );
  }
  return key;
}

/** Curated localStorage keys mapped into the config namespace. They read
 * and write like every other config key, but the storage is the app
 * local storage (App.loadLocalStorage / App.saveLocalStorage), not the
 * config registry.
 *
 * Same rules as CONFIG_KEYS: curated, not complete, and maintained by
 * re-verifying against the live app bundle. localStorage also holds app
 * state this map deliberately does not expose: only keys with a
 * verified, documented purpose belong here.
 *
 * 'mermaid-vault-trust' verified against obsidian-1.13.7.asar on
 * 2026-09-01: the key constant, the prompt strings, and the allow
 * handler (save + "post-processor-change") all match. null is a
 * meaningful value: it means the trust prompt shows.
 */
export const LOCALSTORAGE_KEYS: Readonly<Record<string, ConfigKeyInfo>> = {
  'mermaid-vault-trust': {
    type: 'boolean'
    , description: 'Per-vault trust flag for Mermaid rendering. true renders diagrams. null shows the trust prompt instead. A write re-renders notes, so the change applies immediately.'
  }
};

function isLocalStorageKey(key: string): boolean {
  return Object.prototype.hasOwnProperty.call(LOCALSTORAGE_KEYS, key);
}

/** The app config interface, not in the public typings (verified 1.13.7). */
interface VaultConfigInternal {
  getConfig(key: string): unknown;
  setConfig(key: string, value: unknown): void;
}

function configApi(app: App): VaultConfigInternal {
  return app.vault as unknown as VaultConfigInternal;
}

/** True when the key holds a value (getConfig falls back to defaults, so a
 * known key with no stored value still reads its default). A localStorage
 * key always exists: the catalog defines it, and null is a value there,
 * not an absence. */
export function configKeyExists(app: App, key: string): boolean {
  if (isLocalStorageKey(key)) return true;
  return configApi(app).getConfig(key) !== undefined;
}

/** The current value of one config key as JSON text. Throws ConfigError
 * NOT_FOUND for an unknown key. */
export function readConfigText(app: App, uri: string, key: string): string {
  if (isLocalStorageKey(key)) {
    // An absent stored value reads as null: for these keys null is the
    // meaningful "unset" state, the same answer the app's own check gives.
    // The public typings answer `any | null`; the namespace speaks JSON
    // values only, so the assignment narrows at the boundary.
    const value: unknown = app.loadLocalStorage(key);
    return JSON.stringify(value === undefined ? null : value, null, 2) + '\n';
  }
  const value = configApi(app).getConfig(key);
  if (value === undefined) {
    throw new ConfigError(`File not found: ${uri}`, 'NOT_FOUND');
  }
  return JSON.stringify(value, null, 2) + '\n';
}

/**
 * Parse edited JSON text and apply it to one config key. The parse gate
 * runs first: invalid JSON never reaches the write.
 */
export function writeConfigText(app: App, uri: string, key: string, text: string): { mtime: number; text: string } {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new ConfigError(
      `The edited text for ${uri} is not valid JSON: ${error instanceof Error ? error.message : String(error)}. Nothing was written.`
      , 'INVALID_CONFIG_JSON'
    );
  }
  if (isLocalStorageKey(key)) {
    app.saveLocalStorage(key, value);
    // The app's own Allow handler fires post-processor-change after this
    // save (verified 1.13.7), so a trust change re-renders notes live.
    // Config writes wait for the app to reload the setting; these do not.
    app.workspace.trigger('post-processor-change');
    return { mtime: Date.now(), text };
  }
  if (key === 'enabledCssSnippets') {
    // The CSS subsystem renders from its own in-memory set, rebuilt only
    // at app start, and nothing there listens to config-changed (verified
    // 1.13.7). A plain setConfig persists but cannot apply live. When the
    // app exposes its own toggle handler, route the membership diff
    // through it instead: each call persists and reloads, and a complete
    // diff converges the config to the written membership.
    if (Array.isArray(value)) {
      // The write applies through the app's toggle handler, which stores
      // string ids only. A non-string entry or a duplicate would silently
      // diverge from the written text, so refuse it instead: the value the
      // agent wrote is the value that persists.
      if (value.some((entry) => typeof entry !== 'string') || new Set(value).size !== value.length) {
        throw new ConfigError(
          `The value for ${uri} must be an array of unique snippet id strings. Nothing was written.`
          , 'INVALID_SNIPPET_LIST'
        );
      }
      const previous = configApi(app).getConfig(key);
      const oldIds = new Set(Array.isArray(previous) ? previous.filter((x): x is string => typeof x === 'string') : []);
      const newIds = new Set(value.filter((x): x is string => typeof x === 'string'));
      const deltas: Array<{ id: string; enabled: boolean }> = [];
      for (const id of newIds) {
        if (!oldIds.has(id)) deltas.push({ id, enabled: true });
      }
      for (const id of oldIds) {
        if (!newIds.has(id)) deltas.push({ id, enabled: false });
      }
      if (applySnippetEnabledDelta(app, deltas)) {
        // The app's storage holds string ids only, so the persisted value
        // is the written membership. A no-delta write changed nothing.
        return { mtime: Date.now(), text };
      }
    }
    // Fallback: this build has no toggle handler, or the write is not an
    // array. Persist plainly; the change applies when the app next loads
    // the appearance config, at the latest at restart.
    configApi(app).setConfig(key, value);
    return { mtime: Date.now(), text };
  }
  configApi(app).setConfig(key, value);
  return { mtime: Date.now(), text };
}
