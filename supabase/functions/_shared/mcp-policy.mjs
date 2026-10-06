// MCP connector safety policy shared by the edge function and Node tests.
//
// The Anthropic hosted MCP connector executes tools remotely. Konekt cannot
// intercept those calls with its normal approval card, so connectors are
// fail-closed: a server is attached only when an admin has explicitly listed
// the read-only tools that may be exposed to the model.

const TOOL_NAME_RE = /^[A-Za-z0-9_.:-]{1,128}$/;
const MAX_ALLOWED_TOOLS = 50;
const MUTATING_TOOL_SEGMENT_RE = /(?:^|[_.:-])(create|write|update|delete|remove|send|patch|edit|modify|move|rename|archive|invite|add|upload|execute|run|trigger|publish|approve|reject|assign|enroll|dismiss|cancel|reply)(?:[_.:-]|$)/i;

/**
 * Normalize an untrusted database value into a bounded, unique allowlist.
 * Invalid names are discarded instead of being forwarded to the provider.
 *
 * @param {unknown} value
 * @returns {string[]}
 */
export function normalizeAllowedMcpTools(value) {
  if (!Array.isArray(value)) return [];

  const unique = new Set();
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const name = item.trim();
    if (!TOOL_NAME_RE.test(name) || MUTATING_TOOL_SEGMENT_RE.test(name)) continue;
    unique.add(name);
    if (unique.size >= MAX_ALLOWED_TOOLS) break;
  }
  return [...unique];
}

/**
 * Build the exact MCP server + toolset payloads sent to Anthropic.
 *
 * Anthropic separates connection details (`mcp_servers`) from tool exposure
 * (`tools[].mcp_toolset`). The deny-by-default configuration is therefore set
 * on the toolset: every remote tool is disabled unless it appears in the
 * reviewed allowlist.
 *
 * Returns null for disabled, invalid, or non-allowlisted connectors.
 *
 * @param {{
 *   name?: unknown,
 *   url?: unknown,
 *   authorization_token?: unknown,
 *   allowed_tools?: unknown,
 *   enabled?: unknown,
 * }} row
 * @returns {{
 *   server: Record<string, unknown>,
 *   toolset: Record<string, unknown>,
 * } | null}
 */
export function buildSafeMcpConfiguration(row) {
  if (!row || row.enabled !== true) return null;

  const name = typeof row.name === 'string' ? row.name.trim() : '';
  const url = typeof row.url === 'string' ? row.url.trim() : '';
  const allowedTools = normalizeAllowedMcpTools(row.allowed_tools);

  let parsedUrl;
  try {
    parsedUrl = new URL(url);
  } catch {
    return null;
  }

  if (
    !TOOL_NAME_RE.test(name) ||
    parsedUrl.protocol !== 'https:' ||
    !parsedUrl.hostname ||
    allowedTools.length === 0
  ) {
    return null;
  }

  const server = { type: 'url', name, url };

  if (typeof row.authorization_token === 'string' && row.authorization_token.trim()) {
    server.authorization_token = row.authorization_token.trim();
  }

  return {
    server,
    toolset: {
      type: 'mcp_toolset',
      mcp_server_name: name,
      default_config: { enabled: false },
      configs: Object.fromEntries(
        allowedTools.map((toolName) => [toolName, { enabled: true }]),
      ),
    },
  };
}
