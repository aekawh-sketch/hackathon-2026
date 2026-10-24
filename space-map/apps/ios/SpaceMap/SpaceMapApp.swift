// «Карта пространства» для iPhone и iPad: тот же сайт в WKWebView — кабинет, редактор и карты.
// Адрес сайта — ключ SpaceMapStartURL в Info.plist (build setting SPACE_MAP_START_URL в project.yml).
import SwiftUI

@main
struct SpaceMapApp: App {
    var body: some Scene {
        WindowGroup {
            WebScreen(startURL: Self.startURL)
                // Сайт сам отступает от выреза и полосы жестов (env(safe-area-inset-*)), поэтому — на весь экран.
                .ignoresSafeArea()
        }
    }

    static var startURL: URL {
        let raw = Bundle.main.object(forInfoDictionaryKey: "SpaceMapStartURL") as? String
        return URL(string: raw ?? "") ?? URL(string: "https://193-233-88-64.sslip.io/app")!
    }
}
