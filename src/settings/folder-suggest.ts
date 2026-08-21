import { AbstractInputSuggest, App } from 'obsidian';

/**
 * The suggestion set for a scope-folder autocomplete. The walk is
 * hierarchical, not a flat search:
 *  - empty value: the folders directly under the vault root
 *  - a value that is an existing folder: its ancestors (each step up to the
 *    root) plus its direct children
 *  - a partial value: resolve the deepest existing ancestor, then show that
 *    ancestor's children filtered by the partial last segment, plus the
 *    ancestors above it
 *
 * Kept pure so the walk is unit-testable without DOM.
 */
export function folderScopeSuggestions(value: string, folders: string[]): string[] {
  const normalized = value.trim().replace(/^\/+|\/+$/g, '');
  const existing = new Set(folders);

  const childrenOf = (folder: string): string[] =>
    folders
      .filter(f =>
        folder === ''
          ? !f.includes('/')
          : f.startsWith(folder + '/') && !f.slice(folder.length + 1).includes('/')
      )
      .sort();

  const strictPrefixes = (path: string): string[] => {
    const segs = path.split('/');
    const out: string[] = [];
    for (let i = 1; i < segs.length; i++) out.push(segs.slice(0, i).join('/'));
    return out;
  };

  if (normalized === '') {
    return childrenOf('');
  }

  if (existing.has(normalized)) {
    return [...strictPrefixes(normalized), ...childrenOf(normalized)];
  }

  // Partial value: the real parents of the typed path (every existing prefix,
  // the deepest one included) plus the siblings that continue the typed last
  // segment.
  const segs = normalized.split('/');
  let deepest = '';
  for (let i = 0; i < segs.length; i++) {
    const candidate = segs.slice(0, i + 1).join('/');
    if (existing.has(candidate)) deepest = candidate;
    else break;
  }
  const parents = deepest === '' ? [] : [...strictPrefixes(deepest), deepest];
  const lastSegment = deepest === '' ? normalized : normalized.slice(deepest.length + 1);
  const siblings = childrenOf(deepest).filter(child =>
    child.slice(deepest === '' ? 0 : deepest.length + 1).startsWith(lastSegment)
  );
  return [...parents, ...siblings];
}

/**
 * Scope-folder autocomplete for a scoped-token row. The input stays a plain
 * editable text field; this only populates the suggestion popover, so a
 * hand-typed path is accepted exactly as before.
 *
 * A picked suggestion writes the input and re-fires an input event, so the
 * popover immediately shows the suggestions for the NEW value — the walk
 * continues from the pick — and the save flows through the field's own
 * onChange, the same path as typing.
 */
export class FolderScopeSuggest extends AbstractInputSuggest<string> {
  private readonly inputEl: HTMLInputElement;
  private readonly folders: string[];

  constructor(app: App, inputEl: HTMLInputElement, folders: string[]) {
    super(app, inputEl);
    this.inputEl = inputEl;
    this.folders = folders;
  }

  getSuggestions(query: string): string[] {
    return folderScopeSuggestions(query, this.folders);
  }

  renderSuggestion(path: string, el: HTMLElement): void {
    const depth = path.split('/').length;
    const row = el.createSpan({ cls: 'mcp-folder-suggest-row' });
    row.style.paddingLeft = `${(depth - 1) * 12}px`;
    row.createSpan({ text: '📁', cls: 'mcp-folder-suggest-icon' });
    row.createSpan({ text: path, cls: 'mcp-folder-suggest-path' });
  }

  selectSuggestion(path: string, _evt: MouseEvent | KeyboardEvent): void {
    this.inputEl.value = path;
    // Deferred one tick so the popover's own close-on-select finishes before
    // the synthetic input event reopens it with the new suggestions.
    window.setTimeout(() => {
      this.inputEl.focus();
      this.inputEl.dispatchEvent(new Event('input'));
    }, 0);
  }
}
