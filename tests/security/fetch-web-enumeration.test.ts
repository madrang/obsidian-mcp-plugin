/**
 * fetch_web tool enumeration follows the enableWebFetch setting (ADR-109).
 *
 * This is the presentation half of the gate — what a connecting agent can
 * DISCOVER, as opposed to what the security layer permits (covered by
 * fetch-tool-gate + url-validator). It went untested through the original
 * implementation and live testing could not settle it: an MCP client caches
 * tools/list from its first connection, so a stale schema and a broken filter
 * look identical from the client side. The server-side function is the only
 * place the question has a clean answer.
 */
import { createTools } from '../../src/tools/tool-factory';

const systemTool = (webFetchEnabled?: boolean) =>
  createTools(undefined, undefined, webFetchEnabled).find(t => t.name === 'system');

const actionsOf = (tool: ReturnType<typeof systemTool>): string[] =>
  (tool?.inputSchema.properties.action as { enum: string[] }).enum;

describe('fetch_web enumeration', () => {
  it('advertises fetch_web when enabled', () => {
    const tool = systemTool(true);
    expect(actionsOf(tool)).toEqual(['info', 'commands', 'hints', 'open_in_obsidian', 'fetch_web']);
    expect(tool?.description).toContain('fetch_web');
  });

  it('hides fetch_web when disabled, keeping the rest of the system tool', () => {
    const tool = systemTool(false);
    expect(tool).toBeDefined();
    expect(actionsOf(tool)).toEqual(['info', 'commands', 'hints', 'open_in_obsidian']);
  });

  it('strips fetch_web from the advertised description when disabled', () => {
    // The enum and the prose have to agree. An agent reads the description as
    // the menu; leaving "fetch_web: retrieve and process web content" there
    // while the enum omits it invites calls that can only be refused.
    expect(systemTool(false)?.description).not.toContain('fetch_web');
  });

  it('drops the url parameter when fetch_web is disabled', () => {
    // Schema and enum have to agree too: `url` is consumed only by fetch_web,
    // so advertising the parameter while the action is hidden invites calls
    // that can only be refused.
    expect(systemTool(false)?.inputSchema.properties).not.toHaveProperty('url');
  });

  it('keeps the url parameter when fetch_web is enabled', () => {
    expect(systemTool(true)?.inputSchema.properties).toHaveProperty('url');
  });

  it('does not disturb other operations', () => {
    const disabled = createTools(undefined, undefined, false);
    const enabled = createTools(undefined, undefined, true);
    expect(disabled.map(t => t.name)).toEqual(enabled.map(t => t.name));
    const vaultActions = (tools: typeof disabled) =>
      (tools.find(t => t.name === 'files')?.inputSchema.properties.action as { enum: string[] }).enum;
    expect(vaultActions(disabled)).toEqual(vaultActions(enabled));
  });

  it('hides fetch_web when the flag is omitted entirely (fail closed)', () => {
    // A caller that forgets to thread the setting must not accidentally
    // advertise the capability — the same fail-closed posture the handler has.
    expect(actionsOf(systemTool(undefined))).toEqual(['info', 'commands', 'hints', 'open_in_obsidian']);
  });
});
