import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  type CallToolResult
} from '@modelcontextprotocol/sdk/types.js';
import { EventEmitter } from 'events';
import { Debug } from './debug';
import { ObsidianAPI } from './obsidian-api';
import { SecureObsidianAPI } from '../security/secure-obsidian-api';
import { createTools } from '../tools/tool-factory';
import { buildResourceList, createResourceService, readResource } from '../resources/registry';
import type { ResourceDeps } from '../resources/types';
import { getVersion } from '../version';
import type { SessionManager } from './session-manager';
import type { ConnectionPool } from './connection-pool';
import { AuthScope } from '../security/http-auth';
import { RESOURCES_URI_PREFIX } from '../resources/uri';
import { FolderScopedIgnoreManager } from '../security/token-scope';
import { ToolCallRateLimiter, rateLimitErrorResponse } from '../security/rate-limiter';

/** Plugin interface with settings relevant to MCPServerPool.
 * Includes fields from SecurePluginRef and ObsidianAPIPluginRef so the same object
 * can be passed through the constructor chain. */
interface PluginWithSettings {
  settings?: {
    readOnlyMode?: boolean;
    enableWebFetch?: boolean;
    allowCreateOverwrite?: boolean;
    // ADR-111: session lifetime policy
    sessionTimeoutMs?: number;
    sessionsPerToken?: number;
    // ADR-112: tool call rate limit per credential, 0 = disabled
    rateLimitPerMinute?: number;
    // From SecurePluginRef (for SecureObsidianAPI)
    security?: Partial<import('../security/vault-security-manager').SecuritySettings>;
    // From ObsidianAPIPluginRef (for ObsidianAPI)
    validation?: Partial<import('../validation/input-validator').ValidationConfig>;
    httpPort?: number;
    toolVisibility?: Record<string, boolean>;
  };
  ignoreManager?: import('../security/mcp-ignore-manager').MCPIgnoreManager;
  /** Scoped sessions: true when the path sits in a read-only scope. */
  scopeWriteGate?: (path?: string) => boolean;
  mcpServer?: { isServerRunning(): boolean; getConnectionCount(): number };
  manifest?: { dir?: string };
}

interface PooledServer {
  server: McpServer;
  sessionId: string;
  createdAt: number;
  lastActivityAt: number;
  requestCount: number;
  /** ADR-110: identity of the credential this session was created with.
   * Undefined for the primary key, no-key mode, and auth-disabled mode. */
  identity?: string;
}

/** The silent read-only scope every scoped session carries: the reference
 * pages stay reachable whatever the token's folders say. */
const RESOURCES_SCOPE_PREFIX = RESOURCES_URI_PREFIX;

export class MCPServerPool extends EventEmitter {
  private servers: Map<string, PooledServer> = new Map();
  private maxServers: number;
  private obsidianAPI: ObsidianAPI | SecureObsidianAPI;
  private plugin?: PluginWithSettings;
  private sessionManager?: SessionManager;
  private connectionPool?: ConnectionPool;
  // ADR-107: agent-visible warning string injected into MCP initialize.instructions
  // when the network exposure verdict is 'jail'. Null otherwise (no field sent).
  private initializeInstructions: string | null = null;
  // ADR-112: per-credential tool call limiter, shared by every session in the
  // pool. One instance so one token cannot dodge its limit by opening more
  // sessions.
  private toolCallLimiter = new ToolCallRateLimiter(60_000, () => this.rateLimitPerMinute());

  constructor(obsidianAPI: ObsidianAPI | SecureObsidianAPI, maxServers: number = 32, plugin?: PluginWithSettings) {
    super();
    this.obsidianAPI = obsidianAPI;
    this.maxServers = maxServers;
    this.plugin = plugin;
  }

  /**
   * Set session manager and connection pool references
   */
  setContexts(sessionManager: SessionManager, connectionPool: ConnectionPool) {
    this.sessionManager = sessionManager;
    this.connectionPool = connectionPool;
  }

  /**
   * ADR-107: set the instructions string returned on MCP initialize.
   * Called from MCPHttpServer.start() after the verdict is classified.
   * Pass null to clear (no instructions field on initialize result).
   */
  setInitializeInstructions(instructions: string | null) {
    this.initializeInstructions = instructions;
  }

