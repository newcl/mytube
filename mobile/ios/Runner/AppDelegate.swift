import AVFoundation
import Flutter
import MediaPlayer
import UIKit

@main
@objc class AppDelegate: FlutterAppDelegate, FlutterImplicitEngineDelegate {
  override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
  ) -> Bool {
    configureAudioSession()
    setupRemoteCommandCenter()
    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }

  func didInitializeImplicitFlutterEngine(_ engineBridge: FlutterImplicitEngineBridge) {
    GeneratedPluginRegistrant.register(with: engineBridge.pluginRegistry)
  }

  // MARK: - Audio Session

  private func configureAudioSession() {
    let session = AVAudioSession.sharedInstance()
    do {
      try session.setCategory(.playback, mode: .moviePlayback, options: [])
      try session.setActive(true)
    } catch {
      NSLog("Failed to configure audio session: \(error)")
    }
    NotificationCenter.default.addObserver(
      self,
      selector: #selector(handleAudioInterruption(_:)),
      name: AVAudioSession.interruptionNotification,
      object: session
    )
  }

  @objc private func handleAudioInterruption(_ notification: Notification) {
    guard
      let info = notification.userInfo,
      let typeValue = info[AVAudioSessionInterruptionTypeKey] as? UInt,
      let type = AVAudioSession.InterruptionType(rawValue: typeValue)
    else { return }
    if type == .ended {
      do {
        try AVAudioSession.sharedInstance().setActive(true)
      } catch {
        NSLog("Failed to re-activate audio session after interruption: \(error)")
      }
    }
  }

  // MARK: - Remote Command Center

  /// Registering play/pause commands signals to iOS that this is a legitimate
  /// background-audio app and enables lock-screen / Control Center controls.
  private func setupRemoteCommandCenter() {
    UIApplication.shared.beginReceivingRemoteControlEvents()
    let center = MPRemoteCommandCenter.shared()
    center.playCommand.isEnabled = true
    center.pauseCommand.isEnabled = true
    center.togglePlayPauseCommand.isEnabled = true
    // Handlers are intentionally minimal — the video_player AVPlayer is the
    // actual audio source and continues playing natively in the background.
    center.playCommand.addTarget { _ in .success }
    center.pauseCommand.addTarget { _ in .success }
    center.togglePlayPauseCommand.addTarget { _ in .success }
  }
}
