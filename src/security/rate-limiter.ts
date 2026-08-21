/**
 * Sliding-window rate limiter for tool calls (ADR-112). Keyed by credential
 * identity — the same bucket the per-credential session cap (ADR-111) uses:
 * the undefined identity (primary key, no-key, auth-disabled) is one bucket.
 *
 * Disabled while the limit is 0, the default: the user opts in by setting a
 * limit in the plugin settings. The limit is read through a getter on every
 * check so a settings change applies to live sessions without a restart,
 * the same live-read pattern as read-only mode (ADR-108).
 */

export interface RateLimitDecision {
  allowed: boolean;
  /** Milliseconds until the oldest call in the window ages out. Present when refused. */
  retryAfterMs?: number;
}

export class ToolCallRateLimiter {
  private windows = new Map<string, number[]>();

  constructor(
    private readonly windowMs: number,
    private readonly limit: () => number,
    private readonly now: () => number = () => Date.now()
  ) {}

  /**
   * Record a call attempt and decide. Refused calls do not consume budget:
   * the window holds only the calls that were allowed, so a client hammering
   * past the limit does not extend its own lockout.
   */
  check(key: string): RateLimitDecision {
    const limit = this.limit();
    if (!(limit >= 1)) return { allowed: true };

    const now = this.now();
    const calls = (this.windows.get(key) ?? []).filter(t => now - t < this.windowMs);

    if (calls.length >= limit) {
      this.windows.set(key, calls);
      const retryAfterMs = Math.max(0, this.windowMs - (now - calls[0]));
      return { allowed: false, retryAfterMs };
    }

    calls.push(now);
    this.windows.set(key, calls);
    return { allowed: true };
  }

  /** Drop state for one key, or everything when no key is given. */
  reset(key?: string): void {
    if (key === undefined) this.windows.clear();
    else this.windows.delete(key);
  }
}

/**
 * The coded refusal the pool returns for a rate-limited tool call. Same
 * error envelope as the dispatch-level guards (ACTION_DISABLED,
 * MISSING_PARAMETER), so clients parse one shape.
 */
export function rateLimitErrorResponse(limit: number, retryAfterMs: number): {
  content: { type: 'text'; text: string }[];
  isError: true;
} {
  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        error: {
          code: 'RATE_LIMITED',
          message:
            `Rate limit exceeded: max ${limit} tool calls per minute. ` +
            `Retry in ${Math.ceil(retryAfterMs / 1000)}s.`,
          retryAfterMs
        }
      }, null, 2)
    }],
    isError: true
  };
}
