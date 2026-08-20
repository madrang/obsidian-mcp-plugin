/**
 * The system tool: server info, command listing, workflow hints, opening
 * files in the Obsidian app, and web fetch. Registers itself into the tool
 * registry at import time.
 */
import { registerOperation } from '../tool-registry';
import { executeSystemOperation } from '../../semantic/operations/system';

registerOperation({
  name: 'system',
  title: 'System Operations',
  description: 'ℹ️ System operations - info: show server details, commands: list available actions, hints: get contextual suggestions for the next actions, open_in_obsidian: open a file in the Obsidian app, fetch_web: retrieve and process web content',
  actions: ['info', 'commands', 'hints', 'open_in_obsidian', 'fetch_web'],
  requiredParams: {
    open_in_obsidian: ['path'],
    fetch_web: ['url']
  },
  annotations: {
    readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true
  },
  execute: executeSystemOperation,
  parameters: {
    path: {
      type: 'string',
      description: 'The file path for open_in_obsidian'
    },
    url: {
      type: 'string',
      description: 'The URL to fetch and convert to markdown'
    }
  }
});
