# Project Structure

```
obsidian-mcp-plugin/
├── .github/
│   ├── ISSUE_TEMPLATE/
│   │   ├── bug_report.md
│   │   └── feature_request.md
│   ├── workflows/
│   │   ├── test.yml          # CI/CD tests
│   │   └── security.yml      # Security scanning
│   └── pull_request_template.md
│
├── src/
│   ├── main.ts               # Plugin entry point
│   ├── mcp-server.ts         # MCP HTTP server
│   ├── tools/                # MCP tool implementations
│   │   ├── tool-registry.ts  # Registration point for the tool surface
│   │   ├── router.ts         # Operation routing
│   │   ├── state-tokens.ts   # Router state tokens
│   │   ├── definitions/      # One self-registering module per tool
│   │   └── operations/       # Operation handlers
│   ├── utils/                # Utility functions
│   │   ├── obsidian-api.ts   # Vault operations
│   │   ├── session-manager.ts # Session handling
│   │   └── connection-pool.ts # Connection management
│   └── types/                # TypeScript definitions
│
├── github-issues/            # Security audit findings
│   ├── 01-authentication-vulnerability.md
│   ├── 02-path-traversal-vulnerability.md
│   ├── 03-input-validation-missing.md
│   ├── 04-insecure-session-management.md
│   ├── 05-solid-principles-violations.md
│   ├── 06-large-vault-scalability.md
│   └── README.md
│
├── tests/                    # Test files
├── docs/                     # Documentation
│
├── .gitignore
├── CHANGELOG.md             # Version history
├── CONTRIBUTING.md          # Contribution guidelines
├── LICENSE                  # MIT License
├── README.md               # Main documentation
├── SECURITY.md             # Security policy
├── manifest.json           # Obsidian plugin manifest
├── package.json            # Node.js dependencies
├── tsconfig.json           # TypeScript config
└── versions.json           # Version compatibility
```

## Key Directories

### `/src`
Core plugin code. Main entry point is `main.ts`.

### `/src/tools`
MCP tool implementations. The router maps operations to the handlers in `operations/`, and `tool-registry.ts` registers the tool surface.

### `/src/utils`
Shared utilities including the ObsidianAPI abstraction layer and session management.

### `/.github`
GitHub-specific files including issue templates and automated workflows.

### `/github-issues`
Detailed security audit findings ready to be posted as GitHub issues.

## Configuration Files

- `manifest.json` - Obsidian plugin metadata
- `package.json` - Node dependencies and scripts
- `tsconfig.json` - TypeScript compiler settings
- `versions.json` - Obsidian version compatibility

## Development Files

- `AGENTS.md` - Project-specific instructions for AI agents