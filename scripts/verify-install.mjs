import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

// Use only a trusted plugin directory. The manifest contains executable commands.
const root = resolve(process.argv[2] || 'plugin');
const manifest = JSON.parse(await readFile(resolve(root, '.codex-plugin/plugin.json'), 'utf8'));
const config = JSON.parse(await readFile(resolve(root, manifest.mcpServers), 'utf8')).mcpServers['canvas-lms'];
config.args = config.args.map(arg => arg.replaceAll('${CLAUDE_PLUGIN_ROOT}', root).replaceAll('${PLUGIN_ROOT}', root));
const transport = new StdioClientTransport({ ...config, stderr: 'pipe' });
const host = new Client({ name: 'canvas-install-verification', version: '1' });
try {
  await host.connect(transport);
  const tools = await host.listTools();
  const status = await host.callTool({ name: 'connection_status', arguments: {} });
  if (status.isError || !JSON.parse(status.content[0].text).connected) throw Error('Installed MCP connection is not configured. Complete local setup and retry.');
  const courses = await host.callTool({ name: 'list_courses', arguments: {} });
  if (courses.isError) throw Error('Installed MCP courses read failed.');
  console.log(JSON.stringify({ tools: tools.tools.length, connected: true, courseCount: JSON.parse(courses.content[0].text).courses.length }));
} finally { await host.close(); }
