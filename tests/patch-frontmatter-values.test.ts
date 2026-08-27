import { ObsidianAPI } from '../src/utils/obsidian-api';
import { executeEditOperation } from '../src/tools/operations/edit';
import { App, TFile } from 'obsidian';
import { parse } from 'yaml';

// Typed frontmatter values (Option A, chosen on the project TODOs): the old
// patchFrontmatter wrote the raw string unescaped, so YAML typed values by
// accident, and append/prepend on an array field corrupted the block by
// stranding the `- item` lines. The rewrite serializes through the yaml
// library, replaces only the target field's lines, adds operation 'remove',
// and fails closed where the old path corrupted.

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

function buildApi(fileContent: string): { api: ObsidianAPI; modify: jest.Mock } {
  const mockFile = {
    path: 'test.md',
    name: 'test.md',
    extension: 'md',
    stat: { ctime: 0, mtime: 0, size: 0 },
    _isTFile: true
  };
  // The mock vault tracks its own content, so consecutive patches chain
  // the way they do against a real file.
  let current = fileContent;
  const modify = jest.fn().mockImplementation((_file: unknown, content: string) => {
    current = content;
    return Promise.resolve(undefined);
  });
  const mockApp = {
    vault: {
      getAbstractFileByPath: jest.fn().mockReturnValue(mockFile),
      read: jest.fn().mockImplementation(() => Promise.resolve(current)),
      modify
    }
  } as unknown as App;
  return { api: new ObsidianAPI(mockApp), modify };
}

const written = (modify: jest.Mock): string =>
  modify.mock.calls[modify.mock.calls.length - 1][1];

const MULTI_KEY_FILE = `---
title: Keeps Its Lines
status: draft
tags:
  - one
  - two
after: untouched
---

# Body`;

describe('patchFrontmatter — typed value path', () => {
  it('keeps a string that looks like a boolean a string', async () => {
    const { api, modify } = buildApi(MULTI_KEY_FILE);
    await api.patchVaultFile('test.md', {
      targetType: 'frontmatter', target: 'status', operation: 'replace', value: 'true'
    });
    const doc = parse(written(modify).split('---')[1]);
    expect(doc.status).toBe('true');
    expect(typeof doc.status).toBe('string');
  });

  it('writes numbers, booleans, and null as their YAML types', async () => {
    const { api, modify } = buildApi(MULTI_KEY_FILE);
    await api.patchVaultFile('test.md', {
      targetType: 'frontmatter', target: 'count', operation: 'replace', value: 42
    });
    await api.patchVaultFile('test.md', {
      targetType: 'frontmatter', target: 'done', operation: 'replace', value: true
    });
    const doc = parse(written(modify).split('---')[1]);
    expect(doc.count).toBe(42);
    expect(doc.done).toBe(true);
  });

  it('round-trips arrays and objects', async () => {
    const { api, modify } = buildApi(MULTI_KEY_FILE);
    await api.patchVaultFile('test.md', {
      targetType: 'frontmatter', target: 'tags', operation: 'replace', value: ['a', 'b', 'c']
    });
    const doc = parse(written(modify).split('---')[1]);
    expect(doc.tags).toEqual(['a', 'b', 'c']);
    expect(written(modify)).toContain('- a');
  });

  it('replaces only the target field: other keys stay byte-identical', async () => {
    const { api, modify } = buildApi(MULTI_KEY_FILE);
    await api.patchVaultFile('test.md', {
      targetType: 'frontmatter', target: 'status', operation: 'replace', value: 'published'
    });
    const out = written(modify);
    expect(out).toContain('title: Keeps Its Lines');
    expect(out).toContain('tags:\n  - one\n  - two');
    expect(out).toContain('after: untouched');
    expect(out).not.toContain('draft');
  });

  it('replaces a whole array block via a string, leaving no stranded items', async () => {
    const { api, modify } = buildApi(MULTI_KEY_FILE);
    await api.patchVaultFile('test.md', {
      targetType: 'frontmatter', target: 'tags', operation: 'replace', content: 'single'
    });
    const out = written(modify);
    expect(out).toContain('tags: single');
    expect(out).not.toContain('- one');
    // The keys after the replaced block survive.
    expect(out).toContain('after: untouched');
  });

  it('quotes text that would otherwise break or retype the block', async () => {
    const { api, modify } = buildApi(MULTI_KEY_FILE);
    await api.patchVaultFile('test.md', {
      targetType: 'frontmatter', target: 'note', operation: 'replace', content: 'hello: world'
    });
    const doc = parse(written(modify).split('---')[1]);
    expect(doc.note).toBe('hello: world');
    expect(doc.after).toBe('untouched');
  });

  it('creates a missing field and a missing frontmatter block', async () => {
    const missing = buildApi(MULTI_KEY_FILE);
    await missing.api.patchVaultFile('test.md', {
      targetType: 'frontmatter', target: 'priority', operation: 'replace', value: 3
    });
    expect(parse(written(missing.modify).split('---')[1]).priority).toBe(3);

    const noBlock = buildApi('# No frontmatter here');
    await noBlock.api.patchVaultFile('test.md', {
      targetType: 'frontmatter', target: 'status', operation: 'replace', value: 'new'
    });
    expect(written(noBlock.modify).startsWith('---\n')).toBe(true);
    expect(written(noBlock.modify)).toContain('status: new');
    expect(written(noBlock.modify)).toContain('# No frontmatter here');
  });
});

