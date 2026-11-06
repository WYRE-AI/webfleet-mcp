import { config } from 'dotenv';
import { startHttpTransport } from './http-transport.js';
import { startStdioTransport } from './stdio-transport.js';

// stdout carries JSON-RPC in stdio mode. dotenv logs with console.log and
// DOTENV_CONFIG_DEBUG/QUIET override options, so route its output to stderr.
const stdoutLog = console.log;
console.log = console.error;
try {
  config({ quiet: true });
} finally {
  console.log = stdoutLog;
}

const transport = process.env.MCP_TRANSPORT || (process.argv.includes('--http') ? 'http' : 'stdio');

async function main(): Promise<void> {
  try {
    if (transport === 'stdio') {
      console.error('Starting Webfleet MCP server (stdio)...');
      await startStdioTransport();
    } else {
      console.error('Starting Webfleet MCP server (http)...');
      await startHttpTransport();
    }
  } catch (error) {
    console.error('Failed to start Webfleet MCP server:', error);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('Unhandled error:', error);
  process.exit(1);
});
