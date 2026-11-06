import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';

const arch = process.argv[2];
if (process.argv.length !== 3 || !['amd64', 'arm64'].includes(arch)) {
  console.error('Usage: npm run package -- <amd64|arm64>');
  process.exit(1);
}

const project = realpathSync(join(import.meta.dirname, '..'));
const server = join(project, 'server');
if (realpathSync(server) !== server) throw new Error('server must be inside the project directory');

const staging = join(server, 'web-build');
const output = join(project, 'release', 'mac-web-os-linux-' + arch);
mkdirSync(dirname(output), { recursive: true });
mkdirSync(staging);
try {
  cpSync(join(project, 'dist'), staging, { recursive: true });
  execFileSync('go', ['build', '-tags=release', '-trimpath', '-ldflags=-s -w', '-o', output, '.'], {
    cwd: server,
    stdio: 'inherit',
    env: { ...process.env, GOOS: 'linux', GOARCH: arch, CGO_ENABLED: '0' },
  });
  const binary = readFileSync(output);
  const sha256 = createHash('sha256').update(binary).digest('hex');
  const payload = gzipSync(binary).toString('base64').match(/.{1,76}/g).join('\n');
  const shellSource = name => readFileSync(join(import.meta.dirname, name), 'utf8').replaceAll('\r\n', '\n');
  const installer = shellSource('install-linux.sh')
    .replace('__ARCH__', arch)
    .replace('__SHA256__', sha256)
    .replace('__UNINSTALL__', () => shellSource('uninstall-linux.sh').trimEnd())
    .replace('__PAYLOAD__', () => payload);
  const packaged = join(staging, 'installer.sh');
  writeFileSync(packaged, installer, { mode: 0o755 });
  renameSync(packaged, output + '.sh');
  console.log(output + '.sh');
} finally {
  if (realpathSync(staging) === staging) rmSync(staging, { recursive: true });
}
