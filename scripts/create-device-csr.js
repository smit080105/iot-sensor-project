const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const [deviceId, outputDirectory = path.join(process.cwd(), 'device-identity')] = process.argv.slice(2);
if (!deviceId || !/^[A-Za-z0-9_-]{1,100}$/.test(deviceId)) {
  console.error('Usage: node scripts/create-device-csr.js <dongle_id> [output_directory]');
  process.exit(1);
}

function getOpenSSL() {
  const candidates = [process.env.OPENSSL_BIN, 'C:\\Program Files\\Git\\usr\\bin\\openssl.exe', 'openssl'];
  return candidates.find((candidate) => candidate && (candidate === 'openssl' || fs.existsSync(candidate))) || 'openssl';
}

const outputDir = path.resolve(outputDirectory);
fs.mkdirSync(outputDir, { recursive: true });
const keyPath = path.join(outputDir, `${deviceId}.key`);
const csrPath = path.join(outputDir, `${deviceId}.csr`);
if (fs.existsSync(keyPath) || fs.existsSync(csrPath)) {
  console.error(`Refusing to overwrite an existing key or CSR in ${outputDir}.`);
  process.exit(1);
}

const openssl = getOpenSSL();
execFileSync(openssl, ['genpkey', '-algorithm', 'RSA', '-pkeyopt', 'rsa_keygen_bits:2048', '-out', keyPath], { stdio: 'inherit' });
try {
  execFileSync(openssl, [
    'req', '-new', '-key', keyPath, '-out', csrPath,
    '-subj', `/C=US/O=IoT-Devices/OU=Sensors/CN=${deviceId}`,
  ], { stdio: 'inherit' });
} catch (error) {
  fs.rmSync(keyPath, { force: true });
  throw error;
}

if (process.platform !== 'win32') fs.chmodSync(keyPath, 0o600);
console.log(`Private key created locally: ${keyPath}`);
console.log(`Send only this CSR to the certificate authority: ${csrPath}`);
