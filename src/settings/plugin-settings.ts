/**
 * The plugin settings shape and its defaults, in their own module so both
 * main.ts (the plugin) and settings/ui.ts (the declarative settings UI) can
 * use them without an import cycle.
 */
import { CertificateConfig } from '../utils/certificate-manager';
import { ValidationConfig } from '../validation/input-validator';
import { BindMode } from '../utils/network-classifier';
import { ScopedToken } from '../security/http-auth';

export interface MCPPluginSettings {
	httpEnabled: boolean;
	httpPort: number;
	httpsEnabled: boolean;
	httpsPort: number;
	certificateConfig: CertificateConfig;
	// ADR-107: network exposure modes
	bindMode: BindMode;
	customBindHost: string;
	hasShownBindMigrationNotice: boolean;
	debugLogging: boolean;
	showConnectionStatus: boolean;
	autoDetectPortConflicts: boolean;
	apiKey: string;
	// ADR-110: additional bearer tokens, each optionally restricted to a
	// folder and/or read-only
	scopedTokens: ScopedToken[];
	// ADR-111: session lifetime policy. sessionTimeoutMs 0 = never expire;
	// sessionsPerToken caps concurrent sessions per credential
	sessionTimeoutMs: number;
	sessionsPerToken: number;
	dangerouslyDisableAuth: boolean;
	readOnlyMode: boolean;
	enableWebFetch: boolean;
	allowCreateOverwrite: boolean;
	pathExclusionsEnabled: boolean;
	enableIgnoreContextMenu: boolean;
	validation?: Partial<ValidationConfig>;
	toolVisibility: Record<string, boolean>;
}

export interface MCPServerInfo {
	version: string;
	running: boolean;
	httpEnabled: boolean;
	httpsEnabled: boolean;
	httpPort: number;
	httpsPort: number;
	vaultName: string;
	vaultPath: string;
	toolsCount: number;
	resourcesCount: number;
	connections: number;
	poolStats: {
		enabled: boolean;
		stats?: {
			activeConnections: number;
			maxConnections: number;
			utilization: number;
			queuedRequests: number;
		};
	} | undefined;
}

export const DEFAULT_SETTINGS: MCPPluginSettings = {
	httpEnabled: true, // Start enabled by default
	httpPort: 3011,
	httpsEnabled: false, // HTTPS disabled by default
	httpsPort: 3444,
	certificateConfig: {
		enabled: false,
		selfSigned: true,
		autoGenerate: true,
		// rejectUnauthorized omitted on purpose: inert for our inbound HTTPS
		// server (no requestCert); cert-manager defaults it to true. See #163.
		minTLSVersion: 'TLSv1.2'
	},
	bindMode: 'loopback',
	customBindHost: '',
	hasShownBindMigrationNotice: false,
	debugLogging: false,
	showConnectionStatus: true,
	autoDetectPortConflicts: true,
	apiKey: '', // Will be generated on first load
	scopedTokens: [], // ADR-110: no scoped tokens until the user adds one
	sessionTimeoutMs: 0, // ADR-111: sessions never expire by default
	sessionsPerToken: 1, // ADR-111: one session per credential by default
	dangerouslyDisableAuth: false, // Auth enabled by default
	readOnlyMode: false, // Read-only mode disabled by default
	enableWebFetch: false, // ADR-109: outbound web fetch off by default, for everyone
	allowCreateOverwrite: false, // Create-as-upsert off by default: overwrite must be opted into
	pathExclusionsEnabled: false, // Path exclusions disabled by default
	enableIgnoreContextMenu: false, // Context menu disabled by default
	validation: {
		maxFileSize: 10 * 1024 * 1024, // 10MB default
		maxBatchSize: 100,
		maxPathLength: 255,
		maxRegexComplexity: 100,
		strictMode: false
	},
	toolVisibility: {} // Empty = all tools enabled (missing keys default to true)
};
