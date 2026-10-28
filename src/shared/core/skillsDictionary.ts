/**
 * A compact dictionary of common skills used to spot skills in free text locally (no AI).
 * Multi-word and symbol-containing entries are matched case-insensitively on word boundaries.
 */
export const KNOWN_SKILLS = [
  // Languages
  'JavaScript', 'TypeScript', 'Python', 'Java', 'Kotlin', 'Swift', 'Objective-C', 'C', 'C++', 'C#', 'Go', 'Golang',
  'Rust', 'Ruby', 'PHP', 'Scala', 'R', 'MATLAB', 'SQL', 'Bash', 'Shell', 'Perl', 'Dart', 'Elixir', 'Haskell', 'Lua',
  // Web & mobile
  'React', 'React Native', 'Next.js', 'Vue', 'Angular', 'Svelte', 'Redux', 'HTML', 'CSS', 'Tailwind', 'Sass',
  'Node.js', 'Express', 'NestJS', 'Django', 'Flask', 'FastAPI', 'Spring', 'Spring Boot', 'Rails', 'Laravel', '.NET',
  'ASP.NET', 'GraphQL', 'REST', 'gRPC', 'WebSockets', 'Electron', 'Flutter', 'SwiftUI', 'iOS', 'Android',
  // Data & ML
  'PostgreSQL', 'MySQL', 'SQLite', 'MongoDB', 'Redis', 'Cassandra', 'DynamoDB', 'Elasticsearch', 'Snowflake',
  'BigQuery', 'Redshift', 'Spark', 'Hadoop', 'Kafka', 'Airflow', 'dbt', 'Pandas', 'NumPy', 'scikit-learn',
  'TensorFlow', 'PyTorch', 'Keras', 'Machine Learning', 'Deep Learning', 'NLP', 'Computer Vision', 'LLM',
  'Data Analysis', 'Data Engineering', 'ETL', 'Tableau', 'Power BI', 'Excel', 'Statistics', 'A/B Testing',
  // Cloud & DevOps
  'AWS', 'Azure', 'GCP', 'Google Cloud', 'Docker', 'Kubernetes', 'Terraform', 'Ansible', 'Jenkins',
  'GitHub Actions', 'CI/CD', 'Linux', 'Serverless', 'Lambda', 'Microservices', 'Prometheus', 'Grafana',
  'Datadog', 'Nginx', 'Git',
  // Practices
  'System Design', 'Distributed Systems', 'Agile', 'Scrum', 'Kanban', 'TDD', 'Unit Testing', 'Jest', 'Cypress',
  'Playwright', 'Selenium', 'Security', 'OAuth', 'Accessibility', 'Performance Optimization', 'Product Management',
  'Project Management', 'Stakeholder Management', 'Leadership', 'Mentoring', 'Figma', 'UX', 'UI Design',
  'Jira', 'Salesforce', 'SAP', 'Communication',
];

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const SKILL_PATTERNS = KNOWN_SKILLS.map((skill) => ({
  skill,
  // Custom boundaries so "C++", "C#", ".NET" and "Node.js" match correctly.
  pattern: new RegExp(`(^|[^A-Za-z0-9+#])${escapeRegExp(skill)}(?=$|[^A-Za-z0-9+#])`, skill.length <= 2 ? '' : 'i'),
}));

export function findKnownSkills(text: string): string[] {
  const found: string[] = [];
  for (const { skill, pattern } of SKILL_PATTERNS) {
    if (pattern.test(text)) found.push(skill);
  }
  // "Go" and "R" are too ambiguous on their own; only accept them in skill lists.
  return found.filter((skill) => skill !== 'Go' && skill !== 'R' && skill !== 'C');
}