  /**
   * Build the currently-visible tool set from live plugin settings.
   *
   * Called per request rather than once per session so a settings toggle
   * applies to sessions that already exist. `enableWebFetch` is passed
   * explicitly as a boolean — `createTools` fails closed on an omitted
   * flag, and this keeps the intent visible at the call site (ADR-109).
   *
   * The resource service is bound to the calling session, so resource
   * content served through tool actions carries the same session identity
   * as resources/read.
   */
  private buildTools(sessionId: string) {
    return createTools(
      this.obsidianAPI,
      this.plugin?.settings?.toolVisibility,
      this.plugin?.settings?.enableWebFetch === true,
      this.plugin?.settings?.allowCreateOverwrite === true,
      createResourceService(this.resourceDeps(sessionId))
    );
  }

  /** The registry's inputs, rebuilt per read so every value is live. */
  private resourceDeps(sessionId: string): ResourceDeps {
    return {
      obsidianAPI: this.obsidianAPI
      , sessionId
      , sessionManager: this.sessionManager
      , connectionPool: this.connectionPool
      , serverPoolStats: this.getStats()
      , sessionPolicy: {
        sessionTimeoutLabel: this.sessionTimeoutLabel()
        , sessionsPerTokenLimit: this.sessionsPerTokenLimit()
        , maxConcurrentConnections: this.maxServers
      }
    };
  }

  /**
   * Tell every live session its tool list changed, so clients re-fetch instead
   * of holding the list they cached at connection time (#285).
   *
   * Best-effort by design: the SDK no-ops on a server with no connected
   * transport, and one session's failure must not stop the rest — a settings
   * toggle is a UI action, not a transaction.
   */
  notifyToolListChanged(): void {
    let notified = 0;
    for (const [sessionId, pooled] of this.servers) {
      // Skip sessions with no live transport. McpServer.sendToolListChanged()
      // makes this check itself, but it returns void and drops the promise the
      // underlying send returns — so a transport that rejects (client tab
      // closed, half-dead socket) surfaces as an unhandled rejection instead of
      // a log line. Going through the non-deprecated `.server` accessor, which
      // is what this file already uses to register handlers, hands back the
      // promise so the failure can be caught. The isConnected() guard has to
      // come with it, since the low-level call throws on a disconnected server.
      if (!pooled.server.isConnected()) continue;
      try {
        void pooled.server.server.sendToolListChanged().catch((error: unknown) => {
          Debug.error(`[Session ${sessionId}] tools/list_changed send failed:`, error);
        });
        notified++;
      } catch (error: unknown) {
        Debug.error(`[Session ${sessionId}] tools/list_changed notify failed:`, error);
      }
    }
    Debug.log(`📢 Notified ${notified}/${this.servers.size} session(s) of a tool list change`);
  }

  /**
   * ADR-110: does the session's bound credential identity match the one
   * presented on this request? True when the session is unknown (creation
   * paths bind it fresh). False means a different credential is trying to
   * ride a session it did not create — the caller answers 403.
   */
  sessionIdentityMatches(sessionId: string, identity: string | undefined): boolean {
    const pooledServer = this.servers.get(sessionId);
    if (!pooledServer) return true;
    return pooledServer.identity === identity;
  }

