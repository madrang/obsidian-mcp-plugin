/**
 * The pure content transformation behind patchVaultFile: content in,
 * content out, no vault access. Shared by the vault, snippet, and config
 * branches of the patch path.
 */
import { stringify } from 'yaml';
import type { PatchParams } from './obsidian-api';

/** The content transformation of patchVaultFile, shared by the vault and
 * snippet branches. Pure: content in, content out. */
export function applyPatchToContent(content: string, params: PatchParams): string {
  // Handle structured targeting (heading, block, frontmatter)
  if (params.targetType && params.target) {
    return applyStructuredPatch(content, params);
  }
  // Handle legacy patch operations
  if (params.operation === 'replace') {
    if (params.old_text && params.new_text) {
      return content.replace(params.old_text, params.new_text);
    }
  } else if (params.operation === 'insert') {
    if (params.position !== undefined) {
      return content.slice(0, params.position) + (params.text ?? '') + content.slice(params.position);
    }
  } else if (params.operation === 'delete') {
    if (params.start !== undefined && params.end !== undefined) {
      return content.slice(0, params.start) + content.slice(params.end);
    }
  }
  return content;
}

function applyStructuredPatch(content: string, params: PatchParams): string {
  const { targetType, target, operation, content: patchContent, value } = params;

  // Without the guard the heading and block switches would silently
  // no-op on an operation they have no case for.
  if (operation === 'remove' && targetType !== 'frontmatter') {
    throw new Error('operation "remove" works on a frontmatter field only');
  }

  switch (targetType) {
    case 'heading':
      return patchHeading(content, target ?? '', operation ?? '', patchContent ?? '');
    case 'block':
      return patchBlock(content, target ?? '', operation ?? '', patchContent ?? '');
    case 'frontmatter':
      return patchFrontmatter(content, target ?? '', operation ?? '', patchContent ?? '', value);
    default:
      throw new Error(`Unknown targetType: ${String(targetType)}`);
  }
}

function patchHeading(content: string, headingPath: string, operation: string, patchContent: string): string {
  const lines = content.split('\n');
  const headingHierarchy = headingPath.split('::').map(h => h.trim());

  // Find the target heading
  let currentLevel = 0;
  let targetLineIndex = -1;
  let endLineIndex = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);

    if (headingMatch) {
      const level = headingMatch[1].length;
      const headingText = headingMatch[2].trim();

      // Check if we're at the right level in hierarchy
      if (currentLevel < headingHierarchy.length &&
          headingText === headingHierarchy[currentLevel]) {
        currentLevel++;

        if (currentLevel === headingHierarchy.length) {
          targetLineIndex = i;
          // Find where this section ends
          for (let j = i + 1; j < lines.length; j++) {
            const nextHeadingMatch = lines[j].match(/^(#{1,6})\s+/);
            if (nextHeadingMatch && nextHeadingMatch[1].length <= level) {
              endLineIndex = j;
              break;
            }
          }
          if (endLineIndex === -1) {
            endLineIndex = lines.length;
          }
          break;
        }
      } else if (level <= currentLevel) {
        // Reset if we've moved to a different section
        currentLevel = 0;
      }
    }
  }

  if (targetLineIndex === -1) {
    throw new Error(`Heading not found: ${headingPath}`);
  }

  // Apply the operation
  switch (operation) {
    case 'append': {
      // Add content at the end of the section
      // Fix for list continuity - thanks to @that0n3guy (PR #44)
      const lastLine = endLineIndex > 0 ? lines[endLineIndex - 1] : '';
      const isLastLineEmpty = lastLine.trim() === '';
      const listRegex = /^(\s*)([-*+]|\d+\.)\s+/;
      const isPatchList = listRegex.test(patchContent);

      // Find the last non-empty line to check if it's a list
      let lastNonEmptyLine = '';
      for (let i = endLineIndex - 1; i >= targetLineIndex + 1; i--) {
        if (lines[i].trim() !== '') {
          lastNonEmptyLine = lines[i];
          break;
        }
      }
      const isLastNonEmptyLineList = listRegex.test(lastNonEmptyLine);

      if (isLastLineEmpty && isLastNonEmptyLineList && isPatchList) {
        // Preserve list continuity by replacing empty line
        lines.splice(endLineIndex - 1, 1, patchContent);
      } else if (!isLastLineEmpty && isLastNonEmptyLineList && isPatchList) {
        // Append list item without blank line
        lines.splice(endLineIndex, 0, patchContent);
      } else {
        // Default: add blank line separator (original behavior)
        lines.splice(endLineIndex, 0, '', patchContent);
      }
      break;
    }
    case 'prepend':
      // Add content right after the heading
      lines.splice(targetLineIndex + 1, 0, '', patchContent);
      break;
    case 'replace': {
      // Replace the entire section content (keeping the heading)
      const sectionLines = endLineIndex - targetLineIndex - 1;
      lines.splice(targetLineIndex + 1, sectionLines, '', patchContent);
      break;
    }
  }

  return lines.join('\n');
}

