/**
 * The plugin settings shape and its defaults, in their own module so both
 * main.ts (the plugin) and settings/ui.ts (the declarative settings UI) can
 * use them without an import cycle.
 */
import { CertificateConfig } from '../utils/certificate-manager';
import { ValidationConfig } from '../validation/input-validator';
import { BindMode } from '../utils/network-classifier';
import { ScopedToken, normalizeScopedTokens } from '../security/http-auth';

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
	// ADR-112: max tool calls per credential per 60s. 0 = disabled (default)
	rateLimitPerMinute: number;
	dangerouslyDisableAuth: boolean;
	readOnlyMode: boolean;
	enableWebFetch: boolean;
	allowCreateOverwrite: boolean;
	// ADR-113: managed-namespace write gates. Reads of both namespaces are
	// open; every write needs its dedicated setting, both default off.
	allowSnippetEditing: boolean;
	allowConfigEditing: boolean;
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
	httpEnabled: true // Start enabled by default
	, httpPort: 3011
	, httpsEnabled: false // HTTPS disabled by default
	, httpsPort: 3444
	, certificateConfig: {
		enabled: false
		, selfSigned: true
		, autoGenerate: true
		// rejectUnauthorized omitted on purpose: inert for our inbound HTTPS
		// server (no requestCert); cert-manager defaults it to true. See #163.
		, minTLSVersion: 'TLSv1.2'
	}
	, bindMode: 'loopback'
	, customBindHost: ''
	, hasShownBindMigrationNotice: false
	, debugLogging: false
	, showConnectionStatus: true
	, autoDetectPortConflicts: true
	, apiKey: '' // Will be generated on first load
	, scopedTokens: [] // ADR-110: no scoped tokens until the user adds one
	, sessionTimeoutMs: 0 // ADR-111: sessions never expire by default
	, sessionsPerToken: 16 // ADR-111 cap. Raised from 1 (2026-08-24): parallel client connections each open a session, and a cap of 1 made them evict each other
	, rateLimitPerMinute: 0 // ADR-112: no limit until the user sets one
	, dangerouslyDisableAuth: false // Auth enabled by default
	, readOnlyMode: false // Read-only mode disabled by default
	, enableWebFetch: false // ADR-109: outbound web fetch off by default, for everyone
	, allowCreateOverwrite: false // Create-as-upsert off by default: overwrite must be opted into
	, allowSnippetEditing: false // ADR-113: snippet file writes off by default, reads open
	, allowConfigEditing: false // ADR-113: config writes off by default, reads open
	, pathExclusionsEnabled: false // Path exclusions disabled by default
	, enableIgnoreContextMenu: false // Context menu disabled by default
	, validation: {
		maxFileSize: 10 * 1024 * 1024 // 10MB default
		, maxBatchSize: 100
		, maxPathLength: 255
		, maxRegexComplexity: 100
		, strictMode: false
	}
	, toolVisibility: {} // Empty = all tools enabled (missing keys default to true)
};

/**
 * Coerce the security-relevant fields of a settings object loaded from
 * data.json. loadData() returns whatever is on disk, and data.json is
 * hand-editable. The security predicates test `=== true` while the settings
 * toggle renders with truthiness, so a string "true" would show the toggle
 * ON while the gate was NOT enforced — belief diverging from reality, which
 * is the exact shape of the bug this hardening came out of. Normalising
 * here means UI and enforcement read one value.
 */
export function normalizeLoadedSettings(settings: MCPPluginSettings): MCPPluginSettings {
	settings.readOnlyMode = settings.readOnlyMode === true;
	settings.dangerouslyDisableAuth = settings.dangerouslyDisableAuth === true;
	settings.enableWebFetch = settings.enableWebFetch === true;
	settings.allowCreateOverwrite = settings.allowCreateOverwrite === true;
	// ADR-113: both managed-namespace write gates fail closed on
	// hand-edited values. No migration code: a missing key takes the
	// false default.
	settings.allowSnippetEditing = settings.allowSnippetEditing === true;
	settings.allowConfigEditing = settings.allowConfigEditing === true;

	// ADR-110: drop malformed scoped tokens and normalize folders.
	settings.scopedTokens = normalizeScopedTokens(settings.scopedTokens);

	// ADR-111: session lifetime policy. Both fail closed on hand-edited
	// values: an invalid timespan means never expire, an invalid cap means 1.
	settings.sessionTimeoutMs = typeof settings.sessionTimeoutMs === 'number' && settings.sessionTimeoutMs >= 0
		? settings.sessionTimeoutMs
		: 0;
	settings.sessionsPerToken = typeof settings.sessionsPerToken === 'number' && settings.sessionsPerToken >= 1
		? Math.floor(settings.sessionsPerToken)
		: 1;

	return settings;
}
