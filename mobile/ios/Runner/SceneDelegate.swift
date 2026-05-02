import Flutter
import UIKit

let kAppGroup = "group.com.mytube.mobile"
let kPendingUrlKey = "pending_url"

class SceneDelegate: FlutterSceneDelegate {
  override func scene(
    _ scene: UIScene,
    willConnectTo session: UISceneSession,
    options connectionOptions: UIScene.ConnectionOptions
  ) {
    super.scene(scene, willConnectTo: session, options: connectionOptions)

    guard let windowScene = scene as? UIWindowScene,
          let window = windowScene.windows.first,
          let controller = window.rootViewController as? FlutterViewController
    else { return }

    let shareChannel = FlutterMethodChannel(
      name: "com.mytube.mobile/share",
      binaryMessenger: controller.binaryMessenger
    )
    shareChannel.setMethodCallHandler { call, result in
      let defaults = UserDefaults(suiteName: kAppGroup)
      switch call.method {
      case "getPendingUrl":
        result(defaults?.string(forKey: kPendingUrlKey))
      case "clearPendingUrl":
        defaults?.removeObject(forKey: kPendingUrlKey)
        result(nil)
      default:
        result(FlutterMethodNotImplemented)
      }
    }
  }
}
