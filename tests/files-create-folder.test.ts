import { executeFilesOperation } from '../src/tools/files/operations';

// files.create with format "folder" creates a directory. Content has no
// meaning for a folder: the handler refuses a non-empty value before any
// vault call, so the write never lands.
describe('folder create via files.create format folder', () => {
  const created: string[] = [];
  const ctx = {
    api: {
      createFolder: jest.fn(async (path: string) => {
        created.push(path);
        return { success: true, path, folder: true };
      }),
    },
  } as never;

  it('creates a folder with no content', async () => {
    const result = await executeFilesOperation(ctx, 'create', {
      path: 'newdir'
      , format: 'folder',
    } as never);
    expect(result).toEqual({ success: true, path: 'newdir', folder: true });
    expect(created).toEqual(['newdir']);
  });

  it('accepts an empty content string', async () => {
    await executeFilesOperation(ctx, 'create', {
      path: 'empty'
      , format: 'folder'
      , content: '',
    } as never);
    expect(created).toEqual(['newdir', 'empty']);
  });

  it('refuses non-empty content without creating the folder', async () => {
    await expect(executeFilesOperation(ctx, 'create', {
      path: 'nope'
      , format: 'folder'
      , content: 'text',
    } as never)).rejects.toThrow('takes no content');
    expect(created).toEqual(['newdir', 'empty']);
  });
});