  /**
   * Get or create an MCP server for a session
   */
  getOrCreateServer(sessionId: string, scope?: AuthScope): McpServer {
    // Check if server exists
    let pooledServer = this.servers.get(sessionId);

    if (pooledServer) {
      // Update activity
      pooledServer.lastActivityAt = Date.now();
      pooledServer.requestCount++;
      Debug.log(`♻️ Reusing MCP server for session ${sessionId}`);
      return pooledServer.server;
    }

    // Check capacity
    if (this.servers.size >= this.maxServers) {
      // Evict oldest inactive server
      this.evictOldestServer();
    }

    // ADR-111: per-credential session cap, read live from the settings. A new
    // session for an identity already at the cap invalidates that identity's
    // OLDEST session — one token is one session unless the user widens it.
    // The undefined identity (primary key, no-key, auth-disabled) is one
    // bucket, so the primary key follows the same rule.
    const limit = this.sessionsPerTokenLimit();
    const sameIdentity = [...this.servers.entries()]
      .filter(([, s]) => s.identity === scope?.identity)
      .sort((a, b) => a[1].lastActivityAt - b[1].lastActivityAt);
    while (sameIdentity.length >= limit) {
      const [oldestId] = sameIdentity.shift()!;
      this.evictServer(oldestId);
    }

    // Create new server
    const server = this.createNewServer(sessionId, scope);

    pooledServer = {
      server
      , sessionId
      , createdAt: Date.now()
      , lastActivityAt: Date.now()
      , requestCount: 1
      , identity: scope?.identity
    };

    this.servers.set(sessionId, pooledServer);
    Debug.log(`🆕 Created new MCP server for session ${sessionId} (Total: ${this.servers.size}/${this.maxServers})`);

    return server;
  }

  /**
   * ADR-110: the plugin ref seen by a scoped session's SecureObsidianAPI.
   * The ignore manager becomes the folder-scoped composite, and the settings
   * getter reports readOnlyMode when the token is read-only — both computed
   * per access, so the ADR-108 live-settings behavior is preserved. The token
   * scope itself is fixed at session creation; scope edits apply to new
   * sessions.
   */
  private scopedPluginRef(scope: AuthScope): PluginWithSettings | undefined {
    const plugin = this.plugin;
    if (!plugin) return plugin;
    const tokenScopes = scope.scopes ?? [];
    // Every scoped session silently carries the resources namespace as a
    // read-only scope: the reference pages stay reachable whatever the
    // token's folders say, and nothing in that namespace is writable anyway.
    const sessionScopes = tokenScopes.length > 0
      ? [...tokenScopes, { folder: RESOURCES_SCOPE_PREFIX, readOnly: true }]
      : [];
    // A token whose every scope is read-only is a read-only session: fold
    // it into the live readOnlyMode predicate (ADR-108 shape). Mixed scopes
    // keep the per-path gate below.
    const allScopesReadOnly = tokenScopes.length > 0
      && tokenScopes.every(scope => scope.readOnly === true);
    const scopedManager = sessionScopes.length > 0
      ? new FolderScopedIgnoreManager(this.obsidianAPI.getApp(), plugin.ignoreManager, sessionScopes)
      : undefined;
    return {
      get settings() {
        return {
          ...plugin.settings
          , readOnlyMode: plugin.settings?.readOnlyMode === true || allScopesReadOnly
        };
      }
      , ignoreManager: scopedManager ?? plugin.ignoreManager
      , scopeWriteGate: scopedManager
        ? (path?: string) => scopedManager.isPathReadOnly(path)
        : undefined
      , mcpServer: plugin.mcpServer
      , manifest: plugin.manifest
    };
  }

