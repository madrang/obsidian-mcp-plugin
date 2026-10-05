/**
 * The Recent activity recipe behind the MCP resource
 * obsidian://resources/recipes/recent-activity. How to track vault changes
 * through a .base file: a Recent activity view over file.mtime, created
 * with the files tool and queried with the bases tool.
 */

export function generateRecentActivityRecipe(): string {
  return `# Recent activity recipe

Track vault changes through a \`.base\` file. This server has no action that lists changes since a timestamp. A base file with a Recent activity view is the way to get changes. The view sorts notes by \`file.mtime\`, newest first. Every edit moves \`file.mtime\`: edits in Obsidian, edits through this server, and external edits once the app syncs the file.

One file serves two readers:
- Obsidian renders the base as a live view.
- The \`bases\` tool queries the same view headlessly, with action \`query\`.

# Create the base

Call the \`files\` tool: action \`create\`, path \`Recent Activity.base\`, format \`base\`. The \`content\` parameter carries the configuration object:

\`\`\`json
{
  "filters": { "and": ["file.ext == \\"md\\""] },
  "formulas": { "last_edit_days": "number((now() - file.mtime) / 86400000)" },
  "views": [
    {
      "type": "table",
      "name": "Recent activity",
      "order": ["file.name", "file.folder", "formula.last_edit_days"],
      "sort": [{ "property": "file.mtime", "direction": "DESC" }],
      "limit": 30
    }
  ]
}
\`\`\`

The formula computes the age of the last edit in days. Both \`now()\` and \`file.mtime\` are dates, so the subtraction yields milliseconds.

# Read the changes

Call the \`bases\` tool: action \`query\`, path \`Recent Activity.base\`, viewName \`Recent activity\`. The answer lists the newest notes first, at most 30 rows. Each row carries the note name, its folder, and \`formula.last_edit_days\`.

Narrow the window at call time with the \`filters\` parameter. This caller filter keeps the last seven days, on top of the view:

\`\`\`json
{ "property": "formula.last_edit_days", "operator": "lt", "value": 7 }
\`\`\`

The \`sortBy\` and \`sortOrder\` parameters refine at call time too. Sort by \`file.ctime\`, descending, to watch new notes instead of edits.

# Customize

- Scope the base to a folder: add \`file.inFolder("Projects")\` to the filters list.
- Change \`limit\`, the sort direction, or the columns in \`order\`. The formula column is optional.
- Add views. Each entry in \`views\` is a view, queried by name. Proven ones:
  - Indexes: filter \`file.basename == "0 - Index"\`, sort by \`file.folder\`.
  - Missing tags: filter \`!file.hasProperty("tags")\`, sort by \`file.folder\`.
  - Stale notes: sort \`file.mtime\` ascending, then filter at call time with \`formula.last_edit_days\`, operator \`gte\`, value 90.

# Two spellings that work only in the app

- \`file.mtime.relative()\` renders "3 hours ago" in Obsidian. Through the \`bases\` tool the formula evaluates to null. Compute the age in days instead.
- \`now() - "90d"\` is native date-duration math. The sandbox refuses it. Compare against \`formula.last_edit_days\` instead.

# Rules

- A base query reaches only files the caller can reach. A scoped token narrows the base to its scope.
- The \`bases\` tool reference: \`obsidian://resources/bases\`. The \`.base\` format reference: \`obsidian://resources/syntax/bases\`.
`;
}
