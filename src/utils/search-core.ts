import { App, TFile } from 'obsidian';

/**
 * Core search functionality for the graph traversal
 */
export class SearchCore {
    constructor(private app: App) {}

    /**
     * Search for files containing the query
     * Note: The API exposes no simple one-shot search, so we implement our own
     */
    async search(query: string): Promise<Array<{file: TFile, matches: number}>> {
        const results: Array<{file: TFile, matches: number}> = [];
        const files = this.app.vault.getMarkdownFiles();
        
        for (const file of files) {
            const content = await this.app.vault.read(file);
            const matches = this.countMatches(content, query);
            if (matches > 0) {
                results.push({ file, matches });
            }
        }
        
        return results;
    }

    /**
     * Get search matches within a specific file
     */
    async searchInFile(file: TFile, query: string): Promise<number> {
        const content = await this.app.vault.read(file);
        return this.countMatches(content, query);
    }
    
    private countMatches(content: string, query: string): number {
        const queryLower = query.toLowerCase();
        const contentLower = content.toLowerCase();
        let count = 0;
        let index = 0;
        
        while ((index = contentLower.indexOf(queryLower, index)) !== -1) {
            count++;
            index += queryLower.length;
        }
        
        return count;
    }

    /**
     * Simple text search within content
     */
    searchInContent(content: string, query: string): Array<{line: number, match: string, score: number}> {
        const lines = content.split('\n');
        const results: Array<{line: number, match: string, score: number}> = [];
        const queryLower = query.toLowerCase();
        const queryTerms = queryLower.split(/\s+/);
        
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const lineLower = line.toLowerCase();
            
            let score = 0;
            let matchedTerms = 0;
            
            for (const term of queryTerms) {
                if (lineLower.includes(term)) {
                    matchedTerms++;
                    // Higher score for exact word matches
                    const wordBoundaryRegex = new RegExp(`\\b${term}\\b`, 'i');
                    if (wordBoundaryRegex.test(line)) {
                        score += 2;
                    } else {
                        score += 1;
                    }
                }
            }
            
            if (matchedTerms > 0) {
                // Normalize score
                score = score / (queryTerms.length * 2);
                results.push({
                    line: i + 1
                    , match: line.trim()
                    , score
                });
            }
        }
        
        // Sort by score descending
        return results.sort((a, b) => b.score - a.score);
    }
}