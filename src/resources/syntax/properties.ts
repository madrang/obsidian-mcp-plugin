/**
 * The properties reference behind the MCP resource
 * obsidian://resources/syntax/properties. Static curated markdown.
 */

export function generatePropertiesReference(): string {
  return `# Properties

Properties hold structured data at the top of a note, in YAML between \`---\` fences. Each property row has a name and a value. Names are unique within a note.

## Property types

The type decides which values a property can store. A type assigned to a property name applies to every note in the vault.

| Type | Format | Notes |
| --- | --- | --- |
| Text | \`title: A New Hope\` | One line. Markdown does not render. Hashtags do not create tags. |
| List | one \`- value\` per line | Values can be text, numbers, or links. |
| Number | \`year: 1977\` | A literal number only. Integers and decimals. |
| Checkbox | \`favorite: true\` | \`true\` or \`false\`. |
| Date | \`date: 2020-08-21\` | With Daily notes enabled, links to the daily note. |
| Date and time | \`time: 2020-08-21T10:30:00\` | |
| Tags | a list of tags | Reserved for the \`tags\` property. |

## Links in properties must be quoted

Text and list properties accept internal links. Surround every link with quotes:

\`\`\`yaml
---
link: "[[Episode IV]]"
links:
  - "[[Link A]]"
  - "[[Link B]]"
---
\`\`\`

## Default properties

| Property | Type | Purpose |
| --- | --- | --- |
| \`tags\` | List | Tags of the note. |
| \`aliases\` | List | Alternative names for linking. |
| \`cssclasses\` | List | CSS classes applied to the note. |

The singular forms \`tag\`, \`alias\`, and \`cssclass\` are deprecated.

## Editing through the tools

The edit tool edits frontmatter structurally with \`action="patch"\`, \`targetType="frontmatter"\`:

- \`operation="replace"\` with \`value\` writes any type, serialized as YAML.
- \`operation="remove"\` deletes the field. Takes no \`newText\`.
- \`operation="append"\` and \`operation="prepend"\` refuse a field that holds an array or object.

Only the target field's lines change, so untouched keys stay byte-identical. See \`obsidian://resources/edit\`.

## Limitations

- No nested properties in the panel. Use Source mode to see them.
- No markdown in values. Properties hold small, atomic data.
- No bulk editing beyond a vault-wide rename in the All properties view.
`;
}
