import { loadConfig } from '../src/config.js';
import { Canvas } from '../src/canvas.js';
import { FileCache } from '../src/cache.js';
const config = await loadConfig(), client = new Canvas(config.token);
const cache = new FileCache(config.cacheDir, await client.identity(), config.maxBytes, config.libraryDir);
const action = process.argv[2] || 'status';
if (!['status', 'prune', 'clear'].includes(action)) throw Error('사용법: npm run cache -- status|prune|clear');
if (action === 'clear' && !process.argv.includes('--yes')) throw Error('현재 계정의 다운로드·추출 텍스트·이미지를 지우려면 clear --yes를 사용하세요.');
console.log(JSON.stringify(action === 'status' ? await cache.stats() : await cache.prune(action === 'clear'), null, 2));
