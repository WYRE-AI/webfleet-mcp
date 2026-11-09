import { WEBFLEET_ORIGIN, WEBFLEET_PATH, resolveCredentials } from '../client.js';
import { isGatewayMode } from '../config.js';
import { validateCredentials } from '../auth.js';
import { VERSION } from '../version.js';
import { READ_ONLY } from './endpoint.js';
import type { ToolDef } from './types.js';

/**
 * Local only: reports configuration and confirms usable credentials are in
 * scope. Missing or invalid credentials are a tool error (isError), as the
 * template canary contract requires. Never calls Webfleet and never returns a
 * credential value.
 */
export const statusTool: ToolDef = {
  tier: 'read',
  tool: {
    name: 'webfleet_status',
    description:
      'Report this server\'s WEBFLEET.connect configuration: base URL, credential mode, and that usable credentials are present (an error if they are missing or invalid). ' +
      'Does not call Webfleet (so it uses no request quota) and never returns credential values.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { ...READ_ONLY, openWorldHint: false },
  },
  handler: async () => {
    // Throws CredentialError, which dispatch returns as isError with the reason.
    validateCredentials(resolveCredentials());
    return {
      server: 'webfleet-mcp',
      version: VERSION,
      baseUrl: `${WEBFLEET_ORIGIN}${WEBFLEET_PATH}`,
      credentialMode: isGatewayMode() ? 'gateway (X-Webfleet-* headers)' : 'env (WEBFLEET_* variables)',
      credentials: { usable: true },
      auth: 'account and apikey as query parameters; username and password via HTTP Basic Auth only',
    };
  },
};
