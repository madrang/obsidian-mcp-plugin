/**
 * The session-info resource body: active MCP sessions, pool statistics,
 * and the live session lifetime policy. Moved from mcp-server-pool.ts.
 */
import type { ResourceBody, SessionInfoDeps } from './types';

interface SessionDataItem {
  sessionId: string;
  isCurrentSession: boolean;
  createdAt: string;
  lastActivityAt: string;
  requestCount: number;
  ageSeconds: number;
  idleSeconds: number;
  status: string;
}

export function buildSessionInfo(deps: SessionInfoDeps): ResourceBody {
  const sessions = deps.sessionManager.getAllSessions();
  const sessionStats = deps.sessionManager.getStats();
  const poolStats = deps.connectionPool?.getStats();

  const sessionData: SessionDataItem[] = sessions.map((session) => {
    const idleTime = Date.now() - session.lastActivityAt;
    const age = Date.now() - session.createdAt;
    return {
      sessionId: session.sessionId
      , isCurrentSession: session.sessionId === deps.sessionId
      , createdAt: new Date(session.createdAt).toISOString()
      , lastActivityAt: new Date(session.lastActivityAt).toISOString()
      , requestCount: session.requestCount
      , ageSeconds: Math.round(age / 1000)
      , idleSeconds: Math.round(idleTime / 1000)
      , status: session.sessionId === deps.sessionId ? '🟢 This is you!' : '🔵 Active'
    };
  });

  sessionData.sort((a: SessionDataItem, b: SessionDataItem) => {
    if (a.isCurrentSession) return -1;
    if (b.isCurrentSession) return 1;
    return b.lastActivityAt.localeCompare(a.lastActivityAt);
  });

  const sessionInfo = {
    summary: {
      activeSessions: sessionStats.activeSessions
      , maxSessions: sessionStats.maxSessions
      , utilization: `${Math.round((sessionStats.activeSessions / sessionStats.maxSessions) * 100)}%`
      , totalRequests: sessionStats.totalRequests
      , oldestSessionAge: `${Math.round(sessionStats.oldestSessionAge / 1000)}s`
      , newestSessionAge: `${Math.round(sessionStats.newestSessionAge / 1000)}s`
    }
    , serverPool: {
      activeServers: deps.serverPoolStats.activeServers
      , maxServers: deps.serverPoolStats.maxServers
      , utilization: deps.serverPoolStats.utilization
      , totalRequests: deps.serverPoolStats.totalRequests
    }
    , connectionPool: poolStats ? {
      activeConnections: poolStats.activeConnections
      , queuedRequests: poolStats.queuedRequests
      , maxConnections: poolStats.maxConnections
      , poolUtilization: `${Math.round(poolStats.utilization * 100)}%`
    } : null
    , sessions: sessionData
    , settings: {
      sessionTimeout: deps.sessionPolicy.sessionTimeoutLabel
      , sessionsPerToken: deps.sessionPolicy.sessionsPerTokenLimit
      , maxConcurrentConnections: deps.sessionPolicy.maxConcurrentConnections
    }
    , timestamp: new Date().toISOString()
  };

  return {
    mimeType: 'application/json'
    , text: JSON.stringify(sessionInfo, null, 2)
  };
}
