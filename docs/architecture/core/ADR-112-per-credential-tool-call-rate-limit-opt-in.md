---
status: Accepted
date: 2026-08-20
deciders:
  - Madrang
related:
  - ADR-108
  - ADR-110
  - ADR-111
---

# ADR-112: Per-credential tool call rate limit, opt-in only

## Context

The MCP spec (2026-07-28) lists rate limiting as a server MUST. Nothing in
this plugin rate-limited anything: a connected client could issue tool calls
in a tight loop, and each call dispatches through the semantic router into
vault reads, searches, and graph traversals — CPU and disk spent inside the
Obsidian process the user is typing in. The scoped-token model (ADR-110)
already gives every credential an identity and a session bucket (ADR-111),
so the natural key for a limit already existed.

## Decision

One sliding-window limiter per credential, enforced at the single chokepoint
every tool call passes through: the pool's `CallToolRequestSchema` handler.

- **Opt-in.** The `rateLimitPerMinute` setting defaults to 0, disabled. The
  limit exists only when the user sets one. A missing or malformed value
  also means disabled — unlike the ADR-111 session cap there is no strict
  default that would not silently throttle existing users.
- **Keyed by credential identity**, the same bucket as the session cap. One
  token cannot dodge its limit by opening more sessions. The undefined
  identity (primary key, no-key, auth-disabled) is one bucket.
- **Live read.** The limit is read through a getter on every check, so a
  settings change applies to live sessions without a restart (the ADR-108
  pattern).
- **Checked before dispatch**, so unknown tool names count too — a caller
  hammering garbage names still burns CPU per call and is limited the same
  way.
- **Refused calls do not consume budget.** The window records only allowed
  calls, so a client hammering past the limit does not extend its own
  lockout.
- **Refusal shape matches the dispatch guards** (`ACTION_DISABLED`,
  `MISSING_PARAMETER`): an `isError` tool result whose JSON carries
  `error.code: 'RATE_LIMITED'`, a human message, and `retryAfterMs`.

## Consequences

Positive: spec MUST satisfied once enabled; one runaway client stops eating
the Obsidian process; per-token fairness (one abusive token cannot starve
the others, except in no-auth mode where all anonymous callers share the
primary bucket); no behavior change for anyone who does not opt in.

Negative: an aggressive but legitimate limit can stall a batch-heavy agent;
in no-key and auth-disabled mode every caller shares one bucket, so one
client's burst limits the rest.

Neutral: the window state is in-memory and per pool — a plugin restart
resets every window.
