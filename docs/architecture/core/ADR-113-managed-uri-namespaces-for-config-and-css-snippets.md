# ADR-113: Managed URI namespaces for config and CSS snippets

Date: 2026-08-31
Status: accepted

## Context

Two classes of vault-adjacent content were unreachable through the tool
surface:

1. CSS snippets live in `<configDir>/snippets/`. The vault index excludes
   dot-prefixed segments, so `getAbstractFileByPath` returns null for them,
   and SecurePathValidator rejects every path into that space twice over:
   any `://` string as a forbidden sequence, and dot-prefixed segments as
   `HIDDEN_PATH`.
2. The app's own settings (theme, enabled snippets, editor options) are
   reachable only through Obsidian's UI. Agents cannot read or change them.

A tool family dedicated to snippet state (list, enable, disable) was built
first and rejected in review with the user: it adds surface for what is
really a path problem. One mechanism serves both classes better.

## Decision

Two virtual namespaces, addressed by the URI the agent passes. The URI is
the only representation that flows through the system. A raw
`.obsidian/...` path from an agent stays rejected.

- `obsidian://snippets/<name>.css` — one CSS snippet file. One segment,
  `.css` suffix, no leading dot, no separators, no traversal. File access
  goes through `vault.adapter`; the folder resolves from
  `vault.configDir`, never a hardcoded `.obsidian`.
- `obsidian://config/<key>` — one app config key. A read serves
  `getConfig(key)` as `JSON.stringify(value, null, 2)` text. A write
  parses the edited text and applies it with `setConfig(key, parsed)`.
  The parse gate runs first: invalid JSON is refused with
  `INVALID_CONFIG_JSON` and nothing reaches `setConfig`. Config keys
  answer `undefined` as not-found, and `getConfig` falls back to defaults,
  so a known key with no stored value still reads its default.

No new tools or actions. The existing `view`, `edit`, and `files` actions
operate on these URIs through dispatch branches in `ObsidianAPI`:
`getFile`, `getFileStat`, `updateFile`, `appendToFile`, `patchVaultFile`,
plus `createFile` and `deleteFile` for snippets. `files.create` and
`files.delete` on a config key are refused with
`CONFIG_ACTION_UNSUPPORTED`: keys are the app's own settings, and the edit
tool is the supported way to change them.

### Security shape

The namespaces are separate doors into config space, not holes in the
path validator. `VaultSecurityManager.validateOperation` branches to
`validateManagedUriOperation` ahead of every other step, including the
`pathValidation: 'disabled'` early return, because the namespace gates are
independent of path-validation mode. `SecurePathValidator` keeps its
blanket rules untouched.

Containment comes from the namespace shape: the file name or config key
is the only variable part of the URI.

Gates, all fail closed:

- Reads of both namespaces are open by default.
- Snippet writes require the `allowSnippetEditing` setting (default off),
  enforced live per call (ADR-108 predicate shape). Refusal code:
  `SNIPPET_WRITE_DISABLED`.
- Config writes require the `allowConfigEditing` setting (default off),
  same shape. Refusal code: `CONFIG_WRITE_DISABLED`.
- Read-only mode blocks namespace writes through the existing
  `isOperationAllowed` check, ahead of the namespace gates.
- Folder-scoped tokens are denied both namespaces automatically: their
  scope predicate runs in the same blocked-path check, and an
  `obsidian://` URI can never match a vault folder prefix.

### The delete interlock

`files.delete` on a snippet refuses with `SNIPPET_ENABLED` while
`getConfig('enabledCssSnippets')` contains the snippet id (file name
without the trailing `.css`). The agent must disable it first, by editing
`obsidian://config/enabledCssSnippets`. Delete is permanent: no trash
exists in config space.

## Verified internal APIs

Both APIs are undocumented. Shapes verified against the live app bundle
`~/.config/obsidian/obsidian-1.13.7.asar` (2026-08-31), found by following
the auto-update loader in `/opt/Obsidian/resources/app.asar` — on Linux
the installed base package can lag the running version, so verification
must resolve the asar the wrapper actually loads.