describe('patchFrontmatter — remove and fail-closed guards', () => {
  it('removes a field including its array lines', async () => {
    const { api, modify } = buildApi(MULTI_KEY_FILE);
    await api.patchVaultFile('test.md', {
      targetType: 'frontmatter', target: 'tags', operation: 'remove'
    });
    const out = written(modify);
    expect(out).not.toContain('tags');
    expect(out).not.toContain('- one');
    expect(out).toContain('after: untouched');
  });

  it('removing a missing field errors', async () => {
    const { api } = buildApi(MULTI_KEY_FILE);
    await expect(api.patchVaultFile('test.md', {
      targetType: 'frontmatter', target: 'ghost', operation: 'remove'
    })).rejects.toThrow('Field not found: ghost');
  });

  it('remove on a heading or block target errors instead of no-oping', async () => {
    const { api } = buildApi(MULTI_KEY_FILE);
    await expect(api.patchVaultFile('test.md', {
      targetType: 'heading', target: 'Body', operation: 'remove'
    })).rejects.toThrow('frontmatter field only');
  });

  it('value refuses append and prepend', async () => {
    const { api } = buildApi(MULTI_KEY_FILE);
    await expect(api.patchVaultFile('test.md', {
      targetType: 'frontmatter', target: 'status', operation: 'append', value: 'x'
    })).rejects.toThrow('operation "replace"');
  });

  it('append on a field that holds an array errors instead of corrupting', async () => {
    const { api, modify } = buildApi(MULTI_KEY_FILE);
    await expect(api.patchVaultFile('test.md', {
      targetType: 'frontmatter', target: 'tags', operation: 'append', content: 'extra'
    })).rejects.toThrow('multi-line value');
    expect(modify).not.toHaveBeenCalled();
  });
});

describe('executeEditOperation — value dispatch guards', () => {
  const ctx = {
    api: { patchVaultFile: jest.fn().mockResolvedValue({ success: true }) }
  } as never;

  it('rejects value and newText together before any write', async () => {
    await expect(executeEditOperation(ctx, 'patch', {
      path: 'a.md', targetType: 'frontmatter', target: 'status', operation: 'replace'
      , value: 'x', newText: 'y'
    } as never)).rejects.toThrow('mutually exclusive');
    expect((ctx as { api: { patchVaultFile: jest.Mock } }).api.patchVaultFile).not.toHaveBeenCalled();
  });

  it('rejects value on a non-frontmatter target', async () => {
    await expect(executeEditOperation(ctx, 'patch', {
      path: 'a.md', targetType: 'heading', target: 'Section', operation: 'replace'
      , value: 'x'
    } as never)).rejects.toThrow('frontmatter field only');
  });

  it('forwards the typed value to the API', async () => {
    await executeEditOperation(ctx, 'patch', {
      path: 'a.md', targetType: 'frontmatter', target: 'tags', operation: 'replace'
      , value: ['a', 'b']
    } as never);
    expect((ctx as { api: { patchVaultFile: jest.Mock } }).api.patchVaultFile)
      .toHaveBeenCalledWith('a.md', expect.objectContaining({ value: ['a', 'b'] }));
  });

  it('parses a JSON-string value — bridges stringify untyped params', async () => {
    await executeEditOperation(ctx, 'patch', {
      path: 'a.md', targetType: 'frontmatter', target: 'tags', operation: 'replace'
      , value: '["a", "b"]'
    } as never);
    expect((ctx as { api: { patchVaultFile: jest.Mock } }).api.patchVaultFile)
      .toHaveBeenCalledWith('a.md', expect.objectContaining({ value: ['a', 'b'] }));
  });

  it('a value string that is not JSON passes through as the string itself', async () => {
    await executeEditOperation(ctx, 'patch', {
      path: 'a.md', targetType: 'frontmatter', target: 'status', operation: 'replace'
      , value: 'plain active'
    } as never);
    expect((ctx as { api: { patchVaultFile: jest.Mock } }).api.patchVaultFile)
      .toHaveBeenCalledWith('a.md', expect.objectContaining({ value: 'plain active' }));
  });
});

describe('edit.patch remove — no newText demanded', () => {
  // remove deletes a field and reads no write text. The newText demand
  // used to refuse it until an unused newText: "" arrived.
  beforeEach(() => {
    const { ContentBufferManager } = jest.requireActual('../src/utils/content-buffer');
    ContentBufferManager.getInstance().clear();
  });

  it('removes the field with no newText and no buffered replacement', async () => {
    const { api, modify } = buildApi('---\nstatus: draft\n---\n\nBody');

    await executeEditOperation({ api } as never, 'patch', {
      path: 'test.md', targetType: 'frontmatter', target: 'status', operation: 'remove'
    } as never);

    expect(written(modify)).toBe('---\n---\n\nBody');
  });

  it('remove of a missing field still fails with the field error, not the newText demand', async () => {
    const { api, modify } = buildApi('---\nstatus: draft\n---\n\nBody');

    await expect(executeEditOperation({ api } as never, 'patch', {
      path: 'test.md', targetType: 'frontmatter', target: 'missing', operation: 'remove'
    } as never)).rejects.toThrow('Field not found');

    expect(modify).not.toHaveBeenCalled();
  });
});
