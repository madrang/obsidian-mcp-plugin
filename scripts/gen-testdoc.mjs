// Generates the vault test-reference structure: one markdown file per
// category, describes as headings, tests as plain bullets, plus an index.
// Usage: npx jest --verbose 2>&1 | node scripts/gen-testdoc.mjs out-dir
// The out-dir files are then copied into the vault note folder
// "Projects/Scoped Vault MCP/Tests/" through the Obsidian MCP tools.
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

const CATEGORY_OF = suite => {
  if (suite === 'tests/test-contract.test.ts') return 'Meta';
  if (suite.startsWith('tests/security/') || suite === 'tests/read-only-mode.test.ts') return 'Security';
  if (suite.startsWith('tests/formatters/') || suite === 'tests/combine-format.test.ts' || suite === 'tests/web-fetch-large-response.test.ts') return 'Formatters';
  if (['tests/mcp-server.test.ts', 'tests/mcp-session-reinit.test.ts', 'tests/sse-socket-timeout.test.ts',
    'tests/session-lifetime.test.ts', 'tests/bridge-bootstrap.test.ts', 'tests/bridge-self-heal.test.ts',
    'tests/network-exposure-integration.test.ts', 'tests/network-classifier.test.ts'].includes(suite)) return 'Server and transport';
  if (['tests/description-parity.test.ts', 'tests/tool-action-required-params.test.ts',
    'tests/dispatch-param-guards.test.ts', 'tests/settings-ui.test.ts'].includes(suite)) return 'Surface and dispatch';
  if (['tests/edit-preconditions.test.ts', 'tests/edit-multi.test.ts', 'tests/edit-replace-count.test.ts',
    'tests/patch-operations.test.ts', 'tests/file-lock-edit-serialization.test.ts'].includes(suite)) return 'Edit tool';
  if (['tests/view-grep.test.ts', 'tests/view-lines.test.ts', 'tests/view-read-fidelity.test.ts',
    'tests/view-read-stats.test.ts', 'tests/view-folder-glob.test.ts', 'tests/fragments-path-scope.test.ts'].includes(suite)) return 'View and read';
  if (['tests/search-diacritics.test.ts', 'tests/search-tag-operator.test.ts', 'tests/fuzzy-match.test.ts'].includes(suite)) return 'Search';
  if (['tests/files-concat-router.test.ts', 'tests/files-move-extension.test.ts', 'tests/recursive-copy.test.ts',
    'tests/list-files-recursive.test.ts', 'tests/folder-suggest.test.ts'].includes(suite)) return 'Files operations';
  if (suite.startsWith('tests/graph-')) return 'Graph';
  if (suite.startsWith('tests/bases-')) return 'Bases';
  if (suite === 'tests/dataview-integration.test.ts') return 'Dataview';
  if (['src/utils/__tests__/response-limiter.test.ts', 'tests/validation/input-validator.test.ts'].includes(suite)) return 'Core and validation';
  return 'Uncategorized';
};

const ORDER = ['Security', 'Server and transport', 'Surface and dispatch', 'Edit tool', 'View and read',
  'Search', 'Files operations', 'Graph', 'Bases', 'Dataview', 'Formatters', 'Core and validation', 'Meta'];

