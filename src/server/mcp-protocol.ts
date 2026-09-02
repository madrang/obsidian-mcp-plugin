/**
 * MCP protocol request handling for the Streamable HTTP transport: session
 * resolution, the spec's session-lifecycle signals, and the ping fast path.
 * Transport plumbing lives in transport.ts; MCPHttpServer composes both.
 */
import express from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  isInitializeRequest
} from '@modelcontextprotocol/sdk/types.js';
import { randomUUID } from 'crypto';
import { AuthScope } from '../security/http-auth';
import { SessionManager } from '../utils/session-manager';
import { Debug } from '../utils/debug';
import type { ScopedHttpRequest } from './transport';

/** JSON-RPC request body structure */
export interface JsonRpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
}

/**
 * Emit the Streamable HTTP spec's session-lifecycle signal so the client
 * can recover a dropped/evicted session on its own (client-driven re-init,
 * ADR-106).
 *
 * - If the request carried an `Mcp-Session-Id` we no longer hold a
 *   transport for, the session is terminated: respond **HTTP 404**
 *   (Session Management §3). A spec-compliant client/bridge MUST then
 *   start a new session by sending a fresh `InitializeRequest` with no
 *   session ID (§4) — no client restart required, fixing #128.
 * - If no `Mcp-Session-Id` was sent on a non-initialize request, a session
 *   is required: respond **HTTP 400** (§2).
 *
 * The HTTP status is the load-bearing signal; the JSON-RPC error body is
 * courtesy for clients that surface it. We deliberately do not attempt a
 * server-side synthetic initialize — that cannot drive SDK 1.29's
 * web-standard transport to an initialized state (see #190).
 */
export function sendSessionTerminated(
  res: express.Response,
  request: JsonRpcRequest | undefined,
  sessionId: string | undefined
): void {
  const id = request?.id ?? null;
  if (sessionId) {
    // Spec §3: terminated session → 404; client re-inits per §4.
    res.setHeader('Mcp-Session-Id', sessionId);
    res.status(404).json({
      jsonrpc: '2.0'
      , error: {
        code: -32001
        , message: 'Session expired or not found. Start a new session by sending an initialize request without a session ID.'
        , data: { sessionId }
      }
      , id
    });
    Debug.log(`🔁 Session ${sessionId} terminated → 404 (client should re-initialize per MCP spec §4)`);
    return;
  }
  // Spec §2: session required for non-initialize requests → 400.
  res.status(400).json({
    jsonrpc: '2.0'
    , error: {
      code: -32600
      , message: 'Bad Request: a session is required. Send an initialize request first.'
    }
    , id
  });
  Debug.log('⚠️ Non-initialize request with no session id → 400 (session required)');
}

/** What the protocol handler reads from the composing server. */
export interface StreamableSessionDeps {
  transports: Map<string, StreamableHTTPServerTransport>;
  getOrCreateServer: (sessionId: string, authScope?: AuthScope) => McpServer;
  sessionIdentityMatches: (sessionId: string, identity?: string) => boolean;
  sessionManager?: SessionManager;
  /** A transport entered the map: the connection count rises. */
  onTransportAdded: () => void;
}

