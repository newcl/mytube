import AVFoundation
import Flutter
import MediaPlayer
import UIKit

@main
@objc class AppDelegate: FlutterAppDelegate, FlutterImplicitEngineDelegate {
  /// Channel used to exchange Now Playing updates and remote-control events
  /// with the Flutter/Dart layer.
  private var nowPlayingChannel: FlutterMethodChannel?

  override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
  ) -> Bool {
    configureAudioSession()
    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }

  func didInitializeImplicitFlutterEngine(_ engineBridge: FlutterImplicitEngineBridge) {
    GeneratedPluginRegistrant.register(with: engineBridge.pluginRegistry)
    guard let registrar = engineBridge.pluginRegistry.registrar(forPlugin: "NowPlayingPlugin") else {
      return
    }
    nowPlayingChannel = FlutterMethodChannel(
      name: "com.mytube/nowPlaying",
      binaryMessenger: registrar.messenger()
    )
    nowPlayingChannel?.setMethodCallHandler { [weak self] call, result in
      self?.handleNowPlayingCall(call, result: result)
    }
    setupRemoteCommandCenter()
  }

  // MARK: - Now Playing Info

  private func handleNowPlayingCall(_ call: FlutterMethodCall, result: FlutterResult) {
    switch call.method {
    case "update":
      guard let args = call.arguments as? [String: Any] else { result(nil); return }
      let title    = args["title"]     as? String ?? "MyTube"
      let position = args["position"]  as? Double ?? 0
      let duration = args["duration"]  as? Double ?? 0
      let isPlaying = args["isPlaying"] as? Bool ?? false
      var info: [String: Any] = [
        MPMediaItemPropertyTitle:                  title,
        MPNowPlayingInfoPropertyElapsedPlaybackTime: position,
        MPNowPlayingInfoPropertyPlaybackRate:       isPlaying ? 1.0 : 0.0,
        MPNowPlayingInfoPropertyDefaultPlaybackRate: 1.0,
        MPMediaItemPropertyMediaType:              MPMediaType.anyVideo.rawValue,
      ]
      if duration > 0 {
        info[MPMediaItemPropertyPlaybackDuration] = duration
      }
      MPNowPlayingInfoCenter.default().nowPlayingInfo = info
      result(nil)
    case "clear":
      MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
      result(nil)
    default:
      result(FlutterMethodNotImplemented)
    }
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

  private func setupRemoteCommandCenter() {
    UIApplication.shared.beginReceivingRemoteControlEvents()
    let center = MPRemoteCommandCenter.shared()
    center.playCommand.isEnabled = true
    center.pauseCommand.isEnabled = true
    center.togglePlayPauseCommand.isEnabled = true
    center.changePlaybackPositionCommand.isEnabled = true

    center.playCommand.addTarget { [weak self] _ in
      self?.nowPlayingChannel?.invokeMethod("play", arguments: nil)
      return .success
    }
    center.pauseCommand.addTarget { [weak self] _ in
      self?.nowPlayingChannel?.invokeMethod("pause", arguments: nil)
      return .success
    }
    center.togglePlayPauseCommand.addTarget { [weak self] _ in
      self?.nowPlayingChannel?.invokeMethod("togglePlayPause", arguments: nil)
      return .success
    }
    // Scrubbing from the lock screen / Control Center.
    center.changePlaybackPositionCommand.addTarget { [weak self] event in
      if let e = event as? MPChangePlaybackPositionCommandEvent {
        self?.nowPlayingChannel?.invokeMethod("seekTo", arguments: e.positionTime)
      }
      return .success
    }
  }
}
