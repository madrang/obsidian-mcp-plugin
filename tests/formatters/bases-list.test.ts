import { formatBasesList } from '../../src/tools/bases/format';

// bases.list once returned paths as strings, then listBases() moved to
// entry objects ({ path, name, views }) while the formatter still called
// .split on every entry. The TypeError landed in the dispatcher's catch
// and every non-empty vault got the "_Formatter error" raw-data dump.
describe('formatBasesList', () => {
  it('renders the listBases entry objects without the formatter-error fallback', () => {
    const out = formatBasesList([
      { path: 'Projects/Services Billing.base', name: 'Services Billing', views: ['Table'] }
      , { path: 'Donjon-Stats.base', name: 'Donjon-Stats', views: [] },
    ]);
    expect(out).toContain('Found 2 base files');
    expect(out).toContain('Services Billing');
    expect(out).toContain('Projects/Services Billing.base');
    expect(out).not.toContain('_Formatter error');
  });

  it('still renders the legacy string-array shape', () => {
    const out = formatBasesList(['Projects/Services Billing.base']);
    expect(out).toContain('Found 1 base file');
    expect(out).toContain('Services Billing');
    expect(out).toContain('Projects/Services Billing.base');
    expect(out).not.toContain('_Formatter error');
  });

  it('renders the wrapped { bases } shape and falls back to the path basename when name is empty', () => {
    const out = formatBasesList({ bases: [{ path: 'Ops/Monitoring.base', name: '', views: [] }] });
    expect(out).toContain('Found 1 base file');
    expect(out).toContain('Monitoring');
    expect(out).toContain('Ops/Monitoring.base');
  });

  it('renders the empty vault', () => {
    expect(formatBasesList([])).toContain('No .base files found');
  });
});
