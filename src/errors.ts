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
    if (code === '401' || error.status === 401) {
      return new McpError(ErrorCode.InvalidRequest, 'Invalid WEBFLEET.connect credentials');
    }
    if (code === '403' || error.status === 403) {
      return new McpError(ErrorCode.InvalidRequest, 'WEBFLEET.connect access forbidden');
    }
    if (error.status === 429 || /limit/i.test(error.message)) {
      return new McpError(ErrorCode.InvalidRequest, `WEBFLEET.connect rate limit exceeded (${error.message})`);
    }
    return new McpError(ErrorCode.InvalidRequest, error.message);
  }

  const errorMessage = error instanceof Error ? error.message : String(error);

  if (errorMessage.includes('401')) {
    return new McpError(ErrorCode.InvalidRequest, 'Invalid WEBFLEET.connect credentials');
  }
  if (errorMessage.includes('429')) {
    return new McpError(ErrorCode.InvalidRequest, 'WEBFLEET.connect rate limit exceeded');
  }
  if (/\b(500|502|503)\b/.test(errorMessage)) {
    return new McpError(ErrorCode.InternalError, 'WEBFLEET.connect service error');
  }

  return new McpError(ErrorCode.InternalError, `WEBFLEET.connect error: ${errorMessage}`);
}
