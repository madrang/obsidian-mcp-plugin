import { ObsidianAPI } from '../src/utils/obsidian-api';
import { createTools } from '../src/tools/tool-factory';
import { App, TFile } from 'obsidian';

// Mock the instanceof check for TFile
jest.mock('obsidian', () => {
  const originalModule = jest.requireActual('../tests/__mocks__/obsidian');
  return {
    ...originalModule,
    TFile: class TFile {
      static [Symbol.hasInstance](instance: any) {
        return instance && instance._isTFile;
      }
    }
  };
});

describe('Patch Operations', () => {
  let api: ObsidianAPI;
  let mockApp: App;
  let mockFile: any;
  let mockVault: any;

  beforeEach(() => {
    // Create minimal mocks for testing
    mockFile = {
      path: 'test.md',
      name: 'test.md',
      extension: 'md',
      // TFile.stat is always present in the real API; the post-write
      // return of patchVaultFile reads it.
      stat: { ctime: 0, mtime: 0, size: 0 },
      _isTFile: true // Mark as TFile for instanceof check
    };

    mockVault = {
      getAbstractFileByPath: jest.fn().mockReturnValue(mockFile),
      read: jest.fn(),
      modify: jest.fn().mockResolvedValue(undefined)
    };

    mockApp = {
      vault: mockVault
    } as any;

    api = new ObsidianAPI(mockApp);
  });

  describe('Structured Patch - Heading', () => {
    it('should append content to a heading section', async () => {
      const originalContent = `# Main Title

## Section One
Original content here.

## Section Two
Different content.`;

      const expectedContent = `# Main Title

## Section One
Original content here.


New appended content.
## Section Two
Different content.`;

      mockVault.read.mockResolvedValue(originalContent);

      const result = await api.patchVaultFile('test.md', {
        targetType: 'heading',
        target: 'Section One',
        operation: 'append',
        content: 'New appended content.'
      });

      expect(result.success).toBe(true);
      expect(mockVault.modify).toHaveBeenCalledWith(mockFile, expectedContent);
    });

    it('should prepend content after a heading', async () => {
      const originalContent = `# Main Title

## Section One
Original content here.`;

      const expectedContent = `# Main Title

## Section One

New prepended content.
Original content here.`;

      mockVault.read.mockResolvedValue(originalContent);

      const result = await api.patchVaultFile('test.md', {
        targetType: 'heading',
        target: 'Section One',
        operation: 'prepend',
        content: 'New prepended content.'
      });

      expect(result.success).toBe(true);
      expect(mockVault.modify).toHaveBeenCalledWith(mockFile, expectedContent);
    });

    it('should handle nested headings with :: syntax', async () => {
      const originalContent = `# Main Title

## Section One

### Subsection
Original subsection content.

## Section Two`;

      const expectedContent = `# Main Title

## Section One

### Subsection
Original subsection content.


New content in subsection.
## Section Two`;

      mockVault.read.mockResolvedValue(originalContent);

      const result = await api.patchVaultFile('test.md', {
        targetType: 'heading',
        target: 'Section One::Subsection',
        operation: 'append',
        content: 'New content in subsection.'
      });

      expect(result.success).toBe(true);
      expect(mockVault.modify).toHaveBeenCalledWith(mockFile, expectedContent);
    });

    it('replace rewrites the whole section body, and the heading and the next section stay', async () => {
      // The data-loss case: every line between the heading and the next
      // heading of the same or higher level is gone. A caller that passes
      // an append-sized text loses the old body.
      const originalContent = `# Title

## Keep
keep body

## Target
old body one
old body two

## After
after body`;

      const expectedContent = `# Title

## Keep
keep body

## Target

new body
## After
after body`;

      mockVault.read.mockResolvedValue(originalContent);

      const result = await api.patchVaultFile('test.md', {
        targetType: 'heading',
        target: 'Target',
        operation: 'replace',
        content: 'new body'
      });

      expect(result.success).toBe(true);
      expect(mockVault.modify).toHaveBeenCalledWith(mockFile, expectedContent);
    });
  });

  describe('Structured Patch - Frontmatter', () => {
    it('should add a new frontmatter field', async () => {
      const originalContent = `---
title: Test Document
---

# Content`;

      const expectedContent = `---
title: Test Document
status: published
---

# Content`;

      mockVault.read.mockResolvedValue(originalContent);

      const result = await api.patchVaultFile('test.md', {
        targetType: 'frontmatter',
        target: 'status',
        operation: 'replace',
        content: 'published'
      });

      expect(result.success).toBe(true);
      expect(mockVault.modify).toHaveBeenCalledWith(mockFile, expectedContent);
    });

    it('should create frontmatter if it does not exist', async () => {
      const originalContent = `# Content without frontmatter`;

      const expectedContent = `---
tags: new-tag
---

# Content without frontmatter`;

      mockVault.read.mockResolvedValue(originalContent);

      const result = await api.patchVaultFile('test.md', {
        targetType: 'frontmatter',
        target: 'tags',
        operation: 'replace',
        content: 'new-tag'
      });

      expect(result.success).toBe(true);
      expect(mockVault.modify).toHaveBeenCalledWith(mockFile, expectedContent);
    });

    it('should replace an existing field and leave the other fields byte-identical', async () => {
      const originalContent = `---
title: Old Title
tags: [a, b]
---

# Body`;

      const expectedContent = `---
title: New Title
tags: [a, b]
---

# Body`;

      mockVault.read.mockResolvedValue(originalContent);

      const result = await api.patchVaultFile('test.md', {
        targetType: 'frontmatter',
        target: 'title',
        operation: 'replace',
        content: 'New Title'
      });

      expect(result.success).toBe(true);
      expect(mockVault.modify).toHaveBeenCalledWith(mockFile, expectedContent);
    });
  });

  describe('Structured Patch - Block', () => {
    const blockDoc = `# Document

This is a paragraph with a block ID. ^myblock

Another paragraph.`;

    it('should append content to a block', async () => {
      const expectedContent = `# Document

This is a paragraph with a block ID. Additional content ^myblock

Another paragraph.`;

      mockVault.read.mockResolvedValue(blockDoc);

      const result = await api.patchVaultFile('test.md', {
        targetType: 'block',
        target: 'myblock',
        operation: 'append',
        content: 'Additional content'
      });

      expect(result.success).toBe(true);
      expect(mockVault.modify).toHaveBeenCalledWith(mockFile, expectedContent);
    });

    it('prepend puts the new text before the block content, and the ID stays last', async () => {
      const expectedContent = `# Document

Prepended content This is a paragraph with a block ID. ^myblock

Another paragraph.`;

      mockVault.read.mockResolvedValue(blockDoc);

      const result = await api.patchVaultFile('test.md', {
        targetType: 'block',
        target: 'myblock',
        operation: 'prepend',
        content: 'Prepended content'
      });

      expect(result.success).toBe(true);
      expect(mockVault.modify).toHaveBeenCalledWith(mockFile, expectedContent);
    });

    it('replace rewrites the block line, and the ID stays last', async () => {
      const expectedContent = `# Document

Replacement line ^myblock

Another paragraph.`;

      mockVault.read.mockResolvedValue(blockDoc);

      const result = await api.patchVaultFile('test.md', {
        targetType: 'block',
        target: 'myblock',
        operation: 'replace',
        content: 'Replacement line'
      });

      expect(result.success).toBe(true);
      expect(mockVault.modify).toHaveBeenCalledWith(mockFile, expectedContent);
    });
  });

  describe('Dispatch guard', () => {
    it('a patch without operation is refused at dispatch, and no read or write lands', async () => {
      // Below the dispatch guard, a structured patch without an operation
      // reaches patchVaultFile: the heading and block switches have no case
      // for it, the content returns unchanged, and the file is still written
      // with a success result. The requiredParams guard refuses the call
      // before any vault access.
      const tools = createTools(api);
      const edit = tools.find(t => t.name === 'edit')!;

      const res = await edit.handler(api, {
        action: 'patch'
        , path: 'test.md'
        , targetType: 'heading'
        , target: 'Section One',
      });

      expect(res.isError).toBe(true);
      const text = res.content[0].type === 'text' ? res.content[0].text : '';
      expect(text).toContain('MISSING_PARAMETER');
      expect(text).toContain('operation');
      expect(mockVault.read).not.toHaveBeenCalled();
      expect(mockVault.modify).not.toHaveBeenCalled();
    });
  });

  describe('Legacy Patch Operations', () => {
    it('should still support old text replacement', async () => {
      const originalContent = `This is the original text.`;
      const expectedContent = `This is the modified text.`;

      mockVault.read.mockResolvedValue(originalContent);

      const result = await api.patchVaultFile('test.md', {
        operation: 'replace',
        old_text: 'original',
        new_text: 'modified'
      });

      expect(result.success).toBe(true);
      expect(mockVault.modify).toHaveBeenCalledWith(mockFile, expectedContent);
    });
  });
});