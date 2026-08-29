import { access, cp, mkdir, readFile, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const webBuild = resolve(repositoryRoot, 'apps/web/dist');
const workerEntry = resolve(repositoryRoot, 'sites/worker.js');
const outputRoot = resolve(repositoryRoot, 'dist');

await access(resolve(webBuild, 'index.html'));
await access(workerEntry);

await rm(outputRoot, { recursive: true, force: true });
await mkdir(resolve(outputRoot, 'server'), { recursive: true });
await cp(webBuild, resolve(outputRoot, 'client'), { recursive: true });
await cp(workerEntry, resolve(outputRoot, 'server/index.js'));

const html = await readFile(resolve(outputRoot, 'client/index.html'), 'utf8');
if (!html.includes('<div id="root"></div>')) {
  throw new Error('The packaged site is missing the React application root.');
}

console.log('Packaged Proofline for Sites in dist/.');
