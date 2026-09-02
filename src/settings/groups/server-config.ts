/** Server configuration controls: protocols, ports, sessions, rate limit. */
import type { SettingsUIHost } from '../host-types';
import {
  validatePort
  , validateMinutes
  , validateSessionCap
  , validateRateLimit
  , DEFAULT_SESSION_TIMEOUT_MINUTES
  , Group
} from '../ui-helpers';
import { DEFAULT_SETTINGS } from '../plugin-settings';

export function serverConfigGroup(host: SettingsUIHost): Group {
  const s = host.settings;
  return {
    type: 'group'
    , heading: 'Server configuration'
    , items: [
      {
        name: 'Enable HTTP server'
        , desc: `Enable HTTP server on port ${s.httpPort}` + (s.httpsEnabled ? ' (can be disabled when HTTPS is enabled)' : ' (required - at least one protocol must be enabled)')
        , aliases: ['http', 'server']
        , control: { type: 'toggle', key: 'httpEnabled', disabled: () => !host.settings.httpsEnabled }
      }
      , {
        name: 'Server port'
        , desc: 'Port for the server (default: 3011). Applies on change; restarts the server when it is running.'
        , aliases: ['http', 'port']
        , control: { type: 'number', key: 'httpPort', placeholder: String(DEFAULT_SETTINGS.httpPort), defaultValue: DEFAULT_SETTINGS.httpPort, validate: validatePort }
      }
      , {
        name: 'Auto-detect port conflicts'
        , desc: 'Automatically detect and warn about port conflicts'
        , aliases: ['port']
        , control: { type: 'toggle', key: 'autoDetectPortConflicts' }
      }
      , {
        name: 'Sessions never expire'
        , desc: 'Keep sessions valid until the client disconnects or a session limit evicts them. An old session ID can resume at any time. Turn off to expire idle sessions after a timespan.'
        , aliases: ['session', 'expire', 'timeout']
        , control: { type: 'toggle', key: 'sessionsNeverExpire' }
      }
      , {
        name: 'Session timeout in minutes'
        , desc: 'Idle time after which a session expires'
        , aliases: ['session', 'expire', 'timeout']
        , visible: () => host.settings.sessionTimeoutMs > 0
        , control: { type: 'number', key: 'sessionTimeoutMinutes', placeholder: String(DEFAULT_SESSION_TIMEOUT_MINUTES), defaultValue: DEFAULT_SESSION_TIMEOUT_MINUTES, validate: validateMinutes }
      }
      , {
        name: 'Sessions per token'
        , desc: 'How many sessions one credential can hold at once, including the main key. A new session past the limit invalidates the oldest session of that credential.'
        , aliases: ['session', 'token', 'limit']
        , control: { type: 'number', key: 'sessionsPerToken', placeholder: String(DEFAULT_SETTINGS.sessionsPerToken), defaultValue: DEFAULT_SETTINGS.sessionsPerToken, min: 1, validate: validateSessionCap }
      }
      , {
        name: 'Tool call rate limit'
        , desc: "Maximum tool calls per credential per minute, across all of that credential's sessions. 0 disables the limit (default). Takes effect immediately; a refused call returns the RATE_LIMITED error with a retry delay."
        , aliases: ['rate', 'limit', 'throttle', 'per minute', 'calls']
        , control: { type: 'number', key: 'rateLimitPerMinute', placeholder: String(DEFAULT_SETTINGS.rateLimitPerMinute), defaultValue: DEFAULT_SETTINGS.rateLimitPerMinute, validate: validateRateLimit }
      }
    ]
  };
}
