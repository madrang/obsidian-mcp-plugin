/**
 * The DQL reference behind the MCP resource `obsidian://resources/dataview`.
 * Static content, apart from the query logic, so the markdown stays readable
 * top to bottom.
 */

/**
 * Generate Dataview reference content for MCP resource
 */
export function generateDataviewReference(): string {
  return `# Dataview Query Language (DQL) Reference

## The dataview tool

Registered only when the Dataview plugin is installed. Actions: \`query\` (run DQL or JS), \`list\` (pages, with an optional \`source\` filter), \`metadata\` (the metadata of one file), \`validate\` (a DQL dry-run), \`status\` (plugin availability, no parameters).

| Param | Type | Actions | Default |
|---|---|---|---|
| query | string, required | query, validate | — |
| format | string ("dql" \\| "js") | query | dql |
| source | string | list | — |
| path | string, required | metadata | — |

The schema enum advertises only \`dql\`, but the handler also accepts \`js\`. The rest of this page is the DQL language reference.

## Query Types

### LIST
Lists files matching criteria
\`\`\`
LIST FROM "folder"
LIST FROM #tag
LIST FROM [[Note]] AND #tag
LIST FROM "folder" WHERE rating > 3
LIST FROM #project WHERE status = "active" SORT file.mtime DESC
\`\`\`

### TABLE
Displays data in tabular format
\`\`\`
TABLE file.size, file.mtime FROM "Notes"
TABLE rating, status, file.name FROM #project
TABLE author, published AS "Year" FROM #books WHERE rating >= 4
TABLE length(file.outlinks) AS "Links" FROM "Research"
\`\`\`

### TASK
Shows tasks from notes
\`\`\`
TASK FROM "Projects"
TASK FROM #todo WHERE !completed
TASK FROM "Daily Notes" WHERE contains(text, "urgent")
\`\`\`

### CALENDAR
Calendar view of dates
\`\`\`
CALENDAR file.ctime FROM "Daily Notes"
CALENDAR created FROM #meeting
CALENDAR due FROM #project WHERE !completed
\`\`\`

## Common Fields

### File Fields
- \`file.path\` - Full file path
- \`file.name\` - File name with extension
- \`file.basename\` - File name without extension
- \`file.size\` - File size in bytes
- \`file.ctime\` - Creation time
- \`file.mtime\` - Modification time
- \`file.folder\` - Parent folder
- \`file.outlinks\` - Outgoing links
- \`file.inlinks\` - Incoming links
- \`file.tags\` - File tags

### Custom Fields
Any frontmatter field can be used:
- \`rating\` - Custom rating field
- \`status\` - Project status
- \`author\` - Book author
- \`priority\` - Task priority
- \`due\` - Due date

## Operators

### Comparison
- \`=\` - Equal
- \`!=\` - Not equal
- \`>\`, \`>=\` - Greater than (or equal)
- \`<\`, \`<=\` - Less than (or equal)

### Logical
- \`AND\` - Both conditions true
- \`OR\` - Either condition true
- \`!\` - Not (negation)

### Text
- \`contains(field, "text")\` - Contains text
- \`startswith(field, "prefix")\` - Starts with
- \`endswith(field, "suffix")\` - Ends with
- \`regexmatch(field, "pattern")\` - Regex match

## Functions

### Date Functions
- \`date(today)\` - Today's date
- \`date("2024-01-01")\` - Specific date
- \`dur(1 week)\` - Duration
- \`dateformat(date, "yyyy-MM-dd")\` - Format date

### List Functions
- \`length(list)\` - List length
- \`sum(numbers)\` - Sum of numbers
- \`min(numbers)\` - Minimum value
- \`max(numbers)\` - Maximum value

### Text Functions
- \`upper(text)\` - Uppercase
- \`lower(text)\` - Lowercase
- \`split(text, "separator")\` - Split text

## Sorting & Grouping

### SORT
\`\`\`
SORT file.mtime DESC
SORT rating ASC, file.name
SORT length(file.outlinks) DESC
\`\`\`

### GROUP BY
\`\`\`
GROUP BY file.folder
GROUP BY author
GROUP BY status
\`\`\`

### LIMIT
\`\`\`
LIMIT 10
LIMIT 5
\`\`\`

## Example Queries

### Project Management
\`\`\`
TABLE status, priority, file.mtime FROM #project
WHERE status != "completed"
SORT priority DESC, file.mtime DESC
\`\`\`

### Book Library
\`\`\`
TABLE author, rating, file.name FROM #books
WHERE rating >= 4
GROUP BY author
SORT rating DESC
\`\`\`

### Daily Notes Analysis
\`\`\`
CALENDAR file.ctime FROM "Daily Notes"
WHERE file.ctime >= date(today) - dur(30 days)
\`\`\`

### Task Tracking
\`\`\`
TASK FROM #todo
WHERE !completed AND contains(text, "urgent")
SORT file.mtime DESC
\`\`\`

## Tips

1. **Performance**: Use WHERE clauses and LIMIT for large vaults
2. **Folders**: Use quotes for folder names with spaces
3. **Tags**: Prefix with # for tag queries
4. **Links**: Use [[Note Name]] syntax for link queries
5. **Custom Fields**: Define in YAML frontmatter of notes
6. **Dates**: Use ISO format (YYYY-MM-DD) for date fields
7. **Escaping**: Use backslashes for special characters in strings

## Common Patterns

### Find Recent Files
\`\`\`
LIST FROM "Notes"
WHERE file.mtime >= date(today) - dur(7 days)
SORT file.mtime DESC
\`\`\`

### Files Without Tags
\`\`\`
LIST FROM "Notes"
WHERE length(file.tags) = 0
\`\`\`

### High-Value Content
\`\`\`
TABLE rating, length(file.inlinks) AS "Backlinks"
FROM #important
WHERE rating > 3
SORT length(file.inlinks) DESC
\`\`\`
`;
}
