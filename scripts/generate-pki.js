const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Determine OpenSSL executable path
function getOpenSSLPath() {
  if (process.env.OPENSSL_BIN && fs.existsSync(process.env.OPENSSL_BIN)) {
    return `"${process.env.OPENSSL_BIN}"`;
  }
  const gitOpenSSL = 'C:\\Program Files\\Git\\usr\\bin\\openssl.exe';
  if (fs.existsSync(gitOpenSSL)) {
    return `"${gitOpenSSL}"`;
  }
  return 'openssl';
}

const OPENSSL = getOpenSSLPath();
console.log(`[PKI] Using OpenSSL binary: ${OPENSSL}`);

const ROOT_DIR = path.resolve(__dirname, '..');
const CERTS_DIR = path.join(ROOT_DIR, 'certs');
const BACKEND_CERTS_DIR = path.join(CERTS_DIR, 'backend');
// Ensure certificate directories exist
[CERTS_DIR, BACKEND_CERTS_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

function runCommand(cmd) {
  try {
    return execSync(cmd, { stdio: 'pipe' }).toString();
  } catch (err) {
    console.error(`[PKI Error] Command failed: ${cmd}`);
    if (err.stderr) console.error(err.stderr.toString());
    throw err;
  }
}

// -------------------------------------------------------------
// 1. Root Certificate Authority (CA)
// -------------------------------------------------------------
const caKey = path.join(CERTS_DIR, 'ca.key');
const caCrt = path.join(CERTS_DIR, 'ca.crt');

if (!fs.existsSync(caKey) || !fs.existsSync(caCrt)) {
  console.log('[PKI] 1. Generating Root CA private key and certificate...');
  // 4096-bit RSA for Root CA
  runCommand(`${OPENSSL} genrsa -out "${caKey}" 4096`);
  // Self-signed root CA certificate valid for 10 years (3650 days)
  runCommand(`${OPENSSL} req -x509 -new -nodes -key "${caKey}" -sha256 -days 3650 -out "${caCrt}" -subj "/C=US/ST=State/L=City/O=IoT-Enterprise/OU=Security/CN=IoT-Private-Root-CA"`);
  console.log('  -> Root CA created: certs/ca.crt, certs/ca.key');
} else {
  console.log('[PKI] 1. Root CA already exists: certs/ca.crt');
}

// -------------------------------------------------------------
// 2. Broker / Server Certificate (TLS 1.2 / 1.3 with SAN)
// -------------------------------------------------------------
const serverKey = path.join(CERTS_DIR, 'server.key');
const serverCsr = path.join(CERTS_DIR, 'server.csr');
const serverCrt = path.join(CERTS_DIR, 'server.crt');
const serverExt = path.join(CERTS_DIR, 'server.ext');

console.log('[PKI] 2. Generating Broker Server Certificate (Subject Alternative Names included)...');
fs.writeFileSync(serverExt, [
  'authorityKeyIdentifier=keyid,issuer',
  'basicConstraints=CA:FALSE',
  'keyUsage = digitalSignature, nonRepudiation, keyEncipherment, dataEncipherment',
  'extendedKeyUsage = serverAuth',
  'subjectAltName = @alt_names',
  '',
  '[alt_names]',
  'DNS.1 = localhost',
  'DNS.2 = mosquitto',
  'DNS.3 = backend',
  'DNS.4 = host.docker.internal',
  'IP.1 = 127.0.0.1',
  'IP.2 = 0.0.0.0'
].join('\n'));

runCommand(`${OPENSSL} genrsa -out "${serverKey}" 2048`);
runCommand(`${OPENSSL} req -new -key "${serverKey}" -out "${serverCsr}" -subj "/C=US/ST=State/L=City/O=IoT-Enterprise/OU=Broker/CN=localhost"`);
runCommand(`${OPENSSL} x509 -req -in "${serverCsr}" -CA "${caCrt}" -CAkey "${caKey}" -CAcreateserial -out "${serverCrt}" -days 825 -sha256 -extfile "${serverExt}"`);

if (fs.existsSync(serverCsr)) fs.unlinkSync(serverCsr);
if (fs.existsSync(serverExt)) fs.unlinkSync(serverExt);
console.log('  -> Server Certificate created: certs/server.crt, certs/server.key');

// -------------------------------------------------------------
// 3. Backend Service Client Certificate (CN=backend-service)
// -------------------------------------------------------------
const backendKey = path.join(BACKEND_CERTS_DIR, 'backend-service.key');
const backendCsr = path.join(BACKEND_CERTS_DIR, 'backend-service.csr');
const backendCrt = path.join(BACKEND_CERTS_DIR, 'backend-service.crt');
const clientExt = path.join(CERTS_DIR, 'client.ext');

console.log('[PKI] 3. Generating Backend Ingestion Service Client Certificate...');
fs.writeFileSync(clientExt, [
  'authorityKeyIdentifier=keyid,issuer',
  'basicConstraints=CA:FALSE',
  'keyUsage = digitalSignature, keyEncipherment',
  'extendedKeyUsage = clientAuth'
].join('\n'));

runCommand(`${OPENSSL} genrsa -out "${backendKey}" 2048`);
runCommand(`${OPENSSL} req -new -key "${backendKey}" -out "${backendCsr}" -subj "/C=US/ST=State/L=City/O=IoT-Enterprise/OU=Services/CN=backend-service"`);
runCommand(`${OPENSSL} x509 -req -in "${backendCsr}" -CA "${caCrt}" -CAkey "${caKey}" -CAcreateserial -out "${backendCrt}" -days 825 -sha256 -extfile "${clientExt}"`);

if (fs.existsSync(backendCsr)) fs.unlinkSync(backendCsr);
console.log('  -> Backend Service Certificate created: certs/backend/backend-service.crt');

// Device private keys must be created on the device and signed through the
// separate CSR flow documented in mqtt/SECURE_DEPLOYMENT.md.

// Clean up temporary files
if (fs.existsSync(clientExt)) fs.unlinkSync(clientExt);

console.log('\n[PKI] Private PKI Setup Complete!');
console.log('Summary of generated certificates:');
console.log(` - Root CA:         ${caCrt}`);
console.log(` - Broker Server:   ${serverCrt}`);
console.log(` - Backend Service: ${backendCrt}`);
console.log(' - Device identities: provision individually from device-generated CSRs');
