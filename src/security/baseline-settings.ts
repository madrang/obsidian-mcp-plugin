/**
 * The security baseline every server and session API is built with.
 *
 * Permissions are all TRUE on purpose, and must stay that way (ADR-108).
 * Read-only is enforced by VaultSecurityManager's live predicate, which only
 * ever ADDS denial — it cannot grant. So a restrictive baseline is a one-way
 * door: installing presets.readOnly() here (which is what this used to do when
 * the server booted with read-only on) meant toggling read-only OFF could not
 * restore writes until the next restart.
 *
 * Path validation and .mcpignore blocking are unaffected — those are not
 * permissions and still apply.
 */
export const BASELINE_SECURITY_SETTINGS = {
  pathValidation: 'strict' as const  // Always validate paths for security
  , permissions: {
    read: true
    , create: true
    , update: true
    , delete: true
    , move: true
    , execute: true
  }
  , blockedPaths: []  // .mcpignore will handle blocking
  , logSecurityEvents: false
};
