#!/usr/bin/env node
// Hook PreToolUse de Claude Code sur l'outil MCP Supabase execute_sql.
//
// Approuve sans demande une requête en lecture seule : une seule instruction
// SELECT / WITH / EXPLAIN / TABLE / VALUES, sans mot d'écriture, sans
// appel de fonction hors d'une liste de fonctions natives sans effet de bord,
// et sans table, schéma ou colonne qui porte un secret. Dans tous les autres
// cas le script ne répond rien et la demande d'autorisation habituelle
// s'affiche : il ne refuse jamais une requête, il épargne seulement la
// confirmation des lectures.

import { readFileSync } from 'node:fs';

// SHOW reste hors liste : SHOW ALL affiche aussi les paramètres personnalisés,
// où un secret peut avoir été rangé.
const FIRST_WORDS = new Set(['select', 'with', 'explain', 'table', 'values']);

// Une instruction unique qui commence par un mot de FIRST_WORDS ne peut écrire
// que par une CTE (insert, update, delete, merge), SELECT INTO, EXPLAIN ANALYZE
// d'une commande (create, declare, execute) ou un verrou FOR UPDATE. Les autres
// mots servent de filet.
const WRITE_WORDS = new Set([
  'insert', 'update', 'delete', 'merge', 'into', 'create', 'declare', 'execute',
  'drop', 'alter', 'truncate', 'grant', 'revoke', 'copy', 'call', 'vacuum',
  'reindex', 'cluster', 'refresh', 'lock', 'prepare', 'deallocate', 'notify',
  'listen', 'unlisten', 'checkpoint', 'discard',
]);

// Tables et schémas qui portent des secrets : un SELECT * les exposerait sans
// nommer de colonne sensible. Les tâches cron et pg_net embarquent souvent une
// clé dans la commande ou les en-têtes HTTP, que pg_stat_activity montre
// pendant l'exécution ; prosrc et routine_definition exposent le code des
// fonctions.
const SENSITIVE_RELATIONS = new Set([
  'auth', 'vault', 'pgsodium', 'cron', 'net', 'supabase_functions',
  'pg_authid', 'pg_shadow', 'pg_user_mapping', 'pg_user_mappings',
  'pg_settings', 'pg_db_role_setting', 'pg_file_settings',
  'pg_stat_activity', 'pg_stat_statements', 'prosrc', 'routine_definition',
  'organization_integrations', 'organization_mcp_servers',
  'organization_notion_connections', 'notion_mcp_oauth_clients',
  'organization_invitations', 'mission_invitations',
  'candidate_portal_tokens', 'client_portal_tokens',
  'email_unsubscribe_tokens', 'extension_tokens',
]);

