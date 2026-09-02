import express from 'express';
import { App, Notice } from 'obsidian';
import { Server } from 'http';
import { Server as HttpsServer } from 'https';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { ObsidianAPI } from './utils/obsidian-api';
import { SecureObsidianAPI } from './security';
import { BASELINE_SECURITY_SETTINGS } from './security/baseline-settings';
import { Debug } from './utils/debug';
import { ConnectionPool } from './utils/connection-pool';
import { SessionManager } from './utils/session-manager';
import { MCPServerPool } from './utils/mcp-server-pool';
import { CertificateManager, CertificateConfig } from './utils/certificate-manager';
import {
  classifyFromSettings,
  resolveListenHost,
  agentInstructionsForVerdict,
  Verdict
} from './utils/network-classifier';
import {
  MCPPluginRef,
  setupExpressMiddleware,
  setupHttpRoutes,
  createListenerServer,
  configureServerTimeouts
} from './server/transport';
import { handleStreamableHttpRequest } from './server/mcp-protocol';

/** Connection pool stats response */
interface ConnectionPoolStatsResponse {
  enabled: boolean;
  stats?: {
    activeConnections: number;
    queuedRequests: number;
    maxConnections: number;
    utilization: number;
  };
  serverPoolStats?: {
    activeServers: number;
    maxServers: number;
    utilization: string;
    totalRequests: number;
  };
}

export class MCPHttpServer {
  private app: express.Application;
  private server?: Server | HttpsServer;
  private mcpServerPool!: MCPServerPool;
  private transports: Map<string, StreamableHTTPServerTransport> = new Map();
  private obsidianApp: App;
  // Deliberately the narrow type, not ObsidianAPI. Every session's API is built
  // from this one, and MCPServerPool now refuses to create a session when it is
  // not a SecureObsidianAPI — so a future assignment of a plain ObsidianAPI here
  // should fail to compile rather than fail at session creation.
  private obsidianAPI: SecureObsidianAPI;
  private port: number;
  private isRunning: boolean = false;
  private connectionCount: number = 0;
  private plugin?: MCPPluginRef; // Reference to the plugin
  private connectionPool?: ConnectionPool;
  // Assigned unconditionally in the constructor. Non-optional so the
  // "initialize is never short-circuited as a terminated session" invariant
  // (ADR-106) is guaranteed by the type system, not just construction order.
  private sessionManager: SessionManager;
  private certificateManager: CertificateManager | null;
  private isHttps: boolean = false;
  // ADR-107: resolved at bind time, consumed by initialize.instructions
  private currentVerdict?: Verdict;
  private resolvedListenHost: string = '127.0.0.1';

