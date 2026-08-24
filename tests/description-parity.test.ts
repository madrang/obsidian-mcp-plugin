/**
 * Description parity: the description names exactly the actions the session
 * can call.
 *
 * Descriptions are built per session from conditional markdown lines
 * (buildDescription). The line a hidden action owns drops out with its enum
 * value, so the prose can never advertise what the schema omits — the defect
 * that motivated this: disabling an action used to keep its mention in the
 * description. These pins hold both directions: no missing bullet, no orphan
 * bullet, for every tool on every visibility shape tested here.
 */
import { createSemanticTools, getOperationDescription, getActionsForOperation, ALL_OPERATIONS, SemanticTool } from '../src/tools/semantic-tools';
import { getActionDescriptionLines, getStaticDescriptionLines } from '../src/tools/tool-registry';

type EnumHolder = { enum: string[] };

function enumActions(tool: SemanticTool): string[] {
  return (tool.inputSchema.properties.action as EnumHolder).enum;
}

/** Action names that start a bullet: the lines an agent reads as the action list. */
function bulletActions(description: string): string[] {
  return [...description.matchAll(/^- `([\w-]+)`/gm)].map(m => m[1]);
}

function byName(tools: SemanticTool[], name: string): SemanticTool {
  const tool = tools.find(t => t.name === name);
  if (!tool) throw new Error(`tool not built: ${name}`);
  return tool;
}

describe('description partition: static vs action-owned lines', () => {
  it('getActionDescriptionLines returns the lines owned by the action', () => {
    const lines = getActionDescriptionLines('view', 'lines');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('`lines`');

    // 2026-08-23: the create overwrite line was removed. The `overwrite` parameter is the only carrier.
    // No definition carries a multi-key when array anymore, so create owns its single bullet.
    // The registry mechanism stays, but it has no live specimen (see the vault TODO).
    expect(getActionDescriptionLines('files', 'create')).toHaveLength(1);
  });

  it('getStaticDescriptionLines drops action bullets and emptied headings', () => {
    const view = getStaticDescriptionLines('view');
    expect(view.join('\n')).toContain('View, read, and search vault content');
    expect(view.join('\n')).not.toContain('`window`');
    expect(view.join('\n')).not.toContain('## Actions');
    expect(view.join('\n')).not.toContain('## Guidance');

    const edit = getStaticDescriptionLines('edit');
    expect(edit.join('\n')).toContain('## Rules');
    expect(edit.join('\n')).toContain('ifUnmodifiedSince');
    expect(edit.join('\n')).not.toContain('## Actions');

    const graph = getStaticDescriptionLines('graph');
    // 2026-08-24: the When-to-use header was folded away; the purpose line
    // and the guidance bullets open the description now.
    expect(graph.join('\n')).toContain('Read the links between notes');
    expect(graph.join('\n')).toContain('Search ranks by term frequency');
    expect(graph.join('\n')).not.toContain('## Actions');
  });

  it('action-owned guidance travels with its action under visibility', () => {
    // The fold puts guidance lines inside the action's conditional block.
    // The property that matters: hiding the action removes its guidance
    // too. A guidance line that stayed static would outlive its action —
    // the stale-mention defect this structure exists to prevent.
    const hiddenRead = createSemanticTools(undefined, { 'view.read': false })
      .find(t => t.name === 'view')!;
    expect(hiddenRead.description).not.toContain('A complete `read` returns the stats');
    expect(hiddenRead.description).toContain('`window`');

    const full = createSemanticTools().find(t => t.name === 'view')!;
    expect(full.description).toContain('A complete `read` returns the stats');

    const noPatch = createSemanticTools(undefined, { 'edit.patch': false })
      .find(t => t.name === 'edit')!;
    expect(noPatch.description).not.toContain('Warning: `patch`');
    // The cross-action rules are static on purpose and must survive any
    // action being hidden.
    expect(noPatch.description).toContain('ifUnmodifiedSince');
  });
});

describe('description parity', () => {
  it('every registered operation advertises every action as a bullet (full surface)', () => {
    // The full-surface description (settings UI view) is compared against the
    // registry's full action list, not a session enum — session gates
    // legitimately narrow the enum below the full surface.
    for (const op of ALL_OPERATIONS) {
      const bullets = bulletActions(getOperationDescription(op));
      const actions = getActionsForOperation(op);
      for (const action of actions) {
        expect(bullets).toContain(action);
      }
      for (const bullet of bullets) {
        expect(actions).toContain(bullet);
      }
    }
  });

  it('descriptions are markdown: headings and multi-line structure', () => {
    for (const tool of createSemanticTools()) {
      expect(tool.description).toContain('## Actions');
      expect(tool.description).toContain('\n');
      expect(tool.description.length).toBeGreaterThan(0);
    }
  });

  it('a hidden action leaves the description with its enum value', () => {
    const tools = createSemanticTools(undefined, { 'view.read': false });
    const view = byName(tools, 'view');
    expect(enumActions(view)).not.toContain('read');
    expect(bulletActions(view.description)).not.toContain('read');
    expect(bulletActions(view.description)).toContain('window');
    // The read-owned guidance line drops out with the action.
    expect(view.description).not.toContain('ifUnmodifiedSince');
  });

  it('a hidden action keeps the other bullets intact', () => {
    const tools = createSemanticTools(undefined, { 'edit.replace': false });
    const edit = byName(tools, 'edit');
    expect(enumActions(edit)).not.toContain('replace');
    expect(bulletActions(edit.description)).toEqual(
      expect.arrayContaining(['append', 'patch', 'at_line', 'multi'])
    );
  });

  it('the files description never advertises overwrite, with the gate on or off', () => {
    // 2026-08-23: the overwrite bullet was removed. The schema-side parameter is the only carrier,
    // and it keeps following the gate (covered by the tool-surface-moves suite).
    // Verdict ledger: vault, Descriptor Review/files.
    const off = byName(createSemanticTools(undefined, undefined, false, false), 'files');
    expect(off.description).not.toContain('overwrite');

    const on = byName(createSemanticTools(undefined, undefined, false, true), 'files');
    expect(on.description).not.toContain('overwrite');
  });

  it('create hidden keeps the word overwrite out of the files description', () => {
    const tools = createSemanticTools(undefined, { 'files.create': false }, false, true);
    const files = byName(tools, 'files');
    expect(enumActions(files)).not.toContain('create');
    expect(files.description).not.toContain('overwrite');
  });

  it('fetch_web stays out of the system description while the gate is off', () => {
    const off = byName(createSemanticTools(undefined, undefined, false, false), 'system');
    expect(off.description).not.toContain('fetch_web');

    const on = byName(createSemanticTools(undefined, undefined, true, false), 'system');
    expect(on.description).toContain('fetch_web');
  });

  it('a disabled operation is not built at all', () => {
    const tools = createSemanticTools(undefined, { view: false });
    expect(tools.find(t => t.name === 'view')).toBeUndefined();
  });
});
