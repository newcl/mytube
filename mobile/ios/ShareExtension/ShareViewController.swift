import UIKit
import Social
import MobileCoreServices
import UniformTypeIdentifiers

let kAppGroup    = "group.com.mytube.mobile"
let kPendingUrl  = "pending_url"
let kServerUrl   = "mytube_server_url"
let kBearerToken = "mytube_bearer_token"

class ShareViewController: UIViewController {

  // ── UI ──────────────────────────────────────────────────────────────────
  private let container: UIView = {
    let v = UIView()
    v.backgroundColor = .systemBackground
    v.layer.cornerRadius = 16
    v.layer.shadowColor = UIColor.black.cgColor
    v.layer.shadowOpacity = 0.15
    v.layer.shadowRadius = 12
    v.translatesAutoresizingMaskIntoConstraints = false
    return v
  }()

  private let iconView: UIImageView = {
    let iv = UIImageView(image: UIImage(systemName: "arrow.down.circle.fill"))
    iv.tintColor = .systemRed
    iv.contentMode = .scaleAspectFit
    iv.translatesAutoresizingMaskIntoConstraints = false
    return iv
  }()

  private let titleLabel: UILabel = {
    let l = UILabel()
    l.text = "MyTube"
    l.font = .systemFont(ofSize: 20, weight: .bold)
    l.textAlignment = .center
    l.translatesAutoresizingMaskIntoConstraints = false
    return l
  }()

  private let statusLabel: UILabel = {
    let l = UILabel()
    l.text = "Submitting..."
    l.font = .systemFont(ofSize: 15)
    l.textColor = .secondaryLabel
    l.textAlignment = .center
    l.numberOfLines = 3
    l.translatesAutoresizingMaskIntoConstraints = false
    return l
  }()

  private let spinner: UIActivityIndicatorView = {
    let s = UIActivityIndicatorView(style: .medium)
    s.translatesAutoresizingMaskIntoConstraints = false
    return s
  }()

  // ── Lifecycle ──────────────────────────────────────────────────────────
  override func viewDidLoad() {
    super.viewDidLoad()
    view.backgroundColor = UIColor.black.withAlphaComponent(0.4)
    setupUI()
    extractURL()
  }

  private func setupUI() {
    view.addSubview(container)
    [iconView, titleLabel, statusLabel, spinner].forEach { container.addSubview($0) }

    NSLayoutConstraint.activate([
      container.centerXAnchor.constraint(equalTo: view.centerXAnchor),
      container.centerYAnchor.constraint(equalTo: view.centerYAnchor),
      container.widthAnchor.constraint(equalToConstant: 280),

      iconView.topAnchor.constraint(equalTo: container.topAnchor, constant: 24),
      iconView.centerXAnchor.constraint(equalTo: container.centerXAnchor),
      iconView.widthAnchor.constraint(equalToConstant: 48),
      iconView.heightAnchor.constraint(equalToConstant: 48),

      titleLabel.topAnchor.constraint(equalTo: iconView.bottomAnchor, constant: 8),
      titleLabel.leadingAnchor.constraint(equalTo: container.leadingAnchor, constant: 16),
      titleLabel.trailingAnchor.constraint(equalTo: container.trailingAnchor, constant: -16),

      spinner.topAnchor.constraint(equalTo: titleLabel.bottomAnchor, constant: 16),
      spinner.centerXAnchor.constraint(equalTo: container.centerXAnchor),

      statusLabel.topAnchor.constraint(equalTo: spinner.bottomAnchor, constant: 12),
      statusLabel.leadingAnchor.constraint(equalTo: container.leadingAnchor, constant: 16),
      statusLabel.trailingAnchor.constraint(equalTo: container.trailingAnchor, constant: -16),
      statusLabel.bottomAnchor.constraint(equalTo: container.bottomAnchor, constant: -24),
    ])

    spinner.startAnimating()
  }

