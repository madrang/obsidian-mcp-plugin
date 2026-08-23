import { formatFileList } from '../../src/formatters/files';

// The pattern-aware parts of the folder listing: the glob is echoed so the
// agent sees the filter it asked for, the next-page hint carries the
// pattern (a hint without it would send the agent to an unfiltered page 2),
// and an empty match is stated instead of left as a bare listing.

describe('formatFileList — pattern filter display', () => {
  it('echoes the pattern in the listing header', () => {
    const out = formatFileList({
      directory: 'docs',
      pattern: '*.md',
      files: [
        { path: 'docs/a.md', name: 'a.md' },
        { path: 'docs/b.md', name: 'b.md' },
      ],
      totalFiles: 2,
    });
    expect(out).toContain('Pattern');
    expect(out).toContain('*.md');
  });

  it('the next-page hint includes the pattern', () => {
    const out = formatFileList({
      directory: 'docs',
      pattern: '*.md',
      files: [
        { path: 'docs/a.md', name: 'a.md' },
      ],
      totalFiles: 3,
      page: 1,
      pageSize: 1,
      totalPages: 3,
    });
    expect(out).toContain("pattern='*.md'");
    expect(out).toContain('page=2');
    expect(out).toContain("path='docs'");
  });

  it('states an empty match explicitly', () => {
    const out = formatFileList({
      directory: 'docs',
      pattern: '*.xyz',
      files: [],
      totalFiles: 0,
    });
    expect(out).toContain('No files match `*.xyz`');
  });

  it('renders without a pattern exactly as before', () => {
    const out = formatFileList({
      directory: 'docs',
      files: [{ path: 'docs/a.md', name: 'a.md' }],
      totalFiles: 1,
    });
    expect(out).not.toContain('Pattern');
    expect(out).toContain('docs/a.md');
  });
});
