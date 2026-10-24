import { readFile, access } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

let root = fileURLToPath(new URL('../..', import.meta.url));
try {
  await access(join(root, 'node_modules', '@modelcontextprotocol', 'sdk', 'package.json'));
} catch {
  // Plugin managers copy the package without node_modules; use the user's prepared clone.
  try {
    const config = JSON.parse(await readFile(join(process.env.CANVAS_AGENT_CONFIG_DIR || join(homedir(), '.config', 'canvas-lms-for-agents'), 'config.json'), 'utf8'));
    root = resolve(config.runtimeRoot);
    await access(join(root, 'node_modules', '@modelcontextprotocol', 'sdk', 'package.json'));
  } catch {
    process.stderr.write('Canvas LMS for Agents: clone에서 npm ci와 npm run setup을 먼저 실행하세요.\n');
    process.exit(1);
  }
}
const { start } = await import(pathToFileURL(join(root, 'src', 'server.js')).href);
await start();
