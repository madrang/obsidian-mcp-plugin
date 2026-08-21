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
  descriptionLines: [
    'ℹ️ System operations.',
    '',
    '## Actions',
    { when: 'system.info', text: '- `info` — show server details.' },
    { when: 'system.commands', text: '- `commands` — list the Obsidian commands of the command palette, grouped by plugin.' },
    { when: 'system.hints', text: '- `hints` — get suggestions for the next actions.' },
    { when: 'system.open_in_obsidian', text: '- `open_in_obsidian` — open a file in the Obsidian app.' },
    { when: 'system.fetch_web', text: '- `fetch_web` — retrieve and process web content.' }
  ],
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