function patchBlock(content: string, blockId: string, operation: string, patchContent: string): string {
  const lines = content.split('\n');
  let blockLineIndex = -1;

  // Find the block by ID (blocks end with ^blockId)
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim().endsWith(`^${blockId}`)) {
      blockLineIndex = i;
      break;
    }
  }

  if (blockLineIndex === -1) {
    throw new Error(`Block not found: ^${blockId}`);
  }

  // Apply the operation
  switch (operation) {
    case 'append':
      lines[blockLineIndex] = lines[blockLineIndex].replace(`^${blockId}`, `${patchContent} ^${blockId}`);
      break;
    case 'prepend': {
      const blockContent = lines[blockLineIndex].replace(`^${blockId}`, '').trim();
      lines[blockLineIndex] = `${patchContent} ${blockContent} ^${blockId}`;
      break;
    }
    case 'replace':
      lines[blockLineIndex] = `${patchContent} ^${blockId}`;
      break;
  }

  return lines.join('\n');
}

/**
 * Patch a frontmatter field, field-block aware: the write replaces only
 * the target field's lines (its `field:` line plus its indented lines),
 * so untouched keys stay byte-identical.
 *
 * Two input paths. `value` (any JSON type) serializes through the yaml
 * library, so "true" stays a string and arrays and objects round-trip;
 * it works with operation 'replace' only. The text path keeps the
 * append/prepend/replace string semantics, but the result is serialized
 * as YAML instead of written raw, and append/prepend refuse a field
 * whose current block is multi-line rather than corrupting it.
 */
function patchFrontmatter(content: string, field: string, operation: string, patchContent: string, value?: unknown): string {
  const lines = content.split('\n');
  let frontmatterStart = -1;
  let frontmatterEnd = -1;

  // Find frontmatter boundaries
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === '---') {
      if (frontmatterStart === -1) {
        frontmatterStart = i;
      } else {
        frontmatterEnd = i;
        break;
      }
    }
  }

  const hasValue = value !== undefined;
  if (hasValue && operation !== 'replace') {
    throw new Error('The value parameter works with operation "replace". Use newText for append and prepend.');
  }

  // Serialize one field assignment. lineWidth 0 never folds long scalars.
  const fieldLines = (val: unknown): string[] =>
    stringify({ [field]: val }, { lineWidth: 0 }).replace(/\n$/, '').split('\n');

  // A missing frontmatter block: every operation but remove creates it.
  if (frontmatterStart === -1) {
    if (operation === 'remove') {
      throw new Error(`Field not found: ${field}`);
    }
    lines.unshift('---', ...(hasValue ? fieldLines(value) : fieldLines(patchContent)), '---', '');
    return lines.join('\n');
  }

  // Find the field block: the `field:` line plus its indented lines.
  let fieldLineIndex = -1;
  for (let i = frontmatterStart + 1; i < frontmatterEnd; i++) {
    if (lines[i].startsWith(`${field}:`)) {
      fieldLineIndex = i;
      break;
    }
  }

  if (fieldLineIndex === -1) {
    if (operation === 'remove') {
      throw new Error(`Field not found: ${field}`);
    }
    lines.splice(frontmatterEnd, 0, ...(hasValue ? fieldLines(value) : fieldLines(patchContent)));
    return lines.join('\n');
  }

  let fieldEnd = fieldLineIndex + 1;
  while (fieldEnd < frontmatterEnd && (lines[fieldEnd].startsWith(' ') || lines[fieldEnd].startsWith('\t'))) {
    fieldEnd++;
  }

  if (operation === 'remove') {
    lines.splice(fieldLineIndex, fieldEnd - fieldLineIndex);
    return lines.join('\n');
  }

  if (hasValue) {
    lines.splice(fieldLineIndex, fieldEnd - fieldLineIndex, ...fieldLines(value));
    return lines.join('\n');
  }

  const currentValue = lines[fieldLineIndex].substring(field.length + 1).trim();
  if ((operation === 'append' || operation === 'prepend') && fieldEnd > fieldLineIndex + 1) {
    throw new Error(
      `Field ${field} holds a multi-line value (an array or object). Use value with operation "replace" to write it.`
    );
  }

  let combined: string;
  switch (operation) {
    case 'append':
      combined = currentValue ? `${currentValue} ${patchContent}` : patchContent;
      break;
    case 'prepend':
      combined = currentValue ? `${patchContent} ${currentValue}` : patchContent;
      break;
    case 'replace':
      combined = patchContent;
      break;
    default:
      throw new Error(`Unknown frontmatter operation: ${String(operation)}`);
  }
  lines.splice(fieldLineIndex, fieldEnd - fieldLineIndex, ...fieldLines(combined));
  return lines.join('\n');
}
