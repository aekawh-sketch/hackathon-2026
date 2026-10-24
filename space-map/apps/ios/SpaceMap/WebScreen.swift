// WKWebView с сайтом: свои страницы — внутри приложения, чужие ссылки — в Safari.
// Камера (сканер QR-кода, съёмка «по шагам») и датчики ориентации — только своему сайту.
import SwiftUI
import UIKit
import WebKit

struct WebScreen: UIViewRepresentable {
    let startURL: URL

    func makeCoordinator() -> Coordinator {
        Coordinator(startURL: startURL)
    }

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        // Видео камеры — внутри страницы, а не на весь экран; звук и видео без лишнего касания.
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        // По этой метке сайт понимает, что открыт в приложении для iOS.
        let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0"
        config.applicationNameForUserAgent = "SpaceMapiOS/\(version)"
        config.websiteDataStore = .default()

        let web = WKWebView(frame: .zero, configuration: config)
        web.navigationDelegate = context.coordinator
        web.uiDelegate = context.coordinator
        // Свайп от края — назад, как в Safari.
        web.allowsBackForwardNavigationGestures = true
        web.scrollView.contentInsetAdjustmentBehavior = .never
        web.isOpaque = false
        web.backgroundColor = .systemBackground
        #if DEBUG
        if #available(iOS 16.4, *) { web.isInspectable = true }
        #endif
        context.coordinator.webView = web
        web.load(URLRequest(url: startURL))
        return web
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {}

    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate {
        let startURL: URL
        weak var webView: WKWebView?

        init(startURL: URL) {
            self.startURL = startURL
        }

        private func isOurs(_ url: URL?) -> Bool {
            guard let url else { return false }
            return url.scheme == startURL.scheme && url.host == startURL.host && url.port == startURL.port
        }

        // Свой сайт — здесь; почта, телефон и чужие сайты — системе.
        func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            guard let url = action.request.url else { return decisionHandler(.cancel) }
            if isOurs(url) || url.scheme == "about" || url.scheme == "data" || url.scheme == "blob" {
                return decisionHandler(.allow)
            }
            UIApplication.shared.open(url)
            decisionHandler(.cancel)
        }

        // target="_blank" со своего сайта — в этом же окне, чужое — в Safari.
        func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
            if let url = action.request.url {
                if isOurs(url) { webView.load(URLRequest(url: url)) } else { UIApplication.shared.open(url) }
            }
            return nil
        }

        func webView(_ webView: WKWebView, requestMediaCapturePermissionFor origin: WKSecurityOrigin, initiatedByFrame frame: WKFrameInfo, type: WKMediaCaptureType, decisionHandler: @escaping (WKPermissionDecision) -> Void) {
            decisionHandler(origin.host == startURL.host ? .grant : .deny)
        }

        func webView(_ webView: WKWebView, requestDeviceOrientationAndMotionPermissionFor origin: WKSecurityOrigin, initiatedByFrame frame: WKFrameInfo, decisionHandler: @escaping (WKPermissionDecision) -> Void) {
            decisionHandler(origin.host == startURL.host ? .grant : .deny)
        }

        // Нет связи с сервером — своя страница с «Повторить» вместо пустого экрана.
        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
            let failed = (error as NSError).userInfo[NSURLErrorFailingURLStringErrorKey] as? String ?? startURL.absoluteString
            if (error as NSError).code == NSURLErrorCancelled { return }
            webView.loadHTMLString(Self.offlinePage(url: failed, reason: error.localizedDescription), baseURL: nil)
        }

        static func offlinePage(url: String, reason: String) -> String {
            let safe = { (s: String) in s.replacingOccurrences(of: "&", with: "&amp;").replacingOccurrences(of: "<", with: "&lt;").replacingOccurrences(of: "\"", with: "&quot;") }
            return """
            <!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
            <style>body{margin:0;display:grid;place-items:center;height:100vh;font:16px/1.5 -apple-system,sans-serif;background:#e9edf3;color:#0e1726}
            @media (prefers-color-scheme:dark){body{background:#0d131d;color:#e8edf5}}
            main{max-width:360px;padding:24px;text-align:center}h1{font-size:20px;margin:0 0 8px}p{margin:0 0 16px;opacity:.8}
            a{display:inline-block;padding:12px 20px;border-radius:12px;background:#2f5bea;color:#fff;text-decoration:none;font-weight:600}</style>
            <main><h1>Сервер не отвечает</h1><p>\(safe(reason)). Проверьте интернет и попробуйте ещё раз.</p><a href="\(safe(url))">Повторить</a></main></html>
            """
        }
    }
}
