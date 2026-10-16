# Wer na U?

Private family location sharing for Android: live family map, SOS panic button, invite codes.
Built with Capacitor + Firebase Realtime Database. The APK is built by GitHub Actions, so no Android Studio is needed.

## 1. Firebase (one time)
1. Go to console.firebase.google.com > Add project > name it `wer-na-u` (Analytics can stay off).
2. Build > Authentication > Get started > Sign-in method > **Anonymous** > Enable > Save.
3. Build > Realtime Database > Create database > location **Singapore (asia-southeast1)** > Start in **locked mode**.
4. In Realtime Database > **Rules**, replace everything with the contents of `firebase-rules.json` > Publish.
5. Project settings (gear icon) > Your apps > Web (`</>`) > register app `wer-na-u` > copy the `firebaseConfig` values into `www/firebase-config.js`.

The web API key is meant to be public; the database rules are what keep each family's data private.

## 2. GitHub
1. Create a repo named `wer-na-u`.
2. Add file > Upload files > drag in everything from this folder, including the `.github` folder > Commit.
   If `.github` doesn't upload, use Add file > Create new file, name it `.github/workflows/build-apk.yml`, and paste that file's contents.
3. Actions tab > Build APK > wait for the green check > open the run > download **wer-na-u-apk** under Artifacts. Unzip it to get `app-debug.apk`.

## 3. Install on each phone
1. Open the APK and allow installing from this source.
2. Open Wer na U?, enter a name, and create a circle (first person) or join with the 6-letter invite code (everyone else). The code is in Settings.
3. Tap **Turn on location sharing**, allow location ("While using the app" is enough) and notifications.
4. Recommended: Settings > Apps > Wer na U? > Battery > **Unrestricted**, so the phone doesn't stop sharing in the background.

## What's in this version
- Live family map (OpenStreetMap), with name, speed while moving, battery, and last update
- Background sharing with a persistent notification; pause anytime
- SOS: hold the red button 3 seconds; everyone with the app running gets an alert and a notification
- Invite codes and leaving a circle

## Coming next
Place alerts (geofences), driving reports, crash detection, and push notifications that reach phones even when the app has been fully closed.
