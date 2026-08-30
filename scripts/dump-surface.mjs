/**
 * Dumps the exact MCP surface an agent receives: every tool, its built
 * description (full surface, both gates on), actions, per-action required
 * parameters, and every parameter schema entry. Output is JSON on stdout.
 *
 *   node scripts/dump-surface.mjs > surface-dump.json
 *
 * Readers receive this file's content verbatim, so no transcription drift can
 * create false gaps. The procedure and the verdict ledger live in the vault:
 * Projects/Scoped Vault MCP/Descriptor Review/.
 *
 * The parameters come from createTools, not the raw registry
 * definitions: the tool factory adds `action` and `raw` to every schema in
 * production. Dumping the registry directly hid those, and an early round
 * flagged a `raw` parameter gap that production clients do receive.
 */
import { build } from 'esbuild';
import { writeFileSync, unlinkSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const root = path.dirname(fileURLToPath(import.meta.url));

const entry = `
import { App } from 'obsidian';
import { getRegisteredOperations, buildDescription } from '../src/tools/tool-registry';
import { createTools } from '../src/tools/tool-factory';
import '../src/tools/files/definitions';
import '../src/tools/edit/definitions';
import '../src/tools/view/definitions';
import '../src/tools/system/definitions';
import '../src/tools/definitions/graph';
import '../src/tools/bases/definitions';
import '../src/tools/definitions/dataview';

const api = { getApp: () => new App() };
// Gates on: the dump documents the full surface a session can see, so both
// toggles are on and no conditional line is dropped. The factory only needs
// the getApp() shape for the dataview availability probe.
const tools = new Map(createTools(api as never, undefined, true, true).map(t => [t.name, t]));

const ops = getRegisteredOperations().map(d => {
  const tool = tools.get(d.name);
  const keys = new Set([d.name, ...d.actions.map(a => d.name + '.' + a), 'gate:overwrite', 'gate:webFetch']);
  return {
    name: d.name
    , title: d.title
    , description: tool ? tool.description : buildDescription(d.descriptionLines, keys)
    , actions: d.actions
    , requiredParams: d.requiredParams ?? {}
    // One-of requirements, the same map the schema's anyOf conditionals and
    // the dispatch guard are built from.
    , requireAnyParams: d.requireAnyParams ?? {}
    // The live schema when the tool was built; the registry copy for an
    // operation the factory skipped (dataview without the plugin). The raw
    // entry matches the factory shape, parenthetical and default included.
    // A bare fallback once read as a surface gap, but the gap was not real.
    , parameters: tool
      ? tool.inputSchema.properties
      : {
          // The factory prepends an action param and appends raw to every
          // schema. The registry fallback mirrors both, or a reader sees a
          // tool with no way to select its action (dataview, 2026-08-24).
          action: { type: 'string', description: 'The specific action to perform', enum: d.actions }
          , ...d.parameters
          , raw: { type: 'boolean', description: 'Return raw JSON instead of the formatted markdown (use when you need complete metadata or structured data for processing)', default: false }
        }
  };
});
console.log(JSON.stringify(ops, null, 2));
`;

const result = await build({
  stdin: { contents: entry, resolveDir: root, loader: 'ts' },
  bundle: true,
  format: 'cjs',
  write: false,
  platform: 'node',
  alias: { obsidian: path.join(root, '../tests/__mocks__/obsidian.ts') },
});

// Write the bundle to a temp file and import it (Node's ESM loader has no
// blob: support). debug.ts reads window.console at import time; alias window
// to globalThis the same way tests/setup.ts does.
const tmp = path.join(root, '.surface-dump.tmp.cjs');
writeFileSync(tmp, result.outputFiles[0].text);
globalThis.window = globalThis;
await import('file://' + tmp);
unlinkSync(tmp);