export async function handleStreamableHttpRequest(
  deps: StreamableSessionDeps,
  req: express.Request,
  res: express.Response
): Promise<void> {
  try {
    const request = req.body as JsonRpcRequest | undefined;

    // Get or create session ID
    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    const authScope = (req as ScopedHttpRequest).authScope;
    Debug.log(`📨 MCP Request: ${request?.method ?? 'unknown'}${sessionId ? ` [Session: ${sessionId}]` : ''}`, request?.params);

    // ADR-110: a session is bound at creation to the credential that
    // created it. A request presenting different credentials — for example
    // a folder-scoped token replaying a full-access session ID it learned —
    // is refused rather than served with the session's broader scope.
    if (sessionId && !deps.sessionIdentityMatches(sessionId, authScope?.identity)) {
      res.status(403).json({
        jsonrpc: '2.0'
        , error: {
          code: -32600
          , message: 'Forbidden: session is bound to different credentials'
        }
        , id: request?.id ?? null
      });
      Debug.log(`⛔ Session ${sessionId} presented mismatched credentials → 403`);
      return;
    }

    // `GET /mcp` opens the standalone SSE notification stream — long-lived and
    // idle by design (this server pushes no server-initiated notifications).
    // The global 120s socket timeout set in start() would otherwise reap it
    // every ~2 min, surfacing as a "stream terminated" reconnect churn in
    // bridges and noisy logs (#221). Disable the idle timeout on this GET
    // socket; POST request sockets keep the server-wide default. (A non-SSE
    // GET is short-lived — its response is sent immediately — so the
    // exemption is a harmless no-op for those.)
    //
    // Trade-off: with no socket-layer idle reap, a truly-dead SSE socket
    // (client vanished without a FIN) is no longer dropped at ~2 min.
    // Sessions do not idle out by default (ADR-111), so abandoned streams
    // are bounded by the capacity cap and the per-token session cap — both
    // of which close the transport — not by a timeout. Setting a session
    // timespan in the plugin settings re-enables the idle reap.
    if (req.method === 'GET') {
      req.socket?.setTimeout(0);
    }
    // Quick path: lightweight ping to keep session alive
    if (request?.method === 'session/ping' || request?.method === 'status/ping') {
      if (sessionId && deps.sessionManager) {
        deps.sessionManager.touchSession(sessionId);
      }
      if (sessionId) {
        res.setHeader('Mcp-Session-Id', sessionId);
      }
      res.status(200).json({ jsonrpc: '2.0', id: request?.id ?? null, result: { ok: true, sessionId: sessionId || null } });
      return;
    }
    let transport: StreamableHTTPServerTransport | undefined;
    let effectiveSessionId!: string; // will be set in the branches below
    if (sessionId) {
      effectiveSessionId = sessionId;
    }
        let mcpServer: McpServer;

    // Transport cleanup is handled by two existing paths, so there is no
    // per-transport close hook here:
    //   • idle eviction — the SessionManager emits `session-evicted`, whose
    //     handler (see the composing server) calls `transport.close()` and drops
    //     the map entry; every transport maps to a manager-tracked session that
    //     is eventually idle-evicted, so none leaks permanently.
    //   • explicit teardown — the DELETE /mcp handler closes + removes it.
    // A prior `transport.on('close'|'error')` helper here was dead code:
    // SDK 1.29's StreamableHTTPServerTransport is not an EventEmitter and has
    // no `.on`, so it never fired. Its only correct hook would be the
    // `onclose` callback, which would merely duplicate the two paths above.

    // Determine which server to use from the pool
    if (sessionId && deps.transports.has(sessionId)) {
        // Use existing transport for this session
        transport = deps.transports.get(sessionId)!;

        // Get the server for this session (it should already exist)
        mcpServer = deps.getOrCreateServer(sessionId, authScope);

        // Update session activity
        if (deps.sessionManager) {
          deps.sessionManager.touchSession(sessionId);
        }
      } else if (sessionId && deps.sessionManager) {
        // Session ID provided but no active transport
        // Only allow re-create on initialize; otherwise signal explicit session expiration
        if (isInitializeRequest(request)) {
          const session = deps.sessionManager.getOrCreateSession(sessionId);
          mcpServer = deps.getOrCreateServer(sessionId, authScope);
          effectiveSessionId = sessionId;
          transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => effectiveSessionId
          });
          await mcpServer.connect(transport);
          deps.transports.set(effectiveSessionId, transport);
          deps.onTransportAdded();
          Debug.log(`♻️ Recreated transport for session ${sessionId} (requests: ${session.requestCount})`);
        } else {
          // Stale/evicted session: the client presented an Mcp-Session-Id
          // we no longer hold a transport for, and this is not an
          // initialize request. Per the Streamable HTTP spec (Session
          // Management §3) the server MUST respond HTTP 404 for a
          // terminated session; per §4 the client must then start a new
          // session by sending a fresh InitializeRequest with no session
          // ID. We do NOT fabricate a transport or attempt a server-side
          // synthetic initialize — that cannot drive SDK 1.29's
          // web-standard transport to an initialized state (ADR-106 /
          // #190) and only produces an unrecoverable 400 loop (#128).
          sendSessionTerminated(res, request, sessionId);
          return;
        }
      } else if (!sessionId && isInitializeRequest(request)) {
        // New initialization request - create new transport with session
        effectiveSessionId = randomUUID();

        // Get or create server for this session
        mcpServer = deps.getOrCreateServer(effectiveSessionId, authScope);

        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => effectiveSessionId
        });

        // Connect the MCP server to this transport
        await mcpServer.connect(transport);

        // Store the transport for future requests
        deps.transports.set(effectiveSessionId, transport);
        deps.onTransportAdded();

        // Register session with manager if enabled
        if (deps.sessionManager) {
          deps.sessionManager.getOrCreateSession(effectiveSessionId);
        }
      } else {
        // Non-initialize request with no usable session. Either:
        //  - an Mcp-Session-Id we don't hold a transport for → spec §3
        //    terminated-session signal (HTTP 404), client re-inits per §4;
        //  - no Mcp-Session-Id at all and not an initialize → spec §2
        //    "session required" (HTTP 400).
        // sendSessionTerminated picks the status from sessionId presence.
        // No phantom transport, no synthetic initialize (see #190/#128).
        sendSessionTerminated(res, request, sessionId);
        return;
      }

    // Safety: every reachable path above either bound a live `transport`
    // (existing session, recreate-on-initialize, fresh initialize) or
    // returned a spec-compliant terminated/required-session response. A
    // missing transport here is an unexpected invariant break, not a stale
    // session — surface it explicitly rather than papering it.
    if (!transport) {
      Debug.error('Invariant: no transport after session resolution');
      sendSessionTerminated(res, request, sessionId);
      return;
    }

    // Handle the request using the transport
    await transport.handleRequest(
      req,
      res,
      request
    );

    Debug.log('📤 MCP Response sent via transport');

  } catch (error) {
    Debug.error('❌ MCP request error:', error);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: '2.0'
        , error: {
          code: -32603
          , message: 'Internal error: ' + (error instanceof Error ? error.message : 'Unknown error')
        }
        , id: null
      });
    }
  }
}
