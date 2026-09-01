/**
 * Resources namespace security: obsidian://resources/ URIs pass the managed
 * gate for reads and reach the registry-backed API branch; every write,
 * create, delete, and move is refused at validateOperation with
 * RESOURCE_ACTION_UNSUPPORTED, ahead of any app access. Resources are
 * server-computed pages: no setting opens a write.
 */
import { App } from 'obsidian';
import { SecureObsidianAPI } from '../../src/security/secure-obsidian-api';
import { ResourceService } from '../../src/resources/types';
import { RESOURCES_URI_PREFIX } from '../../src/resources/registry';

const PERMISSIVE = {
  pathValidation: 'strict' as const,
  permissions: {
    read: true, create: true, update: true,
    delete: true, move: true, execute: true,
  },
  blockedPaths: [],
  logSecurityEvents: false,
};

const URI = `${RESOURCES_URI_PREFIX}view`;

function stubService(): ResourceService {
  return {
    read: (uri: string) => ({ uri, mimeType: 'text/markdown', text: '# reference' })
    , list: () => []
  };
}

function makeApi(settings: { readOnlyMode?: boolean } = {}): SecureObsidianAPI {
  const app = {
    vault: { adapter: { basePath: '/test/vault' } }
    , workspace: { getActiveFile: () => null }
  } as unknown as App;
  const api = new SecureObsidianAPI(app, undefined, { settings } as never, PERMISSIVE);
  api.setResourceService(stubService());
  return api;
}

async function expectCode(promise: Promise<unknown>, code: string): Promise<void> {
  try {
    await promise;
    throw new Error(`expected error code ${code}`);
  } catch (error) {
    expect((error as { code?: string }).code).toBe(code);
  }
}

describe('resources namespace gate', () => {
  it('reads pass the gate and serve through the API branch', async () => {
    const api = makeApi();

    const file = await api.getFile(URI);
    expect((file as { content: string }).content).toBe('# reference');
  });

  it('update is refused with RESOURCE_ACTION_UNSUPPORTED', async () => {
    const api = makeApi();
    await expectCode(api.updateFile(URI, 'changed'), 'RESOURCE_ACTION_UNSUPPORTED');
  });

  it('append is refused with RESOURCE_ACTION_UNSUPPORTED', async () => {
    const api = makeApi();
    await expectCode(api.appendToFile(URI, 'more'), 'RESOURCE_ACTION_UNSUPPORTED');
  });

  it('create is refused with RESOURCE_ACTION_UNSUPPORTED', async () => {
    const api = makeApi();
    await expectCode(api.createFile(URI, 'new'), 'RESOURCE_ACTION_UNSUPPORTED');
  });

  it('delete is refused with RESOURCE_ACTION_UNSUPPORTED', async () => {
    const api = makeApi();
    await expectCode(api.deleteFile(URI), 'RESOURCE_ACTION_UNSUPPORTED');
  });

  it('a move with a resources destination is refused', async () => {
    const api = makeApi();
    await expectCode(api.moveFile('note.md', URI), 'RESOURCE_ACTION_UNSUPPORTED');
  });

  it('a move with a resources source is refused', async () => {
    const api = makeApi();
    await expectCode(api.moveFile(URI, 'moved.md'), 'RESOURCE_ACTION_UNSUPPORTED');
  });

  it('read-only mode still permits the read', async () => {
    const api = makeApi({ readOnlyMode: true });

    const file = await api.getFile(URI);
    expect((file as { content: string }).content).toBe('# reference');
  });
});
