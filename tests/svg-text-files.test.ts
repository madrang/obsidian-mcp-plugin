/**
 * SVG files are text. The read layer routes .svg through the text path,
 * not the binary image path, so the edit tool works on SVG files. Binary
 * image extensions keep the image response shape.
 *
 * Edit assertions are on recorded writes, the #210 discipline.
 */
import { App, TFile } from 'obsidian';
import { ObsidianAPI } from '../src/utils/obsidian-api';
import { isImageFile } from '../src/utils/image-handler';
import { contentHash } from '../src/utils/content-hash';
import { VaultRouter } from '../src/tools/router';

const SVG_PATH = 'assets/icon.svg';
const SVG_TEXT =
  '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10">\n' +
  '  <rect width="10" height="10" fill="red"/>\n' +
  '</svg>';
const RECT_LINE = '  <rect width="10" height="10" fill="red"/>';
const CIRCLE_LINE = '  <circle cx="5" cy="5" r="4"/>';
const PNG_PATH = 'assets/logo.png';
const PNG_BYTES = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).buffer;

function makeFile(path: string, size: number): TFile {
  const f = new TFile();
  f.path = path;
  f.name = path.split('/').pop()!;
  f.extension = path.split('.').pop()!;
  f.stat = { mtime: 1000, ctime: 500, size };
  return f;
}

function buildApi() {
  const svg = makeFile(SVG_PATH, SVG_TEXT.length);
  const png = makeFile(PNG_PATH, PNG_BYTES.byteLength);
  const files = new Map<string, TFile>([[SVG_PATH, svg], [PNG_PATH, png]]);
  const textOf = new Map<TFile, string>([[svg, SVG_TEXT]]);
  const binaryOf = new Map<TFile, ArrayBuffer>([[png, PNG_BYTES]]);
  const writes: { path: string; content: string }[] = [];

  const mockApp = new App();
  mockApp.vault.getAbstractFileByPath = (path: string) => files.get(path) ?? null;
  mockApp.vault.read = async (file: TFile) => textOf.get(file)!;
  mockApp.vault.readBinary = async (file: TFile) => binaryOf.get(file)!;
  (mockApp.vault as any).cachedRead = async (file: TFile) => textOf.get(file)!;
  (mockApp.vault as any).modify = async (file: TFile, content: string) => {
    writes.push({ path: file.path, content });
    file.stat.mtime = 2000;
  };
  (mockApp as any).metadataCache = { getFileCache: () => null };

  return { api: new ObsidianAPI(mockApp), writes };
}

describe('SVG files are text', () => {
  test('the path-based image check excludes svg and keeps binary extensions', () => {
    expect(isImageFile(SVG_PATH)).toBe(false);
    expect(isImageFile('assets/logo.png')).toBe(true);
    expect(isImageFile('assets/photo.webp')).toBe(true);
  });

  test('getFile returns SVG content as text, not a base64 image', async () => {
    const { api } = buildApi();
    const file: any = await api.getFile(SVG_PATH);
    expect(file.content).toBe(SVG_TEXT);
    expect(file.base64Data).toBeUndefined();
    expect(file.mimeType).toBeUndefined();
  });

  test('getFile keeps the image response for a binary image', async () => {
    const { api } = buildApi();
    const file: any = await api.getFile(PNG_PATH);
    expect(file.mimeType).toBe('image/png');
    expect(file.base64Data).toBe(Buffer.from(PNG_BYTES).toString('base64'));
    expect(file.content).toBeUndefined();
  });

  test('getFileStat reports lines and hash for SVG, like any text file', async () => {
    const { api } = buildApi();
    const stat: any = await api.getFileStat(SVG_PATH);
    expect(stat.lineCount).toBe(SVG_TEXT.split('\n').length);
    expect(stat.hash).toBe(contentHash(SVG_TEXT));
  });

  test('edit.at_line works on an SVG file', async () => {
    const { api, writes } = buildApi();
    const router = new VaultRouter(api);
    const response: any = await router.route({
      operation: 'edit',
      action: 'at_line',
      params: { path: SVG_PATH, lineNumber: 2, newText: CIRCLE_LINE, mode: 'replace' },
    });
    expect(response.error).toBeUndefined();
    expect(response.result.success).toBe(true);
    expect(writes).toEqual([
      { path: SVG_PATH, content: SVG_TEXT.replace(RECT_LINE, CIRCLE_LINE) },
    ]);
  });
});
