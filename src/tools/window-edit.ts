import { ObsidianAPI } from '../utils/obsidian-api';
import { findFuzzyMatches } from '../utils/fuzzy-match';
import { ContentBufferManager } from '../utils/content-buffer';
import { isImageFile } from '../types/obsidian';

// Shared edit logic behind edit.replace and edit.from_buffer, imported
// dynamically by the router to avoid circular references.
export async function performWindowEdit(
  api: ObsidianAPI,
  path: string,
  oldText: string,
  newText: string,
  fuzzyThreshold: number = 0.7
) {
  const buffer = ContentBufferManager.getInstance();

  // Get current file content
  const file = await api.getFile(path);
  if (isImageFile(file)) {
    throw new Error('Cannot perform window edits on image files');
  }
  const content = typeof file === 'string' ? file : file.content;

  // Try exact match first
  if (content.includes(oldText)) {
    const newContent = content.replace(oldText, newText);
    await api.updateFile(path, newContent);

    return {
      content: [{
        type: 'text',
        text: `Successfully replaced exact match in ${path}`
      }]
    };
  }

  // Buffer the new content for potential recovery
  buffer.store(newText, undefined, {
    filePath: path,
    searchText: oldText
  });

  // Try fuzzy matching
  const matches = findFuzzyMatches(content, oldText, fuzzyThreshold);

  if (matches.length === 0) {
    // No matches found, provide helpful feedback
    return {
      content: [{
        type: 'text',
        text: `No matches found for "${oldText}" in ${path}. ` +
              `Content has been buffered. You can use edit(action='from_buffer') to retry ` +
              `with different search text or edit(action='at_line') to insert at a specific line.`
      }],
      isError: true
    };
  }

  // If multiple matches, ask for clarification
  if (matches.length > 1) {
    const matchList = matches.map(m =>
      `Line ${m.lineNumber} (${Math.round(m.similarity * 100)}% match): "${m.line.trim()}"`
    ).join('\n');

    return {
      content: [{
        type: 'text',
        text: `Found ${matches.length} potential matches:\n\n${matchList}\n\n` +
              `Content has been buffered. Use edit(action='at_line') with the specific line number.`
      }],
      isError: true
    };
  }

  // Single match found - replace the entire line
  const match = matches[0];
  const lines = content.split('\n');
  lines[match.lineNumber - 1] = newText;
  const newContent = lines.join('\n');

  await api.updateFile(path, newContent);

  return {
    content: [{
      type: 'text',
      text: `Successfully replaced line ${match.lineNumber} (${Math.round(match.similarity * 100)}% match) in ${path}`
    }]
  };
}
