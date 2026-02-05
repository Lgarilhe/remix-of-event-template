/**
 * Notion API Interactions - Job context fetching
 */

const NOTION_API_KEY = Deno.env.get('NOTION_API_KEY');

// Helper to extract property values from Notion page
function getValue(prop: Record<string, unknown>): unknown {
  if (!prop) return null;
  switch (prop.type) {
    case 'title':
      return (prop.title as Array<{ plain_text: string }>)?.[0]?.plain_text || '';
    case 'rich_text':
      return (prop.rich_text as Array<{ plain_text: string }>)?.map(t => t.plain_text).join('') || '';
    case 'select':
      return (prop.select as { name: string })?.name || null;
    case 'multi_select':
      return (prop.multi_select as Array<{ name: string }>)?.map(s => s.name) || [];
    case 'number':
      return prop.number;
    case 'relation':
      return (prop.relation as Array<{ id: string }>)?.map(r => r.id) || [];
    default:
      return null;
  }
}

// Fetch company/client details from a Notion relation
export async function fetchClientFromRelation(clientIds: string[]): Promise<{ name: string; sector: string } | null> {
  if (!clientIds || clientIds.length === 0 || !NOTION_API_KEY) return null;
  
  try {
    const response = await fetch(`https://api.notion.com/v1/pages/${clientIds[0]}`, {
      headers: {
        'Authorization': `Bearer ${NOTION_API_KEY}`,
        'Notion-Version': '2022-06-28',
      },
    });
    
    if (!response.ok) return null;
    
    const page = await response.json();
    const props = page.properties || {};
    
    // Find title property (company name)
    let name = '';
    for (const [, prop] of Object.entries(props)) {
      if ((prop as Record<string, unknown>).type === 'title') {
        const titleArray = (prop as Record<string, unknown>).title as Array<{ plain_text: string }>;
        name = titleArray?.[0]?.plain_text || '';
        break;
      }
    }
    
    // Find sector property
    let sector = '';
    const sectorProp = props['Secteur'] || props['Sector'] || props['Industry'];
    if (sectorProp) {
      if ((sectorProp as Record<string, unknown>).type === 'select') {
        sector = ((sectorProp as Record<string, unknown>).select as { name: string })?.name || '';
      } else if ((sectorProp as Record<string, unknown>).type === 'rich_text') {
        const textArray = (sectorProp as Record<string, unknown>).rich_text as Array<{ plain_text: string }>;
        sector = textArray?.map(t => t.plain_text).join('') || '';
      }
    }
    
    console.log(`[fetchClientFromRelation] Resolved client: name="${name}", sector="${sector}"`);
    return { name, sector };
  } catch (err) {
    console.error('[fetchClientFromRelation] Failed to fetch client:', err);
    return null;
  }
}

