/**
 * The system tool: server info, command listing, workflow hints, opening
 * files in the Obsidian app, and web fetch. Registers itself into the tool
 * registry at import time.
 */
import { registerOperation } from '../tool-registry';
import { executeSystemOperation } from '../operations/system';

registerOperation({
  name: 'system'
  , title: 'System Operations'
  , descriptionLines: [
    // The opener is a gate pair, not one static line: naming web fetches on
    // a vault with the gate off would advertise an action the schema omits
    // (ADR-109), while omitting it on the full surface hides the action from
    // a cold reader. Each variant shows on exactly one gate state.
    { when: 'system.fetch_web', text: 'Server status, Obsidian app commands, hints, opening files in the Obsidian app, and web fetches.' }
    , { whenNot: 'system.fetch_web', text: 'Server status, Obsidian app commands, hints, and opening files in the Obsidian app.' }
    , ''
    , '## Actions'
    , { when: 'system.info', text: '- `info` — Show server details.' }
    , { when: 'system.commands', text: '- `commands` — List the Obsidian commands of the command palette, grouped by plugin.' }
    , { when: 'system.hints', text: '- `hints` — Get suggestions for the next actions.' }
    , { when: 'system.open_in_obsidian', text: '- `open_in_obsidian` — Open a file in the Obsidian app.' }
    , { when: 'system.fetch_web', text: '- `fetch_web` — Retrieve and process web content.' }
  ]
  , actions: ['info', 'commands', 'hints', 'open_in_obsidian', 'fetch_web']
  , requiredParams: {
    open_in_obsidian: ['path']
    , fetch_web: ['url']
  }
  , annotations: {
    readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true
  }
  , execute: executeSystemOperation
  , parameters: {
    path: {
      type: 'string'
      , description: 'The file path, relative to the vault root, for open_in_obsidian'
    }
    , url: {
      type: 'string'
      , description: 'The URL to fetch and convert to markdown'
    }
  }
});
