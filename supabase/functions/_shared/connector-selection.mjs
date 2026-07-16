const CONNECTOR_NAME_RE = /^[a-z0-9][a-z0-9_-]{1,39}$/;

/**
 * The client names the connectors it wants to use for one request. Unknown or
 * malformed values are ignored and the list is capped to Notion + five
 * organization connectors. Authorization is still resolved server-side for
 * every selected connector.
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
  )].slice(0, 6);
}

/**
 * @param {unknown} name
 * @param {string[]} enabledNames
 */
export function connectorSelectedForRequest(name, enabledNames) {
  return typeof name === 'string' && enabledNames.includes(name.toLowerCase());
}
