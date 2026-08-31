#!/usr/bin/env node

/**
 * Test concurrent MCP sessions with the plugin
 */

import http from 'node:http';
import { randomUUID } from 'node:crypto';

const MCP_PORT = 3001;
const MCP_URL = `http://localhost:${MCP_PORT}/mcp`;

// Create a session and send a request
async function createSession(sessionName) {
  const sessionId = randomUUID();
  console.log(`🚀 Creating session ${sessionName} (${sessionId})`);

  // Initialize session
  const initResponse = await sendRequest({
    jsonrpc: '2.0',
    method: 'initialize',
    params: {
      protocolVersion: '1.0.0',
      capabilities: {},
      clientInfo: {
        name: `test-client-${sessionName}`,
        version: '1.0.0'
      }
    },
    id: 1
  }, sessionId);

  console.log(`✅ Session ${sessionName} initialized`);

  // Simulate concurrent graph search operations
  const searchPromises = [];

  for (let i = 0; i < 3; i++) {
    const promise = sendRequest({
      jsonrpc: '2.0',
      method: 'tools/call',
      params: {
        name: 'graph',
        arguments: {
          action: 'search-traverse',
          startPath: 'Daily Notes/2024-01-01.md',
          searchQuery: `session ${sessionName} query ${i}`,
          maxDepth: 2
        }
      },
      id: i + 2
    }, sessionId).then(response => {
      console.log(`📊 Session ${sessionName} - Request ${i} completed`);
      return response;
    });

    searchPromises.push(promise);
  }

  // Wait for all requests to complete
  const results = await Promise.all(searchPromises);
  console.log(`🏁 Session ${sessionName} completed all requests`);

  return { sessionId, results };
}

// Send HTTP request to MCP server
function sendRequest(body, sessionId) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: MCP_PORT,
      path: '/mcp',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Mcp-Session-Id': sessionId
      }
    };

    const req = http.request(options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (error) {
          reject(new Error(`Failed to parse response: ${data}`));
        }
      });
    });

    req.on('error', reject);
    req.write(JSON.stringify(body));
    req.end();
  });
}

// Main test function
async function runTest() {
  console.log('🧪 Testing concurrent MCP sessions...\n');

  try {
    // Check if server is running
    await sendRequest({
      jsonrpc: '2.0',
      method: 'ping',
      id: 0
    }, 'test');
  } catch (error) {
    console.error('❌ MCP server is not running on port', MCP_PORT);
    console.error('Please start the Obsidian plugin first.');
    process.exit(1);
  }

  // Create multiple concurrent sessions
  const sessionPromises = [];
  const sessionCount = 5;

  console.log(`Creating ${sessionCount} concurrent sessions...\n`);

  for (let i = 0; i < sessionCount; i++) {
    sessionPromises.push(createSession(`Session-${i + 1}`));
  }

  // Wait for all sessions to complete
  const startTime = Date.now();
  const sessions = await Promise.all(sessionPromises);
  const duration = Date.now() - startTime;

  console.log(`\n✨ All sessions completed in ${duration}ms`);
  console.log(`📈 Average time per session: ${(duration / sessionCount).toFixed(2)}ms`);

  // Get session info resource
  try {
    const sessionInfo = await sendRequest({
      jsonrpc: '2.0',
      method: 'resources/read',
      params: {
        uri: 'obsidian://session-info'
      },
      id: 999
    }, sessions[0].sessionId);

    console.log('\n📊 Session Statistics:');
    if (sessionInfo.result?.contents?.[0]?.text) {
      const stats = JSON.parse(sessionInfo.result.contents[0].text);
      console.log(`  Active Sessions: ${stats.summary.activeSessions}`);
      console.log(`  Total Requests: ${stats.summary.totalRequests}`);
      if (stats.connectionPool) {
        console.log(`  Active Connections: ${stats.connectionPool.activeConnections}`);
        console.log(`  Pool Utilization: ${stats.connectionPool.poolUtilization}`);
      }
    }
  } catch (error) {
    console.log('Could not fetch session statistics');
  }

  console.log('\n✅ Concurrent session test completed successfully!');
}

// Run the test
runTest().catch(console.error);
