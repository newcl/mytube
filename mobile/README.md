# Mytube

Mytube mobile app (Flutter).

## Connect to the server

Open the Mytube website while signed in through Cloudflare Access, select
**Settings → Show pairing code**, then select **Settings → Scan pairing code**
in the iPhone app. The one-time code expires after five minutes. The resulting
revocable device credential is stored in iOS Keychain; no server admin token is
entered into the app. API, playback, and offline-download requests send that
credential only in the `Authorization` header; media URLs never contain it.

## iOS Deploy Workflow

Day-to-day install on a physical iPhone should use Flutter CLI first.

1. Build release app

	flutter build ios --release

2. Install on device

	xcrun devicectl device install app --device <DEVICE_ID> build/ios/iphoneos/Runner.app

Use Xcode (Runner.xcworkspace) only when needed for native iOS tasks:

1. Signing / provisioning fixes
2. Entitlements and capabilities changes (Share Extension, App Groups, Keychain groups)
3. Native Swift debugging
4. Archive and distribution workflows

## Known iOS Note

On newer Xcode versions, debug deployment can be flaky in this project.
If deployment fails in debug mode, prefer release build + devicectl install.

## Free Apple Account Note

If using a personal/free Apple account, installed apps expire every 7 days and must be reinstalled.
