import { executeBasesOperation } from '../src/tools/bases/operations';

// files.create with format "base" routes here. Bridges that stringify
// untyped parameters can deliver the config object as its JSON text. The
// handler parses JSON text back into the config before validating.
describe('bases create via files.create format base', () => {
  const created: Array<{ path: string; config: unknown }> = [];
  const ctx = {
    api: {
      createBase: jest.fn(async (path: string, config: unknown) => {
        created.push({ path, config });
      }),
    },
  } as never;

  it('accepts the config as a native object', async () => {
    const result = await executeBasesOperation(ctx, 'create', {
      path: 'x.base'
      , content: { views: [{ type: 'table', name: 'T' }] },
    } as never);
    expect(result).toEqual({ success: true, path: 'x.base' });
    expect(created[0].config).toEqual({ views: [{ type: 'table', name: 'T' }] });
  });

  it('accepts the config as its JSON text — the bridge-stringified form', async () => {
    await executeBasesOperation(ctx, 'create', {
      path: 'y.base'
      , content: '{"formulas":{"a":"if(true, 1, 2)"},"views":[{"type":"table","name":"T"}]}',
    } as never);
    expect(created[1].config).toEqual({
      formulas: { a: 'if(true, 1, 2)' }
      , views: [{ type: 'table', name: 'T' }],
    });
  });

  it('refuses content that is neither, with the real key names', async () => {
    await expect(executeBasesOperation(ctx, 'create', {
      path: 'z.base'
      , content: 'not json at all',
    } as never)).rejects.toThrow('filters, formulas, properties, and views');
    expect(created.length).toBe(2);
  });
});
