/**
 * files.split — the formatter must accept the handler's response shape.
 *
 * The handler returns createdFiles as objects ({path, lines, size}). The
 * formatter treated each entry as a string and called .split('/') on it, so
 * every successful split dropped into the raw-JSON fallback with a
 * "Formatter error" console line. The write had already landed, so nothing
 * failed loudly — the caller just got the ugly path every time. These pins
 * use the handler-shaped response, so a future shape drift fails here
 * instead of degrading to the fallback.
 */
import { formatFileSplit } from '../../src/formatters/files';

const SPLIT_RESPONSE = {
  success: true,
  sourceFile: 'notes/big.md',
  totalFiles: 2,
  splitBy: 'heading',
  createdFiles: [
    { path: 'notes/big-001.md', lines: 12, size: 340 },
    { path: 'notes/big-002.md', lines: 8, size: 210 },
  ],
};

describe('formatFileSplit — handler-shaped response', () => {
  it('formats a successful split without throwing', () => {
    expect(() => formatFileSplit(SPLIT_RESPONSE)).not.toThrow();
  });

  it('lists the created files by name', () => {
    const output = formatFileSplit(SPLIT_RESPONSE);
    expect(output).toContain('big-001.md');
    expect(output).toContain('big-002.md');
  });

  it('keeps the source file and count visible', () => {
    const output = formatFileSplit(SPLIT_RESPONSE);
    expect(output).toContain('notes/big.md');
    expect(output).toContain('2 files');
    expect(output).toContain('heading');
  });

  it('takes the basename from the entry path', () => {
    const output = formatFileSplit({
      ...SPLIT_RESPONSE,
      createdFiles: [{ path: 'deep/nested/folder/note-001.md', lines: 1, size: 5 }],
    });
    expect(output).toContain('note-001.md');
    expect(output).not.toContain('deep/nested');
  });

  it('reports a failed split without touching createdFiles', () => {
    const output = formatFileSplit({
      success: false,
      sourceFile: 'notes/big.md',
      createdFiles: [],
      totalFiles: 0,
    });
    expect(output).toContain('Failed to split file.');
  });
});
