/**
 * The MCP resource registry: the owner of the obsidian://resources/
 * namespace. The server pool's resources/list and resources/read handlers
 * dispatch through this module, and the view tool serves the same content
 * through the service it hands the router. Every access renders from one
 * source.
 *
 * Every caller — the protocol handlers and the tool actions alike — names
 * the canonical URI (obsidian://resources/<name>). The MCP resources/read
 * request requires a URI field, so no shorter form exists to serve.
 * Resolution is an exact match against the registered names, so an
 * unregistered URI — including a future namespace such as snippets — is
 * never swallowed here.
 */
import { DataviewTool, isDataviewToolAvailable } from '../tools/dataview/tool';
import { generateFilesReference } from '../tools/files/reference';
import { generateEditReference } from '../tools/edit/reference';
import { generateViewReference } from '../tools/view/reference';
import { generateGraphReference } from '../tools/graph/reference';
import { generateBasesReference } from '../tools/bases/reference';
import { generateSystemReference } from '../tools/system/reference';
import { buildVaultInfo } from './vault-info';
import { buildSessionInfo } from './session-info';
import { generateMarkdownSyntaxReference } from './syntax/markdown';
import { generateInternalLinksReference } from './syntax/internal-links';
import { generateCalloutsReference } from './syntax/callouts';
import { generateMermaidReference } from './syntax/mermaid';
import { generateCanvasReference } from './syntax/canvas';
import { generateBasesSyntaxReference } from './syntax/bases';
import { generateCustomCssReference } from './syntax/custom-css';
import { generateSearchReference } from './syntax/search';
import { generatePropertiesReference } from './syntax/properties';
import { generateTagsReference } from './syntax/tags';
import { ResourceBody, ResourceContent, ResourceDeps, ResourceError, ResourceListEntry, ResourceService } from './types';

export const RESOURCES_URI_PREFIX = 'obsidian://resources/';

interface ResourceSpec {
  name: string;
  listEntry: Omit<ResourceListEntry, 'uri'>;
  isAvailable: (deps: ResourceDeps) => boolean;
  build: (deps: ResourceDeps) => ResourceBody;
}

