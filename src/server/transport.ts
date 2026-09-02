/**
 * HTTP(S) transport plumbing for the MCP server: the express middleware
 * chain, the HTTP routes, listener creation, and socket timeout tuning.
 * The MCP protocol semantics live in mcp-protocol.ts; MCPHttpServer
 * composes both.
 */
import express from 'express';
import cors from 'cors';
import { createServer as createHttpServer, Server } from 'http';
import { Server as HttpsServer } from 'https';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { getVersion } from '../version';
import { authorizeRequest, AuthScope, ScopedToken } from '../security/http-auth';
import { CertificateManager, CertificateConfig } from '../utils/certificate-manager';
import { Debug } from '../utils/debug';
import { BindMode } from '../utils/network-classifier';

/** Minimal plugin interface for MCPHttpServer.
 * Includes fields from SecurePluginRef and ObsidianAPIPluginRef so the same object
 * can be passed through the constructor chain. */
export interface MCPPluginRef {
  settings?: {
    httpsEnabled?: boolean;
    httpsPort?: number;
    httpPort?: number;
    certificateConfig?: CertificateConfig;
    // ADR-107: bind mode + custom host
    bindMode?: BindMode;
    customBindHost?: string;
    readOnlyMode?: boolean;
    apiKey?: string;
    scopedTokens?: ScopedToken[];
    // ADR-111: session lifetime policy
    sessionTimeoutMs?: number;
    sessionsPerToken?: number;
    dangerouslyDisableAuth?: boolean;
    // From SecurePluginRef (for SecureObsidianAPI)
    security?: Partial<import('../security/vault-security-manager').SecuritySettings>;
    // From ObsidianAPIPluginRef (for ObsidianAPI)
    validation?: Partial<import('../validation/input-validator').ValidationConfig>;
  };
  manifest: { dir?: string };
  // From ObsidianAPIPluginRef
  ignoreManager?: import('../security/mcp-ignore-manager').MCPIgnoreManager;
  mcpServer?: { isServerRunning(): boolean; getConnectionCount(): number };
}

/** Express request after the auth middleware: carries the matched scoped
 * token's restriction, when one matched (ADR-110). */
export type ScopedHttpRequest = express.Request & { authScope?: AuthScope };

/** Server with configurable timeout properties (Node.js http.Server internals) */
export interface ServerWithTimeouts {
  keepAliveTimeout: number;
  headersTimeout: number;
  requestTimeout: number;
  setTimeout: (msecs: number) => unknown;
}

export function setupExpressMiddleware(app: express.Application, plugin?: MCPPluginRef): void {
  // CORS middleware for MCP clients
  app.use(cors({
    origin: '*'
    , methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']
    , allowedHeaders: ['Origin', 'X-Requested-With', 'Content-Type', 'Accept', 'Authorization', 'Mcp-Session-Id']
    , exposedHeaders: ['Mcp-Session-Id']
  }));

  // JSON body parser
  app.use(express.json());

  // Request logging for debugging (moved before auth to see all requests)
  app.use((req, res, next) => {
    Debug.log(`📡 ${req.method} ${req.url}`, {
      headers: req.headers
      , body: req.body ? JSON.stringify(req.body).substring(0, 200) : ''
    });
    next();
  });

  // Authentication middleware. The decision itself lives in
  // security/http-auth.ts as a pure function so every branch is testable —
  // dangerouslyDisableAuth previously had no test coverage at all because the
  // logic was only reachable by standing up a server.
  app.use((req, res, next) => {
    const decision = authorizeRequest({
      method: req.method
      , authHeader: req.headers.authorization
      , apiKey: plugin?.settings?.apiKey
      , scopedTokens: plugin?.settings?.scopedTokens
      , authDisabled: plugin?.settings?.dangerouslyDisableAuth
    });

    if (decision.allow) {
      if (decision.reason === 'auth-disabled') {
        Debug.log('⚠️ Authentication is DISABLED - allowing access without credentials');
      } else if (decision.reason === 'no-key-configured') {
        Debug.log('🔓 No API key configured, allowing access');
      } else if (decision.reason === 'authenticated') {
        Debug.log('✅ Auth successful');
      }
      // ADR-110: a scoped token match carries its identity and restriction
      // into session creation. Everything else (primary key, no-key,
      // auth-disabled, preflight) leaves authScope unset = full access.
      if (decision.reason === 'authenticated' && decision.identity) {
        (req as ScopedHttpRequest).authScope = {
          identity: decision.identity
          , ...(decision.scopes ? { scopes: decision.scopes } : {})
        };
      }
      return next();
    }

    Debug.log(`❌ Auth failed: ${decision.reason}`);
    res.status(decision.status).json({ error: decision.error });
  });
}

