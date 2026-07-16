const CONNECTOR_NAME_RE = /^[a-z0-9][a-z0-9_-]{1,39}$/;
export const RESERVED_CONNECTOR_NAMES = Object.freeze(['notion', 'email', 'gmail', 'outlook']);
const RESERVED_CONNECTOR_NAME_SET = new Set(RESERVED_CONNECTOR_NAMES);

/**
 * The client names the connectors it wants to use for one request. Unknown or
 * malformed values are ignored and the list is capped to Notion + personal
 * email + five organization connectors. Authorization is still resolved
 * server-side for every selected connector.
 *
 * @param {unknown} value
 * @returns {string[]}
 */
export function normalizeEnabledConnectorNames(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(
    value
      .filter((name) => typeof name === 'string')
      .map((name) => name.trim().toLowerCase())
      .filter((name) => CONNECTOR_NAME_RE.test(name)),
  )].slice(0, 7);
}

/**
 * Built-in names can never be claimed by an organization MCP server. Gmail
 * and Outlook are reserved aliases even though the backend capability is
 * enabled only by the canonical `email` connector.
 *
 * @param {unknown} name
 */
export function isReservedConnectorName(name) {
  return typeof name === 'string' && RESERVED_CONNECTOR_NAME_SET.has(name.toLowerCase());
}

/**
 * @param {unknown} name
 * @param {string[]} enabledNames
 */
export function connectorSelectedForRequest(name, enabledNames) {
  return typeof name === 'string' && enabledNames.includes(name.toLowerCase());
}
