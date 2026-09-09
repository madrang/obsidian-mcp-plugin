/**
 * The bases syntax reference behind the MCP resource
 * obsidian://resources/syntax/bases. Static curated markdown. The bases
 * TOOL surface is documented at obsidian://resources/bases.
 */

export function generateBasesSyntaxReference(): string {
  return `# Bases

A \`.base\` file is YAML: filters, formulas, properties, summaries, and views. It turns notes into database-like views. Bases shipped with Obsidian 1.9.0.

## The file structure

\`\`\`yaml
filters:            # global filters, apply to every view
  and:
    - file.hasTag("project")
    - 'status != "archived"'
formulas:           # calculated properties, usable in all views
  days_left: '(due_date - now()) / 86400000'
properties:         # display configuration per property
  status:
    displayName: "Project Status"
views:
  - type: table     # table or cards (1.9), list or map (1.10)
    name: "Active Projects"
    limit: 10
    filters:        # view-level, AND-ed with the global ones
      and:
        - 'priority <= 2'
    order:          # column order for table views
      - file.name
      - formula.days_left
    sort:           # row order
      - property: note.priority
        direction: DESC
    summaries:      # aggregate a property across rows
      formula.days_left: Average
\`\`\`

## The three property kinds

| Prefix | Meaning | Example |
|--------|---------|---------|
| \`note.\` | Frontmatter property, the default without a prefix | \`note.status\` or just \`status\` |
| \`file.\` | Metadata about the file itself | \`file.name\`, \`file.mtime\`, \`file.tags\` |
| \`formula.\` | A formula from the same base | \`formula.days_left\` |

Available \`file.\` properties: \`name\`, \`path\`, \`folder\`, \`ext\`, \`size\`, \`ctime\`, \`mtime\`, \`tags\`, \`links\`, \`embeds\`, \`backlinks\`, \`properties\`. Prefer \`file.links\` over \`file.backlinks\`: backlinks is slow.

\`this\` refers to the base file in the main view, to the embedding file when embedded. \`file.hasLink(this.file)\` replicates the backlinks pane.

## Filters and formulas share one expression syntax

- Comparisons \`==\` \`!=\` \`>\` \`<\` \`>=\` \`<=\`. Arithmetic \`+ - * / %\`. Logic \`! && ||\`.
- Strings need quotes. Mind nested quotes inside YAML: \`'status == "active"'\`.
- Filters nest with \`and\`, \`or\`, \`not\`, each taking a list.
- Useful functions: \`file.hasTag()\`, \`file.inFolder()\`, \`file.hasLink()\`, \`if()\`, \`now()\`, \`today()\`, \`date()\`, \`list()\`, \`number()\`, \`link()\`.
- Date arithmetic uses duration strings: \`now() - "1 week"\`, \`today() + "7d"\`. Units: \`y M w d h m s\`. Two dates subtract to a Duration. For a readable age use \`file.mtime.relative()\`. Format with \`date.format("YYYY-MM-DD")\`.
- Lists: indexing, \`contains\`, \`join\`, \`length\`, \`unique\`, \`sort\`. Strings: \`contains\`, \`toLowerCase\`, \`trim\`, \`split\`, \`replace\`. Numbers: \`round\`, \`toFixed\`, \`abs\`.

## Summaries

Built-in: Average, Min, Max, Sum, Range, Median, Stddev, Earliest, Latest, Checked, Unchecked, Empty, Filled, Unique. Custom ones live in the top-level \`summaries\` section with the \`values\` keyword, for example \`customAverage: 'values.mean().round(3)'\`.

## Gotchas

- Two engines read one format. The Obsidian app renders the full native function set above. The \`bases\` tool's query runs a sandboxed subset: the globals \`if()\`, \`date()\`, \`now()\`, \`today()\`, \`number()\`, \`string()\`, \`min()\`, \`max()\`, \`abs()\`, \`round()\`, \`list()\`; the file helpers; the value methods; and the operators. The rest of the native set — \`duration()\`, \`link()\`, \`lower()\`, \`format()\`, the list transforms, date-duration arithmetic — fails the filter, or evaluates a formula to null.
- A base covers the whole vault by default. There is no \`from\` or \`source\`. Narrow with filters.
- Formulas are always quoted strings. Their output type comes from the data.
- \`file.backlinks\` and \`file.properties\` do not refresh automatically and cost performance.
- Embed a base with \`![[File.base]]\`. The first view renders. Pick a view with \`![[File.base#View]\`.
- Create \`.base\` files with the files tool and \`format: "base"\`. List, read, and query them with the bases tool: see \`obsidian://resources/bases\`.
`;
}
