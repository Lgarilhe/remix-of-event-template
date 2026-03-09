/**
 * Skill synonyms — used by client-side pre-scoring for fast, free, deterministic matching.
 *
 * IMPORTANT: This dictionary is a heuristic for the pre-score (client-side, instantaneous).
 * The definitive skill matching happens server-side via LLM (Claude) which understands
 * synonyms, related skills, and context natively — no dictionary needed.
 *
 * The backend (score-profile-job) has a copy of this dictionary for its hard-filter
 * and pre-computation steps only. Keep both in sync when editing.
 */
export const SKILL_SYNONYMS: Record<string, string[]> = {
  // ─── Languages & Frameworks ─────────────────────────────────────────
  'javascript': ['js', 'ecmascript', 'es6', 'es2015', 'es2020'],
  'typescript': ['ts'],
  'python': ['py', 'python3', 'pyspark'],
  'java': ['jvm', 'spring', 'spring boot', 'j2ee', 'jee', 'hibernate'],
  'c#': ['csharp', '.net', 'dotnet', 'asp.net'],
  'c++': ['cpp', 'c plus plus'],
  'c': ['langage c'],
  'go': ['golang'],
  'rust': ['rustlang'],
  'ruby': ['rails', 'ruby on rails', 'ror'],
  'php': ['laravel', 'symfony', 'wordpress'],
  'swift': ['ios development', 'swiftui'],
  'kotlin': ['android development', 'jetpack compose'],
  'scala': ['akka', 'play framework'],
  'r': ['rstudio', 'r language'],
  'dart': ['flutter'],
  'elixir': ['phoenix framework'],
  'perl': ['perl5', 'perl6'],
  'lua': ['luajit'],
  'vba': ['visual basic', 'excel macro'],
  'cobol': ['mainframe programming'],
  'abap': ['sap abap'],

  // ─── Frontend ───────────────────────────────────────────────────────
  'react': ['reactjs', 'react.js', 'react native', 'rn'],
  'vue': ['vuejs', 'vue.js', 'nuxt', 'nuxtjs'],
  'angular': ['angularjs', 'angular.js'],
  'next.js': ['nextjs', 'next'],
  'svelte': ['sveltekit'],
  'tailwind': ['tailwindcss'],
  'sass': ['scss', 'less'],
  'html': ['html5'],
  'css': ['css3', 'stylesheets'],
  'webpack': ['vite', 'bundler', 'esbuild', 'rollup'],
  'figma': ['ui design', 'sketch', 'adobe xd'],

  // ─── Backend & API ──────────────────────────────────────────────────
  'node': ['nodejs', 'node.js', 'express', 'fastify', 'nestjs'],
  'api': ['rest api', 'restful', 'api rest'],
  'graphql': ['graph ql', 'apollo graphql'],
  'grpc': ['protocol buffers', 'protobuf'],
  'microservices': ['micro-services', 'architecture microservices', 'soa'],
  'websocket': ['socket.io', 'ws', 'real-time'],

  // ─── Databases ──────────────────────────────────────────────────────
  'postgres': ['postgresql', 'psql', 'pg'],
  'mysql': ['mariadb'],
  'sql': ['sql server', 'mssql', 'tsql', 'plsql', 'pl/sql'],
  'sqlite': ['sqlite3'],
  'mongodb': ['mongo', 'mongoose'],
  'redis': ['redis cache', 'redis cluster'],
  'elasticsearch': ['elastic', 'elastic search', 'opensearch'],
  'cassandra': ['apache cassandra', 'scylladb'],
  'dynamodb': ['dynamo db', 'aws dynamodb'],
  'neo4j': ['graph database', 'base graphe'],
  'oracle': ['oracle db', 'oracle database', 'oracle sql'],

  // ─── Cloud Providers ────────────────────────────────────────────────
  'aws': ['amazon web services', 'amazon aws'],
  'azure': ['microsoft azure', 'azure cloud'],
  'gcp': ['google cloud', 'google cloud platform'],
  'ovh': ['ovhcloud'],
  'scaleway': ['scaleway cloud'],

  // ─── Cloud Services (AWS) ───────────────────────────────────────────
  'ec2': ['elastic compute', 'amazon ec2'],
  's3': ['amazon s3', 'simple storage service'],
  'lambda': ['aws lambda', 'serverless aws'],
  'cloudformation': ['aws cloudformation', 'cfn'],
  'cdk': ['aws cdk', 'cloud development kit'],
  'eks': ['elastic kubernetes service', 'aws eks'],
  'ecs': ['elastic container service', 'aws ecs'],
  'fargate': ['aws fargate'],
  'rds': ['amazon rds', 'aws rds'],
  'sqs': ['amazon sqs', 'simple queue service'],
  'sns': ['amazon sns'],
  'cloudwatch': ['aws cloudwatch'],
  'iam': ['aws iam', 'identity access management'],

  // ─── Cloud Services (Azure) ─────────────────────────────────────────
  'aks': ['azure kubernetes service'],
  'azure devops': ['azure pipelines', 'azure boards'],
  'bicep': ['arm templates', 'azure resource manager'],
  'azure functions': ['azure serverless'],

  // ─── Cloud Services (GCP) ───────────────────────────────────────────
  'gke': ['google kubernetes engine'],
  'cloud run': ['google cloud run'],
  'bigquery': ['google bigquery', 'bq'],
  'cloud functions': ['google cloud functions'],

  // ─── Virtualisation ─────────────────────────────────────────────────
  'vmware': ['vsphere', 'esxi', 'vcenter', 'vsan', 'nsx', 'vmware vsphere'],
  'hyper-v': ['hyperv', 'hyper v', 'microsoft hyper-v'],
  'kvm': ['qemu', 'libvirt'],
  'proxmox': ['proxmox ve'],
  'openstack': ['open stack'],
  'nutanix': ['nutanix ahv', 'acropolis'],
  'citrix': ['xenserver', 'xenapp', 'xendesktop', 'citrix virtual apps'],
  'virtualisation': ['virtualization', 'hyperviseur', 'hypervisor'],

  // ─── Containers & Orchestration ─────────────────────────────────────
  'docker': ['containers', 'containerization', 'containerd', 'containerisation'],
  'kubernetes': ['k8s', 'kube', 'container orchestration'],
  'helm': ['helm charts', 'helm chart'],
  'istio': ['service mesh', 'envoy proxy'],
  'openshift': ['red hat openshift', 'ocp'],
  'rancher': ['rancher kubernetes'],
  'podman': ['buildah'],
  'docker compose': ['docker-compose', 'compose'],

  // ─── IaC & Config Management ────────────────────────────────────────
  'terraform': ['iac', 'infrastructure as code', 'terragrunt', 'opentofu'],
  'ansible': ['configuration management', 'ansible playbook'],
  'puppet': ['puppet enterprise'],
  'chef': ['chef infra', 'chef automate'],
  'saltstack': ['salt', 'salt project'],
  'packer': ['hashicorp packer', 'machine images'],
  'vagrant': ['hashicorp vagrant'],
  'pulumi': ['pulumi iac'],

  // ─── CI/CD & DevOps ─────────────────────────────────────────────────
  'ci/cd': ['cicd', 'continuous integration', 'continuous deployment', 'continuous delivery'],
  'devops': ['dev ops', 'sre', 'site reliability', 'platform engineering'],
  'jenkins': ['ci server', 'jenkins pipeline'],
  'gitlab': ['gitlab ci', 'gitlab ci/cd'],
  'github actions': ['gh actions', 'github workflows'],
  'argocd': ['argo cd', 'gitops'],
  'circleci': ['circle ci'],
  'travis': ['travis ci'],
  'azure pipelines': ['azure devops pipelines'],
  'bamboo': ['atlassian bamboo'],
  'tekton': ['tekton pipelines'],

  // ─── Networking ─────────────────────────────────────────────────────
  'cisco': ['ios', 'nexus', 'catalyst', 'cisco systems'],
  'juniper': ['junos', 'juniper networks'],
  'arista': ['arista networks', 'arista eos'],
  'networking': ['network', 'réseau', 'réseaux', 'network engineer'],
  'bgp': ['border gateway protocol'],
  'ospf': ['open shortest path first'],
  'mpls': ['multiprotocol label switching'],
  'vlan': ['virtual lan', '802.1q'],
  'sd-wan': ['sdwan', 'software defined wan'],
  'meraki': ['cisco meraki'],
  'tcp/ip': ['tcp ip', 'protocoles réseau', 'network protocols'],
  'dns': ['bind', 'domain name system', 'powerdns'],
  'dhcp': ['dynamic host configuration'],
  'ipam': ['ip address management', 'infoblox'],
  'vpn': ['virtual private network', 'ipsec', 'openvpn', 'wireguard'],
  'wifi': ['wlan', 'wireless', 'wi-fi', '802.11'],

  // ─── Security ───────────────────────────────────────────────────────
  'cybersecurity': ['cybersécurité', 'infosec', 'information security', 'sécurité informatique'],
  'firewall': ['pare-feu', 'fw'],
  'palo alto': ['palo alto networks', 'pan-os', 'panorama'],
  'fortinet': ['fortigate', 'fortios', 'fortimanager'],
  'checkpoint': ['check point', 'check point firewall'],
  'zscaler': ['zscaler zpa', 'zscaler zia', 'zero trust network'],
  'sophos': ['sophos xg', 'sophos utm'],
  'waf': ['web application firewall', 'modsecurity'],
  'siem': ['security information', 'splunk siem', 'qradar', 'sentinel'],
  'soc': ['security operations center', 'centre opérationnel de sécurité'],
  'sase': ['secure access service edge'],
  'zero trust': ['zero trust architecture', 'ztna'],
  'ids': ['intrusion detection', 'ips', 'intrusion prevention', 'snort', 'suricata'],
  'pentest': ['penetration testing', 'test intrusion', 'ethical hacking', 'bug bounty'],
  'iso 27001': ['iso27001', 'smsi', 'isms'],
  'rgpd': ['gdpr', 'data protection', 'protection des données'],

  // ─── Load Balancing & Reverse Proxy ─────────────────────────────────
  'f5': ['big-ip', 'f5 networks', 'f5 big-ip', 'ltm', 'gtm'],
  'haproxy': ['ha proxy'],
  'nginx': ['nginx plus', 'reverse proxy'],
  'traefik': ['traefik proxy'],
  'citrix adc': ['netscaler', 'citrix netscaler'],
  'load balancing': ['load balancer', 'répartition de charge'],

  // ─── Monitoring & Observability ─────────────────────────────────────
  'nagios': ['nagios xi', 'centreon'],
  'zabbix': ['zabbix monitoring'],
  'datadog': ['dd', 'datadog agent'],
  'new relic': ['newrelic'],
  'splunk': ['splunk enterprise'],
  'grafana': ['grafana dashboards'],
  'prometheus': ['prom', 'promql'],
  'elk': ['elk stack', 'logstash', 'kibana', 'elastic stack'],
  'dynatrace': ['dynatrace oneagent'],
  'appdynamics': ['cisco appdynamics'],
  'pagerduty': ['incident management'],

  // ─── Storage & Backup ──────────────────────────────────────────────
  'netapp': ['ontap', 'netapp ontap'],
  'dell emc': ['emc', 'dell storage', 'powerstore', 'unity'],
  'pure storage': ['purestorage', 'flasharray'],
  'ceph': ['ceph storage', 'rados'],
  'minio': ['min.io', 's3-compatible storage'],
  'san': ['storage area network', 'fibre channel', 'iscsi'],
  'nas': ['network attached storage', 'nfs', 'smb', 'cifs'],
  'veeam': ['veeam backup'],
  'commvault': ['commvault backup'],
  'veritas': ['veritas netbackup', 'backup exec'],
  'zfs': ['openzfs'],

  // ─── OS & Systems ──────────────────────────────────────────────────
  'linux': ['unix', 'rhel', 'ubuntu', 'debian', 'centos', 'rocky linux', 'alma linux', 'gnu/linux'],
  'windows server': ['active directory', 'ad', 'gpo', 'wsus', 'sccm'],
  'suse': ['sles', 'opensuse'],
  'solaris': ['oracle solaris', 'sunos'],
  'aix': ['ibm aix'],
  'freebsd': ['bsd'],
  'shell': ['bash', 'zsh', 'scripting', 'powershell', 'script shell'],

  // ─── ITSM & Governance ─────────────────────────────────────────────
  'servicenow': ['snow', 'service-now'],
  'itil': ['itil v3', 'itil v4', 'gestion des services'],
  'cmdb': ['configuration management database'],
  'jira': ['atlassian jira', 'jira service management'],
  'confluence': ['atlassian confluence'],

  // ─── Data Engineering & BI ──────────────────────────────────────────
  'data engineering': ['data pipeline', 'etl', 'elt', 'data platform', 'ingénierie des données'],
  'spark': ['apache spark', 'pyspark', 'spark streaming'],
  'airflow': ['apache airflow', 'dag', 'orchestration données'],
  'dbt': ['data build tool'],
  'kafka': ['event streaming', 'message queue', 'apache kafka', 'confluent'],
  'rabbitmq': ['message broker', 'amqp'],
  'snowflake': ['snowflake db', 'snowflake data cloud'],
  'databricks': ['lakehouse', 'delta lake'],
  'tableau': ['data visualization', 'dataviz'],
  'power bi': ['powerbi', 'power b.i.'],
  'looker': ['looker studio', 'google data studio'],
  'qlik': ['qlikview', 'qlik sense'],
  'sas': ['sas analytics', 'sas institute'],
  'talend': ['talend etl'],
  'informatica': ['informatica powercenter'],

  // ─── Machine Learning & AI ──────────────────────────────────────────
  'machine learning': ['ml', 'deep learning', 'ai', 'artificial intelligence', 'intelligence artificielle'],
  'tensorflow': ['tf', 'keras'],
  'pytorch': ['torch'],
  'nlp': ['natural language processing', 'traitement du langage naturel'],
  'computer vision': ['vision par ordinateur', 'opencv'],
  'llm': ['large language model', 'gpt', 'chatgpt', 'claude', 'gemini'],
  'mlops': ['ml ops', 'mlflow', 'kubeflow'],
  'data science': ['science des données', 'data scientist'],

  // ─── Agile & Project Management ─────────────────────────────────────
  'agile': ['scrum', 'kanban', 'safe', 'lean agile'],
  'pmp': ['project management professional', 'gestion de projet'],
  'prince2': ['prince 2'],
  'product management': ['product owner', 'po', 'gestion produit'],
  'scrum master': ['sm'],

  // ─── ERP & Business Software ────────────────────────────────────────
  'sap': ['sap erp', 'sap hana', 'sap s/4hana', 'sap fi/co', 'sap mm', 'sap sd'],
  'oracle erp': ['oracle ebs', 'oracle e-business suite'],
  'salesforce': ['sfdc', 'salesforce crm', 'salesforce lightning'],
  'hubspot': ['hubspot crm', 'hubspot marketing'],
  'dynamics 365': ['microsoft dynamics', 'dynamics crm'],
  'workday': ['workday hcm'],
  'sap successfactors': ['successfactors', 'sf'],

  // ─── Marketing & Digital ───────────────────────────────────────────
  'seo': ['search engine optimization', 'référencement naturel', 'référencement'],
  'sea': ['search engine advertising', 'google ads', 'adwords', 'référencement payant'],
  'sem': ['search engine marketing'],
  'social media': ['réseaux sociaux', 'community management', 'social media marketing'],
  'marketing automation': ['marketo', 'pardot', 'mailchimp', 'sendinblue', 'brevo'],
  'google analytics': ['ga4', 'analytics', 'web analytics'],
  'growth hacking': ['growth marketing', 'acquisition'],
  'crm': ['customer relationship management', 'gestion relation client'],
  'emailing': ['email marketing', 'newsletter'],

  // ─── Finance & Accounting ──────────────────────────────────────────
  'comptabilité': ['accounting', 'comptable', 'accountant'],
  'ifrs': ['normes ifrs', 'international financial reporting'],
  'contrôle de gestion': ['management control', 'controlling', 'contrôleur de gestion'],
  'audit financier': ['financial audit', 'commissariat aux comptes', 'cac'],
  'bloomberg': ['bloomberg terminal'],
  'reuters': ['refinitiv', 'thomson reuters'],
  'fix protocol': ['fix', 'financial information exchange'],
  'actuariat': ['actuary', 'actuaire', 'actuarial science'],
  'trésorerie': ['treasury', 'cash management'],
  'risk management': ['gestion des risques', 'risk manager'],
  'kyc': ['know your customer', 'aml', 'anti money laundering', 'lcb-ft'],

  // ─── HR ─────────────────────────────────────────────────────────────
  'sirh': ['hris', 'human resource information system'],
  'paie': ['payroll', 'gestion paie'],
  'adp': ['adp paie', 'adp decidium'],
  'gestion des talents': ['talent management', 'talent acquisition'],
  'formation': ['training', 'l&d', 'learning and development'],
  'recrutement': ['recruitment', 'sourcing', 'talent acquisition'],

  // ─── Supply Chain & Logistics ──────────────────────────────────────
  'supply chain': ['chaîne d\'approvisionnement', 'supply chain management', 'scm'],
  'wms': ['warehouse management system', 'gestion d\'entrepôt'],
  'tms': ['transport management system', 'gestion transport'],
  'procurement': ['achats', 'purchasing', 'sourcing achats'],
  's&op': ['sales and operations planning', 'plan industriel et commercial'],
  'lean': ['lean management', 'lean manufacturing', 'kaizen', 'six sigma'],

  // ─── Engineering & BTP ─────────────────────────────────────────────
  'autocad': ['auto cad', 'autodesk autocad'],
  'revit': ['autodesk revit'],
  'bim': ['building information modeling', 'maquette numérique'],
  'solidworks': ['solid works', 'dassault solidworks'],
  'catia': ['dassault catia'],
  'creo': ['ptc creo', 'pro/engineer'],

  // ─── Legal & Compliance ────────────────────────────────────────────
  'droit des affaires': ['business law', 'corporate law'],
  'compliance': ['conformité', 'regulatory compliance'],
  'contentieux': ['litigation', 'litige'],
  'propriété intellectuelle': ['intellectual property', 'ip', 'pi', 'brevets', 'patents'],
  'droit du travail': ['employment law', 'labor law'],
  'dpo': ['data protection officer', 'délégué protection données'],

  // ─── Healthcare & Life Sciences ────────────────────────────────────
  'hl7': ['health level 7', 'hl7 fhir'],
  'fhir': ['fast healthcare interoperability'],
  'dicom': ['medical imaging', 'imagerie médicale'],
  'his': ['hospital information system', 'système information hospitalier'],
  'pharmacovigilance': ['pharma vigilance', 'drug safety'],
  'essais cliniques': ['clinical trials', 'clinical research'],

  // ─── Certifications ────────────────────────────────────────────────
  'ccna': ['cisco certified network associate'],
  'ccnp': ['cisco certified network professional'],
  'ccie': ['cisco certified internetwork expert'],
  'aws saa': ['aws solutions architect', 'solutions architect associate'],
  'aws sap': ['aws solutions architect professional'],
  'az-104': ['azure administrator'],
  'az-305': ['azure solutions architect'],
  'vcp': ['vmware certified professional'],
  'cka': ['certified kubernetes administrator'],
  'ckad': ['certified kubernetes application developer'],
  'cissp': ['certified information systems security'],
  'ceh': ['certified ethical hacker'],
  'oscp': ['offensive security certified professional'],
};

