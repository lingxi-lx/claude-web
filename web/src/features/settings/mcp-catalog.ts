import { tr } from '@/i18n';
// The connector directory's data: popular MCP servers with ready-to-use configs. Pure (no store, no React) — the
// settings page's list (McpCatalog.tsx) and the 扩展 page's directory (features/extensions/) both draw it.
export interface CatalogItem { id: string; name: string; desc: string; cat: string; json: Record<string, unknown>; env?: string[]; oauth?: boolean }

// Curated list modelled on Mirasim's MCP directory: popular stdio / http servers with ready-to-use configs.
export const MCP_CATALOG: CatalogItem[] = [
  { id: 'filesystem', name: 'Filesystem', desc: tr('读写指定目录'), cat: tr('本地'), json: { type: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', '.'] } },
  { id: 'memory', name: 'Memory', desc: tr('知识图谱式长期记忆'), cat: tr('本地'), json: { type: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-memory'] } },
  { id: 'sequential-thinking', name: 'Sequential Thinking', desc: tr('逐步推理'), cat: tr('本地'), json: { type: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-sequential-thinking'] } },
  { id: 'fetch', name: 'Fetch', desc: tr('抓网页转 markdown'), cat: tr('网络'), json: { type: 'stdio', command: 'uvx', args: ['mcp-server-fetch'] } },
  { id: 'puppeteer', name: 'Puppeteer', desc: tr('无头浏览器自动化'), cat: tr('网络'), json: { type: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-puppeteer'] } },
  { id: 'playwright', name: 'Playwright', desc: tr('微软官方浏览器自动化'), cat: tr('网络'), json: { type: 'stdio', command: 'npx', args: ['-y', '@playwright/mcp@latest'] } },
  { id: 'brave-search', name: 'Brave Search', desc: tr('网页搜索'), cat: tr('网络'), json: { type: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-brave-search'] }, env: ['BRAVE_API_KEY'] },
  { id: 'exa', name: 'Exa', desc: tr('AI 搜索'), cat: tr('网络'), json: { type: 'http', url: 'https://mcp.exa.ai/mcp' } },
  { id: 'context7', name: 'Context7', desc: tr('最新库文档'), cat: tr('开发'), json: { type: 'http', url: 'https://mcp.context7.com/mcp' } },
  { id: 'github', name: 'GitHub', desc: tr('仓库 / issue / PR'), cat: tr('开发'), json: { type: 'http', url: 'https://api.githubcopilot.com/mcp/' }, oauth: true },
  { id: 'gitlab', name: 'GitLab', desc: tr('项目 / MR / issue'), cat: tr('开发'), json: { type: 'stdio', command: 'npx', args: ['-y', '@zereight/mcp-gitlab'] }, env: ['GITLAB_API_URL', 'GITLAB_PERSONAL_ACCESS_TOKEN'] },
  { id: 'sentry', name: 'Sentry', desc: tr('错误监控'), cat: tr('开发'), json: { type: 'http', url: 'https://mcp.sentry.dev/mcp' }, oauth: true },
  { id: 'linear', name: 'Linear', desc: tr('任务管理'), cat: tr('协作'), json: { type: 'sse', url: 'https://mcp.linear.app/sse' }, oauth: true },
  { id: 'notion', name: 'Notion', desc: tr('页面 / 数据库'), cat: tr('协作'), json: { type: 'http', url: 'https://mcp.notion.com/mcp' }, oauth: true },
  { id: 'atlassian', name: 'Atlassian (Jira / Confluence)', desc: tr('Jira 与 Confluence'), cat: tr('协作'), json: { type: 'sse', url: 'https://mcp.atlassian.com/v1/sse' }, oauth: true },
  { id: 'slack', name: 'Slack', desc: tr('读写频道消息'), cat: tr('协作'), json: { type: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-slack'] }, env: ['SLACK_BOT_TOKEN', 'SLACK_TEAM_ID'] },
  { id: 'figma', name: 'Figma', desc: tr('设计稿转代码'), cat: tr('设计'), json: { type: 'http', url: 'https://mcp.figma.com/mcp' }, oauth: true },
  { id: 'postgres', name: 'PostgreSQL', desc: tr('只读查询'), cat: tr('数据'), json: { type: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-postgres', 'postgresql://localhost/db'] } },
  { id: 'sqlite', name: 'SQLite', desc: tr('本地数据库'), cat: tr('数据'), json: { type: 'stdio', command: 'uvx', args: ['mcp-server-sqlite', '--db-path', './data.db'] } },
  { id: 'supabase', name: 'Supabase', desc: tr('项目 / 表 / SQL'), cat: tr('数据'), json: { type: 'http', url: 'https://mcp.supabase.com/mcp' }, oauth: true },
  { id: 'stripe', name: 'Stripe', desc: tr('支付 API'), cat: tr('服务'), json: { type: 'http', url: 'https://mcp.stripe.com' }, oauth: true },
  { id: 'cloudflare', name: 'Cloudflare', desc: 'Workers / KV / R2', cat: tr('服务'), json: { type: 'sse', url: 'https://bindings.mcp.cloudflare.com/sse' }, oauth: true },
  { id: 'vercel', name: 'Vercel', desc: tr('部署 / 项目'), cat: tr('服务'), json: { type: 'http', url: 'https://mcp.vercel.com' }, oauth: true },
  { id: 'aws-docs', name: 'AWS Docs', desc: tr('AWS 文档检索'), cat: tr('服务'), json: { type: 'stdio', command: 'uvx', args: ['awslabs.aws-documentation-mcp-server@latest'] } },
  { id: 'docker', name: 'Docker', desc: tr('容器 / 镜像'), cat: tr('本地'), json: { type: 'stdio', command: 'uvx', args: ['docker-mcp'] } },
  { id: 'time', name: 'Time', desc: tr('时区换算'), cat: tr('本地'), json: { type: 'stdio', command: 'uvx', args: ['mcp-server-time'] } },
  { id: 'everything', name: tr('Everything (测试)'), desc: tr('演示所有 MCP 能力'), cat: tr('本地'), json: { type: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-everything'] } },
];
