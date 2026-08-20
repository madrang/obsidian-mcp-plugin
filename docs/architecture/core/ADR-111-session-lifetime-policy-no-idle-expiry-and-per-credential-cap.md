---
status: Accepted
date: 2026-08-20
deciders:
  - Madrang
related:
  - ADR-106
  - ADR-110
---

# ADR-111: Session lifetime policy — no idle expiry by default, one session per credential

## Context

Sessions used to idle out after one hour
(SessionManager's default `sessionTimeout`). The next request on an expired
session got the ADR-106 "session terminated" response and the client had to
re-initialize. Agent harnesses that hold a session across long pauses — a user
reading between prompts, a scheduled task — hit exactly that path, and a
client that does not re-initialize on its own stalls with
`-32001 Session expired or not found`.

Two session-management gaps surfaced at the same time:

- The pool's capacity eviction deleted the pooled server but left the
  transport and the session-manager entry alive, so an "evicted" session kept
  working. Eviction was a lie.
- ADR-110 binds a session to a credential. Nothing bounded how many sessions
  one credential could accumulate.

## Decision

**Idle expiry is a user setting, default never.** `sessionTimeoutMs` holds the
idle timespan; 0 means sessions never expire, and that is the default. A value
that fails to parse as a non-negative number normalizes to 0 (fail closed to
never). With never, an old session ID can resume at any time, which is the
behavior long-paused harnesses need.

**One credential, one session, by default.** `sessionsPerToken` caps the
concurrent sessions per credential identity (ADR-110), default 1. Creating a
new session past the cap invalidates that credential's OLDEST session. The
primary key, no-key mode, and auth-disabled mode share one undefined-identity
bucket, so the primary key follows the same rule. An invalid value normalizes
to 1. Users who run several clients on one credential raise the cap, or give
each client its own scoped token.

**Eviction now ends the session.** The pool's `server-evicted` event gained
its missing listener in mcp-server.ts: the transport closes, the
session-manager entry drops, and the evicted client's next request gets the
ADR-106 404 and re-initializes. This covers capacity eviction and the new
per-token cap alike.

**Both settings are read live.** SessionManager keeps `sessionTimeout` as a
plain `number` on its stored options, but the constructor defines it as an
accessor that reads through the caller's options object. mcp-server.ts
supplies the timeout as a live accessor over the plugin settings, so the
sweep sees the current value and read sites inside SessionManager keep plain
property access. The pool reads `sessionsPerToken` at session-creation time.
No restarts, no per-read unwrapping code. The same accessor pattern can carry
another live setting later without touching SessionManager's read sites.

## Consequences

- Upgrading installs change behavior: sessions no longer idle out. Abandoned
  sessions and their SSE sockets are bounded by the 32-session capacity cap
  and the per-token cap, both of which now really close the transport.
- A second client connecting with the same credential evicts the first
  client's session. The evicted client re-initializes on its next request
  under ADR-106, and would evict the second client back — two live clients on
  one credential ping-pong. The fix is a higher cap or one token per client.
- `isSessionValid` with the never policy returns true for any known session.
- The dead `sessionTimeout` field in ConnectionPoolOptions, stored but never
  read, was removed rather than re-pointed at the new setting.
