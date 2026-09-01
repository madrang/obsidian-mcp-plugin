/**
 * Shared types for the MCP resource registry (src/resources/).
 *
 * Resources are server-computed content exposed under the
 * obsidian://resources/ namespace. The registry (registry.ts) owns the URI
 * mapping. The builders in the sibling files own the content. The server
 * pool passes everything else in as explicit dependencies.
 */
import type { ObsidianAPI } from '../utils/obsidian-api';
import type { SessionManager } from '../utils/session-manager';
import type { ConnectionPool } from '../utils/connection-pool';

/** One entry of a resources/list response. */
export interface ResourceListEntry {
  uri: string;
  name: string;
  description: string;
  mimeType: string;
}

/** One rendered resource: the contents item of a resources/read response. */
export interface ResourceContent {
  uri: string;
  mimeType: string;
  text: string;
}

/** The body a builder produces. The registry attaches the canonical URI. */
export type ResourceBody = Pick<ResourceContent, 'mimeType' | 'text'>;

/** Server pool snapshot the session-info resource reports. */
export interface ServerPoolStats {
  activeServers: number;
  maxServers: number;
  utilization: string;
  totalRequests: number;
}

/** Session lifetime policy, read live by the pool at build time. */
export interface SessionPolicy {
  sessionTimeoutLabel: string;
  sessionsPerTokenLimit: number;
  maxConcurrentConnections: number;
}

/** What the vault-info builder needs. */
export interface VaultInfoDeps {
  obsidianAPI: ObsidianAPI;
  sessionId: string;
}

/** What the session-info builder needs. */
export interface SessionInfoDeps {
  sessionId: string;
  sessionManager: SessionManager;
  connectionPool?: ConnectionPool;
  serverPoolStats: ServerPoolStats;
  sessionPolicy: SessionPolicy;
}

/** Everything the registry needs, built per read so every value is live. */
export interface ResourceDeps extends VaultInfoDeps, Omit<SessionInfoDeps, 'sessionManager'> {
  sessionManager?: SessionManager;
}

/**
 * Coded refusal from the registry. UNKNOWN_RESOURCE names an obsidian://
 * URI that matches no registered resource.
 */
export class ResourceError extends Error {
  constructor(message: string, public code: string = 'UNKNOWN_RESOURCE') {
    super(message);
    this.name = 'ResourceError';
  }
}

/** The resource surface a router carries: read one by canonical URI, list all. */
export interface ResourceService {
  read(uri: string): ResourceContent;
  list(): ResourceListEntry[];
}