  constructor(obsidianApp: App, port: number = 3011, plugin?: MCPPluginRef) {
    this.obsidianApp = obsidianApp;
    this.port = port;
    this.plugin = plugin;

    // Only initialize certificate manager if HTTPS is enabled
    // to avoid fs module issues in browser environment
    if (plugin?.settings?.httpsEnabled && plugin?.settings?.certificateConfig?.enabled) {
      this.isHttps = true;
      this.port = plugin.settings.httpsPort ?? 3444;
      // Lazy initialize certificate manager only when needed
      this.certificateManager = null; // Will be initialized when server starts
    } else {
      this.certificateManager = null;
    }

    // Always use SecureObsidianAPI with VaultSecurityManager as our firewall
    Debug.log('🔐 Initializing VaultSecurityManager firewall');

    // One baseline ruleset, regardless of read-only (ADR-108). See
    // baseline-settings.ts for why it must stay permissive.
    //
    // This used to branch on readOnlyMode and install presets.readOnly() when it
    // was set. That snapshot was the whole bug: read-only became whatever it was
    // at construction. The live predicate in VaultSecurityManager only ever ADDS
    // denial, so a readOnly snapshot here could not be un-done by toggling the
    // setting off — every write stayed denied until the next restart, for exactly
    // the user who runs read-only by default and flips it off for one edit.
    //
    // Read-only is now enforced solely by that predicate, which reads the setting
    // per call. Baseline permissions stay permissive so the predicate is the only
    // thing that decides.
    const securitySettings = BASELINE_SECURITY_SETTINGS;
    Debug.log(`🔐 Baseline ruleset loaded; read-only currently ${plugin?.settings?.readOnlyMode ? 'ON' : 'OFF'} (live)`);

    // Always use SecureObsidianAPI for consistent security layer
    this.obsidianAPI = new SecureObsidianAPI(obsidianApp, undefined, plugin, securitySettings);

    // Initialize connection pool and session manager (always concurrent)
    const maxConnections = 32;

    this.sessionManager = new SessionManager({
      maxSessions: maxConnections
      // ADR-111: live accessor — the sweep reads the current setting, so the
      // expiry toggle applies without a restart. 0 = sessions never expire.
      , get sessionTimeout() { return plugin?.settings?.sessionTimeoutMs ?? 0; }
      , checkInterval: 60000 // Check every minute
    });
    this.sessionManager.start();

    // Handle session events
    this.sessionManager.on('session-evicted', (data: { session: { sessionId: string }; reason: string }) => {
      const transport = this.transports.get(data.session.sessionId);
      if (transport) {
        void transport.close();
        this.transports.delete(data.session.sessionId);
        this.connectionCount = Math.max(0, this.connectionCount - 1);
        Debug.log(`🔚 Evicted session ${data.session.sessionId} (${data.reason}). Connections: ${this.connectionCount}`);
      }
    });

    // Initialize connection pool
    this.connectionPool = new ConnectionPool({
      maxConnections
      , maxQueueSize: 100
      , requestTimeout: 30000
      , sessionCheckInterval: 60000
    });
    void this.connectionPool.initialize();

    // No 'process' dispatch handler is registered here, deliberately.
    //
    // There was one, and it resolved tools from the old module-level tool list
    // const — which is built with NO visibility argument, so neither the enum
    // filter nor the ACTION_DISABLED check existed on that path: a complete
    // bypass of tool visibility. It was dead code (nothing calls the pool's
    // submitRequest/submitPriorityRequest), but it would have become a live
    // bypass the moment anything enqueued a request, which is the same shape as
    // the unsecured-session fallback removed from MCPServerPool.
    //
    // Real dispatch goes through MCPServerPool, which builds per-session tools
    // WITH the live visibility settings. If request queueing is ever wanted, it
    // must route through that path rather than re-introducing a second dispatcher.
    // The pool itself stays — it is still used for stats, session context, and
    // shutdown.

    // Initialize MCP Server Pool
    this.mcpServerPool = new MCPServerPool(this.obsidianAPI, maxConnections, plugin);
    this.mcpServerPool.setContexts(this.sessionManager, this.connectionPool);

    // A pool-level eviction (capacity, or the ADR-111 per-token cap) must
    // actually end the session: close the transport and drop the manager
    // entry, or the "evicted" session keeps working through them. The evicted
    // client's next request then gets the ADR-106 404 and re-initializes.
    this.mcpServerPool.on('server-evicted', (data: { sessionId: string }) => {
      const transport = this.transports.get(data.sessionId);
      if (transport) {
        void transport.close();
        this.transports.delete(data.sessionId);
        this.connectionCount = Math.max(0, this.connectionCount - 1);
      }
      this.sessionManager.removeSession(data.sessionId);
      Debug.log(`🔚 Pool-evicted session ${data.sessionId}. Connections: ${this.connectionCount}`);
    });

    Debug.log(`🏊 Connection pool initialized with max ${maxConnections} connections`);

    this.app = express();
    setupExpressMiddleware(this.app, this.plugin);
    setupHttpRoutes(this.app, {
      vaultName: () => this.obsidianApp.vault.getName()
      , port: () => this.port
      , httpsDiscovery: () => this.plugin?.settings?.httpsEnabled === true
      , transports: this.transports
      , closeSession: (sessionId) => {
        if (!this.transports.has(sessionId)) return false;
        const transport = this.transports.get(sessionId)!;
        void transport.close();
        this.transports.delete(sessionId);
        this.connectionCount = Math.max(0, this.connectionCount - 1);
        Debug.log(`🔚 Closed MCP session: ${sessionId} (Remaining: ${this.connectionCount})`);
        return true;
      }
      , onMCPRequest: (req, res) => this.handleMCPRequest(req, res)
    });
  }

  private async handleMCPRequest(req: express.Request, res: express.Response): Promise<void> {
    await handleStreamableHttpRequest({
      transports: this.transports
      , getOrCreateServer: (sessionId, authScope) => this.mcpServerPool.getOrCreateServer(sessionId, authScope)
      , sessionIdentityMatches: (sessionId, identity) => this.mcpServerPool.sessionIdentityMatches(sessionId, identity)
      , sessionManager: this.sessionManager
      , onTransportAdded: () => { this.connectionCount++; }
    }, req, res);
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      Debug.log(`MCP server already running on port ${this.port}`);
      return;
    }