  /**
   * Create a new MCP server instance with handlers
   */
  private createNewServer(sessionId: string, scope?: AuthScope): McpServer {
      // Construct via McpServer (the non-deprecated class) and register our
      // raw JSON-Schema handlers on its underlying .server — the advanced
      // low-level handle it deliberately exposes — so the deprecated Server
      // symbol never appears in our source. We don't use registerTool/Zod.
      const mcpServer = new McpServer(
      {
        name: 'Scoped Vault MCP'
        , version: getVersion()
      },
      {
        capabilities: {
          // listChanged advertises that this server pushes
          // notifications/tools/list_changed when the visible tool set changes
          // (settings toggles). Without the declaration a spec-compliant client
          // is entitled to ignore the notification.
          tools: { listChanged: true }
          , resources: {}
        }
        // ADR-107: agent-visible network-exposure warning, only set when 🔴
        , ...(this.initializeInstructions ? { instructions: this.initializeInstructions } : {})
      }
    );
    const server = mcpServer.server;

    // Create session-specific API instance
    // Always create SecureObsidianAPI if the main API has security settings
    let sessionAPI: ObsidianAPI | SecureObsidianAPI;
    if (this.obsidianAPI instanceof SecureObsidianAPI) {
      // Without a plugin reference the session API has no settings to read, so
      // read-only cannot be enforced on it — while path validation still can,
      // which is the worst combination: a boundary that looks whole and isn't.
      // Verified behaviour when absent: edit.append writes while a user believing
      // read-only is on sees nothing. Same wiring-bug class as the missing
      // security layer below, so it fails the same way rather than only logging.
      if (!this.plugin) {
        throw new Error(
          'Refusing to create a session without a plugin reference: read-only mode ' +
          'could not be enforced on it. This is a wiring bug, not a runtime condition.'
        );
      }

      // Main API is SecureObsidianAPI - create matching secure instance.
      // ADR-110: a scoped token gets the wrapped plugin ref (folder-scoped
      // ignore manager, token read-only folded into the live predicate).
      sessionAPI = new SecureObsidianAPI(
        this.obsidianAPI.getApp(),
        undefined,
        scope ? this.scopedPluginRef(scope) : this.plugin,
        this.obsidianAPI.getSecuritySettings()
      );
      Debug.log(`🔐 Created secure session API for session ${sessionId}`);
    } else {
      // Previously this fell back to a plain ObsidianAPI and logged "(no
      // security)" — a session with NOTHING between it and vault writes: no
      // read-only, no path validation, no .mcpignore. Unreachable today because
      // mcp-server.ts always builds a SecureObsidianAPI, but a silent fail-open
      // is exactly the shape of the bugs this enforcement work exists to close,
      // so it fails loudly instead of quietly serving an unguarded session.
      throw new Error(
        'Refusing to create a session without the security layer: the parent API ' +
        'is not a SecureObsidianAPI. This is a wiring bug, not a runtime condition.'
      );
    }

    // List tools handler. The list is built per request, not captured here.
    //
    // It used to be a `const availableTools` closed over by both handlers, which
    // froze a session's tool surface at creation: toggling a tool off left every
    // live session advertising and dispatching it until the session was evicted
    // or the client reconnected. That is the stale-snapshot shape ADR-108
    // removed from permission state, in the sibling control — same fix here, and
    // the reason a `tools/list_changed` notification is worth sending at all
    // (a client that re-fetched a snapshot would just receive it again).
    server.setRequestHandler(ListToolsRequestSchema, () => {
      Debug.log(`📋 [Session ${sessionId}] Listing available tools`);
      return {
        tools: this.buildTools(sessionId).map(tool => ({
          name: tool.name
          , title: tool.title
          , description: tool.description
          , annotations: tool.annotations
          , inputSchema: tool.inputSchema
        }))
      };
    });

    // Call tool handler
    server.setRequestHandler(CallToolRequestSchema, async (request): Promise<CallToolResult> => {
      const { name, arguments: args } = request.params;

      // ADR-112: rate limit first, before any dispatch work — even unknown
      // tool names count, so a caller cannot burn CPU by hammering garbage.
      // Keyed by credential identity; the undefined identity (primary key,
      // no-key, auth-disabled) is one bucket, the same bucketing as the
      // ADR-111 session cap.
      const limiterKey = scope?.identity ?? 'primary';
      const decision = this.toolCallLimiter.check(limiterKey);
      if (!decision.allowed) {
        const limit = this.rateLimitPerMinute();
        Debug.log(`⏱️ [Session ${sessionId}] Rate limited ${limiterKey} (${limit}/min) on tool: ${name}`);
        return rateLimitErrorResponse(limit, decision.retryAfterMs ?? 60_000);
      }

      Debug.log(`🔧 [Session ${sessionId}] Executing tool: ${name}`, args);

      const tool = this.buildTools(sessionId).find(t => t.name === name);
      if (!tool) {
        return {
          content: [{
            type: 'text'
            , text: `Error: Unknown tool "${name}"`
          }]
          , isError: true
        };
      }

      try {
        const result = await tool.handler(sessionAPI, args ?? {});
        return result as CallToolResult;
      } catch (error: unknown) {
        Debug.error(`[Session ${sessionId}] Tool execution error (${name}):`, error);
        return {
          content: [{
            type: 'text'
            , text: `Error executing tool "${name}": ${error instanceof Error ? error.message : String(error)}`
          }]
          , isError: true
        };
      }
    });

    // Resources live in src/resources/: the registry owns the
    // obsidian://resources/ namespace for the MCP resource protocol and the
    // view tool actions alike.
    server.setRequestHandler(ListResourcesRequestSchema, () => {
      Debug.log(`📋 [Session ${sessionId}] Listing available resources`);
      return { resources: buildResourceList(this.resourceDeps(sessionId)) };
    });

    // Read resource handler. The MCP protocol requires a URI on this
    // request, so the canonical obsidian://resources/<name> form is the
    // only one the registry serves.
    server.setRequestHandler(ReadResourceRequestSchema, (request) => {
      const { uri } = request.params;
      Debug.log(`📖 [Session ${sessionId}] Reading resource: ${uri}`);

      return {
        contents: [readResource(uri, this.resourceDeps(sessionId))]
      };
    });

    return mcpServer;
  }

