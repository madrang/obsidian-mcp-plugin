/**
 * view.window — derived bounds around a center line. The center comes from
 * `lineNumber`, or from the first fuzzy match of `searchText` when
 * `lineNumber` is omitted. Without either, line 1 is the center. The window
 * spans half the size on each side of the center, clamped to the file.
 */
import { VaultRouter } from '../src/tools/router';
import { ObsidianAPI } from '../src/utils/obsidian-api';
import { App } from 'obsidian';

class WindowAPI extends ObsidianAPI {
  readonly files = new Map<string, string>();

  constructor() {
    super({} as App);
  }

  async getFile(path: string): Promise<any> {
    const content = this.files.get(path);
    if (content === undefined) throw new Error(`File not found: ${path}`);
    return { path, content, tags: [], frontmatter: {} };
  }
}

function numberedFile(lines: number, marker?: { line: number; text: string }): string {
  return Array.from({ length: lines }, (_, i) => {
    const n = i + 1;
    if (marker && n === marker.line) return `line ${n} ${marker.text}`;
    return `line ${n}`;
  }).join('\n');
}

describe('view.window', () => {
  function setup(files: Record<string, string>) {
    const api = new WindowAPI();
    for (const [path, content] of Object.entries(files)) api.files.set(path, content);
    const router = new VaultRouter(api, {} as App);
    return { api, router };
  }

  async function window(router: VaultRouter, params: Record<string, unknown>) {
    return router.route({ operation: 'view', action: 'window', params });
  }

  test('without searchText or lineNumber, line 1 is the center and the start clamps to it', async () => {
    const { router } = setup({ 'a.md': numberedFile(50) });
    const response: any = await window(router, { path: 'a.md' });

    expect(response.error).toBeUndefined();
    expect(response.result.centerLine).toBe(1);
    expect(response.result.startLine).toBe(1);
    expect(response.result.endLine).toBe(11);
    expect(response.result.lines[0]).toBe('line 1');
    expect(response.result.lines).toHaveLength(11);
    expect(response.result.totalLines).toBe(50);
  });

  test('searchText without lineNumber centers on the first line that contains it', async () => {
    const { router } = setup({ 'a.md': numberedFile(50, { line: 25, text: 'zebra' }) });
    const response: any = await window(router, { path: 'a.md', searchText: 'zebra' });

    expect(response.error).toBeUndefined();
    expect(response.result.centerLine).toBe(25);
    expect(response.result.startLine).toBe(15);
    expect(response.result.endLine).toBe(35);
    expect(response.result.lines[0]).toBe('line 15');
    expect(response.result.lines).toHaveLength(21);
    expect(response.result.searchText).toBe('zebra');
  });

  test('with searchText on several lines, the first occurrence centers the window', async () => {
    const content = Array.from({ length: 50 }, (_, i) =>
      i + 1 === 25 || i + 1 === 40 ? `line ${i + 1} zebra` : `line ${i + 1}`
    ).join('\n');
    const { router } = setup({ 'a.md': content });

    const response: any = await window(router, { path: 'a.md', searchText: 'zebra' });

    expect(response.result.centerLine).toBe(25);
  });

  test('an explicit lineNumber wins over searchText', async () => {
    const { router } = setup({ 'a.md': numberedFile(50, { line: 25, text: 'zebra' }) });
    const response: any = await window(router, { path: 'a.md', searchText: 'zebra', lineNumber: 5 });

    expect(response.result.centerLine).toBe(5);
    expect(response.result.startLine).toBe(1);
    expect(response.result.endLine).toBe(15);
  });

  test('a searchText that matches nothing falls back to line 1', async () => {
    const { router } = setup({ 'a.md': numberedFile(50) });
    const response: any = await window(router, { path: 'a.md', searchText: 'absent-token' });

    expect(response.error).toBeUndefined();
    expect(response.result.centerLine).toBe(1);
  });

  test('windowSize spans half on each side of the center', async () => {
    const { router } = setup({ 'a.md': numberedFile(50) });
    const response: any = await window(router, { path: 'a.md', lineNumber: 30, windowSize: 6 });

    expect(response.result.startLine).toBe(27);
    expect(response.result.endLine).toBe(33);
    expect(response.result.lines).toEqual(['line 27', 'line 28', 'line 29', 'line 30', 'line 31', 'line 32', 'line 33']);
  });

  test('the end clamps to the file length', async () => {
    const { router } = setup({ 'a.md': numberedFile(50) });
    const response: any = await window(router, { path: 'a.md', lineNumber: 48 });

    expect(response.result.endLine).toBe(50);
    expect(response.result.lines[response.result.lines.length - 1]).toBe('line 50');
  });
});
