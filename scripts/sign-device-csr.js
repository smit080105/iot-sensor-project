const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const [deviceId, csrArgument] = process.argv.slice(2);
if (!deviceId || !/^[A-Za-z0-9_-]{1,100}$/.test(deviceId) || !csrArgument) {
  console.error('Usage: node scripts/sign-device-csr.js <registered_dongle_id> <device.csr>');
  process.exit(1);
}

function getOpenSSL() {
  const candidates = [process.env.OPENSSL_BIN, 'C:\\Program Files\\Git\\usr\\bin\\openssl.exe', 'openssl'];
  return candidates.find((candidate) => candidate && (candidate === 'openssl' || fs.existsSync(candidate))) || 'openssl';
}

const rootDir = path.resolve(__dirname, '..');
const caCert = path.join(rootDir, 'certs', 'ca.crt');
const caKey = path.join(rootDir, 'certs', 'ca.key');
const devicesDir = path.join(rootDir, 'certs', 'devices');
const csrPath = path.resolve(csrArgument);
const certificatePath = path.join(devicesDir, `${deviceId}.crt`);
const extensionPath = path.join(devicesDir, `${deviceId}.ext`);

if (!fs.existsSync(caCert) || !fs.existsSync(caKey)) {
  console.error('The CA certificate and private key must be available on the trusted signing host.');
  process.exit(1);
}
if (!fs.existsSync(csrPath)) {
  console.error(`CSR not found: ${csrPath}`);
  process.exit(1);
}
if (fs.existsSync(certificatePath)) {
  console.error(`Refusing to overwrite existing certificate: ${certificatePath}`);
  process.exit(1);
}

const openssl = getOpenSSL();
const subject = execFileSync(openssl, ['req', '-in', csrPath, '-noout', '-subject', '-nameopt', 'RFC2253'], { encoding: 'utf8' });
const subjectName = subject.trim().replace(/^subject=/i, '');
const commonName = subjectName.match(/(?:^|,)CN=([^,\r\n]+)/)?.[1];
if (commonName !== deviceId) {
  console.error(`CSR common name must match registered dongle ID ${deviceId}. Found: ${commonName || 'none'}`);
  process.exit(1);
}

fs.mkdirSync(devicesDir, { recursive: true });
fs.writeFileSync(extensionPath, [
  'basicConstraints=critical,CA:FALSE',
  'keyUsage=critical,digitalSignature,keyEncipherment',
  'extendedKeyUsage=clientAuth',
].join('\n'));

try {
  execFileSync(openssl, [
    'x509', '-req', '-in', csrPath, '-CA', caCert, '-CAkey', caKey,
    '-CAcreateserial', '-out', certificatePath, '-days', '365', '-sha256', '-extfile', extensionPath,
  ], { stdio: 'inherit' });
} finally {
  fs.rmSync(extensionPath, { force: true });
}

console.log(`Signed device certificate: ${certificatePath}`);
console.log('Return the certificate to the device through a trusted channel. Keep the device private key on the device.');