  /**
   * Evict the oldest inactive server
   */
  private evictOldestServer(): void {
    let oldestSessionId: string | null = null;
    let oldestActivity = Date.now();

    for (const [sessionId, server] of this.servers) {
      if (server.lastActivityAt < oldestActivity) {
        oldestActivity = server.lastActivityAt;
        oldestSessionId = sessionId;
      }
    }

    if (oldestSessionId) {
      this.evictServer(oldestSessionId);
    }
  }

  /**
   * ADR-111: the per-credential session cap, read live so a settings change
   * applies to the next session creation. Missing or invalid means 1 — one
   * credential holds one session. Fails closed by design: a hand-edited
   * data.json gets the strictest value, not the loosest.
   */
  private sessionsPerTokenLimit(): number {
    const n = this.plugin?.settings?.sessionsPerToken;
    return typeof n === 'number' && Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1;
  }

  /**
   * ADR-112: the per-credential tool call limit, read live so a settings
   * change applies to live sessions. Missing, invalid, or non-positive means
   * 0 — disabled. Unlike sessionsPerTokenLimit this fails open on a
   * hand-edited data.json, on purpose: the limit is opt-in, and there is no
   * strict default that would not silently throttle every existing user.
   */
  private rateLimitPerMinute(): number {
    const n = this.plugin?.settings?.rateLimitPerMinute;
    return typeof n === 'number' && Number.isFinite(n) && n >= 1 ? Math.floor(n) : 0;
  }

  /** Label for the session-info resource, read live like the setting. */
  private sessionTimeoutLabel(): string {
    const ms = this.plugin?.settings?.sessionTimeoutMs;
    return typeof ms === 'number' && ms > 0 ? `${Math.round(ms / 60000)} minutes` : 'never';
  }

  /**
   * Remove a server and announce it. The listener in mcp-server.ts closes the
   * transport and drops the session-manager entry — without that half the
   * "evicted" session keeps working through its live transport.
   */
  private evictServer(sessionId: string): void {
    this.servers.delete(sessionId);
    Debug.log(`🗑️ Evicted MCP server: ${sessionId}`);
    this.emit('server-evicted', { sessionId });
  }

  /**
   * Get statistics about the server pool
   */
  getStats() {
    const servers = Array.from(this.servers.values());
    const now = Date.now();

    return {
      activeServers: this.servers.size
      , maxServers: this.maxServers
      , utilization: `${Math.round((this.servers.size / this.maxServers) * 100)}%`
      , totalRequests: servers.reduce((sum, s) => sum + s.requestCount, 0)
      , oldestServerAge: servers.length > 0 
        ? Math.max(...servers.map(s => now - s.createdAt))
        : 0
      , newestServerAge: servers.length > 0
        ? Math.min(...servers.map(s => now - s.createdAt))
        : 0
    };
  }

  /**
   * The number of resources the registry currently serves, for the settings
   * status display. List entries carry no session identity, so the deps
   * take a placeholder id.
   */
  getResourceCount(): number {
    return buildResourceList(this.resourceDeps('settings-status')).length;
  }

  /**
   * Clean up all servers
   */
  shutdown(): void {
    Debug.log(`🛑 Shutting down MCP server pool (${this.servers.size} servers)`);
    this.servers.clear();
    this.toolCallLimiter.reset();
  }
}