// Makes the background location plugin battery-friendly.
// The stock plugin asks for a high-accuracy GPS fix every 1 second, which drains the battery fast.
// After this patch:
//   distanceFilter < 100  -> normal mode: GPS fix every 15 s (at most every 5 s)
//   distanceFilter >= 100 -> battery saver: Wi-Fi/cell-tower location every 60 s, no constant GPS
const fs = require('fs');
const file = 'node_modules/@capacitor-community/background-geolocation/android/src/main/java/com/equimaps/capacitor_background_geolocation/BackgroundGeolocationService.java';
let src = fs.readFileSync(file, 'utf8');
if (src.includes('wnuLowPower')) { console.log('Plugin already patched'); process.exit(0); }
const from = `            locationRequest.setMaxWaitTime(1000);
            locationRequest.setInterval(1000);
            locationRequest.setPriority(LocationRequest.PRIORITY_HIGH_ACCURACY);`;
const to = `            boolean wnuLowPower = distanceFilter >= 100f;
            long wnuInterval = wnuLowPower ? 60000L : 15000L;
            locationRequest.setInterval(wnuInterval);
            locationRequest.setFastestInterval(wnuLowPower ? 30000L : 5000L);
            locationRequest.setMaxWaitTime(wnuInterval);
            locationRequest.setPriority(wnuLowPower ? LocationRequest.PRIORITY_BALANCED_POWER_ACCURACY : LocationRequest.PRIORITY_HIGH_ACCURACY);`;
if (!src.includes(from)) { console.error('Could not find the location request code to patch. Plugin version changed?'); process.exit(1); }
fs.writeFileSync(file, src.replace(from, to));
console.log('Patched background location plugin for battery saving');
