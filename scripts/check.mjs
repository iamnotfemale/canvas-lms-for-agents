import { readdir, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';

for (const dir of ['src', 'scripts', 'test', 'plugin/scripts']) {
  for (const name of await readdir(dir)) {
    if (!/\.(js|mjs)$/.test(name)) continue;
    const result = spawnSync(process.execPath, ['--check', `${dir}/${name}`], { stdio: 'inherit' });
    assert.equal(result.status, 0, `${dir}/${name}`);
  }
}
const pkg = JSON.parse(await readFile('package.json', 'utf8'));
for (const path of ['plugin/.codex-plugin/plugin.json', 'plugin/.claude-plugin/plugin.json']) {
  const manifest = JSON.parse(await readFile(path, 'utf8'));
  assert.equal(manifest.version, pkg.version);
  assert.equal(manifest.name, pkg.name);
  await readFile(`plugin/${manifest.mcpServers}`);
}
for (const path of ['plugin/.mcp.json', '.agents/plugins/marketplace.json', '.claude-plugin/marketplace.json']) JSON.parse(await readFile(path, 'utf8'));
const codexMcp = JSON.parse(await readFile('plugin/.mcp.codex.json', 'utf8'));
// Older Codex hosts do not expand PLUGIN_ROOT; keep the packaged fallback version aligned.
assert.ok(codexMcp.mcpServers['canvas-lms'].args.join(' ').includes(`/canvas-lms-for-agents/${pkg.version}`));
const skill = await readFile('plugin/skills/canvas-lms/SKILL.md', 'utf8');
assert.match(skill, /^---\nname: canvas-lms\ndescription: .+\n---/);
console.log('Syntax and plugin package checks passed.');
