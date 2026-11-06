import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';

export class WebfleetApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(`WEBFLEET.connect error ${code}: ${message}`);
    this.name = 'WebfleetApiError';
    this.code = code;
    this.status = status;
  }
}

export function toMcpError(error: unknown): McpError {
  if (error instanceof McpError) {
    return error;
  }

  if (error instanceof WebfleetApiError) {
    const code = error.code;
    const detail = `HTTP ${error.status}, code ${code}`;
    if (code === '401' || error.status === 401) {
      return new McpError(ErrorCode.InvalidRequest, `Invalid WEBFLEET.connect credentials (${detail}): ${error.message}`);
    }
    if (code === '403' || error.status === 403) {
      return new McpError(ErrorCode.InvalidRequest, `WEBFLEET.connect access forbidden (${detail}): ${error.message}`);
    }
    // 8011 is WEBFLEET.connect's "request quota reached" error.
    if (error.status === 429 || code === '8011') {
      return new McpError(ErrorCode.InvalidRequest, `WEBFLEET.connect rate limit exceeded (${detail}): ${error.message}`);
    }
    return new McpError(ErrorCode.InvalidRequest, `${error.message} (${detail})`);
  }

  const errorMessage = error instanceof Error ? error.message : String(error);

  return new McpError(ErrorCode.InternalError, `WEBFLEET.connect error: ${errorMessage}`);
}
