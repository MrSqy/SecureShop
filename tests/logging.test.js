const { spawnSync } = require('node:child_process');
const { mkdtempSync, readFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const cwd = join(__dirname, '..');
test('actual file transport never receives the local OTP and redacts nested secrets', () => {
  const dir = mkdtempSync(join(tmpdir(), 'secureshop-log-test-'));
  try {
    const script = `const logger=require('./src/utils/logger'); logger.info('sample',{nested:{password:'private-password',phone_number:'+905550001111',shippingAddress:'private-home'}}); logger.localOtp('+905550001111','654321'); logger.end();`;
    const result = spawnSync(process.execPath, ['-e', script], { cwd, env: { ...process.env, NODE_ENV: 'development', LOG_DIR: dir }, encoding: 'utf8', timeout: 5000 });
    expect(result.status).toBe(0); expect(result.stderr).toContain('654321'); expect(result.stderr).not.toContain('+905550001111');
    const log = readFileSync(join(dir, 'app.log'), 'utf8');
    expect(log).toContain('[REDACTED]'); expect(log).not.toMatch(/654321|private-password|905550001111|private-home/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
