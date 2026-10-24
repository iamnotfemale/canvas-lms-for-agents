import { build } from 'esbuild';
import { mkdir } from 'node:fs/promises';
await mkdir('plugin/dist', {recursive:true});
await build({ entryPoints:['scripts/entry.mjs'], outfile:'plugin/dist/server.mjs', bundle:true, platform:'node', format:'esm', target:'node24', minify:true, legalComments:'eof',
  banner:{js:"import{createRequire as __require}from'node:module';const require=__require(import.meta.url);"} });
console.log('Built standalone MCP server: plugin/dist/server.mjs');
