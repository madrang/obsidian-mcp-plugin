import { formatFileCombine, FileCombineResponse } from '../src/tools/files/format';

describe('formatFileCombine — destination mode', () => {
  test('renders the destination, the counts, and the source files', () => {
    const response: FileCombineResponse = {
      success: true,
      destination: 'combined.md',
      filesCombined: 2,
      totalSize: 16,
      sourceFiles: ['a.md', 'b.md'],
    };

    const out = formatFileCombine(response);

    expect(out).toContain('Combined: combined.md');
    expect(out).toContain('Destination');
    expect(out).toContain('a.md');
    expect(out).toContain('b.md');
  });

  test('a failure renders the failure marker', () => {
    const out = formatFileCombine({
      success: false,
      destination: 'combined.md',
      filesCombined: 0,
    });

    expect(out).toContain('✗');
    expect(out).toContain('Failed to combine files.');
  });
});