const RESOURCE_SPECS: ResourceSpec[] = [
  // Tool reference pages: static curated markdown, one per tool, in the
  // shape of the Dataview reference below. The content lives in each
  // tool family's reference.ts, not in any vault.
  {
    name: 'files'
    , listEntry: {
      name: 'files Reference'
      , description: 'The files tool: every write action, parameters, and rules'
      , mimeType: 'text/markdown'
    }
    , isAvailable: () => true
    , build: () => ({ mimeType: 'text/markdown', text: generateFilesReference() })
  }
  , {
    name: 'edit'
    , listEntry: {
      name: 'edit Reference'
      , description: 'The edit tool: replace, append, patch, at_line, multi, and the write preconditions'
      , mimeType: 'text/markdown'
    }
    , isAvailable: () => true
    , build: () => ({ mimeType: 'text/markdown', text: generateEditReference() })
  }
  , {
    name: 'view'
    , listEntry: {
      name: 'view Reference'
      , description: 'The view tool: every read action, pagination, search operators, and the virtual namespaces'
      , mimeType: 'text/markdown'
    }
    , isAvailable: () => true
    , build: () => ({ mimeType: 'text/markdown', text: generateViewReference() })
  }
  , {
    name: 'graph'
    , listEntry: {
      name: 'graph Reference'
      , description: 'The graph tool: link traversal, tag traversal, and statistics'
      , mimeType: 'text/markdown'
    }
    , isAvailable: () => true
    , build: () => ({ mimeType: 'text/markdown', text: generateGraphReference() })
  }
  , {
    name: 'bases'
    , listEntry: {
      name: 'bases Reference'
      , description: 'The bases tool: list, read, query, filters, and expression rules'
      , mimeType: 'text/markdown'
    }
    , isAvailable: () => true
    , build: () => ({ mimeType: 'text/markdown', text: generateBasesReference() })
  }
  , {
    name: 'system'
    , listEntry: {
      name: 'system Reference'
      , description: 'The system tool: server info, commands, hints, open in app, and the gated web fetch'
      , mimeType: 'text/markdown'
    }
    , isAvailable: () => true
    , build: () => ({ mimeType: 'text/markdown', text: generateSystemReference() })
  }
  // Syntax reference pages: advanced syntax by category, one generator
  // each in ./syntax/. Same static-content shape as the tool pages.
  , {
    name: 'syntax/markdown'
    , listEntry: {
      name: 'Markdown Syntax'
      , description: 'Obsidian Flavored Markdown: wikilinks, embeds, block references, tables, math, code, and sanitized HTML'
      , mimeType: 'text/markdown'
    }
    , isAvailable: () => true
    , build: () => ({ mimeType: 'text/markdown', text: generateMarkdownSyntaxReference() })
  }
  , {
    name: 'syntax/internal-links'
    , listEntry: {
      name: 'Internal Links'
      , description: 'Wikilinks and markdown links, headings and blocks, aliases, embeds, backlinks, and the link format settings'
      , mimeType: 'text/markdown'
    }
    , isAvailable: () => true
    , build: () => ({ mimeType: 'text/markdown', text: generateInternalLinksReference() })
  }
  , {
    name: 'syntax/callouts'
    , listEntry: {
      name: 'Callouts'
      , description: 'Callout syntax: types, titles, folding, nesting, and CSS customization'
      , mimeType: 'text/markdown'
    }
    , isAvailable: () => true
    , build: () => ({ mimeType: 'text/markdown', text: generateCalloutsReference() })
  }
  , {
    name: 'syntax/mermaid'
    , listEntry: {
      name: 'Mermaid'
      , description: 'Diagram blocks, the trust flag check, strict security, diagram types, and linkable nodes'
      , mimeType: 'text/markdown'
    }
    , isAvailable: () => true
    , build: () => ({ mimeType: 'text/markdown', text: generateMermaidReference() })
  }
  , {
    name: 'syntax/canvas'
    , listEntry: {
      name: 'Canvas'
      , description: 'The JSON Canvas file format: nodes, edges, colors, and how agents read and write .canvas files'
      , mimeType: 'text/markdown'
    }
    , isAvailable: () => true
    , build: () => ({ mimeType: 'text/markdown', text: generateCanvasReference() })
  }
  , {
    name: 'syntax/bases'
    , listEntry: {
      name: 'Bases Syntax'
      , description: 'The .base file format: filters, formulas, property kinds, views, summaries, and gotchas'
      , mimeType: 'text/markdown'
    }
    , isAvailable: () => true
    , build: () => ({ mimeType: 'text/markdown', text: generateBasesSyntaxReference() })
  }
  , {
    name: 'syntax/custom-css'
    , listEntry: {
      name: 'Custom CSS'
      , description: 'CSS snippets through the snippets namespace, enabling via config, and per-note cssclasses'
      , mimeType: 'text/markdown'
    }
    , isAvailable: () => true
    , build: () => ({ mimeType: 'text/markdown', text: generateCustomCssReference() })
  }
  , {
    name: 'syntax/search'
    , listEntry: {
      name: 'Search'
      , description: 'The search syntax: boolean terms, operators, property search, regex, and embedded queries'
      , mimeType: 'text/markdown'
    }
    , isAvailable: () => true
    , build: () => ({ mimeType: 'text/markdown', text: generateSearchReference() })
  }
  , {
    name: 'syntax/properties'
    , listEntry: {
      name: 'Properties'
      , description: 'Frontmatter: the seven types, quoted links, default properties, and structured editing'
      , mimeType: 'text/markdown'
    }
    , isAvailable: () => true
    , build: () => ({ mimeType: 'text/markdown', text: generatePropertiesReference() })
  }
  , {
    name: 'syntax/tags'
    , listEntry: {
      name: 'Tags'
      , description: 'Tag format, nested tags, the tags property, and the tools that read tags'
      , mimeType: 'text/markdown'
    }
    , isAvailable: () => true
    , build: () => ({ mimeType: 'text/markdown', text: generateTagsReference() })
  }
  , {
    name: 'infos/vault'
    , listEntry: {
      name: 'Vault Information'
      , description: 'Current vault status, file counts, and metadata'
      , mimeType: 'application/json'
    }
    , isAvailable: () => true
    , build: buildVaultInfo
  }
  , {
    name: 'infos/session'
    , listEntry: {
      name: 'Session Information'
      , description: 'Active MCP sessions and connection pool statistics'
      , mimeType: 'application/json'
    }
    , isAvailable: (deps) => deps.sessionManager !== undefined
    , build: (deps) => {
      // The availability gate above already refused the no-manager case;
      // this guard turns a gate bypass into a loud failure instead of a
      // half-rendered resource.
      if (!deps.sessionManager) {
        throw new ResourceError('Session information is unavailable: no session manager');
      }
      return buildSessionInfo({ ...deps, sessionManager: deps.sessionManager });
    }
  }
  , {
    name: 'dataview'
    , listEntry: {
      name: 'Dataview Reference'
      , description: 'Complete DQL syntax guide with examples, functions, and best practices'
      , mimeType: 'text/markdown'
    }
    , isAvailable: (deps) => isDataviewToolAvailable(deps.obsidianAPI)
    , build: () => ({
      mimeType: 'text/markdown'
      , text: DataviewTool.generateDataviewReference()
    })
  }
];

/** The entries a resources/list response advertises, canonical URIs only. */
export function buildResourceList(deps: ResourceDeps): ResourceListEntry[] {
  return RESOURCE_SPECS
    .filter((spec) => spec.isAvailable(deps))
    .map((spec) => ({ uri: RESOURCES_URI_PREFIX + spec.name, ...spec.listEntry }));
}

/**
 * Read one resource by its canonical URI. The tool actions and the
 * resources/read handler both use this entry.
 */
export function readResource(uri: string, deps: ResourceDeps): ResourceContent {
  if (!uri.startsWith(RESOURCES_URI_PREFIX)) {
    throw new ResourceError(`Unknown resource: ${uri}`);
  }
  const name = uri.slice(RESOURCES_URI_PREFIX.length);
  const spec = RESOURCE_SPECS.find(
    (spec) => spec.name === name && spec.isAvailable(deps)
  );
  if (!spec) {
    throw new ResourceError(`Unknown resource: ${uri}`);
  }
  return {
    uri: RESOURCES_URI_PREFIX + spec.name
    , ...spec.build(deps)
  };
}

/** Binds one deps snapshot into the service the router carries. */
export function createResourceService(deps: ResourceDeps): ResourceService {
  return {
    read: (uri) => readResource(uri, deps)
    , list: () => buildResourceList(deps)
  };
}

/** True when a path belongs to the obsidian://resources/ namespace this
 * registry serves. Snippets and config URIs are other namespaces and must
 * fall through to their own handlers. */
export function isResourceUri(path: string): boolean {
  return path.startsWith(RESOURCES_URI_PREFIX);
}