    return new Promise<void>((resolve, reject) => {
      // Create HTTP or HTTPS server based on configuration
      const certificateConfig: CertificateConfig = this.plugin?.settings?.certificateConfig ?? { enabled: false };

      // Initialize certificate manager lazily if HTTPS is enabled
      if (this.isHttps && !this.certificateManager) {
        try {
          this.certificateManager = new CertificateManager(this.obsidianApp);
        } catch (error) {
          Debug.error('Failed to initialize certificate manager:', error);
          // Fall back to HTTP if certificate manager fails
          this.isHttps = false;
        }
      }

      // Create server - use certificate manager if available and HTTPS is enabled
      this.server = createListenerServer({
        app: this.app
        , isHttps: this.isHttps
        , certificateManager: this.certificateManager
        , certificateConfig
        , port: this.port
      });

      const protocol = this.isHttps ? 'https' : 'http';

      if (!this.server) {
        reject(new Error('Failed to create server'));
        return;
      }

      // Configure server timeouts to keep connections healthy and prevent hangs
      configureServerTimeouts(this.server);

      // ADR-107: resolve bind host from settings and classify the combined state
      const bindMode = this.plugin?.settings?.bindMode ?? 'loopback';
      const customHost = this.plugin?.settings?.customBindHost ?? '';
      this.resolvedListenHost = resolveListenHost(bindMode, customHost);
      this.currentVerdict = classifyFromSettings({
        httpsEnabled: this.isHttps
        , bindMode
        , customBindHost: customHost
        , userSuppliedCert: !!(this.plugin?.settings?.certificateConfig?.certPath
          && this.plugin?.settings?.certificateConfig?.keyPath)
      });
      // Push the agent-visible warning to the server pool so subsequent
      // sessions surface it in MCP initialize.instructions.
      this.mcpServerPool.setInitializeInstructions(
        agentInstructionsForVerdict(this.currentVerdict, this.resolvedListenHost, this.port)
      );

      this.server.listen(this.port, this.resolvedListenHost, () => {
        this.isRunning = true;
        const host = this.resolvedListenHost;
        Debug.log(`🚀 MCP server started on ${protocol}://${host}:${this.port}`);
        Debug.log(`📍 Health check: ${protocol}://${host}:${this.port}/`);
        Debug.log(`🔗 MCP endpoint: ${protocol}://${host}:${this.port}/mcp`);

        if (this.isHttps) {
          Debug.log('🔒 HTTPS enabled with certificate');
          new Notice(`MCP server running on HTTPS port ${this.port}`);
        }

        // ADR-107: act on the classified verdict
        const verdict = this.currentVerdict!;
        if (verdict.class === 'jail') {
          Debug.error(`🚨 Network exposure: ${verdict.reason}`);
          new Notice(
            `⚠️ MCP server is serving vault contents over an unencrypted network interface (${host}:${this.port}). ` +
              'API key and document text travel in cleartext. Reconfigure to HTTPS or loopback in the plugin settings.',
            15000
          );
        } else if (verdict.class === 'warn') {
          Debug.warn(`⚠️ Network exposure: ${verdict.reason}`);
        }

        resolve();
      });

      this.server.on('error', (error: unknown) => {
        this.isRunning = false;
        Debug.error('❌ Failed to start MCP server:', error);
        reject(error instanceof Error ? error : new Error(String(error)));
      });
    });
  }

  async stop(): Promise<void> {
    if (!this.isRunning || !this.server) {
      return;
    }

    // Clean up all active transports
    for (const [sessionId, transport] of this.transports) {
      void transport.close();
      Debug.log(`🔚 Closed MCP session on shutdown: ${sessionId}`);
    }
    this.transports.clear();
    this.connectionCount = 0; // Reset connection count on server stop

    // Shutdown session manager if it exists
    if (this.sessionManager) {
      this.sessionManager.stop();
    }

    // Shutdown connection pool if it exists
    if (this.connectionPool) {
      await this.connectionPool.shutdown();
    }

    // Shutdown MCP server pool if it exists
    if (this.mcpServerPool) {
      this.mcpServerPool.shutdown();
    }

    return new Promise<void>((resolve) => {
      this.server?.close(() => {
        this.isRunning = false;
        Debug.log('👋 MCP server stopped');
        resolve();
      });
    });
  }

  getPort(): number {
    return this.port;
  }

  isServerRunning(): boolean {
    return this.isRunning;
  }

  getConnectionCount(): number {
    return this.connectionCount;
  }

  /**
   * Tell live MCP sessions their tool list changed (#285).
   *
   * Called from the settings UI when a toggle changes which tools are visible.
   * Safe before the pool exists (server not started yet) — there is nothing to
   * notify in that case.
   */
  notifyToolListChanged(): void {
    this.mcpServerPool?.notifyToolListChanged();
  }

  /**
   * Get connection pool statistics
   */
  getConnectionPoolStats(): ConnectionPoolStatsResponse {
    if (!this.connectionPool) {
      return { enabled: false };
    }

    const result: ConnectionPoolStatsResponse = {
      enabled: true
      , stats: this.connectionPool.getStats()
    };

    // Include MCP server pool stats if available
    if (this.mcpServerPool) {
      const poolStats = this.mcpServerPool.getStats();
      result.serverPoolStats = {
        activeServers: poolStats.activeServers
        , maxServers: poolStats.maxServers
        , utilization: poolStats.utilization
        , totalRequests: poolStats.totalRequests
      };
    }

    return result;
  }

  /**
   * Number of resources the registry serves, for the settings status display.
   * Zero before the pool exists (server not started).
   */
  getResourceCount(): number {
    return this.mcpServerPool?.getResourceCount() ?? 0;
  }

  /**
   * Get or create a session-specific API instance
   */
  private getSessionAPI(sessionId?: string): ObsidianAPI {
    if (!sessionId) {
      return this.obsidianAPI;
    }

    // For now, return the same API instance
    // In the future, we could create session-specific instances with isolated state
    return this.obsidianAPI;
  }
}
