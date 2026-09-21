const { readdirSync, readFileSync, existsSync } = require('node:fs');
const { join, resolve, dirname } = require('node:path');
const { execFileSync } = require('node:child_process');
const root = resolve(__dirname, '..');
function filesIn(directory = '') {
  return readdirSync(join(root, directory), { withFileTypes: true }).flatMap(entry => {
    if (['node_modules', 'coverage', 'logs', '.git', '.env'].includes(entry.name)) return [];
    const name = directory ? directory + '/' + entry.name : entry.name;
    return entry.isDirectory() ? filesIn(name) : [name];
  });
}
const files = filesIn();
for (const file of files.filter(file => file.endsWith('.js'))) execFileSync(process.execPath, ['--check', join(root, file)]);
for (const file of files.filter(file => file.endsWith('.sh'))) {
  execFileSync('/bin/bash', ['-n', join(root, file)]);
  const source = readFileSync(join(root, file), 'utf8');
  if (/\\ +#/.test(source)) throw new Error(file + ': broken line continuation');
  // The draft must stop before any external command. PATH makes accidental commands fail.
  try { execFileSync('/bin/bash', [join(root, file)], { env: { PATH: '/nonexistent' }, stdio: 'pipe' }); throw new Error('Draft unexpectedly succeeded: ' + file); }
  catch (error) { if (error.status !== 1 || !String(error.stderr).includes('taslağı devre dışıdır')) throw error; }
  const fragment = source.match(/^aws rds create-db-instance \\\n(?:.*\\\n)*.*$/m)?.[0];
  if (fragment) {
    const stub = 'aws() { printf "%s\\n" "$@"; }; PROJECT=test; DB_ROOT_PASSWORD=test; SG_RDS=test;\n';
    const output = execFileSync('/bin/bash', ['-eu', '-c', stub + fragment], { encoding: 'utf8' });
    for (const flag of ['--allocated-storage', '--no-publicly-accessible']) if (!output.includes(flag)) throw new Error(file + ': incomplete RDS command');
  }
}
const html = readFileSync(join(root, 'public/index.html'), 'utf8');
if (/<style\b|\sstyle=|\son\w+=|<script(?![^>]*\bsrc=)/i.test(html)) throw new Error('Inline style or script violates CSP');
for (const file of files.filter(file => file.endsWith('.md'))) {
  const markdown = readFileSync(join(root, file), 'utf8');
  for (const match of markdown.matchAll(/\]\(([^\s)]+)(?:\s+"[^"]*")?\)/g)) {
    const target = match[1].split('#')[0];
    if (!target || /^(https?:|mailto:|app:|codex:)/.test(target)) continue;
    if (!existsSync(resolve(root, dirname(file), decodeURIComponent(target)))) throw new Error(file + ': missing link ' + target);
  }
}
const guide = readFileSync(join(root, 'PROJE_REHBERI.md'), 'utf8');
for (const file of files.filter(file => !file.startsWith('.env.') || file === '.env.example')) {
  if (!guide.includes('`' + file + '`')) throw new Error('Guide lacks file inventory entry: ' + file);
}
console.log(`${files.length} project files: syntax, local links, guide inventory, CSP and safe AWS fragments checked.`);
