import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
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
  assert.equal((await host.listTools()).tools.length, 10);
  const indexed = await host.callTool({ name: 'index_pdf', arguments: { resourceId: 'file:1:3' } });
  assert.equal(indexed.isError, undefined); assert.equal(JSON.parse(indexed.content[0].text).totalPages, 2);
  const rendered = await host.callTool({ name: 'render_pdf_page', arguments: { resourceId: 'file:1:3', page: 2 } });
  assert.equal(rendered.content[1].type, 'image'); assert.equal(client.downloads, 1);
  const invalid = await host.callTool({ name: 'read_pdf', arguments: { resourceId: '../../private' } });
  assert.equal(invalid.isError, true);
});
test('real stdio launcher initializes without credentials and fails safely on use', async t => {
  const root = await mkdtemp(join(tmpdir(), 'canvas-stdio-')); t.after(() => rm(root, { recursive: true, force: true }));
  const env = { ...process.env, CANVAS_AGENT_CONFIG_DIR: root }; delete env.CANVAS_TOKEN;
  const transport = new StdioClientTransport({ command: process.execPath, args: ['plugin/scripts/launch.mjs'], env, stderr: 'pipe' });
  const host = new Client({ name: 'stdio-test', version: '1' });
  t.after(() => host.close()); await host.connect(transport);
  assert.equal((await host.listTools()).tools.length, 10);
  const result = await host.callTool({ name: 'connection_status', arguments: {} });
  assert.equal(result.isError, true); assert.match(result.content[0].text, /setup/);
});

test('actual plugin manifest boots from user config, independently of current directory', async t => {
  const root = await mkdtemp(join(tmpdir(), 'canvas-manifest-'));
  await writeFile(join(root, 'config.json'), JSON.stringify({ runtimeRoot: process.cwd() }));
  const config = JSON.parse(await readFile('plugin/.mcp.json', 'utf8')).mcpServers['canvas-lms'];
  const env = { ...process.env, CANVAS_AGENT_CONFIG_DIR: root }; delete env.CANVAS_TOKEN;
  const transport = new StdioClientTransport({ ...config, command: process.execPath, cwd: root, env, stderr: 'pipe' });
  const host = new Client({ name: 'manifest-test', version: '1' });
  t.after(async () => { await host.close(); await rm(root, { recursive: true, force: true }); });
  await host.connect(transport); assert.equal((await host.listTools()).tools.length, 10);
  const status = await host.callTool({ name: 'connection_status', arguments: {} });
  assert.equal(status.isError, true); assert.match(status.content[0].text, /setup/);
});