// Fetch job context from Notion with full details including transversal criteria
export async function fetchNotionJobContext(jobId: string): Promise<Record<string, unknown> | null> {
  if (!NOTION_API_KEY) return null;
  
  try {
    const response = await fetch(`https://api.notion.com/v1/pages/${jobId}`, {
      headers: {
        'Authorization': `Bearer ${NOTION_API_KEY}`,
        'Notion-Version': '2022-06-28',
      },
    });

    if (!response.ok) return null;

    const page = await response.json();
    const props = page.properties || {};

    // Find title property
    let title = '';
    for (const [, prop] of Object.entries(props)) {
      if ((prop as Record<string, unknown>).type === 'title') {
        title = getValue(prop as Record<string, unknown>) as string;
        break;
      }
    }

    // Extract accompagnement - try multiple possible property names (with both apostrophe types)
    let accompagnement: string[] = [];
    const accompagnementKeys = [
      "Type d'accompagnement", "Type d\u0027accompagnement",
      "Type d'accompagnement",
      "Accompagnement", "Mode", "Type accompagnement"
    ];
    for (const key of accompagnementKeys) {
      const val = getValue(props[key]);
      if (val && (Array.isArray(val) ? val.length > 0 : val)) {
        accompagnement = Array.isArray(val) ? val : [val as string];
        break;
      }
    }

    // Case-insensitive search for accompagnement if not found
    if (accompagnement.length === 0) {
      for (const [propName, prop] of Object.entries(props)) {
        const lowerName = propName.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        if (lowerName.includes('accompagnement')) {
          const val = getValue(prop as Record<string, unknown>);
          if (val && (Array.isArray(val) ? val.length > 0 : val)) {
            accompagnement = Array.isArray(val) ? val : [val as string];
            console.log(`[fetchNotionJobContext] Found accompagnement via case-insensitive search: ${propName} = ${JSON.stringify(accompagnement)}`);
            break;
          }
        }
      }
    }

    // Fetch transversal criteria if relation exists
    let transversalCriteria: Record<string, string> | null = null;
    const transversalRelation = getValue(props['Critères Transverses']) || getValue(props['Transversal']) || getValue(props['Critères transverses']);
    if (Array.isArray(transversalRelation) && transversalRelation.length > 0) {
      try {
        const transversalId = transversalRelation[0];
        const transversalResponse = await fetch(`https://api.notion.com/v1/pages/${transversalId}`, {
          headers: {
            'Authorization': `Bearer ${NOTION_API_KEY}`,
            'Notion-Version': '2022-06-28',
          },
        });
        
        if (transversalResponse.ok) {
          const transversalPage = await transversalResponse.json();
          const tProps = transversalPage.properties || {};
          transversalCriteria = {
            must: getValue(tProps['Must']) as string || getValue(tProps['Must have']) as string || '',
            should: getValue(tProps['Should']) as string || getValue(tProps['Should have']) as string || '',
            niceToHave: getValue(tProps['Nice to have']) as string || getValue(tProps['Nice']) as string || '',
            context: getValue(tProps['Contexte']) as string || getValue(tProps['Context']) as string || '',
          };
        }
      } catch (e) {
        console.warn('[fetchNotionJobContext] Failed to fetch transversal criteria:', e);
      }
    }

    console.log(`[fetchNotionJobContext] Job ${jobId}: accompagnement=${JSON.stringify(accompagnement)}, hasTransversal=${!!transversalCriteria}`);

    // Resolve client from relation
    const clientRelationValue = getValue(props['Client']);
    let clientInfo: { name: string; sector: string } | null = null;
    
    if (Array.isArray(clientRelationValue) && clientRelationValue.length > 0) {
      clientInfo = await fetchClientFromRelation(clientRelationValue);
    } else if (typeof clientRelationValue === 'string' && clientRelationValue) {
      clientInfo = { name: clientRelationValue, sector: '' };
    }
    
    // Fallback to Entreprise property if Client not found
    if (!clientInfo?.name) {
      const entrepriseValue = getValue(props['Entreprise']);
      if (Array.isArray(entrepriseValue) && entrepriseValue.length > 0) {
        clientInfo = await fetchClientFromRelation(entrepriseValue);
      } else if (typeof entrepriseValue === 'string' && entrepriseValue) {
        clientInfo = { name: entrepriseValue, sector: '' };
      }
    }
    
    console.log(`[fetchNotionJobContext] Resolved client: ${JSON.stringify(clientInfo)}`);

    return {
      title,
      description: getValue(props['Description']),
      skills: getValue(props['Compétences']) || getValue(props['Skills']),
      location: getValue(props['Localisation']) || getValue(props['Location']),
      remote: getValue(props['Remote']) || getValue(props['Télétravail']),
      seniority: getValue(props['Séniorité']) || getValue(props['Seniority']),
      xpMin: getValue(props['XP Min']) || getValue(props['Expérience Min']),
      xpMax: getValue(props['XP Max']) || getValue(props['Expérience Max']),
      salaryMin: getValue(props['Salaire Min']) || getValue(props['Salary Min']),
      salaryMax: getValue(props['Salaire Max']) || getValue(props['Salary Max']),
      tjmMin: getValue(props['TJM Min']),
      tjmMax: getValue(props['TJM Max']),
      contractType: getValue(props['Type de contrat']) || getValue(props['Contract Type']),
      mustHave: getValue(props['Must have']) || getValue(props['Critères Must']),
      shouldHave: getValue(props['Should have']) || getValue(props['Critères Should']),
      niceToHave: getValue(props['Nice to have']) || getValue(props['Critères Nice']),
      accompagnement,
      transversalCriteria,
      client: clientInfo || {
        name: null,
        sector: getValue(props['Secteur']) || getValue(props['Sector']),
      },
    };
  } catch (err) {
    console.error('Failed to fetch Notion job:', err);
    return null;
  }
}
