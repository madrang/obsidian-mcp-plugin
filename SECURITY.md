# Security Policy

## Reporting Security Vulnerabilities

We take security seriously. If you discover a security vulnerability, please:

1. **DO NOT** open a public issue
2. **DO** report it via GitHub Security Advisories: [Report a vulnerability](https://github.com/madrang/obsidian-mcp-plugin/security/advisories/new)

## What to Include

- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

## Security Controls

The vulnerabilities tracked in the old issue list are all fixed. What shipped:

| Control | Status |
|---------|--------|
| API key authentication, scoped bearer tokens with per-scope read-only (ADR-110) | ✅ Shipped |
| Path validation with vault-boundary enforcement | ✅ Shipped |
| Input validation on every action | ✅ Shipped |
| Per-token session limits and session expiry | ✅ Shipped |
| Opt-in rate limiting per credential (ADR-112) | ✅ Shipped |
| Security audit log | ✅ Shipped |
| HTTPS with self-signed or user certificates (ADR-103) | ✅ Shipped |

## Security Best Practices

1. **Keep the server on localhost** — the default network mode listens on localhost only
2. **Don't expose the MCP port** to the internet
3. **Monitor vault access** for unexpected changes
4. **Keep backups** of your vault
5. **Review plugin permissions** in Obsidian

## Secure Configuration

Setting names as they appear in the plugin settings (and in `data.json`):

```json
{
  "httpEnabled": true,
  "httpPort": 3011,
  "httpsEnabled": false,
  "httpsPort": 3444,
  "autoDetectPortConflicts": true,
  "rateLimitPerMinute": 0,
  "debugLogging": false
}
```

`rateLimitPerMinute` is `0` until you set one: no limit by default. Enable HTTPS in the settings to serve over TLS.

## Acknowledgments

Thanks to security researchers who responsibly disclose vulnerabilities.
