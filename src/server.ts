import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { SERVER_NAME, SERVER_VERSION } from './constants.js';
import { toMcpError } from './errors.js';
import { handleObjectsList, objectsListTool } from './tools/objects.js';
import { handleRawRequest, rawRequestTool } from './tools/raw.js';
import { handleStatus, statusTool } from './tools/status.js';
import { handleTrips, tripsTool } from './tools/trips.js';

const TOOLS = [statusTool, objectsListTool, tripsTool, rawRequestTool];

export function createServer(): Server {
  const server = new Server(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { capabilities: { tools: {}, logging: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools: TOOLS };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: rawArgs = {} } = request.params;

    try {
      switch (name) {
        case 'webfleet_status':
          return await handleStatus();
        case 'webfleet_objects_list':
          return await handleObjectsList(rawArgs);
        case 'webfleet_trips':
          return await handleTrips(rawArgs);
        case 'webfleet_raw_request':
          return await handleRawRequest(rawArgs);
        default:
          return {
            content: [{ type: 'text' as const, text: `Unknown tool: ${name}` }],
            isError: true,
          };
      }
    } catch (error) {
      const mcpError = toMcpError(error);
      return {
        content: [{ type: 'text' as const, text: mcpError.message }],
        isError: true,
      };
    }
  });

  return server;
}
