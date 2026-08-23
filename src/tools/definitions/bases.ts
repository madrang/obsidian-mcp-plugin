/**
 * The bases tool: list, read, and query of .base files. Registers itself
 * into the tool registry at import time. Creation goes through
 * files.create with format "base". Query with `format` covers export.
 */
import { registerOperation } from '../tool-registry';
import { executeBasesOperation } from '../../semantic/operations/bases';

registerOperation({
  name: 'bases'
  , title: 'Bases Operations'
  , descriptionLines: [
    '🗃️ Bases operations. A `.base` file is a YAML config: filters, formulas, and views. Expressions use `&&` and `||`. YAML `and:` or `or:` keys combine them, for example `and: [file.hasTag("project"), \'status != "archived"\']`.'
    , ''
    , '## Actions'
    , { when: 'bases.list', text: '- `list` — Show all `.base` files.' }
    , { when: 'bases.read', text: '- `read` — Get the YAML configuration.' }
    , { when: 'bases.query', text: '- `query` — Run a base on vault notes. Without `format`, the result is structured data: notes with properties and computed formulas. With `format`, the result comes back as a formatted string (csv, json, markdown) in the response. The tool writes no file.' }
  ]
  , actions: ['list', 'read', 'query']
  , requiredParams: {
    read: ['path']
    , query: ['path']
  }
  , annotations: {
    readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false
  }
  , execute: executeBasesOperation
  , parameters: {
    path: {
      type: 'string'
      , description: 'The path to the .base file'
    }
    , viewName: {
      type: 'string'
      , description: 'The name of the view to run (query, default: the first view)'
    }
    , format: {
      type: 'string'
      , enum: ['csv', 'json', 'markdown']
      , description: 'query: serialize the result instead of returning structured data. csv, json, or markdown. The string comes back in the response'
    }
    , filters: {
      type: 'array'
      , items: {
        type: 'object'
        , properties: {
          property: { type: 'string', description: 'The property to test: a frontmatter key, or file.name, file.mtime, file.tags, or a formula.NAME key' }
          , operator: {
            type: 'string'
            , enum: ['equals', 'not_equals', 'contains', 'not_contains', 'starts_with', 'ends_with', 'gt', 'gte', 'lt', 'lte', 'between', 'in', 'not_in', 'is_empty', 'is_not_empty']
            , description: 'How to compare the property with the value'
          }
          , value: { type: ['string', 'number', 'boolean', 'array'], description: 'The comparison value. An array for between, in, and not_in. Omit it for is_empty and is_not_empty' }
          , caseSensitive: { type: 'boolean', description: 'Compare strings byte for byte (default: false, case-insensitive)' }
        }
        , required: ['property', 'operator']
      }
      , description: 'query: extra filters on the results. Every filter must pass, on top of the base and view filters. Each item is { property, operator, value }. For example { property: "status", operator: "equals", value: "active" }'
    }
    , sortBy: {
      type: 'string'
      , description: 'query: sort the results by this property (a frontmatter key, file.name, file.mtime, or a formula.NAME key). It refines the view sort. Ties keep the view order'
    }
    , sortOrder: {
      type: 'string'
      , enum: ['asc', 'desc']
      , description: 'The sort direction for sortBy (default: "asc")'
    }
    , page: {
      type: 'number'
      , description: 'query: the page of results to return (default: 1). Pages apply after the view limit'
    }
    , pageSize: {
      type: 'number'
      , description: 'query: the number of results per page (default: 20)'
    }
    , properties: {
      type: 'array'
      , items: { type: 'string' }
      , description: 'query: keep only these properties in each note. A name matches its full key or its last segment, so "status" also keeps "file.status"'
    }
  }
});
