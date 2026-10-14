// Production build for GitHub Pages, which serves the site under /<repository>/.
// Usage: npm run build:pages [-- /BasePath/]   (default /TestBib/; build the engine first: npm run engine)
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const baseHref = process.argv[2] ?? '/TestBib/';
const out = join(root, 'dist', 'frontend', 'browser');

if (!existsSync(join(root, 'public', 'engine', 'engine-worker.js'))) {
  console.error('The conversion engine is missing: run `npm run engine` first.');
  process.exit(1);
}

execFileSync(process.execPath, [join(root, 'node_modules', '@angular', 'cli', 'bin', 'ng.js'), 'build', '--base-href', baseHref], {
  cwd: root,
  stdio: 'inherit',
});
// Pages answers unknown paths (deep links such as /TestBib/book/…) with 404.html: let the app's router handle them.
copyFileSync(join(out, 'index.html'), join(out, '404.html'));
console.log(`Built for ${baseHref} into ${out}`);
