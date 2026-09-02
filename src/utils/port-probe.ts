/**
 * Port availability probing for server startup. The caller supplies the
 * own-server predicate so the probe carries no plugin state.
 */
import { Debug } from './debug';

export type PortStatus = 'available' | 'this-server' | 'in-use';

export async function checkPortConflict(port: number, isOwnServer: (port: number) => boolean): Promise<PortStatus> {
  try {
    if (isOwnServer(port)) {
      return 'this-server';
    }

    // Try to create a temporary server to test port availability
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- Dynamic require needed for Node.js http module in Obsidian desktop environment
    const http = require('http') as typeof import('http');
    const testServer = http.createServer();
    return new Promise((resolve) => {
      testServer.listen(port, '127.0.0.1', () => {
        testServer.close(() => resolve('available')); // Port is available
      });
      testServer.on('error', () => resolve('in-use')); // Port is in use
    });
  } catch {
    return 'available'; // Assume available if we can't test
  }
}

export async function findAvailablePort(startPort: number, isOwnServer: (port: number) => boolean): Promise<number> {
  const maxRetries = 3;
  for (let i = 1; i <= maxRetries; i++) {
    const port = startPort + i;
    const status = await checkPortConflict(port, isOwnServer);
    if (status === 'available') {
      return port;
    }
    Debug.log(`Port ${port} is also in use, trying next...`);
  }
  // If all 3 alternate ports are busy, return 0 to indicate failure
  return 0;
}
