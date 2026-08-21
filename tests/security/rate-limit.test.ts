/**
 * ADR-112 — per-credential tool call rate limit. Opt-in only: the limiter is
 * disabled while the live limit reads 0, which is the default. The window is
 * keyed by credential identity, refused calls do not consume budget, and the
 * refusal carries the stable RATE_LIMITED code with a retry delay.
 */
import { ToolCallRateLimiter, rateLimitErrorResponse } from '../../src/security/rate-limiter';

describe('ToolCallRateLimiter (ADR-112)', () => {
  function limiterWith(limit: () => number) {
    let now = 0;
    const limiter = new ToolCallRateLimiter(60_000, limit, () => now);
    return {
      limiter,
      advance: (ms: number) => { now += ms; }
    };
  }

  test('disabled while the limit is 0: every call allowed', () => {
    const { limiter } = limiterWith(() => 0);
    for (let i = 0; i < 100; i++) {
      expect(limiter.check('tok-a').allowed).toBe(true);
    }
  });

  test('missing or invalid limit settings mean disabled, not strict', () => {
    for (const bad of [() => NaN, () => -5, () => undefined as unknown as number]) {
      const { limiter } = limiterWith(bad);
      expect(limiter.check('tok-a').allowed).toBe(true);
    }
  });

  test('allows up to the limit, then refuses with a retry delay', () => {
    const { limiter } = limiterWith(() => 2);
    expect(limiter.check('tok-a').allowed).toBe(true);
    expect(limiter.check('tok-a').allowed).toBe(true);
    const refused = limiter.check('tok-a');
    expect(refused.allowed).toBe(false);
    expect(refused.retryAfterMs).toBe(60_000);
  });

  test('the window slides: a call ages out and budget returns', () => {
    const { limiter, advance } = limiterWith(() => 1);
    expect(limiter.check('tok-a').allowed).toBe(true);
    expect(limiter.check('tok-a').allowed).toBe(false);
    advance(60_001);
    expect(limiter.check('tok-a').allowed).toBe(true);
  });

  test('refused calls do not consume budget or extend the lockout', () => {
    const { limiter, advance } = limiterWith(() => 1);
    expect(limiter.check('tok-a').allowed).toBe(true);
    advance(10_000);
    // Hammer past the limit: the first call ages out at t=60s regardless.
    for (let i = 0; i < 5; i++) {
      expect(limiter.check('tok-a').allowed).toBe(false);
    }
    advance(50_000);
    expect(limiter.check('tok-a').allowed).toBe(true);
  });

  test('keys are isolated: one credential cannot spend another budget', () => {
    const { limiter } = limiterWith(() => 1);
    expect(limiter.check('tok-a').allowed).toBe(true);
    expect(limiter.check('tok-a').allowed).toBe(false);
    expect(limiter.check('tok-b').allowed).toBe(true);
  });

  test('retryAfterMs shrinks as the oldest call ages', () => {
    const { limiter, advance } = limiterWith(() => 1);
    limiter.check('tok-a');
    advance(15_000);
    const refused = limiter.check('tok-a');
    expect(refused.allowed).toBe(false);
    expect(refused.retryAfterMs).toBe(45_000);
  });

  test('reset drops one key or everything', () => {
    const { limiter } = limiterWith(() => 1);
    limiter.check('tok-a');
    limiter.reset('tok-a');
    expect(limiter.check('tok-a').allowed).toBe(true);

    limiter.check('tok-a');
    limiter.reset();
    expect(limiter.check('tok-a').allowed).toBe(true);
  });
});

describe('rateLimitErrorResponse (ADR-112)', () => {
  test('carries the stable RATE_LIMITED code and a retry delay', () => {
    const response = rateLimitErrorResponse(30, 45_000);
    expect(response.isError).toBe(true);
    const parsed = JSON.parse(response.content[0].text) as {
      error: { code: string; message: string; retryAfterMs: number };
    };
    expect(parsed.error.code).toBe('RATE_LIMITED');
    expect(parsed.error.message).toContain('30');
    expect(parsed.error.retryAfterMs).toBe(45_000);
  });
});
