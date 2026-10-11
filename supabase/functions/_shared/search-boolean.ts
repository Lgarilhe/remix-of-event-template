/** Shared input validation for manual and unattended LinkedIn searches.
 * Validation never repairs or rewrites a query; quoted phrases stay literal. */
export type SearchBooleanIssue = 'empty' | 'quotes' | 'parentheses' | 'operators';

export function searchBooleanIssue(input: unknown): SearchBooleanIssue | null {
  if (typeof input !== 'string' || !input.trim()) return 'empty';
  let syntax = '';
  let depth = 0;
  let inQuote = false;
  for (const ch of input) {
    if (ch === '"') {
      if (!inQuote) syntax += ' PHRASE ';
      inQuote = !inQuote;
      continue;
    }
    if (!inQuote) {
      if (ch === '(') depth++;
      else if (ch === ')') {
        if (depth === 0) return 'parentheses';
        depth--;
      }
      syntax += ch;
    }
  }
  if (inQuote) return 'quotes';
  if (depth !== 0) return 'parentheses';
  // LinkedIn operators are uppercase. Lowercase words remain literal text.
  if (/\b(?:AND|OR|NOT)\s*(?:\)|$)/.test(syntax)
    || /(?:^|\()\s*(?:AND|OR)\b/.test(syntax)
    || /\b(?:AND|OR|NOT)\s+(?:AND|OR)\b/.test(syntax)
    || /\(\s*\)/.test(syntax)) return 'operators';
  return null;
}

export class SearchRoleFilterError extends Error {
  constructor(public code: 'filters_invalid' | 'filters_unsupported', message: string) {
    super(message);
  }
}

/** Only a disjunction of literal titles can become a native inclusion list.
 * Never split operators inside quotes or reinterpret AND/NOT as title text. */