  // ── URL extraction ─────────────────────────────────────────────────────
  private func extractURL() {
    guard let items = extensionContext?.inputItems as? [NSExtensionItem] else {
      finish(success: false, message: "No items found.")
      return
    }

    for item in items {
      guard let attachments = item.attachments else { continue }
      for provider in attachments {
        // Try URL type first
        let urlType = UTType.url.identifier
        if provider.hasItemConformingToTypeIdentifier(urlType) {
          provider.loadItem(forTypeIdentifier: urlType, options: nil) { [weak self] data, _ in
            var urlString: String?
            if let url = data as? URL { urlString = url.absoluteString }
            else if let str = data as? String { urlString = str }
            if let u = urlString { self?.submit(url: u) }
            else { self?.finish(success: false, message: "Could not read URL.") }
          }
          return
        }
        // Fallback: plain text
        let textType = UTType.plainText.identifier
        if provider.hasItemConformingToTypeIdentifier(textType) {
          provider.loadItem(forTypeIdentifier: textType, options: nil) { [weak self] data, _ in
            if let str = data as? String { self?.submit(url: str) }
            else { self?.finish(success: false, message: "Could not read text.") }
          }
          return
        }
      }
    }
    finish(success: false, message: "No URL found in share payload.")
  }

  // ── Submit to backend ──────────────────────────────────────────────────
  private func submit(url: String) {
    let defaults = UserDefaults(suiteName: kAppGroup)
    let serverUrl = keychainRead(key: kServerUrl)
      ?? defaults?.string(forKey: kServerUrl)
      ?? "https://mytubeapi.elladali.com"
    let token = keychainRead(key: kBearerToken)
      ?? defaults?.string(forKey: kBearerToken)
      ?? "a86ff4614dc198cdaaa004e344e2ea3656a88fbd07959ead78e7c496f426cfc4"

    guard let endpoint = URL(string: "\(serverUrl)/api/jobs") else {
      finish(success: false, message: "Invalid server URL.")
      return
    }

    DispatchQueue.main.async { self.statusLabel.text = "Sending to MyTube..." }

    var request = URLRequest(url: endpoint, timeoutInterval: 10)
    request.httpMethod = "POST"
    request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.httpBody = try? JSONSerialization.data(withJSONObject: ["url": url])

    URLSession.shared.dataTask(with: request) { [weak self] _, response, error in
      let statusCode = (response as? HTTPURLResponse)?.statusCode
      let ok = statusCode == 201
      let msg = ok
        ? "Added to queue ✓"
        : "Failed (HTTP \(statusCode ?? 0)). Check app settings."
      self?.finish(success: ok, message: msg)
    }.resume()
  }

  // ── Finish ─────────────────────────────────────────────────────────────
  private func finish(success: Bool, message: String) {
    DispatchQueue.main.async {
      self.spinner.stopAnimating()
      self.statusLabel.text = message
      self.iconView.image = UIImage(systemName: success
        ? "checkmark.circle.fill"
        : "xmark.circle.fill")
      self.iconView.tintColor = success ? .systemGreen : .systemRed
      DispatchQueue.main.asyncAfter(deadline: .now() + 1.8) {
        self.extensionContext?.completeRequest(returningItems: [], completionHandler: nil)
      }
    }
  }

  // ── Keychain helper ────────────────────────────────────────────────────
  // flutter_secure_storage with groupId writes to kSecAttrAccessGroup.
  // The access group must match the entitlement (team prefix is added by OS).
  private func keychainRead(key: String) -> String? {
    let query: [CFString: Any] = [
      kSecClass:           kSecClassGenericPassword,
      kSecAttrService:     "flutter_secure_storage_service",
      kSecAttrAccount:     key,
      kSecAttrAccessGroup: "com.mytube.mytubeMobile",
      kSecReturnData:      true,
      kSecMatchLimit:      kSecMatchLimitOne,
    ]
    var ref: AnyObject?
    guard SecItemCopyMatching(query as CFDictionary, &ref) == errSecSuccess,
          let data = ref as? Data,
          let str = String(data: data, encoding: .utf8)
    else { return nil }
    return str
  }
}
