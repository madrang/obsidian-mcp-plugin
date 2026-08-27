> **Historical snapshot (mid-2025).** This document records the Bases feature as it
> was being implemented. It is not a status page: the items under "What's Not
> Working Yet" were resolved long ago, and the tool surface has since been
> reworked (`bases.create` is now `files` `create` with `format: "base"`). Kept
> for the design history.

# Obsidian Bases Implementation Status

## Project Summary
We implemented support for Obsidian's new Bases feature in the MCP plugin, enabling AI agents to interact with Obsidian's database-like views of notes.

## What We Accomplished ✅

### 1. Research & Documentation
- **Discovered Bases is a core Obsidian feature** (v1.9.0+), not a separate plugin
- **Learned the actual syntax**: YAML format with expression-based filters
- **Documented the complete API** in `bases-mcp-reference.md`
- **Created implementation guide** in `bases-implementation-fixes.md`

### 2. Major Refactoring
- **Switched from JSON to YAML** format for .base files
- **Removed old object-based filter system** that didn't match Obsidian's implementation
- **Implemented proper property prefixes** (`note.*`, `file.*`, `formula.*`)
- **Created new type definitions** matching actual Bases structure

### 3. Core Implementation
- **BasesAPI class** - Complete rewrite with YAML support
- **ExpressionEvaluator** - Parses JavaScript-like filter expressions
- **FormulaEngine** - Evaluates calculated properties
- **Router Integration** - Added bases operations to MCP
- **Tool Descriptions** - Updated to reflect actual functionality

### 4. Working Features
- ✅ **List bases** - Shows all .base files in vault
- ✅ **Read base** - Parses YAML configuration correctly
- ✅ **Create base** - Creates proper YAML-formatted .base files
- ✅ **Query base** - Executes queries (though filters need fixing)
- ✅ **Export** - CSV, JSON, and Markdown export working
- ✅ **View support** - Table and card views defined

## What's Not Working Yet ⚠️

### 1. Metadata Cache Integration
**Problem**: Frontmatter properties aren't being read correctly
```yaml
# File has this frontmatter:
status: active
priority: 1

# But metadata cache returns:
frontmatter: {}
```
**Likely Cause**: The metadata cache isn't being accessed correctly or needs refreshing

### 2. Expression Evaluation
**Problem**: Filter expressions don't evaluate correctly
```javascript
// These don't work:
status == "active"
priority <= 2
file.inFolder("Projects")
```
**Likely Cause**: The expression evaluator needs better integration with Obsidian's API

### 3. Formula Evaluation
**Status**: Not tested yet
**Need**: Test formulas like `(due_date - now()) / 86400000`

## Code Structure

```
src/
├── types/
│   ├── bases-yaml.ts         # Correct type definitions
│   └── bases.ts              # Old types (to be removed)
├── utils/
│   ├── bases-api.ts          # Main Bases API
│   ├── expression-evaluator.ts # Filter expression parser
│   └── formula-engine.ts     # Formula calculator
└── tools/
    └── router.ts             # MCP operation routing
```

## Next Steps 🚀

### High Priority Fixes
1. **Fix Metadata Cache Integration**
   - Debug why `app.metadataCache.getFileCache(file)` returns empty frontmatter
   - Might need to wait for cache to be ready
   - Consider using `app.metadataCache.getCache(file.path)` instead

2. **Debug Expression Evaluator**
   - Test individual functions (`file.inFolder`, `file.hasTag`)
   - Add logging to see what values are being compared
   - Ensure proper type coercion for comparisons

3. **Test Formula Engine**
   - Verify date arithmetic works
   - Test formula dependencies
   - Implement caching for performance

### Medium Priority
4. **Error Handling**
   - Add try-catch blocks for expression parsing
   - Provide meaningful error messages for invalid filters
   - Handle circular formula references

5. **Performance Optimization**
   - Cache parsed expressions
   - Optimize large vault queries
   - Implement pagination for results

6. **Additional Features**
   - Support for embedded bases in code blocks
   - Template-based note generation
   - More view types (calendar, kanban)

### Low Priority
7. **Cleanup**
   - Remove old bases-api-old.ts references
   - Remove unused type definitions
   - Update all documentation

8. **Testing**
   - Unit tests for expression evaluator
   - Integration tests with sample vaults
   - Performance benchmarks

## Key Learnings 📚

1. **Obsidian's Architecture**: Bases is deeply integrated with Obsidian's metadata system
2. **YAML vs JSON**: Obsidian uses YAML for human-readability
3. **Expression Syntax**: Filter expressions are JavaScript-like, not SQL-like
4. **Property Prefixes**: Critical for distinguishing note/file/formula properties
5. **Metadata Cache**: Central to how Obsidian tracks frontmatter and file properties

## Technical Debt
- Old type definitions still referenced in some places
- Expression evaluator uses `Function` constructor (security concern)
- No proper AST parser for expressions (using eval-like approach)
- Missing comprehensive error handling

## Success Metrics
- ✅ Can create and read .base files
- ✅ YAML format correctly parsed
- ✅ Export functionality works
- ⚠️ Filters partially working
- ❌ Formulas not tested
- ❌ Full compatibility with Obsidian's Bases

## Version History
- **0.9.3** - Initial Bases implementation (JSON-based)
- **0.9.4** - Added type definitions and basic structure
- **0.9.5** - Complete refactor to YAML and expression-based filters

## Resources
- [Obsidian Bases Documentation](https://help.obsidian.md/Plugins/Bases)
- [Bases Syntax Reference](https://help.obsidian.md/Plugins/Bases/Bases+syntax)
- [Functions Reference](https://help.obsidian.md/Plugins/Bases/Functions)

## Contact & Support
- GitHub Issues: [obsidian-mcp-plugin](https://github.com/aaronsb/obsidian-mcp-plugin)
- Main Developer: @aaronsb

---

*Last Updated: 2025-01-20*
*Status: In Development - Core functionality working, metadata integration needs fixes*