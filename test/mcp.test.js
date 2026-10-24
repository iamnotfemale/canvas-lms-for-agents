import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createServer } from '../src/server.js';
import { FileCache } from '../src/cache.js';
import { fakeFiles } from './fixtures.js';

test('SDK tool calls index full document, return images and reject invalid input', async t => {
  const root = await mkdtemp(join(tmpdir(), 'canvas-mcp-')); t.after(() => rm(root, { recursive: true, force: true }));
  const client = fakeFiles(), cache = new FileCache(root, '1');
  const server = createServer({ service: { client, cache } });
  const host = new Client({ name: 'test', version: '1' });
  const [a, b] = InMemoryTransport.createLinkedPair(); await server.connect(a); await host.connect(b);
  t.after(async () => { await host.close(); await server.close(); });
  assert.equal((await host.listTools()).tools.length, 11);
  const indexed = await host.callTool({ name: 'index_pdf', arguments: { resourceId: 'file:1:3' } });
  assert.equal(indexed.isError, undefined); assert.equal(JSON.parse(indexed.content[0].text).totalPages, 2);
  const rendered = await host.callTool({ name: 'render_pdf_page', arguments: { resourceId: 'file:1:3', page: 2 } });
  assert.equal(rendered.content[1].type, 'image'); assert.equal(client.downloads, 1);
  const invalid = await host.callTool({ name: 'read_pdf', arguments: { resourceId: '../../private' } });
  assert.equal(invalid.isError, true);
});
test('real stdio launcher initializes without credentials and offers local setup', async t => {
  const root = await mkdtemp(join(tmpdir(), 'canvas-stdio-')); t.after(() => rm(root, { recursive: true, force: true }));
  const env = { ...process.env, CANVAS_AGENT_CONFIG_DIR: root, CANVAS_AGENT_NO_BROWSER: '1' }; delete env.CANVAS_TOKEN;
  const transport = new StdioClientTransport({ command: process.execPath, args: ['plugin/scripts/launch.mjs'], env, stderr: 'pipe' });
  const host = new Client({ name: 'stdio-test', version: '1' });
  t.after(() => host.close()); await host.connect(transport);
  assert.equal((await host.listTools()).tools.length, 11);
  const result = await host.callTool({ name: 'connection_status', arguments: {} });
  assert.equal(result.isError, undefined); assert.equal(JSON.parse(result.content[0].text).setupRequired, true);
});

for (const kind of ['claude', 'codex', 'codex-legacy']) test(`copied ${kind} plugin boots without clone, node_modules or user settings`, async t => {
  const root = await mkdtemp(join(tmpdir(), 'canvas-manifest-'));
  const version=JSON.parse(await readFile('package.json','utf8')).version;
  const copied = kind === 'codex-legacy' ? join(root,'plugins/cache/canvas-lms-for-agents/canvas-lms-for-agents',version) : join(root, 'standalone');
  await cp('plugin', copied, { recursive:true });
  const config = JSON.parse(await readFile(kind === 'claude' ? 'plugin/.mcp.json' : 'plugin/.mcp.codex.json', 'utf8')).mcpServers['canvas-lms'];
  if (kind !== 'codex-legacy') config.args = config.args.map(arg => arg.replaceAll('${CLAUDE_PLUGIN_ROOT}', copied).replaceAll('${PLUGIN_ROOT}', copied));
  const env = { ...process.env, CODEX_HOME:root, CANVAS_AGENT_CONFIG_DIR: join(root, 'settings'), CANVAS_AGENT_NO_BROWSER: '1' }; delete env.CANVAS_TOKEN; delete env.PLUGIN_ROOT; delete env.CODEX_PLUGIN_ROOT;
  const transport = new StdioClientTransport({ ...config, command: process.execPath, cwd: root, env, stderr: 'pipe' });
  const host = new Client({ name: 'manifest-test', version: '1' });
  t.after(async () => { await host.close(); await rm(root, { recursive: true, force: true }); });
  await host.connect(transport); assert.equal((await host.listTools()).tools.length, 11);
  const status = await host.callTool({ name: 'connection_status', arguments: {} });
  assert.equal(status.isError, undefined); const result = JSON.parse(status.content[0].text);
  assert.equal(result.setupRequired, true);
  const page = await fetch(result.setupUrl); assert.equal(page.status, 200); assert.match(await page.text(), /연결하고 시작하기/);
});
