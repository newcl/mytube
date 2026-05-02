# MyTube iOS App — Setup Guide

## Project structure

```
mobile/
├── lib/main.dart                          Flutter app (WebView + Submit + Settings)
└── ios/
    ├── Runner/
    │   ├── AppDelegate.swift              Native channels (HTTP + App Group bridge)
    │   └── Runner.entitlements            App Group + Keychain access groups
    ├── ShareExtension/
    │   ├── ShareViewController.swift      Share sheet handler (pure Swift)
    │   ├── Info.plist                     Extension manifest
    │   └── ShareExtension.entitlements    App Group entitlement
    └── add_share_extension.rb             One-time Xcode project wiring script
```

---

## One-time setup steps

### 1. Install xcodeproj gem (needed for the wiring script)
```bash
sudo gem install xcodeproj
```

### 2. Run the wiring script
```bash
cd mobile/ios
ruby add_share_extension.rb
```
This adds the `ShareExtension` target to `Runner.xcodeproj` and embeds it in the main app.

### 3. Open in Xcode
```bash
open mobile/ios/Runner.xcworkspace
```

### 4. Set your Apple Team on both targets
- Select the **Runner** target → Signing & Capabilities → Team: [your Apple ID]
- Select the **ShareExtension** target → Signing & Capabilities → Team: [same]
- Both Bundle IDs should be pre-set:
  - Runner: `com.mytube.mobile`
  - ShareExtension: `com.mytube.mobile.share`

### 5. Register the App Group (Xcode will do this automatically on first build with a paid account)
- Both targets need: `group.com.mytube.mobile`
- Xcode → Runner target → Signing & Capabilities → `+ Capability` → App Groups → add `group.com.mytube.mobile`
- Repeat for ShareExtension target

### 6. Build & run to your iPhone
```bash
# From mobile/
flutter run --release
```
Or press ▶ in Xcode with your iPhone connected.

---

## First-time app configuration

1. Open **MyTube** on your iPhone
2. Go to **Settings** tab
3. Enter your server URL: `https://your-server.example.com`
4. Enter your Bearer token (from your `.env` / server config)
5. Tap **Save Settings**

---

## Using the Share Extension

1. Open YouTube → find any video
2. Tap **Share** → scroll the share sheet → tap **MyTube**
3. A small card appears: "Sending to MyTube..."
4. After ~1 second: "Added to queue ✓" → sheet auto-dismisses
5. Done — no need to open the app at all

---

## How credentials are shared

```
Flutter app (Settings screen)
  └─ flutter_secure_storage (iOS Keychain, access group: com.mytube.mobile)
         ↑ reads same keychain group
ShareViewController.swift
```

The Share Extension reads credentials directly from the shared Keychain access group — no UserDefaults needed for credentials (only for pending URL fallback when not yet configured).

---

## Sideloading / re-signing

| Account type | Certificate validity | Re-sign needed |
|---|---|---|
| Free Apple ID | 7 days | Weekly (via Xcode or AltStore) |
| Paid Dev ($99/yr) | 1 year | Annually |

For daily use, the **paid account** is strongly recommended.

To re-install without losing data:
```bash
flutter run --release   # Xcode re-signs and installs over existing app
```
