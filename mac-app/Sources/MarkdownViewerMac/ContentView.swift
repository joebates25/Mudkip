import AppKit
import Foundation
import SwiftUI
import UniformTypeIdentifiers
import WebKit

enum AppRuntimeLogger {
    static let logURL = URL(fileURLWithPath: NSTemporaryDirectory())
        .appendingPathComponent("markdown-viewer-mac.log")

    static func reset() {
        try? Data().write(to: logURL)
    }

    static func log(_ message: String) {
        let line = "[\(ISO8601DateFormatter().string(from: Date()))] \(message)\n"
        guard let data = line.data(using: .utf8) else {
            return
        }

        if FileManager.default.fileExists(atPath: logURL.path),
           let handle = try? FileHandle(forWritingTo: logURL) {
            defer { try? handle.close() }
            _ = try? handle.seekToEnd()
            try? handle.write(contentsOf: data)
            return
        }

        try? data.write(to: logURL)
    }
}

struct ContentView: View {
    @Environment(\.colorScheme) private var colorScheme
    @StateObject private var appModel = AppModel()

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 10) {
                Button("Open Markdown File", action: appModel.openMarkdownFileDialog)
                    .keyboardShortcut("o", modifiers: .command)
                Text(appModel.fileName)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            Divider()
            MarkdownWebView(appModel: appModel)
        }
        .onAppear {
            appModel.updateTheme(for: colorScheme)
        }
        .onChange(of: colorScheme) { newColorScheme in
            appModel.updateTheme(for: newColorScheme)
        }
    }
}

struct MarkdownWebView: NSViewRepresentable {
    @ObservedObject var appModel: AppModel

    func makeCoordinator() -> Coordinator {
        Coordinator(appModel: appModel)
    }

    func makeNSView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = context.coordinator
        appModel.attach(webView: webView)
        return webView
    }

    func updateNSView(_ nsView: WKWebView, context: Context) {}

    final class Coordinator: NSObject, WKNavigationDelegate {
        private let appModel: AppModel

        init(appModel: AppModel) {
            self.appModel = appModel
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            appModel.viewerDidFinishLoad()
        }
    }
}

@MainActor
final class AppModel: ObservableObject {
    @Published private(set) var fileName: String = "No file selected"

    private struct RenderPayload: Encodable {
        let markdownBase64: String
        let baseHref: String
        let fileName: String
        let theme: String
    }

    private var webView: WKWebView?
    private var viewerReady = false
    private var started = false
    private var pendingPayload: RenderPayload?
    private var themeClass = "vscode-dark"
    private let launchFilePath: String?

    init(launchFilePath: String? = AppModel.launchFilePathFromArguments()) {
        self.launchFilePath = launchFilePath
        log("AppModel initialized. launchFilePath=\(launchFilePath ?? "nil")")
        start()
    }

    func start() {
        guard !started else {
            return
        }
        started = true
        AppRuntimeLogger.reset()
        log("App start")

        if let launchFilePath {
            loadMarkdownFile(at: URL(fileURLWithPath: launchFilePath))
        }
    }

    func attach(webView: WKWebView) {
        self.webView = webView

        guard let viewerURL = Bundle.module.url(forResource: "viewer", withExtension: "html") else {
            log("ERROR: viewer.html resource not found.")
            return
        }

        let resourceDirectory = viewerURL.deletingLastPathComponent()
        webView.loadFileURL(viewerURL, allowingReadAccessTo: resourceDirectory)
    }

    func viewerDidFinishLoad() {
        viewerReady = true
        log("Viewer finished load")
        applyThemeOnlyIfNeeded()
        renderIfPossible()
    }

    func openMarkdownFileDialog() {
        let panel = NSOpenPanel()
        panel.canChooseFiles = true
        panel.canChooseDirectories = false
        panel.allowsMultipleSelection = false
        panel.allowedContentTypes = [
            .plainText,
            UTType(filenameExtension: "md"),
            UTType(filenameExtension: "markdown"),
            UTType(filenameExtension: "mdown"),
            UTType(filenameExtension: "mkd")
        ].compactMap { $0 }

        let response = panel.runModal()
        guard response == .OK, let selectedURL = panel.url else {
            return
        }

        loadMarkdownFile(at: selectedURL)
    }

    func updateTheme(for colorScheme: ColorScheme) {
        themeClass = (colorScheme == .light) ? "vscode-light" : "vscode-dark"
        if var payload = pendingPayload {
            payload = RenderPayload(
                markdownBase64: payload.markdownBase64,
                baseHref: payload.baseHref,
                fileName: payload.fileName,
                theme: themeClass
            )
            pendingPayload = payload
            renderIfPossible()
        } else {
            applyThemeOnlyIfNeeded()
        }
    }

    private func loadMarkdownFile(at url: URL) {
        do {
            let fileData = try Data(contentsOf: url)
            let markdownText = String(data: fileData, encoding: .utf8) ?? String(decoding: fileData, as: UTF8.self)
            let baseURL = url.deletingLastPathComponent()
            let baseHref = baseURL.appendingPathComponent("", isDirectory: true).absoluteString

            pendingPayload = RenderPayload(
                markdownBase64: fileData.base64EncodedString(),
                baseHref: baseHref,
                fileName: url.lastPathComponent,
                theme: themeClass
            )

            fileName = url.lastPathComponent
            log("Loaded markdown file: \(url.path) (\(markdownText.count) chars)")
            renderIfPossible()
        } catch {
            log("ERROR: Failed to read file at \(url.path): \(error)")
        }
    }

    private func renderIfPossible() {
        guard viewerReady, let webView, let payload = pendingPayload else {
            return
        }

        guard let payloadData = try? JSONEncoder().encode(payload),
              let payloadJSON = String(data: payloadData, encoding: .utf8) else {
            print("ERROR: Failed to encode render payload.")
            return
        }

        let script = "window.renderMarkdown(\(payloadJSON));"
        webView.evaluateJavaScript(script) { _, error in
            if let error {
                self.log("ERROR: JavaScript render failed: \(error.localizedDescription)")
            } else {
                self.log("Rendered markdown preview for \(payload.fileName)")
            }
        }
    }

    private func applyThemeOnlyIfNeeded() {
        guard viewerReady, let webView else {
            return
        }

        let script = """
        document.body.classList.remove('vscode-dark', 'vscode-light');
        document.body.classList.add('\(themeClass)');
        """
        webView.evaluateJavaScript(script)
    }

    private static func launchFilePathFromArguments() -> String? {
        let args = ProcessInfo.processInfo.arguments
        guard args.count > 1 else {
            return nil
        }

        let candidate = args[1]
        guard !candidate.hasPrefix("-") else {
            return nil
        }

        return candidate
    }

    private func log(_ message: String) {
        AppRuntimeLogger.log(message)
        print(message)
    }
}
