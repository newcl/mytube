# mytube_mobile

MyTube mobile app (Flutter).

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
