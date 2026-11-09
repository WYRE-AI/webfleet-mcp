import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { knownSecrets, runWithAbortSignal } from '../client.js';
import { ALL_TIERS, maxResponseChars, parseToolTiers, type ToolTier } from '../config.js';
import { renderSafe } from '../redact.js';
import { ArgumentError, CredentialError, ThrottleError, WebfleetApiError } from '../types.js';
import { logger } from '../utils/logger.js';
import { CATALOG_TOOLS } from './catalog.js';
import { rawRequestTool } from './raw.js';
import { statusTool } from './status.js';
import type { CallToolResult, ToolDef } from './types.js';

/** Every tool this server knows, in tools/list order. Tier filtering happens in buildToolset. */
export const ALL_TOOL_DEFS: readonly ToolDef[] = [statusTool, ...CATALOG_TOOLS, rawRequestTool];

export interface Toolset {
  tiers: ReadonlySet<ToolTier>;
  tools: Tool[];
  dispatch: (name: string, args: unknown, signal?: AbortSignal) => Promise<CallToolResult>;
}

function errorResult(message: string): CallToolResult {
  return { content: [{ type: 'text', text: `Error: ${message}` }], isError: true };
}

/** Keeps only arguments declared in the tool's input schema; anything else never reaches a handler or Webfleet. */
export function pickDeclaredArgs(tool: Tool, args: unknown): Record<string, unknown> {
  const declared = Object.keys(tool.inputSchema.properties ?? {});
  const source = args && typeof args === 'object' && !Array.isArray(args) ? (args as Record<string, unknown>) : {};
  const out: Record<string, unknown> = {};
  for (const key of declared) {
    if (Object.prototype.hasOwnProperty.call(source, key)) out[key] = source[key];
  }
  return out;
}

function isKnownError(err: unknown): err is Error {
  return err instanceof ArgumentError || err instanceof CredentialError || err instanceof WebfleetApiError || err instanceof ThrottleError;
}

/** Only messages this server wrote are shown; anything unexpected becomes a generic message (and is logged redacted). */
function describeError(err: unknown): string {
  return isKnownError(err) ? err.message : 'Unexpected internal error while calling WEBFLEET.connect.';
}

export function buildToolset(tiers: ReadonlySet<ToolTier>): Toolset {
  const enabled = ALL_TOOL_DEFS.filter((d) => tiers.has(d.tier));
  const byName = new Map(enabled.map((d) => [d.tool.name, d]));
  const tools = enabled.map((d) => d.tool);

  async function dispatch(name: string, rawArgs: unknown, signal?: AbortSignal): Promise<CallToolResult> {
    const def = byName.get(name);
    if (!def || !tiers.has(def.tier)) return errorResult(`Unknown tool: ${name}`);

    const started = Date.now();
    try {
      const value = await runWithAbortSignal(signal, () => def.handler(pickDeclaredArgs(def.tool, rawArgs)));
      logger.info('Tool call succeeded', { tool: name, ms: Date.now() - started });
      return { content: [{ type: 'text', text: renderSafe(value, maxResponseChars(), knownSecrets()) }] };
    } catch (err) {
      logger.warn('Tool call failed', {
        tool: name,
        ms: Date.now() - started,
        status: err instanceof WebfleetApiError ? err.status : undefined,
        code: err instanceof WebfleetApiError ? err.code : undefined,
        errorType: err instanceof Error ? err.constructor.name : typeof err,
      });
      if (!isKnownError(err)) {
        logger.error('Unexpected tool error', { tool: name, error: renderSafe(String(err), 500, knownSecrets()) });
      }
      return errorResult(renderSafe(describeError(err), 4000, knownSecrets()));
    }
  }

  return { tiers, tools, dispatch };
}

let defaultToolset: Toolset | undefined;
const toolsetCache = new Map<string, Toolset>();

/** Toolset for this process, from WEBFLEET_TOOL_TIERS. Built once so tools/list is stable. */
export function getDefaultToolset(): Toolset {
  defaultToolset ??= buildToolset(parseToolTiers(process.env.WEBFLEET_TOOL_TIERS));
  return defaultToolset;
}

/**
 * Toolset for a per-request tier set (already narrowed against the default
 * toolset's tiers by the caller). Tiers outside the process configuration are
 * dropped here as well, so this can never widen the surface.
 */
export function toolsetForTiers(requested: ReadonlySet<ToolTier>): Toolset {
  const base = getDefaultToolset();
  const tiers = ALL_TIERS.filter((t) => base.tiers.has(t) && requested.has(t));
  if (tiers.length === base.tiers.size) return base;
  const key = tiers.join(',');
  let toolset = toolsetCache.get(key);
  if (!toolset) {
    toolset = buildToolset(new Set(tiers));
    toolsetCache.set(key, toolset);
  }
  return toolset;
}

/** Test-only. */
export function resetToolsets(): void {
  defaultToolset = undefined;
  toolsetCache.clear();
}
