/**
 * files split. The handler names every output up front and refuses on any
 * collision before the first write: a refused split writes nothing.
 */
import { RouterContext } from '../router-context';
import { Params, paramStr, paramNum } from '../shared';
import { isImageFile } from '../../types/obsidian';

export async function handleSplit(ctx: RouterContext, params: Params): Promise<unknown> {
  const path = paramStr(params, 'path');
  const splitBy = paramStr(params, 'splitBy');
  const outputPattern = paramStr(params, 'outputPattern');
  const outputDirectory = paramStr(params, 'outputDirectory');

  if (!path || !splitBy) {
    throw new Error('Both path and splitBy are required for split operation');
  }

  // Get the source file
  const sourceFile = await ctx.api.getFile(path);
  if (!sourceFile) {
    throw new Error(`File not found: ${path}`);
  }

  if (isImageFile(sourceFile)) {
    throw new Error('Cannot split image files');
  }

  // Split the content
  const splitFiles = splitContent(sourceFile.content, params);

  // Create output files
  const createdFiles = [];
  const pathParts = path.split('/');
  const filename = pathParts.pop() || '';
  const dir = outputDirectory || pathParts.join('/');
  const [basename, ext] = filename.includes('.')
    ? [filename.substring(0, filename.lastIndexOf('.')), filename.substring(filename.lastIndexOf('.'))]
    : [filename, ''];

  // Name every output up front, then refuse on any collision before
  // the first write: a refused split writes nothing. Without the
  // pre-flight, outputs written before the collision stayed on disk.
  const outputPaths = splitFiles.map((_, i) => {
    const pattern = outputPattern || '{filename}-{index}{ext}';
    const outputFilename = pattern
      .replace('{filename}', basename)
      .replace('{index}', String(i + 1).padStart(3, '0'))
      .replace('{ext}', ext);
    return dir ? `${dir}/${outputFilename}` : outputFilename;
  });

  const seenPaths = new Set<string>();
  for (const outputPath of outputPaths) {
    if (seenPaths.has(outputPath)) {
      throw new Error(`Split refused: the output pattern names the same file twice: ${outputPath}`);
    }
    seenPaths.add(outputPath);
    const stat = await ctx.api.getFileStat(outputPath);
    if (stat.exists) {
      throw new Error(`Split refused: output file already exists: ${outputPath}`);
    }
  }

  for (let i = 0; i < splitFiles.length; i++) {
    const outputPath = outputPaths[i];
    await ctx.api.createFile(outputPath, splitFiles[i].content);

    createdFiles.push({
      path: outputPath
      , lines: splitFiles[i].content.split('\n').length
      , size: splitFiles[i].content.length
    });
  }

  return {
    success: true
    , sourceFile: path
    , createdFiles
    , totalFiles: createdFiles.length
    , workflow: {
      message: `Successfully split ${path} into ${createdFiles.length} files`
      , suggested_next: [
        {
          description: 'View one of the split files'
          , command: `view(action='read', path='${createdFiles[0]?.path}')`
        }
        , {
          description: 'List all created files'
          , command: `view(action='folder', directory='${dir || '.'}')`
        }
        , {
          description: 'Combine files back together'
          , command: `edit(action='concat', paths=${JSON.stringify(createdFiles.map(f => f.path))}, destination='${path}-combined${ext}')`
        }
      ]
    }
  };
}

function splitContent(content: string, params: Params): Array<{ content: string }> {
  const splitBy = paramStr(params, 'splitBy');
  const delimiter = paramStr(params, 'delimiter');
  const level = paramNum(params, 'level');
  const linesPerFile = paramNum(params, 'linesPerFile');
  const maxSize = paramNum(params, 'maxSize');
  const splitFiles: Array<{ content: string }> = [];

  switch (splitBy) {
    case 'heading': {
      // Split by markdown headings
      const headingLevel = level || 1;
      const headingRegex = new RegExp(`^${'#'.repeat(headingLevel)}\\s+.+$`, 'gm');
      const matches = Array.from(content.matchAll(headingRegex));

      if (matches.length === 0) {
        // No headings found, return original content
        return [{ content }];
      }

      // Split content at each heading
      for (let i = 0; i < matches.length; i++) {
        const match = matches[i];
        const nextMatch = matches[i + 1];
        const startIndex = match.index || 0;
        const endIndex = nextMatch ? nextMatch.index : content.length;

        if (i === 0 && startIndex > 0) {
          // Content before first heading
          splitFiles.push({ content: content.substring(0, startIndex).trim() });
        }

        const section = content.substring(startIndex, endIndex).trim();
        if (section) {
          splitFiles.push({ content: section });
        }
      }
      break;
    }

    case 'delimiter': {
      // Split by custom delimiter
      const delim = delimiter || '---';
      const parts = content.split(delim);

      for (const part of parts) {
        const trimmed = part.trim();
        if (trimmed) {
          splitFiles.push({ content: trimmed });
        }
      }
      break;
    }

    case 'lines': {
      // Split by line count
      const lines = content.split('\n');
      const chunkSize = linesPerFile || 100;

      for (let i = 0; i < lines.length; i += chunkSize) {
        const chunk = lines.slice(i, i + chunkSize).join('\n');
        if (chunk.trim()) {
          splitFiles.push({ content: chunk });
        }
      }
      break;
    }

    case 'size': {
      // Split by character count, preserving word boundaries
      const max = maxSize || 10000;
      let currentPos = 0;

      while (currentPos < content.length) {
        let endPos = Math.min(currentPos + max, content.length);

        // If we're not at the end, try to find a good break point
        if (endPos < content.length) {
          // Look for paragraph break first
          const paragraphBreak = content.lastIndexOf('\n\n', endPos);
          if (paragraphBreak > currentPos && paragraphBreak > endPos - 1000) {
            endPos = paragraphBreak;
          } else {
            // Look for line break
            const lineBreak = content.lastIndexOf('\n', endPos);
            if (lineBreak > currentPos && lineBreak > endPos - 200) {
              endPos = lineBreak;
            } else {
              // Look for sentence end
              const sentenceEnd = content.lastIndexOf('. ', endPos);
              if (sentenceEnd > currentPos && sentenceEnd > endPos - 100) {
                endPos = sentenceEnd + 1;
              } else {
                // Look for word boundary
                const wordBoundary = content.lastIndexOf(' ', endPos);
                if (wordBoundary > currentPos) {
                  endPos = wordBoundary;
                }
              }
            }
          }
        }

        const chunk = content.substring(currentPos, endPos).trim();
        if (chunk) {
          splitFiles.push({ content: chunk });
        }
        currentPos = endPos;

        // Skip whitespace at the beginning of next chunk
        while (currentPos < content.length && /\s/.test(content[currentPos])) {
          currentPos++;
        }
      }
      break;
    }

    default:
      throw new Error(`Unknown split strategy: ${splitBy}`);
  }

  return splitFiles.length > 0 ? splitFiles : [{ content }];
}
