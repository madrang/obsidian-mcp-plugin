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
      expect.arrayContaining(['append', 'patch', 'at_line', 'from_buffer', 'multi'])
    );
  });

  it('the overwrite gate keeps the word overwrite out of the files description when off', () => {
    const off = byName(createSemanticTools(undefined, undefined, false, false), 'files');
    expect(off.description).not.toContain('overwrite');

    const on = byName(createSemanticTools(undefined, undefined, false, true), 'files');
    expect(on.description).toContain('overwrite=true');
  });

  it('the overwrite line needs both the gate and the create action', () => {
    // create hidden, gate on: the continuation line must not ship orphaned.
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
