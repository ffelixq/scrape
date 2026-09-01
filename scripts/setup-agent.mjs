// Creates the repository virtual environment and installs the Python agent, on any platform.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pythonExecutable, virtualEnvironment } from './venv-run.mjs';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const isWindows = process.platform === 'win32';

function runStep(executable, args) {
  console.log(`> ${executable} ${args.join(' ')}`);
  const result = spawnSync(executable, args, {
    stdio: 'inherit',
    shell: false,
    cwd: repositoryRoot,
  });
  if (result.error) {
    console.error(`Failed to start ${executable}: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function systemPython() {
  // `py -3` is the Windows launcher; `python3` is the POSIX convention. Probe rather than
  // assume, because either machine may only have one of them on PATH.
  const candidates = isWindows
    ? [
        ['py', ['-3']],
        ['python', []],
        ['python3', []],
      ]
    : [
        ['python3', []],
        ['python', []],
      ];

  for (const [executable, prefix] of candidates) {
    const probe = spawnSync(executable, [...prefix, '--version'], {
      stdio: 'ignore',
      shell: false,
    });
    if (!probe.error && probe.status === 0) {
      return [executable, prefix];
    }
  }

  console.error('No Python 3.11+ interpreter found on PATH. Install Python, then rerun.');
  process.exit(1);
}

if (existsSync(pythonExecutable())) {
  console.log(`Reusing the environment at ${virtualEnvironment}.`);
} else {
  const [executable, prefix] = systemPython();
  runStep(executable, [...prefix, '-m', 'venv', virtualEnvironment]);
}

runStep(pythonExecutable(), ['-m', 'pip', 'install', '--upgrade', 'pip']);
runStep(pythonExecutable(), ['-m', 'pip', 'install', '-e', 'apps/agent[dev]']);

console.log('\nPython agent ready. Run `npm run dev` to start web, API and agent together.');
