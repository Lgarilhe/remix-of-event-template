/**
 * Skill synonyms — single source of truth.
 * Used by client-side pre-scoring and edge function score-profile-job.
 */
export const SKILL_SYNONYMS: Record<string, string[]> = {
  'kubernetes': ['k8s', 'kube', 'container orchestration'],
  'javascript': ['js', 'ecmascript', 'es6', 'es2015'],
  'typescript': ['ts'],
  'python': ['py', 'python3', 'pyspark'],
  'react': ['reactjs', 'react.js'],
  'vue': ['vuejs', 'vue.js'],
  'angular': ['angularjs', 'angular.js'],
  'node': ['nodejs', 'node.js'],
  'postgres': ['postgresql', 'psql', 'pg'],
  'mongodb': ['mongo'],
  'redis': ['redis cache'],
  'elasticsearch': ['elastic', 'es'],
  'docker': ['containers', 'containerization', 'containerd'],
  'aws': ['amazon web services', 'amazon aws'],
  'gcp': ['google cloud', 'google cloud platform'],
  'azure': ['microsoft azure'],
  'ci/cd': ['cicd', 'continuous integration', 'continuous deployment', 'devops'],
  'machine learning': ['ml', 'deep learning', 'ai', 'artificial intelligence'],
  'api': ['rest api', 'restful', 'graphql'],
  'agile': ['scrum', 'kanban'],
  'sql': ['mysql', 'mariadb', 'sqlite'],
  'java': ['jvm', 'spring', 'spring boot'],
  'go': ['golang'],
  'rust': ['rustlang'],
  'terraform': ['iac', 'infrastructure as code'],
  'kafka': ['event streaming', 'message queue'],
  'rabbitmq': ['message broker', 'amqp'],
  'data engineering': ['data pipeline', 'etl', 'elt', 'data platform'],
  'spark': ['apache spark', 'pyspark'],
  'airflow': ['apache airflow', 'dag'],
  'dbt': ['data build tool'],
  'snowflake': ['snowflake db'],
  'databricks': ['lakehouse'],
  'tableau': ['data visualization', 'dataviz'],
  'power bi': ['powerbi'],
  'linux': ['unix', 'rhel', 'ubuntu', 'debian'],
  'networking': ['network', 'réseau', 'sdn'],
  'security': ['cybersecurity', 'infosec', 'sécurité'],
  'ansible': ['configuration management'],
  'jenkins': ['ci server'],
  'gitlab': ['gitlab ci'],
  'github actions': ['gh actions'],
  'figma': ['ui design'],
  'next.js': ['nextjs', 'next'],
  'tailwind': ['tailwindcss'],
  'sass': ['scss'],
  'c++': ['cpp'],
  'c#': ['csharp', '.net', 'dotnet'],
  'php': ['laravel', 'symfony'],
  'ruby': ['rails', 'ruby on rails'],
  'swift': ['ios development'],
  'kotlin': ['android development'],
  'flutter': ['dart'],
  'react native': ['rn', 'mobile development'],
};

/** Check if two skill strings match (including synonyms). */
export function skillsMatch(a: string, b: string): boolean {
  const la = a.toLowerCase().trim();
  const lb = b.toLowerCase().trim();
  if (la === lb) return true;
  if (la.includes(lb) || lb.includes(la)) return true;
  for (const [canonical, synonyms] of Object.entries(SKILL_SYNONYMS)) {
    const all = [canonical, ...synonyms];
    if (all.some(v => la.includes(v) || v.includes(la)) && all.some(v => lb.includes(v) || v.includes(lb))) {
      return true;
    }
  }
  return false;
}
