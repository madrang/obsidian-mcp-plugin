/**
 * The vault-info resource body: vault name and path, active file, file
 * counts, and plugin version. Moved from mcp-server-pool.ts.
 */
import { getVersion } from '../version';
import type { ResourceBody, VaultInfoDeps } from './types';

export function buildVaultInfo(deps: VaultInfoDeps): ResourceBody {
  const app = deps.obsidianAPI.getApp();
  const vaultName = app.vault.getName();
  const activeFile = app.workspace.getActiveFile();
  const allFiles = app.vault.getAllLoadedFiles();
  const markdownFiles = app.vault.getMarkdownFiles();

  const vaultInfo = {
    vault: {
      name: vaultName
      , path: (app.vault.adapter as unknown as { basePath?: string }).basePath ?? 'Unknown'
    }
    , activeFile: activeFile ? {
      name: activeFile.name
      , path: activeFile.path
      , basename: activeFile.basename
      , extension: activeFile.extension
    } : null
    , files: {
      total: allFiles.length
      , markdown: markdownFiles.length
      , attachments: allFiles.length - markdownFiles.length
    }
    , plugin: {
      version: getVersion()
      , status: 'Connected and operational'
      , transport: 'HTTP MCP via Express.js + MCP SDK'
      , sessionId: deps.sessionId
    }
    , timestamp: new Date().toISOString()
  };

  return {
    mimeType: 'application/json'
    , text: JSON.stringify(vaultInfo, null, 2)
  };
}
