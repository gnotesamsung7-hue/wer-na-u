// Adds the Android permissions Wer na U? needs. Runs in GitHub Actions after `npx cap add android`.
const fs = require('fs');
const file = 'android/app/src/main/AndroidManifest.xml';
let xml = fs.readFileSync(file, 'utf8');
const perms = [
  'android.permission.ACCESS_COARSE_LOCATION',
  'android.permission.ACCESS_FINE_LOCATION',
  'android.permission.FOREGROUND_SERVICE',
  'android.permission.FOREGROUND_SERVICE_LOCATION',
  'android.permission.POST_NOTIFICATIONS',
  'android.permission.VIBRATE',
  'android.permission.WAKE_LOCK'
];
const missing = perms.filter(p => !xml.includes(`"${p}"`));
const lines = missing.map(p => `    <uses-permission android:name="${p}" />`).join('\n');
if (lines) xml = xml.replace('</manifest>', `${lines}\n</manifest>`);
fs.writeFileSync(file, xml);
console.log('Added permissions:', missing.join(', ') || 'none');
