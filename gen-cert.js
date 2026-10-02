const selfsigned = require('selfsigned');
const fs = require('fs');
const os = require('os');

let localIp = '127.0.0.1';
for (const iface of Object.values(os.networkInterfaces())) {
  for (const addr of iface) {
    if (addr.family === 'IPv4' && !addr.internal) { localIp = addr.address; break; }
  }
}

const attrs = [{ name: 'commonName', value: localIp }];
const opts = {
  days: 365,
  extensions: [
    { name: 'subjectAltName', altNames: [
      { type: 7, ip: localIp },
      { type: 7, ip: '127.0.0.1' },
    ]},
  ],
};

selfsigned.generate(attrs, opts).then(pems => {
  fs.writeFileSync('ssl.key', pems.private);
  fs.writeFileSync('ssl.crt', pems.cert);
  console.log(`Cert generated for IP: ${localIp}`);
  console.log('Files: ssl.key, ssl.crt');
}).catch(e => console.error(e));
