import { formatBasesRead, formatBasesQuery } from '../../src/tools/bases/format';

// bases.read and bases.query hit the same defect class as the old
// bases.list crash: the formatters were written against shapes the handlers
// never produced. readBase returns the parsed BaseYAML itself, queryBase
// returns { notes, total }. Reading response.path or response.totalCount
// threw, and every call ended in the "_Formatter error" raw-data dump.
describe('formatBasesRead', () => {
  it('renders the BaseYAML configuration readBase returns', () => {
    const out = formatBasesRead({
      filters: 'status == "active"'
      , formulas: { age: 'file.mtime - note.born' }
      , properties: {
        status: { displayName: 'Status' }
        , priority: {},
      }
      , views: [
        { type: 'table', name: 'All tasks' }
        , { type: 'cards', name: 'Board' },
      ],
    });
    expect(out).toContain('Base Configuration');
    expect(out).toContain('status == "active"');
    expect(out).toContain('age');
    expect(out).toContain('status (Status)');
    expect(out).toContain('priority');
    expect(out).toContain('All tasks (table)');
    expect(out).toContain('Board (cards)');
    expect(out).not.toContain('_Formatter error');
  });

  it('renders a minimal base with only the required views array', () => {
    const out = formatBasesRead({ views: [{ type: 'table', name: 'Table' }] });
    expect(out).toContain('Base Configuration');
    expect(out).toContain('Table (table)');
    expect(out).not.toContain('_Formatter error');
  });

  it('stringifies object filter expressions', () => {
    const out = formatBasesRead({
      filters: { and: ['status == "active"', 'file.hasTag("project")'] }
      , views: [],
    });
    expect(out).toContain('active');
    expect(out).toContain('file.hasTag');
    expect(out).not.toContain('_Formatter error');
  });
});

describe('formatBasesQuery', () => {
  it('renders the { notes, total } result queryBase returns', () => {
    const out = formatBasesQuery({
      notes: [
        {
          path: 'Projects/Renovation.md'
          , name: 'Renovation'
          , properties: { status: 'active', budget: 1200 },
        }
        , {
          path: 'Projects/Launch.md'
          , name: 'Launch'
          , properties: {},
        },
      ]
      , total: 2,
    });
    expect(out).toContain('Base Results');
    expect(out).toContain('Results');
    expect(out).toContain('2');
    expect(out).toContain('Renovation');
    expect(out).toContain('Projects/Renovation.md');
    expect(out).toContain('status');
    expect(out).not.toContain('_Formatter error');
  });

  it('renders the empty result set', () => {
    const out = formatBasesQuery({ notes: [], total: 0 });
    expect(out).toContain('No matching entries found.');
    expect(out).not.toContain('_Formatter error');
  });
});