- `vault.getConfig(key)` — in-memory value, defaults fallback, deep
  copies for objects and arrays. Answers `undefined` for an unknown key.
- `vault.setConfig(key, value)` — sets (or deletes on `undefined`),
  requests a debounced save, fires `config-changed` with the key.
- Snippet ids in `enabledCssSnippets` carry no `.css` suffix.

Nothing in the CSS subsystem listens to `config-changed` (the app's own
toggle helper `setCssEnabledStatus` performs its own reload). A plain
config write to `enabledCssSnippets` therefore persists but would only
apply at the next appearance reload. The write path closes this gap
without duplicating any CSS logic: when the app exposes
`customCss.setCssEnabledStatus` (feature-detected, verified in the
1.12.x base package and in 1.13.7), an `enabledCssSnippets` write
computes the membership diff and routes each change through that handler
— the exact code the Settings UI runs, which persists and reloads per
call, so a complete diff converges the config to the written membership
and applies live. Without the handler, or for a non-array write, the
plain `setConfig` fallback persists and applies at the next appearance
reload. The community-documented `enableSnippet`/`disableSnippet`
methods do not exist in current builds. If Obsidian ever makes
`customCss` react to `config-changed` on this key, the diff routing
becomes a no-op and is deleted.

## Consequences

- Agents on any harness reach both namespaces through plain tool actions.
  Clients without the MCP resources capability (ZCode among them) lose
  nothing.
- The rejected snippet-state tool family is gone. Enabling a snippet is an
  edit on `obsidian://config/enabledCssSnippets`, which the user gates
  independently from snippet file writes.
- `view.folder` lists both namespace roots. The snippets root goes through
  `listFiles`, so the security layer applies and a folder-scoped session
  cannot enumerate it. The config root lists a curated key catalog
  (`CONFIG_KEYS` in `src/utils/app-config.ts`): the app has no enumerable
  config registry, and the catalog is plugin documentation holding no app
  state, so it carries no security pass. The catalog is a stand-in for a
  missing enumeration API and is replaced when the app ever exposes one —
  the maintenance and replacement rules sit above the constant. A key
  outside the catalog still reads and writes through its URI.
- `obsidian://resources/` (registry-based computed resources) predates
  this ADR and kept its own resolution path in the view handlers until the
  2026-09-01 amendment below folded it into the same dispatch.
- Tests pin the gates on recorded writes (`tests/security/managed-namespaces.test.ts`,
  `tests/snippets-config-access.test.ts`): every refusal case asserts the
  adapter and `setConfig` stayed untouched.

## Amendment 2026-09-01: resources join the dispatch

The third namespace, `obsidian://resources/`, moved from per-action
branches in the view handlers into the same `ObsidianAPI` dispatch this
ADR established for snippets and config. No action knows the namespace
exists.

- The registry's prefix and matcher live in `src/resources/uri.ts`, a leaf
  module. The registry, the API layer, and `VaultSecurityManager` import
  it, so none depends on the others.
- `VaultRouter` binds the session-bound `ResourceService` onto the API
  (`setResourceService`) at construction, so the API serves the same
  session content the `resources/read` protocol handler serves.
- `getFile` and `getFileStat` serve resource text and its stat through
  namespace branches shaped like the config ones (no mtime; an
  unregistered name stats `exists: false`). Every write, create, delete,
  and move on a resource URI refuses with `RESOURCE_ACTION_UNSUPPORTED`
  at `validateManagedUriOperation` — reads open, writes unsupported, no
  setting opens one.
- Every text action inherits the namespace: a single-file `grep` on a
  resource URI works, `edit.*` writes refuse with the code instead of a
  misleading `File not found`, and write preconditions chain off the
  resource stat (`ifHash` over the served text). The `view.folder` tree
  walk stays on the registry service: listing a virtual tree is not a
  text read.
- Pinned by `tests/resources-via-api.test.ts` and
  `tests/security/resources-namespace.test.ts`.
