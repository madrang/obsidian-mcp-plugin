---
status: Accepted
date: 2026-08-20
deciders:
  - Madrang
related:
  - ADR-108
  - ADR-109
---

# ADR-110: Scoped bearer tokens with per-token folder and read-only restriction

## Context

The server authenticates every request against one `apiKey`
(src/security/http-auth.ts). The key is all-or-nothing: any client that holds
it reaches the whole vault. A user who wants an agent to work only inside
`Projects/Blog`, or to only read notes, cannot express that today.

The MCP specification (2026-07-28) allows the tool list to vary by the
authorization presented on the request, so per-token surfaces are
spec-compliant. It also lists rate limiting as a server requirement. That part
stays open and is tracked separately.

## Decision

**Additional tokens, not a replacement.** `settings.scopedTokens` holds extra
credentials next to the unchanged primary `apiKey`:

```typescript
interface ScopedToken {
  name: string;
  token: string;
  folder?: string;    // vault-relative; unset = whole vault
  readOnly?: boolean;
}
```

Existing clients keep working. No migration runs.

**The auth decision carries the scope.** `authorizeRequest` matches the
presented credential against the primary key first, then each scoped token,
with the same constant-time comparison for every candidate. A scoped match
returns the token's `identity` (a truncated SHA-256 of the secret, never the
secret itself), `folder`, and `readOnly`. The primary key's decision shape is
unchanged and pinned by tests.

**Sessions bind to the credential that created them.** The middleware stashes
the scope on the request. The pool stores the identity on the pooled server
and builds the session's SecureObsidianAPI with it. A request that presents
different credentials for a live session ID gets HTTP 403. This closes the
replay of a full-access session ID by a scoped token holder. Revocation needs
no extra work: a deleted token fails the middleware check on the next request,
session ID or not. Scope edits apply to new sessions only.

**Enforcement rides the ignore-manager mechanism.** A scoped session gets a
`FolderScopedIgnoreManager` (src/security/token-scope.ts) in the plugin ref's
ignore-manager slot. It excludes every path that is not the folder or under
it, using a `folder + '/'` comparison so `ProjectsX` stays out of a
`Projects` scope. Every existing call site then enforces the scope with no
changes of its own: path operations fail with the existing `PATH_BLOCKED`
code, and listFiles, search results, and graph traversal filter silently.
`getEnabled()` always reports true, because
`VaultSecurityManager.isPathBlocked` gates the exclusion check on it. Token
read-only folds into the ADR-108 live predicate through the wrapped plugin
ref's settings getter, and denies with the existing `PERMISSION_DENIED` code.

**The tool list does not vary per token.** The spec allows it. We decline:
enforcement in the security layer leaves one code path, and a hidden tool
would only be presentation anyway (ADR-109's lesson).

## Gaps closed in the same pass

The scope only holds if every read path respects the ignore manager. Three did
not:

- `GraphSearchTraversal` and `GraphSearchTagTraversal` enumerated
  `app.vault.getFiles()` directly and followed links without a filter. Both
  now take the ignore manager and skip excluded paths during traversal.
- The active-file operations (`getActiveFile`, `updateActiveFile`,
  `appendToActiveFile`, `deleteActiveFile`) validated no path at all. They
  now validate the resolved active-file path, so a scoped or excluded note
  cannot leak through `view.active` or be written through the active-file
  channel. This hardens the single-key case too.

## Consequences

- One mechanism covers both targeted and enumeration operations, and denials
  reuse the codes agents already understand. The denial does not reveal the
  scope configuration.
- Session-bound scope means a folder change does not disturb live sessions.
  The settings UI says so.
- `SearchCore.search()` enumerates the whole vault unfiltered. It has no
  callers today. A future caller must filter, the way GraphSearchTraversal now
  does.
- The wrapped plugin ref is a per-session object with a live settings getter.
  The ADR-108 guarantee (settings changes apply without a restart) is
  preserved, and tested.

## Alternatives considered

- **`sandboxMode` per session.** `SecuritySettings.sandboxMode` already
  existed as a single global folder restriction. It compares with bare
  `startsWith` (the `Projects`/`ProjectsX` collision), and it covers only
  path-targeted operations, not enumeration. Extending it would have fixed
  the prefix bug and still left the search and graph leaks.
- **Per-token tool visibility.** Two policy planes for one decision. The
  security layer is the enforcement point everywhere else in this codebase.
- **A new error code for scope denials.** `PATH_BLOCKED` is accurate, and a
  distinct code would tell a probing client that a scope exists.