/** What the HTTP routes read from the composing server. */
export interface HttpRoutesDeps {
  vaultName: () => string;
  port: () => number;
  /** Discovery answers from the httpsEnabled setting, not the live listener. */
  httpsDiscovery: () => boolean;
  transports: Map<string, StreamableHTTPServerTransport>;
  /** Close a session's transport, drop it, and decrement the connection
   * count. Returns false when no transport existed for the id. */
  closeSession: (sessionId: string) => boolean;
  onMCPRequest: (req: express.Request, res: express.Response) => void | Promise<void>;
}

export function setupHttpRoutes(app: express.Application, deps: HttpRoutesDeps): void {
  // Health check endpoint
  app.get('/', (req, res) => {
    const response = {
      name: 'Scoped Vault MCP'
      , version: getVersion()
      , status: 'running'
      , vault: deps.vaultName()
      , timestamp: new Date().toISOString()
    };

    Debug.log('📊 Health check requested');
    res.json(response);
  });

  // MCP discovery endpoints
  app.get('/.well-known/appspecific/com.mcp.obsidian-mcp', (req, res) => {
    const protocol = deps.httpsDiscovery() ? 'https' : 'http';
    res.json({
      endpoint: `${protocol}://localhost:${deps.port()}/mcp`
      , protocol: protocol
      , method: 'POST'
      , contentType: 'application/json'
    });
  });

  // Debug/info endpoint — moved off `GET /mcp` so it no longer shadows the
  // SSE stream the client opens with `GET /mcp` (the shadowing caused the
  // SSE reconnection loop in #125).
  app.get('/mcp-info', (req, res) => {
    res.json({
      message: 'MCP endpoint active'
      , usage: 'POST /mcp for messages, GET /mcp for the SSE stream'
      , protocol: 'Model Context Protocol'
      , transport: 'HTTP'
      , sessionHeader: 'Mcp-Session-Id'
    });
  });

  // MCP protocol endpoint — StreamableHTTPServerTransport. POST carries
  // messages, GET establishes the SSE stream; both go to the same handler.
  // DELETE keeps its own explicit session-close handler below, so we route
  // GET/POST individually rather than `app.all` (which would shadow it).
  app.post('/mcp', (req, res) => {
    void deps.onMCPRequest(req, res);
  });
  app.get('/mcp', (req, res) => {
    void deps.onMCPRequest(req, res);
  });

  // Handle session deletion
  app.delete('/mcp', (req, res) => {
    const sessionId = req.headers['mcp-session-id'] as string;

    if (sessionId && deps.closeSession(sessionId)) {
      res.status(200).json({ message: 'Session closed' });
    } else {
      res.status(404).json({ error: 'Session not found' });
    }
  });
}

/** Create the HTTP or HTTPS listener for the express app. HTTPS goes through
 * the certificate manager; HTTP is the plain node server. */
export function createListenerServer(opts: {
  app: express.Application;
  isHttps: boolean;
  certificateManager: CertificateManager | null;
  certificateConfig: CertificateConfig;
  port: number;
}): Server | HttpsServer {
  if (opts.isHttps && opts.certificateManager) {
    return opts.certificateManager.createServer(opts.app, opts.certificateConfig, opts.port);
  }
  return createHttpServer(opts.app);
}

/** Configure server timeouts to keep connections healthy and prevent hangs. */
export function configureServerTimeouts(server: Server | HttpsServer): void {
  try {
    const serverWithTimeouts = server as unknown as ServerWithTimeouts;
    // Keep connections alive long enough for clients, but not indefinitely
    serverWithTimeouts.keepAliveTimeout = 60_000; // 60s
    // Headers timeout should exceed keepAliveTimeout slightly
    serverWithTimeouts.headersTimeout = 65_000; // 65s
    // Per-request timeout; 0 to disable, or a generous value
    serverWithTimeouts.requestTimeout = 120_000; // 120s
    // Legacy idle timeout fallback
    if (typeof serverWithTimeouts.setTimeout === 'function') {
      serverWithTimeouts.setTimeout(120_000);
    }
    Debug.log('⏱️ Server timeouts configured (keepAlive=60s, headers=65s, request=120s)');
  } catch (e) {
    Debug.error('Failed to configure server timeouts:', e);
  }
}