export function roleTitleAlternatives(query: string): string[] | null {
  if (searchBooleanIssue(query)) return null;
  const tokens = query.match(/"[^"]*"|\b(?:AND|OR|NOT)\b|[()]|[^"()]+?(?=\b(?:AND|OR|NOT)\b|["()]|$)/g)
    ?.map(value => value.trim()).filter(Boolean) ?? [];
  let index = 0;
  function group(): string[] | null {
    const values: string[] = [];
    let needsTitle = true;
    while (index < tokens.length && tokens[index] !== ')') {
      const token = tokens[index++];
      if (!needsTitle) {
        if (token !== 'OR') return null;
        needsTitle = true;
        continue;
      }
      if (token === '(') {
        const nested = group();
        if (!nested || tokens[index++] !== ')') return null;
        values.push(...nested);
      } else {
        if (['AND', 'OR', 'NOT'].includes(token)) return null;
        const value = token.startsWith('"') ? token.slice(1, -1) : token;
        if (!value) return null;
        values.push(value);
      }
      needsTitle = false;
    }
    return needsTitle ? null : values;
  }
  const values = group();
  return values && index === tokens.length ? [...new Set(values)] : null;
}

type SearchRole = { keywords: string; priority: 'MUST_HAVE' | 'CAN_HAVE' | 'DOESNT_HAVE'; scope: 'CURRENT' | 'PAST' | 'CURRENT_OR_PAST' };
type SalesTitle = { id: string; priority: 'MUST_HAVE' | 'DOESNT_HAVE' };

/** Compile the same saved criteria for interactive, onboarding and unattended
 * search. Canonical roles stay in the editor; only the request is adapted.
 * API v1 documents plain current titles for Sales, not past text titles or
 * Boolean expressions inside its native list. Classic has no period selector. */
export function compileSearchRoles(
  input: readonly unknown[],
  api: 'classic' | 'sales_navigator' | 'recruiter' | 'database',
  context: { classicTitle?: string; salesTitles?: readonly { id: string; priority?: string; scope?: string }[] } = {},
): { role?: SearchRole[]; classicTitle?: string; salesTitles?: SalesTitle[] } {
  const invalid = (message: string): never => { throw new SearchRoleFilterError('filters_invalid', message); };
  const unsupported = (message: string): never => { throw new SearchRoleFilterError('filters_unsupported', message); };
  const validate = (query: string): string => {
    if (searchBooleanIssue(query)) invalid('Validez les guillemets et les opérateurs des intitulés de poste.');
    if (api !== 'recruiter' && api !== 'database' && query.length > 200) {
      invalid(`La requête de poste contient ${query.length} caractères. Cette licence accepte actuellement jusqu’à 200 caractères. Revoyez les intitulés.`);
    }
    return query;
  };
  const roles: SearchRole[] = input.map(value => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) invalid('Revoyez les intitulés de poste.');
    const row = value as Record<string, unknown>;
    if (typeof row.keywords !== 'string') invalid('Renseignez les intitulés de poste.');
    const priority = row.priority ?? 'MUST_HAVE';
    const scope = row.scope ?? 'CURRENT';
    if (!['MUST_HAVE', 'CAN_HAVE', 'DOESNT_HAVE'].includes(String(priority))) invalid('Revoyez les priorités des intitulés de poste.');
    if (!['CURRENT', 'PAST', 'CURRENT_OR_PAST'].includes(String(scope))) invalid('Revoyez la période des intitulés de poste.');
    return { keywords: validate(row.keywords as string), priority, scope } as SearchRole;
  });
  const existing: SalesTitle[] = api === 'sales_navigator' ? (context.salesTitles ?? []).map(row => {
    if (row.scope && row.scope !== 'CURRENT') unsupported('Sales Navigator conserve uniquement les postes actuels dans ce filtre. Revoyez la période ou utilisez Recruiter.');
    if (row.priority === 'CAN_HAVE') unsupported('Revoyez la priorité des intitulés sélectionnés pour Sales Navigator.');
    if (!row.id || (row.priority && !['MUST_HAVE', 'DOESNT_HAVE'].includes(row.priority))) invalid('Revoyez les intitulés sélectionnés.');
    if (row.id.length > 200) invalid('Un intitulé sélectionné dépasse les 200 caractères acceptés. Revoyez le poste sans tronquer de critère.');
    return { id: row.id, priority: row.priority === 'DOESNT_HAVE' ? 'DOESNT_HAVE' : 'MUST_HAVE' };
  }) : [];
  if (!roles.length) return {};
  if (api === 'recruiter' || api === 'database') return { role: roles };

  if (api === 'classic') {
    if (roles.some(row => row.scope !== 'CURRENT_OR_PAST')) {
      unsupported('LinkedIn Classic ne distingue pas les postes actuels et passés. Conservez cette exigence avec Recruiter, ou revoyez explicitement la période du poste.');
    }
    const expression = (row: SearchRole) => {
      const titles = roleTitleAlternatives(row.keywords);
      return titles ? titles.map(title => `"${title}"`).join(' OR ') : row.keywords;
    };
    const clauses = roles.filter(row => row.priority === 'MUST_HAVE').map(row => `(${expression(row)})`);
    const alternatives = roles.filter(row => row.priority === 'CAN_HAVE');
    if (alternatives.length) clauses.push(`(${alternatives.map(row => `(${expression(row)})`).join(' OR ')})`);
    clauses.push(...roles.filter(row => row.priority === 'DOESNT_HAVE').map(row => `NOT (${expression(row)})`));
    if (context.classicTitle) clauses.unshift(`(${validate(context.classicTitle)})`);
    return { classicTitle: validate(clauses.join(' AND ')) };
  }

  if (roles.some(row => row.scope !== 'CURRENT')) {
    unsupported('Sales Navigator ne conserve pas cette période pour les intitulés en texte. Utilisez Recruiter ou sélectionnez les postes passés dans les filtres.');
  }
  const required = roles.filter(row => row.priority === 'MUST_HAVE');
  const alternatives = roles.filter(row => row.priority === 'CAN_HAVE');
  if (required.length > 1 || (required.length && alternatives.length)) {
    unsupported('Sales Navigator recherche au moins un intitulé. Plusieurs groupes obligatoires nécessitent Recruiter ; revoyez les priorités sans supprimer de critère.');
  }
  const titles: SalesTitle[] = roles.flatMap(row => {
    const values = roleTitleAlternatives(row.keywords);
    if (!values) unsupported('Sales Navigator accepte ici des intitulés simples en alternatives. Cette expression de poste nécessite Recruiter.');
    return values!.map(id => ({ id, priority: row.priority === 'DOESNT_HAVE' ? 'DOESNT_HAVE' as const : 'MUST_HAVE' as const }));
  });
  const positive = (rows: SalesTitle[]) => [...new Set(rows.filter(row => row.priority !== 'DOESNT_HAVE').map(row => row.id))].sort();
  if (positive(existing).length && positive(titles).length && JSON.stringify(positive(existing)) !== JSON.stringify(positive(titles))) {
    unsupported('Les intitulés sélectionnés et générés forment deux exigences distinctes. Sales Navigator ne peut pas les combiner sans élargir la recherche. Revoyez-les ou utilisez Recruiter.');
  }
  const merged = [...new Map([...existing, ...titles].map(row => [`${row.priority}|${row.id}`, row])).values()];
  // Preserve the app's supported limit across every generated alternative.
  validate(titles.map(row => `${row.priority === 'DOESNT_HAVE' ? 'NOT ' : ''}"${row.id}"`).join(' OR '));
  return { salesTitles: merged };
}