// Fonctions natives sans effet de bord. Toute autre fonction (RPC de l'app,
// nextval, set_config, pg_sleep, dblink, query_to_xml…) déclenche la demande.
const SAFE_FUNCTIONS = new Set([
  'count', 'sum', 'avg', 'min', 'max', 'array_agg', 'string_agg', 'json_agg',
  'jsonb_agg', 'json_object_agg', 'jsonb_object_agg', 'bool_and', 'bool_or',
  'every', 'bit_and', 'bit_or', 'percentile_cont', 'percentile_disc', 'mode',
  'stddev', 'stddev_pop', 'stddev_samp', 'variance', 'var_pop', 'var_samp',
  'corr', 'covar_pop', 'covar_samp', 'regr_slope', 'regr_intercept', 'grouping',
  'row_number', 'rank', 'dense_rank', 'percent_rank', 'cume_dist', 'ntile',
  'lag', 'lead', 'first_value', 'last_value', 'nth_value',
  'coalesce', 'nullif', 'greatest', 'least',
  'abs', 'ceil', 'ceiling', 'floor', 'round', 'trunc', 'mod', 'power', 'pow',
  'sqrt', 'cbrt', 'exp', 'ln', 'log', 'log10', 'sign', 'div', 'width_bucket',
  'pi', 'degrees', 'radians',
  'lower', 'upper', 'initcap', 'length', 'char_length', 'character_length',
  'octet_length', 'bit_length', 'substring', 'substr', 'left', 'right', 'trim',
  'ltrim', 'rtrim', 'btrim', 'lpad', 'rpad', 'concat', 'concat_ws', 'replace',
  'translate', 'split_part', 'position', 'strpos', 'starts_with', 'reverse',
  'repeat', 'format', 'regexp_replace', 'regexp_match', 'regexp_matches',
  'regexp_split_to_array', 'regexp_split_to_table', 'regexp_count',
  'regexp_instr', 'regexp_like', 'regexp_substr', 'string_to_array',
  'array_to_string', 'to_hex', 'md5', 'encode', 'decode', 'quote_ident',
  'quote_literal', 'quote_nullable', 'ascii', 'chr', 'overlay', 'unaccent',
  'now', 'clock_timestamp', 'statement_timestamp', 'transaction_timestamp',
  'timeofday', 'date_trunc', 'date_part', 'date_bin', 'extract', 'age',
  'to_char', 'to_date', 'to_timestamp', 'to_number', 'make_date', 'make_time',
  'make_timestamp', 'make_timestamptz', 'make_interval', 'justify_days',
  'justify_hours', 'justify_interval', 'isfinite', 'timezone',
  'cast', 'to_json', 'to_jsonb', 'row_to_json', 'array_to_json',
  'json_build_object', 'jsonb_build_object', 'json_build_array',
  'jsonb_build_array', 'json_object', 'jsonb_object', 'json_array_length',
  'jsonb_array_length', 'json_array_elements', 'jsonb_array_elements',
  'json_array_elements_text', 'jsonb_array_elements_text', 'json_each',
  'jsonb_each', 'json_each_text', 'jsonb_each_text', 'json_object_keys',
  'jsonb_object_keys', 'json_typeof', 'jsonb_typeof', 'json_extract_path',
  'jsonb_extract_path', 'json_extract_path_text', 'jsonb_extract_path_text',
  'jsonb_pretty', 'jsonb_strip_nulls', 'json_strip_nulls', 'jsonb_path_query',
  'jsonb_path_query_array', 'jsonb_path_query_first', 'jsonb_path_exists',
  'jsonb_path_match', 'jsonb_set', 'jsonb_insert',
  'array_length', 'array_lower', 'array_upper', 'array_ndims', 'array_dims',
  'cardinality', 'unnest', 'array_position', 'array_positions', 'array_remove',
  'array_replace', 'array_append', 'array_prepend', 'array_cat',
  'generate_series', 'generate_subscripts',
  'pg_size_pretty', 'pg_total_relation_size', 'pg_relation_size',
  'pg_table_size', 'pg_indexes_size', 'pg_database_size', 'pg_column_size',
  'pg_get_constraintdef', 'pg_get_indexdef', 'pg_get_triggerdef', 'pg_get_expr',
  'pg_get_userbyid', 'pg_typeof', 'format_type', 'obj_description',
  'col_description', 'has_table_privilege', 'has_column_privilege',
  'has_schema_privilege', 'has_function_privilege', 'to_regclass',
  'to_regproc', 'to_regprocedure', 'to_regtype', 'to_regnamespace', 'version',
  'current_database', 'current_schema', 'current_schemas', 'gen_random_uuid',
  'uuid_generate_v4',
]);

// Mots SQL qui peuvent précéder une parenthèse sans être un appel de fonction,
// et types à paramètres (numeric(10,2), varchar(255)…).
const PAREN_KEYWORDS = new Set([
  'select', 'from', 'join', 'lateral', 'where', 'on', 'using', 'and', 'or',
  'not', 'in', 'exists', 'any', 'some', 'all', 'as', 'with', 'values', 'over',
  'filter', 'within', 'group', 'by', 'having', 'when', 'then', 'else', 'case',
  'between', 'like', 'ilike', 'similar', 'is', 'row', 'array', 'union',
  'intersect', 'except', 'limit', 'offset', 'sets', 'rollup', 'cube', 'explain',
  'distinct', 'window',
  'numeric', 'decimal', 'varchar', 'char', 'character', 'varying', 'bit',
  'varbit', 'time', 'timetz', 'timestamp', 'timestamptz', 'interval', 'float',
  'vector',
]);

const IDENT_CHAR = /[A-Za-z0-9_$\u0080-￿]/;
const DOLLAR_TAG = /^\$(?:[A-Za-z_\u0080-￿][A-Za-z0-9_\u0080-￿]*)?\$/;

