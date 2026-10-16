// Copies Leaflet into www/vendor so the map library ships inside the APK.
const fs = require('fs');
const path = require('path');
const out = path.join(__dirname, '..', 'www', 'vendor');
fs.mkdirSync(out, { recursive: true });
for (const f of ['leaflet.js', 'leaflet.css']) {
  fs.copyFileSync(path.join(__dirname, '..', 'node_modules', 'leaflet', 'dist', f), path.join(out, f));
}
console.log('Leaflet copied to www/vendor');