/** Check if two skill strings match (including synonyms). Uses word-boundary matching. */
export function skillsMatch(a: string, b: string): boolean {
  const la = a.toLowerCase().trim();
  const lb = b.toLowerCase().trim();
  if (la === lb) return true;

  // For skills >= 3 chars, use word-boundary matching to avoid false positives
  // (e.g. "go" matching "django")
  if (la.length >= 3 && lb.length >= 3) {
    const escRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const aRe = new RegExp(`\\b${escRe(la)}\\b`, 'i');
    const bRe = new RegExp(`\\b${escRe(lb)}\\b`, 'i');
    if (aRe.test(lb) || bRe.test(la)) return true;
  } else {
    // Short skills (< 3 chars): exact match only
    if (la === lb) return true;
  }

  // Check synonym groups
  for (const [canonical, synonyms] of Object.entries(SKILL_SYNONYMS)) {
    const all = [canonical, ...synonyms];
    const aMatches = all.some(v => {
      if (v.length >= 3 && la.length >= 3) {
        const escRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return new RegExp(`\\b${escRe(v)}\\b`, 'i').test(la) || new RegExp(`\\b${escRe(la)}\\b`, 'i').test(v);
      }
      return v === la;
    });
    const bMatches = all.some(v => {
      if (v.length >= 3 && lb.length >= 3) {
        const escRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return new RegExp(`\\b${escRe(v)}\\b`, 'i').test(lb) || new RegExp(`\\b${escRe(lb)}\\b`, 'i').test(v);
      }
      return v === lb;
    });
    if (aMatches && bMatches) return true;
  }

  return false;
}