// Lit la requête comme le lexer PostgreSQL : chaînes '...' (quote doublée),
// chaînes E'...' (antislash), chaînes $tag$...$tag$, identifiants "..." et
// commentaires -- ou /* */ imbriqués. Renvoie le code seul (chaînes remplacées
// par '', identifiants entre guillemets par qident) ou null si une chaîne ou un
// commentaire reste ouvert.
function stripLiterals(sql) {
  let out = '';
  let identLen = 0; // longueur de l'identifiant non guillemeté en cours
  let i = 0;
  const n = sql.length;

  const closeQuoted = (quote, backslashEscapes) => {
    i++;
    while (i < n) {
      const ch = sql[i];
      if (backslashEscapes && ch === '\\') { i += 2; continue; }
      if (ch === quote) {
        if (sql[i + 1] === quote) { i += 2; continue; }
        i++;
        return true;
      }
      i++;
    }
    return false;
  };

  while (i < n) {
    const ch = sql[i];
    const next = sql[i + 1];

    if (ch === '-' && next === '-') {
      while (i < n && sql[i] !== '\n' && sql[i] !== '\r') i++;
      out += ' ';
      identLen = 0;
      continue;
    }

    if (ch === '/' && next === '*') {
      let depth = 1;
      i += 2;
      while (i < n && depth > 0) {
        if (sql[i] === '/' && sql[i + 1] === '*') { depth++; i += 2; }
        else if (sql[i] === '*' && sql[i + 1] === '/') { depth--; i += 2; }
        else i++;
      }
      if (depth > 0) return null;
      out += ' ';
      identLen = 0;
      continue;
    }

    if (ch === "'") {
      // E'...' : le E doit être un mot à lui seul, collé à la quote.
      const escapeString = identLen === 1 && /[eE]/.test(out[out.length - 1]);
      if (!closeQuoted("'", escapeString)) return null;
      out += "''";
      identLen = 0;
      continue;
    }

    if (ch === '"') {
      if (!closeQuoted('"', false)) return null;
      out += ' qident ';
      identLen = 0;
      continue;
    }

    if (ch === '$' && identLen === 0) {
      const tag = sql.slice(i).match(DOLLAR_TAG);
      if (tag) {
        const end = sql.indexOf(tag[0], i + tag[0].length);
        if (end === -1) return null;
        i = end + tag[0].length;
        out += "''";
        continue;
      }
    }

    out += ch;
    identLen = IDENT_CHAR.test(ch) ? identLen + 1 : 0;
    i++;
  }
  return out;
}

function isSensitiveWord(word) {
  if (SENSITIVE_RELATIONS.has(word)) return true;
  if (word === 'token' || word.startsWith('token_') || word.endsWith('_token') || word.includes('_token_')) {
    return true;
  }
  return /secret|api_?key|passw|credential|ciphertext|private_key|service_role|jwt|decrypt/.test(word);
}

function isReadOnly(sql) {
  // Secrets : contrôle sur le texte brut, chaînes et commentaires compris.
  const rawWords = sql.toLowerCase().match(/[a-z_][a-z0-9_$]*/g) ?? [];
  if (rawWords.some(isSensitiveWord)) return false;

  const stripped = stripLiterals(sql);
  if (stripped === null) return false;
  const code = stripped.toLowerCase().replace(/[\s;]+$/, '');

  if (code.includes(';')) return false; // plusieurs instructions

  const first = code.match(/^[\s(]*([a-z_]+)/);
  if (!first || !FIRST_WORDS.has(first[1])) return false;

  const words = code.match(/[a-z_][a-z0-9_$]*/g) ?? [];
  if (words.some((w) => WRITE_WORDS.has(w))) return false;

  const calls = /([a-z_][a-z0-9_$]*)\s*\.\s*([a-z_][a-z0-9_$]*)\s*\(|([a-z_][a-z0-9_$]*)\s*\(/g;
  for (const m of code.matchAll(calls)) {
    if (m[2] !== undefined) {
      if (m[1] !== 'pg_catalog' || !SAFE_FUNCTIONS.has(m[2])) return false;
    } else if (!SAFE_FUNCTIONS.has(m[3]) && !PAREN_KEYWORDS.has(m[3])) {
      return false;
    }
  }
  return true;
}

function main() {
  let payload;
  try {
    payload = JSON.parse(readFileSync(0, 'utf8'));
  } catch {
    return;
  }
  if (!/^mcp__supabase__execute_sql$/i.test(payload?.tool_name ?? '')) return;
  const query = payload?.tool_input?.query;
  if (typeof query !== 'string' || !isReadOnly(query)) return;
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'allow',
      permissionDecisionReason: 'Requête SQL en lecture seule, approuvée sans demande.',
    },
  }));
}

try {
  main();
} catch {
  // En cas d'erreur, ne rien répondre : la demande habituelle s'affiche.
}