let input = '';
process.stdin.on('data', d => { input += d; });
process.stdin.on('end', () => {
  const suites = [];
  let current = null;
  const stack = [];
  for (const line of input.split('\n')) {
    const pass = line.match(/^PASS (\S+)/);
    if (pass) {
      current = { path: pass[1], root: { name: '', children: [] } };
      suites.push(current);
      stack.length = 0;
      continue;
    }
    const test = line.match(/^(\s+)[✓✕]\s+(.+?)(?:\s+\([\d.]+ m?s\))?$/);
    if (test && current) {
      let node = current.root;
      for (const frame of stack) {
        let child = node.children.find(c => c.type === 'describe' && c.name === frame.name);
        if (!child) { child = { type: 'describe', name: frame.name, children: [] }; node.children.push(child); }
        node = child;
      }
      node.children.push({ type: 'test', name: test[2] });
      continue;
    }
    const desc = line.match(/^(\s{2,})\S/);
    if (desc && current) {
      const indent = desc[1].length;
      while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();
      stack.push({ indent, name: line.trim() });
    }
  }

  const outDir = process.argv[2] ?? 'testdoc-out';
  mkdirSync(outDir, { recursive: true });

  const countTests = node => node.children.reduce((n, c) => n + (c.type === 'test' ? 1 : countTests(c)), 0);
  const byCategory = new Map();
  for (const suite of suites) {
    const category = CATEGORY_OF(suite.path);
    if (!byCategory.has(category)) byCategory.set(category, []);
    byCategory.get(category).push(suite);
  }

  const files = [];
  for (const category of ORDER) {
    const cats = byCategory.get(category);
    if (!cats) continue;
    const total = cats.reduce((n, s) => n + countTests(s.root), 0);
    const lines = [];
    lines.push('---');
    lines.push(`tags: [scoped-vault-mcp, tests, tests-${category.toLowerCase().replace(/[^a-z]+/g, '-')}]`);
    lines.push('---');
    lines.push(`# Tests — ${category}`);
    lines.push('');
    lines.push(`${cats.length} suites, ${total} tests. Check here before writing a new test in this area: the coverage may already exist.`);
    lines.push('');
    lines.push('Related: [[Projects/Scoped Vault MCP/Tests/0 - Index|↑ Tests index]]');
    lines.push('');
    // Children render in their original order, so a describe's direct tests
    // stay above its nested describes when jest printed them that way.
    const render = (node, depth) => {
      const level = Math.min(depth + 2, 5);
      for (const child of node.children) {
        if (child.type === 'test') {
          lines.push(`- ${child.name}`);
        } else {
          lines.push('');
          lines.push(`${'#'.repeat(level)} ${child.name}`);
          render(child, depth + 1);
        }
      }
    };
    for (const suite of cats) {
      lines.push(`## ${suite.path} (${countTests(suite.root)} tests)`);
      render(suite.root, 1);
      lines.push('');
    }
    const name = category === 'Meta' ? 'Meta' : category;
    writeFileSync(join(outDir, `${name}.md`), lines.join('\n') + '\n');
    files.push({ category, suites: cats.length, tests: total, file: `${name}.md` });
  }

  // The index carries the meta suite itself plus the links and the counts.
  const meta = byCategory.get('Meta') ?? [];
  const grandTotal = suites.reduce((n, s) => n + countTests(s.root), 0);
  const index = [];
  index.push('---');
  index.push('tags: [scoped-vault-mcp, tests]');
  index.push('---');
  index.push('# Tests index');
  index.push('');
  index.push(`Generated from \`npx jest --verbose\` on 2026-08-23. ${suites.length} suites, ${grandTotal} tests.`);
  index.push('Regenerate: \`npx jest --verbose 2>&1 | node scripts/gen-testdoc.mjs testdoc-out\`, then refresh the notes in this folder through the Obsidian MCP tools.');
  index.push('Before writing a new test, check the category note below. The purpose of this index is to prevent duplicate coverage.');
  index.push('');
  for (const f of files.filter(f => f.category !== 'Meta')) {
    index.push(`- [[Projects/Scoped Vault MCP/Tests/${f.file.replace('.md', '')}|${f.category}]] — ${f.suites} suites, ${f.tests} tests`);
  }
  index.push('');
  index.push('## Read-only coverage lives in several places');
  index.push('');
  index.push('The read-only wall is pinned from three angles. Do not add a fourth without checking these first:');
  index.push('- [[Projects/Scoped Vault MCP/Tests/Security|Security]] — the exhaustive action matrix, liveness switches, and containment suites');
  index.push('- [[Projects/Scoped Vault MCP/Tests/Surface and dispatch|Surface and dispatch]] — dispatch guards and the overwrite gate');
  index.push('- [[Projects/Scoped Vault MCP/Tests/Server and transport|Server and transport]] — session scoping and enforcement on the session API');
  for (const suite of meta) {
    index.push('');
    index.push(`## ${suite.path} (${countTests(suite.root)} tests)`);
    const renderIndex = (node, depth) => {
      const level = Math.min(depth + 2, 5);
      for (const child of node.children) {
        if (child.type === 'test') {
          index.push(`- ${child.name}`);
        } else {
          index.push('');
          index.push(`${'#'.repeat(level)} ${child.name}`);
          renderIndex(child, depth + 1);
        }
      }
    };
    renderIndex(suite.root, 1);
  }
  index.push('');
  index.push('---');
  index.push('Related: [[Projects/Scoped Vault MCP/0 - Index|↑ Project index]]');
  writeFileSync(join(outDir, '0 - Index.md'), index.join('\n') + '\n');

  console.error(`categories: ${files.length}, suites: ${suites.length}, tests: ${grandTotal}`);
  for (const f of files) console.error(`${f.category}: ${f.suites} suites, ${f.tests} tests -> ${f.file}`);
});
