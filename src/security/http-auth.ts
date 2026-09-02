import { createHash, timingSafeEqual } from 'crypto';

/**
 * The HTTP auth decision, extracted from the express middleware so it can be
 * tested exhaustively.
 *
 * It was previously inline in MCPHttpServer.setupMiddleware, which meant the
 * only way to cover `dangerouslyDisableAuth` was to stand up a server — so it
 * had no tests at all, despite being the switch that decides whether anything
 * on the network can reach the vault.
 *
 * Pure: no express, no plugin, no I/O. Every branch is reachable from a plain
 * object.
 */

export type AuthDecision =
  | { allow: true; reason: 'preflight' | 'auth-disabled' | 'no-key-configured' | 'authenticated'; identity?: string; scopes?: TokenScope[] }
  | { allow: false; status: 401; error: string; reason: 'missing-header' | 'bad-format' | 'bad-key' };

/** One scope entry of a token: a folder (empty = whole vault) plus the
 * read-only flag for that folder alone. */
export interface TokenScope {
  folder?: string;
  readOnly?: boolean;
}

/**
 * An additional bearer credential beside the primary apiKey (ADR-110).
 * `scopes` lists the folders the token reaches, each with its own read-only
 * flag. Absent or empty means whole vault with full access — the token keeps
 * its own identity for session binding either way.
 */
export interface ScopedToken {
  name: string;
  token: string;
  scopes?: TokenScope[];
}

/** The scope a matched scoped token carries into session creation (ADR-110). */
export interface AuthScope {
  identity: string;
  scopes?: TokenScope[];
}

/**
 * Session-binding identity for a token: a truncated SHA-256 of the secret.
 * Deterministic across restarts, stable for hand-edited data.json entries,
 * and never the raw secret — the pool holds it in memory per session.
 */
export function identityForToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex').slice(0, 16);
}

/**
 * Normalize the scopedTokens setting loaded from data.json. Entries without a
 * token string are dropped. Every scope entry carries a folder: trimmed and
 * stripped of slashes, so "Projects/Blog/" and "/Projects/Blog" both mean
 * "Projects/Blog", and a folder of only slashes canonicalizes to "/", the
 * vault root. An entry without a usable folder is dropped — a root scope is
 * spelled `{ folder: '/' }`, never an empty folder. A folder that matches
 * nothing fails closed: every vault path falls outside it.
 */
export function normalizeScopedTokens(raw: unknown): ScopedToken[] {
  if (!Array.isArray(raw)) return [];
  const out: ScopedToken[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as Partial<ScopedToken> & { folder?: unknown; readOnly?: unknown; scopes?: unknown };
    if (typeof e.token !== 'string' || !e.token) continue;

    /** Trimmed folder, "/" for the vault root, undefined when unusable. */
    const trimFolder = (f: unknown): string | undefined => {
      if (typeof f !== 'string') return undefined;
      const trimmed = f.trim();
      if (trimmed === '') return undefined;
      const stripped = trimmed.replace(/^\/+|\/+$/g, '');
      return stripped === '' ? '/' : stripped;
    };

    let scopes: TokenScope[] | undefined;
    if (Array.isArray(e.scopes)) {
      // New shape: every entry needs a folder; folderless entries are junk
      // and drop.
      scopes = [];
      for (const scope of e.scopes) {
        if (!scope || typeof scope !== 'object') continue;
        const sc = scope as Partial<TokenScope>;
        const folder = trimFolder(sc.folder);
        if (folder === undefined) continue;
        const ro = sc.readOnly === true;
        scopes.push({ folder, ...(ro ? { readOnly: true } : {}) });
      }
      if (scopes.length === 0) scopes = undefined;
    } else {
      // Legacy single-folder shape migrates into one scope entry. A legacy
      // "/" folder (or none) with readOnly was a whole-vault read-only
      // token: it becomes the root scope. The same without readOnly was an
      // unscoped token and stays unscoped.
      const folder = trimFolder(e.folder);
      const ro = e.readOnly === true;
      if (folder && folder !== '/') {
        scopes = [{ folder, ...(ro ? { readOnly: true } : {}) }];
      } else if (ro) {
        scopes = [{ folder: '/', readOnly: true }];
      }
    }

    out.push({
      name: typeof e.name === 'string' ? e.name : ''
      , token: e.token
      , ...(scopes ? { scopes } : {})
    });
  }
  return out;
}

export interface AuthInput {
  method: string;
  authHeader?: string;
  /** The configured key. Empty/undefined means no key is configured. */
  apiKey?: string;
  /** settings.scopedTokens (ADR-110) */
  scopedTokens?: ScopedToken[];
  /** settings.dangerouslyDisableAuth */
  authDisabled?: boolean;
}

