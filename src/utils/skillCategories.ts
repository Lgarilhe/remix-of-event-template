// Skill categorization with colors

export type SkillCategory = 'frontend' | 'backend' | 'devops' | 'data' | 'mobile' | 'design' | 'other';

interface CategoryConfig {
  label: string;
  bgColor: string;
  textColor: string;
  borderColor: string;
}

export const SKILL_CATEGORIES: Record<SkillCategory, CategoryConfig> = {
  frontend: {
    label: 'Frontend',
    bgColor: 'bg-info/10',
    textColor: 'text-info',
    borderColor: 'border-info/30',
  },
  backend: {
    label: 'Backend',
    bgColor: 'bg-success/10',
    textColor: 'text-success',
    borderColor: 'border-success/30',
  },
  devops: {
    label: 'DevOps',
    bgColor: 'bg-warning/10',
    textColor: 'text-warning',
    borderColor: 'border-warning/30',
  },
  data: {
    label: 'Data',
    bgColor: 'bg-brand-purple/10',
    textColor: 'text-brand-purple',
    borderColor: 'border-brand-purple/30',
  },
  mobile: {
    label: 'Mobile',
    bgColor: 'bg-brand-pink/10',
    textColor: 'text-brand-pink',
    borderColor: 'border-brand-pink/30',
  },
  design: {
    label: 'Design',
    bgColor: 'bg-brand-pink/10',
    textColor: 'text-brand-pink',
    borderColor: 'border-brand-pink/30',
  },
  other: {
    label: 'Autre',
    bgColor: 'bg-muted',
    textColor: 'text-muted-foreground',
    borderColor: 'border-border',
  },
};

// Keywords mapping for skill categorization
const SKILL_KEYWORDS: Record<SkillCategory, string[]> = {
  frontend: [
    'react', 'vue', 'angular', 'javascript', 'typescript', 'html', 'css', 'sass', 'scss', 
    'tailwind', 'next', 'nuxt', 'svelte', 'webpack', 'vite', 'redux', 'mobx', 'jquery',
    'bootstrap', 'material-ui', 'mui', 'chakra', 'styled-components', 'emotion', 'gatsby',
    'remix', 'astro', 'frontend', 'front-end', 'front end', 'web components', 'pwa',
    'responsive', 'accessibility', 'a11y', 'storybook', 'jest', 'cypress', 'playwright',
    'figma to code', 'pixel perfect'
  ],
  backend: [
    'node', 'nodejs', 'express', 'nestjs', 'fastify', 'python', 'django', 'flask', 'fastapi',
    'java', 'spring', 'springboot', 'kotlin', 'scala', 'ruby', 'rails', 'php', 'laravel',
    'symfony', 'go', 'golang', 'rust', 'c#', 'csharp', '.net', 'dotnet', 'asp.net',
    'graphql', 'rest', 'api', 'microservices', 'backend', 'back-end', 'back end',
    'postgresql', 'postgres', 'mysql', 'mariadb', 'mongodb', 'redis', 'elasticsearch',
    'rabbitmq', 'kafka', 'sql', 'nosql', 'prisma', 'typeorm', 'sequelize', 'hibernate',
    'grpc', 'websocket', 'oauth', 'jwt', 'authentication', 'authorization'
  ],
  devops: [
    'docker', 'kubernetes', 'k8s', 'aws', 'azure', 'gcp', 'google cloud', 'terraform',
    'ansible', 'jenkins', 'gitlab', 'github actions', 'ci/cd', 'cicd', 'devops',
    'linux', 'unix', 'bash', 'shell', 'nginx', 'apache', 'prometheus', 'grafana',
    'datadog', 'new relic', 'splunk', 'elk', 'logstash', 'kibana', 'helm', 'argocd',
    'istio', 'envoy', 'cloudflare', 'cdn', 'load balancer', 'vpc', 'networking',
    'security', 'sre', 'infrastructure', 'iac', 'serverless', 'lambda', 'cloud functions'
  ],
  data: [
    'python', 'pandas', 'numpy', 'scipy', 'scikit-learn', 'sklearn', 'tensorflow',
    'pytorch', 'keras', 'machine learning', 'ml', 'deep learning', 'dl', 'ai',
    'artificial intelligence', 'nlp', 'computer vision', 'data science', 'data engineering',
    'spark', 'hadoop', 'hive', 'airflow', 'dbt', 'etl', 'elt', 'data warehouse',
    'bigquery', 'snowflake', 'redshift', 'databricks', 'tableau', 'power bi', 'looker',
    'metabase', 'analytics', 'statistics', 'r', 'julia', 'data mining', 'data analyst',
    'data scientist', 'mlops', 'feature engineering', 'a/b testing'
  ],
  mobile: [
    'ios', 'android', 'swift', 'swiftui', 'objective-c', 'kotlin', 'java', 'react native',
    'flutter', 'dart', 'xamarin', 'cordova', 'ionic', 'capacitor', 'expo', 'mobile',
    'app store', 'play store', 'push notifications', 'mobile ui', 'responsive design',
    'pwa', 'hybrid app', 'native app', 'cross-platform'
  ],
  design: [
    'figma', 'sketch', 'adobe xd', 'photoshop', 'illustrator', 'indesign', 'after effects',
    'ui', 'ux', 'ui/ux', 'user interface', 'user experience', 'design system', 'prototyping',
    'wireframe', 'mockup', 'branding', 'typography', 'color theory', 'animation',
    'motion design', 'graphic design', 'web design', 'product design', 'visual design',
    'interaction design', 'design thinking', 'usability', 'user research', 'persona'
  ],
  other: [],
};

export function categorizeSkill(skill: string): SkillCategory {
  const normalizedSkill = skill.toLowerCase().trim();
  
  // Check each category's keywords
  for (const [category, keywords] of Object.entries(SKILL_KEYWORDS)) {
    if (category === 'other') continue;
    
    for (const keyword of keywords) {
      if (normalizedSkill.includes(keyword) || keyword.includes(normalizedSkill)) {
        return category as SkillCategory;
      }
    }
  }
  
  return 'other';
}

export function getSkillStyles(skill: string): CategoryConfig {
  const category = categorizeSkill(skill);
  return SKILL_CATEGORIES[category];
}
