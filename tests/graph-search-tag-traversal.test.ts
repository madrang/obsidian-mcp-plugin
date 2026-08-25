/**
 * filePattern on tag-traverse: the regex narrows the traversal universe the
 * same way it does on search-traverse — a path that fails is never visited,
 * matched, or expanded.
 */
import { GraphSearchTagTraversal } from '../src/tools/graph-search-tag-traversal';
import { App, TFile } from 'obsidian';
import { ObsidianAPI } from '../src/utils/obsidian-api';
import { SearchCore } from '../src/utils/search-core';

const mockApp = {
    vault: {
        getAbstractFileByPath: jest.fn(),
        read: jest.fn()
    },
    metadataCache: {
        getFileCache: jest.fn(),
        getFirstLinkpathDest: jest.fn(),
        resolvedLinks: {} as any
    }
} as unknown as App;

const mockAPI = { getIgnoreManager: () => undefined } as unknown as ObsidianAPI;
const mockSearchCore = new SearchCore(mockApp);

describe('GraphSearchTagTraversal', () => {
    let traversal: GraphSearchTagTraversal;

    beforeEach(() => {
        traversal = new GraphSearchTagTraversal(mockApp, mockAPI, mockSearchCore);
        jest.clearAllMocks();

        const mockFile1 = Object.create(TFile.prototype);
        Object.assign(mockFile1, { path: 'note1.md', extension: 'md', name: 'note1.md' });
        const mockFile2 = Object.create(TFile.prototype);
        Object.assign(mockFile2, { path: 'note2.md', extension: 'md', name: 'note2.md' });

        const files: Record<string, TFile> = { 'note1.md': mockFile1, 'note2.md': mockFile2 };
        mockApp.vault.getAbstractFileByPath = jest.fn((p: string) => files[p] ?? null);
        mockApp.vault.read = jest.fn(async () => 'this line holds the search term');
        mockApp.metadataCache.getFileCache = jest.fn().mockImplementation((file: TFile) =>
            file.path === 'note1.md' ? { links: [{ link: 'note2.md' }] } : { links: [] });
        mockApp.metadataCache.getFirstLinkpathDest = jest.fn((link: string) => files[link] ?? null);
        mockApp.metadataCache.resolvedLinks = {};
    });

    it('visits only files whose path matches the regex', async () => {
        const result = await traversal.searchTraverseWithTags(
            'note1.md', 'search', 3, 1, 0.3, false, 0.8, '^note1'
        );

        expect(result.totalNodesVisited).toBe(1);
        expect(result.traversalChain.map(n => n.path)).toEqual(['note1.md']);
        // The filter blocks the visit itself: note2.md is never opened.
        expect(mockApp.vault.read).toHaveBeenCalledTimes(1);
    });

    it('without a pattern the traversal reaches the linked note', async () => {
        const result = await traversal.searchTraverseWithTags(
            'note1.md', 'search', 3, 1, 0.3, false
        );

        expect(result.totalNodesVisited).toBe(2);
        expect(result.traversalChain.map(n => n.path)).toEqual(['note1.md', 'note2.md']);
    });
});
