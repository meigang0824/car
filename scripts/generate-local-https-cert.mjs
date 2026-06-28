import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { resolve } from "node:path";

const certDir = resolve("certs");
const keyPath = resolve(certDir, "local-dev-key.pem");
const certPath = resolve(certDir, "local-dev-cert.pem");
const configPath = resolve(certDir, "local-dev-openssl.cnf");

const localIps = Object.values(networkInterfaces())
  .flat()
  .filter((item) => item && item.family === "IPv4" && !item.internal)
  .map((item) => item.address);

const extraIps = String(process.env.LOCAL_HTTPS_IPS || "")
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);

const ips = [...new Set(["127.0.0.1", ...localIps, ...extraIps])];

mkdirSync(certDir, { recursive: true });

const altNames = [
  "DNS.1 = localhost",
  ...ips.map((ip, index) => `IP.${index + 1} = ${ip}`),
].join("\n");

writeFileSync(configPath, `[req]
default_bits = 2048
prompt = no
default_md = sha256
distinguished_name = dn
x509_extensions = v3_req

[dn]
CN = ev-trike-local-dev

[v3_req]
subjectAltName = @alt_names
keyUsage = critical, digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth

[alt_names]
${altNames}
`);

execFileSync("openssl", [
  "req",
  "-x509",
  "-newkey",
  "rsa:2048",
  "-nodes",
  "-days",
  "825",
  "-keyout",
  keyPath,
  "-out",
  certPath,
  "-config",
  configPath,
], { stdio: "inherit" });

console.log("");
console.log("Local HTTPS certificate generated:");
console.log(`  Key:  ${keyPath}`);
console.log(`  Cert: ${certPath}`);
console.log("");
console.log("Included IP addresses:");
ips.forEach((ip) => console.log(`  https://${ip}:5173`));
console.log("");
console.log("Trust the cert on your iPad before testing microphone input.");
