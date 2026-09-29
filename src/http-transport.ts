import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { credentialsFromHeaders, credentialsStorage } from './credentials.js';
import { S2S_HEADER, verifyS2sHeader } from './s2s-verify.js';
import { createServer } from './server.js';

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

export function createHttpRequestListener(): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  return async (req, res) => {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

    // /health is container liveness, not credential readiness. Gateway mode
    // receives credentials per request, so this endpoint always returns 200.
    if (url.pathname === '/health') {
      sendJson(res, 200, { status: 'ok', server: 'webfleet-mcp' });
      return;
    }

    if (url.pathname !== '/mcp') {
      sendJson(res, 404, { error: 'Not found', endpoints: ['/mcp', '/health'] });
      return;
    }

    const s2sSecret = process.env.CONDUIT_S2S_SECRET || '';
    if (s2sSecret && !verifyS2sHeader(req.headers[S2S_HEADER] as string | undefined, s2sSecret)) {
      sendJson(res, 401, {
        error: 'Missing or invalid X-Gateway-S2S header: this endpoint only accepts requests signed by the gateway.',
      });
      return;
    }

    const handle = async () => {
      const server = createServer();
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });

      res.on('close', () => {
        transport.close();
        server.close();
      });

      await server.connect(transport);
      await transport.handleRequest(req, res);
    };

    const scoped = credentialsFromHeaders(req.headers);
    if (scoped) {
      await credentialsStorage.run(scoped, handle);
    } else {
      await handle();
    }
  };
}

export async function startHttpTransport(): Promise<void> {
  const port = parseInt(process.env.MCP_HTTP_PORT || '8080', 10);
  const host = process.env.MCP_HTTP_HOST || '0.0.0.0';
  const listener = createHttpRequestListener();
  const httpServer = createHttpServer((req, res) => {
    void listener(req, res);
  });

  await new Promise<void>((resolve) => {
    httpServer.listen(port, host, () => {
      console.log(`Webfleet MCP HTTP server listening on ${host}:${port}`);
      resolve();
    });
  });
}
