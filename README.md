# Scoped Vault MCP

![GitHub stars](https://img.shields.io/github/stars/madrang/obsidian-mcp-plugin?style=social)
![GitHub forks](https://img.shields.io/github/forks/madrang/obsidian-mcp-plugin?style=social)
![Downloads](https://img.shields.io/github/downloads/madrang/obsidian-mcp-plugin/total?color=blue)
![Latest Release](https://img.shields.io/github/v/release/madrang/obsidian-mcp-plugin?include_prereleases&label=version)
![License](https://img.shields.io/github/license/madrang/obsidian-mcp-plugin)

> **Scoped Vault MCP** is an independent fork by [Madrang](https://github.com/madrang) of [Semantic Notes Vault MCP](https://github.com/aaronsb/obsidian-mcp-plugin) by Aaron Bockelie. This fork adds scoped bearer tokens (per-token folder and read-only restriction), per-token session limits, optional session expiry, and per-action parameter validation against the current MCP specification.

**Read, write, search, and traverse your Obsidian vault from any AI assistant — through an MCP server that runs _inside_ Obsidian.**

No external Node process to launch, no separate REST-API plugin to bridge through: the server *is* the plugin. Setup is a drag-and-drop — drop the `.mcpb` bundle into a bundle-compatible MCP client, paste your key, done.

It exposes **7 powerful tools** — each a whole family of operations, not a single call (the `view` tool alone handles 6: read, search, folder, fragments, and more) — with first-class **Dataview** and **Bases** support plus graph traversal. And every operation respects the permissions *you* set — a read-only mode, per-operation controls, scoped tokens, and path allow/block lists — so the AI only ever does what you've allowed, not unrestricted run of your vault.

**Works with any MCP-compatible client** — desktop agents, CLI agents, Cline, Continue.dev, and anything that speaks MCP over HTTP.

> **New to MCP?** The [Model Context Protocol](https://modelcontextprotocol.io) is the open standard that lets AI assistants interact with external tools and data. You don't need to understand it to use this — the [Quick Start](#quick-start) is three steps.

## Quick Start

**Prerequisites:** an MCP-compatible AI client that can reach a local HTTP endpoint.

> ## 📦 ──drag──▶ 🤖💬
> **Download the `.mcpb` bundle from the plugin's config page → drag it into your MCP client → paste your key. Done.**

For most people that's the entire setup. The numbered steps below spell it out, then cover the JSON config path.

### 1. Install the Plugin

**From source**
- Clone this repo, then run `npm install && npm run build`
- Copy `main.js`, `manifest.json`, and `styles.css` into `<your vault>/.obsidian/plugins/scoped-vault-mcp/`
- Enable the plugin in Settings → Community plugins

**Via BRAT** (once the first release is published)
- Install [BRAT](https://github.com/TfTHacker/obsidian42-brat)
- Add beta plugin: `madrang/obsidian-mcp-plugin`

### 2. Configure Your AI Client

Two onboarding paths. Both are also shown in the plugin's Settings tab with copy-ready values.

**📦 → 🤖 MCP bundle — one-click `.mcpb` install (recommended)**

Download `scoped-vault-mcp-<version>.mcpb` — either from the plugin's **Settings** tab (button right on the config page) or the [latest release](https://github.com/madrang/obsidian-mcp-plugin/releases/latest) — then drag it into a bundle-compatible MCP client or double-click it. The client opens an install dialog with two fields — paste the URL and API key shown in the plugin's Settings tab, hit Save, and you're done.

> *Cross-platform note:* `.mcpb` files install via the client's bundled handler. If double-click doesn't open your client, drag the file onto the client's window instead, or right-click → "Open with…" and pick the client (then "always open with" if your OS asks). Behavior varies by platform: macOS usually auto-associates, Windows may need a one-time association, Linux varies by desktop environment.

**Any MCP client (JSON config)**

Add an entry to the client's MCP config file — one entry per vault if you run multiple Obsidian instances on different ports:

```json
{
  "mcpServers": {
    "obsidian-vault": {
      "transport": {
        "type": "http",
        "url": "http://localhost:3011/mcp",
        "headers": {
          "Authorization": "Bearer YOUR_API_KEY"
        }
      }
    }
  }
}
```

For HTTPS, use `https://localhost:3444/mcp` instead — see [Trusting the self-signed certificate](#trusting-the-self-signed-certificate) below. **Clients running on Bun do not read the macOS system keychain**, so you will need to set `NODE_EXTRA_CA_CERTS`.

**Advanced: custom `.mcpb` per vault**

For multi-vault setups that want one-click install per vault, clone this repo and run the maker:

```bash
node scripts/make-mcpb.mjs
# Prompts for display name, URL, and API key
# Outputs scoped-vault-mcp-<slug>.mcpb with everything pre-filled
```

Drop the resulting bundle into a bundle-compatible client and click Install — no fields to type.

### Trusting the self-signed certificate

The plugin's HTTPS server uses a self-signed certificate auto-generated on first start and stored under `.obsidian/plugins/scoped-vault-mcp/certificates/default.crt` inside your vault. MCP clients reject self-signed certificates by default, so you need to explicitly trust it before connecting over HTTPS. Pick the method that matches your client runtime.

**macOS Keychain** (for clients that use the system trust store — desktop apps, browser-based tools, Node with `--use-system-ca`):

```bash
sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain \
  /path/to/vault/.obsidian/plugins/scoped-vault-mcp/certificates/default.crt
```

**`NODE_EXTRA_CA_CERTS`** (required for Bun-based runtimes):

Bun does **not** consult the macOS system keychain for TLS trust, so trusting the certificate via Keychain Access alone has no effect — this is almost always the real reason an HTTPS connection from a Bun-based client fails. Bun only honors certificates listed in `NODE_EXTRA_CA_CERTS`:

```bash
# Point directly at the plugin cert, or append it to an existing CA bundle:
export NODE_EXTRA_CA_CERTS=/path/to/vault/.obsidian/plugins/scoped-vault-mcp/certificates/default.crt

# Propagate to GUI apps launched from the macOS dock (including MCP clients):
launchctl setenv NODE_EXTRA_CA_CERTS /path/to/vault/.obsidian/plugins/scoped-vault-mcp/certificates/default.crt
```

Re-run these whenever the plugin regenerates its certificate (e.g. after the 1-year validity expires).

> **Avoid `NODE_TLS_REJECT_UNAUTHORIZED=0`.** It disables TLS verification process-wide — for *every* HTTPS connection the client makes, not just this plugin — and masks legitimate certificate problems (expired, revoked, tampered). Trust the certificate explicitly instead.

### 3. Start Using

Once connected, simply chat with your AI assistant about your notes! For example:
- "What are my recent thoughts on project X?"
- "Find connections between my psychology and philosophy notes"
- "Summarize my meeting notes from this week"
- "Create a new note linking my ideas about Y"

Your AI assistant now has these capabilities:
- Navigate your vault's link structure
- Search and rank across all notes
- Read, edit, and create notes
- Analyze your knowledge graph
- Work with Dataview queries (if installed)
- Manage Obsidian Bases (database views)

## Why It's Different

Traditional file access gives AI a narrow view — one document at a time. This plugin gives it the whole connected picture:

- **Graph Navigation**: AI follows links between notes, understanding relationships and context
- **Concept Discovery**: Search and graph traversal surface related ideas across your vault
- **Contextual Awareness**: AI understands where information lives in your knowledge structure
- **Intelligent Synthesis**: Combine fragments from multiple notes to answer complex questions

## Core Tools

The plugin provides 7 powerful tools that give AI comprehensive vault access — each one a family of related operations, all subject to the permissions you set:

| Tool | Purpose | Key Actions |
|------|---------|-------------|
| **🗂️ files** | File management | create, delete, move, copy, split, concat |
| **✏️ edit** | Content modification | replace, append, patch sections |
| **👁️ view** | Read and search | folder listing, read notes, search, fragments, windows |
| **🕸️ graph** | Link navigation | traverse, find paths, analyze connections |
| **📊 dataview** | Query notes | Execute DQL queries (if installed) |
| **🗃️ bases** | Database views | Query and export Bases (if available) |
| **ℹ️ system** | Vault info | Server status, commands, hints, web fetch |

## Documentation

Detailed documentation for each tool and feature:

- [🗂️ Files Operations](docs/tools/files.md) - File management: create, move, copy, split, concat
- [✏️ Edit Operations](docs/tools/edit.md) - Content modification: replace, append, patch, at_line
- [👁️ View Operations](docs/tools/view.md) - Read, search, fragments, folder listing
- [🕸️ Graph Navigation](docs/tools/graph.md) - Link traversal and analysis
- [🗃️ Bases Operations](docs/tools/bases.md) - Query and export Bases
- [📊 Dataview Integration](docs/tools/dataview.md) - DQL queries (requires the Dataview plugin)
- [🔐 Security Implementation](docs/SECURITY-IMPLEMENTATION.md) - Permissions and path validation
- [❓ Troubleshooting](docs/troubleshooting.md) - Common issues and solutions

## In Practice

This plugin doesn't just give AI access to files — it lets AI work across your vault as a connected whole:

### Example: Research Assistant
```
User: "Summarize my research on machine learning optimization"

AI uses these tools to:
1. Search for notes with ML optimization concepts
2. Traverse graph to find related papers and techniques  
3. Follow backlinks to discover applications
4. Synthesize findings from multiple connected notes
```

### Example: Knowledge Explorer
```
User: "What connections exist between my notes on philosophy and cognitive science?"

AI uses graph tools to:
1. Find notes tagged with both topics
2. Analyze shared concepts via graph traversal
3. Identify bridge notes that connect domains
4. Map the conceptual overlap
```

## Features

### Full-Text Search
- Advanced query operators: `tag:`, `path:`, `content:`
- Regular expressions and phrase matching
- Relevance ranking and snippet extraction

### Graph Intelligence
- Multi-hop traversal with depth control
- Backlink and forward-link analysis
- Path finding between concepts
- Tag-based navigation

### Content Operations
- Fuzzy text matching for edits
- Structure-aware modifications (headings, blocks)
- Batch operations (split, combine, move)
- Template support

### Integration
- Dataview query execution
- Bases database operations
- Web content fetching
- Read-only mode for safety

## Plugin Settings

Access settings via: Settings → Community plugins → Scoped Vault MCP

Key configuration options:
- **Server Ports**: HTTP (3011) and HTTPS (3444)
- **Authentication**: API key protection, plus scoped tokens that limit a client to one vault folder or to read-only access
- **Security**: Path validation and permissions
- **Performance**: Connection pooling and caching
- **Sessions**: no idle expiry by default (an optional timespan re-enables it), and one session per credential by default (configurable)

## Development

```bash
npm run dev    # watch-mode build
npm run build  # type-check, then bundle
npm run lint   # eslint
npm test       # jest suite
```

Run `npm run build && npm run lint && npm test` before a push. See [docs/PROJECT_STRUCTURE.md](docs/PROJECT_STRUCTURE.md) for the code layout.

Releases are manual. Bump the version in `package.json` only — `sync-version.mjs` propagates it to `manifest.json` and `src/version.ts`. Tags carry no `v` prefix. Releases ship as prereleases, and `make promote` flips a proven release to stable.

## Support

- **Issues**: [GitHub Issues](https://github.com/madrang/obsidian-mcp-plugin/issues)
- **Discussions**: [GitHub Discussions](https://github.com/madrang/obsidian-mcp-plugin/discussions)

## License

[MIT](LICENSE)
