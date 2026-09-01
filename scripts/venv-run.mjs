// Runs a command with the repository's Python virtual environment on any platform.
//
// Windows puts interpreters in `.venv/Scripts` and POSIX in `.venv/bin`, so a hardcoded
// path breaks one side of the team. Usage:
//
//   node scripts/venv-run.mjs [--cwd <dir>] <python args...>
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const isWindows = process.platform === 'win32';

export const virtualEnvironment = process.env.VIRTUAL_ENV
  ? resolve(process.env.VIRTUAL_ENV)
  : resolve(repositoryRoot, '.venv');

export function pythonExecutable() {
  return isWindows
    ? resolve(virtualEnvironment, 'Scripts/python.exe')
    : resolve(virtualEnvironment, 'bin/python');
}

export function requirePython() {
  const executable = pythonExecutable();
  if (existsSync(executable)) {
    return executable;
  }

  console.error(
    [
      `No Python environment at ${virtualEnvironment}.`,
      '',
      'Create it from the repository root:',
      isWindows
        ? '  python -m venv .venv\n  .venv\\Scripts\\python.exe -m pip install -e "apps/agent[dev]"'
        : "  python3 -m venv .venv\n  .venv/bin/python -m pip install -e 'apps/agent[dev]'",
      '',
      'Or run `npm run setup:agent`, which does both.',
    ].join('\n'),
  );
  process.exit(1);
}

export function run(executable, args, options = {}) {
  // No shell: arguments reach the process verbatim, so `apps/agent[dev]` survives zsh
  // globbing and paths containing spaces survive cmd.exe.
  const child = spawn(executable, args, { stdio: 'inherit', shell: false, ...options });
  child.on('error', (error) => {
    console.error(`Failed to start ${executable}: ${error.message}`);
    process.exit(1);
  });
  child.on('exit', (code, signal) => {
    process.exit(signal ? 1 : (code ?? 1));
  });
  return child;
}

const invokedDirectly =
  process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  const args = process.argv.slice(2);
  let workingDirectory = repositoryRoot;
  if (args[0] === '--cwd') {
    workingDirectory = resolve(repositoryRoot, args[1] ?? '.');
    args.splice(0, 2);
  }
  if (args.length === 0) {
    console.error('Usage: node scripts/venv-run.mjs [--cwd <dir>] <python args...>');
    process.exit(1);
  }
  run(requirePython(), args, { cwd: workingDirectory });
}
