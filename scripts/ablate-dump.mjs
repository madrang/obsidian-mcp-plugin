// Ablation builder: loads the canonical dump, applies the cut table, and
// writes the lean variant sent to readers as if it were the only surface.
// Every entry must match its expected hit count exactly. A miss or a
// surprise aborts, so the variant is never silently wrong.
//
// The verdict ledger lives in the vault:
// Projects/Scoped Vault MCP/Descriptor Review/.
// Read the ledger before you change this table.
// Never re-cut a KEPT sentence. Never re-add a REMOVED sentence
// without new evidence that beats the recorded verdict.
import { readFileSync, writeFileSync } from 'fs';

const dump = JSON.parse(readFileSync('surface-dump.json', 'utf8'));

// [find, replace, expectedHits] — replace with '' removes the text;
// surrounding spaces must be handled in the find string itself. expectedHits
// defaults to 1; use it for shared param text that appears once per tool.
const CUTS = [
  // carried — no verdict yet
  [' The source file stays.', ''],
  [' The source files stay.', ''],
  [' An image read returns the image itself.', ''],
  [' (one global slot shared across files, 30 minutes)', ''],
  [' Hits rank by TF-IDF.', ''],
  ['- Scan broadly with `view.search` to catch the unlinked notes. Then follow links from the hits to catch the differently worded notes.', ''],
  // new candidates — first test next round
  [' (use when you need complete metadata or structured data for processing)', '', 7],
  ['. Set fuzzyThreshold to 1.0 for an exact substring replace', ''],
  ['. Scope it to a unique passage in the file', ''],
];

let applied = 0;
for (const [find, replace, expected = 1] of CUTS) {
  let hits = 0;
  for (const tool of dump) {
    if (tool.description.includes(find)) hits++;
    for (const key of Object.keys(tool.parameters ?? {})) {
      const entry = tool.parameters[key];
      if (typeof entry.description === 'string' && entry.description.includes(find)) hits++;
      if (entry.items?.properties) {
        for (const sub of Object.values(entry.items.properties)) {
          if (typeof sub.description === 'string' && sub.description.includes(find)) hits++;
        }
      }
    }
  }
  if (hits !== expected) {
    console.error(`ABORT: "${find.slice(0, 60)}..." matched ${hits} times, expected ${expected}`);
    process.exit(1);
  }
  for (const tool of dump) {
    tool.description = tool.description.split(find).join(replace);
    for (const key of Object.keys(tool.parameters ?? {})) {
      const entry = tool.parameters[key];
      if (typeof entry.description === 'string') entry.description = entry.description.split(find).join(replace);
      if (entry.items?.properties) {
        for (const sub of Object.values(entry.items.properties)) {
          if (typeof sub.description === 'string') sub.description = sub.description.split(find).join(replace);
        }
      }
    }
  }
  applied++;
}

console.error(`applied ${applied} cuts`);
writeFileSync('surface-dump-lean.json', JSON.stringify(dump, null, 2));