/**
 * Constant-time secret comparison, independent of input length.
 *
 * A plain `===` short-circuits on the first differing byte, leaking a key prefix
 * through response timing. The server is loopback by default so the window is
 * small, but not zero once binding is widened, and the fix is free.
 *
 * Both sides are hashed to a fixed 32 bytes before comparing. An earlier version
 * compared the raw buffers and bailed early on a length mismatch, which still
 * did work proportional to the attacker's input — so it leaked the key's LENGTH
 * even though each individual comparison was constant-time. Hashing removes the
 * length signal entirely and lets timingSafeEqual see two equal-length buffers
 * always, so it can never throw.
 */
function secretsMatch(a: string, b: string): boolean {
  const digestA = createHash('sha256').update(a, 'utf8').digest();
  const digestB = createHash('sha256').update(b, 'utf8').digest();
  return timingSafeEqual(digestA, digestB);
}

/**
 * Match a presented secret against the configured scoped tokens. Every entry
 * runs the same hash-and-compare work even after a match, so the response
 * time does not reveal which position matched. Returns the first match.
 */
function matchScopedToken(secret: string, tokens: ScopedToken[] | undefined): ScopedToken | undefined {
  if (!tokens) return undefined;
  let match: ScopedToken | undefined;
  for (const t of tokens) {
    if (typeof t.token === 'string' && t.token && secretsMatch(secret, t.token) && !match) {
      match = t;
    }
  }
  return match;
}

/** The allow-decision for a scoped token match carries the token's scope. */
function scopedDecision(token: ScopedToken): AuthDecision {
  return {
    allow: true
    , reason: 'authenticated'
    , identity: identityForToken(token.token)
    , ...(token.scopes ? { scopes: token.scopes } : {})
  };
}

export function authorizeRequest(input: AuthInput): AuthDecision {
  // CORS preflight carries no credentials by design.
  if (input.method === 'OPTIONS') {
    return { allow: true, reason: 'preflight' };
  }

  if (input.authDisabled === true) {
    return { allow: true, reason: 'auth-disabled' };
  }

  const apiKey = input.apiKey;
  if (!apiKey) {
    // Deliberate fail-open, retained for backward compatibility: a vault with no
    // configured key accepts unauthenticated requests. Contained by loopback
    // binding in the default configuration, and NOT contained if binding is
    // widened. Asserted in the tests so the behaviour is a recorded decision
    // rather than an accident.
    return { allow: true, reason: 'no-key-configured' };
  }

  if (!input.authHeader) {
    return { allow: false, status: 401, error: 'Authentication required', reason: 'missing-header' };
  }

  if (input.authHeader.startsWith('Bearer ')) {
    const token = input.authHeader.slice(7);
    // The scoped-token loop runs even when the primary key matches, so the
    // work done per request does not depend on which credential matched.
    const primaryMatch = secretsMatch(token, apiKey);
    const scopedMatch = matchScopedToken(token, input.scopedTokens);
    if (primaryMatch) {
      return { allow: true, reason: 'authenticated' };
    }
    if (scopedMatch) {
      return scopedDecision(scopedMatch);
    }
    return { allow: false, status: 401, error: 'Invalid API key', reason: 'bad-key' };
  }

  if (input.authHeader.startsWith('Basic ')) {
    const decoded = Buffer.from(input.authHeader.slice(6), 'base64').toString('utf8');
    const sep = decoded.indexOf(':');
    // RFC 7617 requires the colon. Rejecting a credential without one also keeps
    // parity with the previous implementation, whose destructuring yielded
    // `password === undefined` and failed — without this guard, slice(-1 + 1)
    // would treat the ENTIRE decoded string as the password, widening the
    // accepted credential encodings for no reason.
    if (sep === -1) {
      return { allow: false, status: 401, error: 'Invalid API key', reason: 'bad-format' };
    }
    // Only the password carries the key; the username is ignored, which is what
    // lets `curl -u anything:KEY` work. Slicing after the FIRST colon (rather
    // than splitting on every one) keeps a key that itself contains a colon.
    const password = decoded.slice(sep + 1);
    const primaryMatch = secretsMatch(password, apiKey);
    const scopedMatch = matchScopedToken(password, input.scopedTokens);
    if (primaryMatch) {
      return { allow: true, reason: 'authenticated' };
    }
    if (scopedMatch) {
      return scopedDecision(scopedMatch);
    }
    return { allow: false, status: 401, error: 'Invalid API key', reason: 'bad-key' };
  }

  return { allow: false, status: 401, error: 'Invalid API key', reason: 'bad-format' };
}
