// Builds the conversion engine (engine/, .NET WebAssembly) into public/engine/, where the app loads it from.
// Usage: npm run engine   (needs the .NET 10 SDK; no workload required)
import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const target = join(root, 'public', 'engine');
const out = mkdtempSync(join(tmpdir(), 'bib-engine-'));

try {
  execFileSync('dotnet', ['publish', join(root, 'engine'), '-c', 'Release', '-o', out], { stdio: 'inherit' });
  rmSync(target, { recursive: true, force: true });
  // Pre-compressed copies are useless here: neither the dev server nor GitHub Pages serve them.
  cpSync(join(out, 'wwwroot'), target, { recursive: true, filter: (path) => !/\.(br|gz)$/.test(path) });
  console.log(`Engine built into ${target}`);
} finally {
  rmSync(out, { recursive: true, force: true });
}
