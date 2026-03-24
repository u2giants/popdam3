// PopDAM Helper — Mac URL scheme handler
//
// Handles popdam://open-folder?path=<encoded-path> by revealing the
// folder in Finder (NSWorkspace.open). The app is a background-only
// LSUIElement app: no Dock icon, no window, quits after handling the URL.
//
// Build:
//   swiftc -framework Cocoa main.swift -o "PopDAM Helper"
//
// Bundle:
//   mkdir -p "PopDAM Helper.app/Contents/MacOS"
//   cp "PopDAM Helper" "PopDAM Helper.app/Contents/MacOS/"
//   cp Info.plist "PopDAM Helper.app/Contents/"
//
// Install:
//   Move "PopDAM Helper.app" to /Applications (or anywhere), then open it
//   once. macOS registers the popdam:// scheme automatically on first launch.

import Cocoa

class AppDelegate: NSObject, NSApplicationDelegate {

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSAppleEventManager.shared().setEventHandler(
            self,
            andSelector: #selector(handleGetURL(event:replyEvent:)),
            forEventClass: AEEventClass(kInternetEventClass),
            andEventID: AEEventID(kAEGetURL)
        )
        // If no URL arrives within 2 s (e.g. user double-clicked the app to
        // register it), just quit quietly.
        DispatchQueue.main.asyncAfter(deadline: .now() + 2.0) {
            NSApp.terminate(nil)
        }
    }

    @objc func handleGetURL(event: NSAppleEventDescriptor, replyEvent: NSAppleEventDescriptor) {
        defer {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
                NSApp.terminate(nil)
            }
        }

        guard
            let urlString = event.paramDescriptor(forKeyword: keyDirectObject)?.stringValue,
            let components = URLComponents(string: urlString),
            let pathItem = components.queryItems?.first(where: { $0.name == "path" }),
            let rawPath = pathItem.value,
            !rawPath.isEmpty
        else { return }

        // Normalize backslashes → forward slashes.
        // The web app may encode Windows-style UNC paths (\\host\share\folder)
        // or Synology Drive paths that use backslashes — both work as POSIX
        // paths once converted (Synology Drive syncs to a local Mac path).
        let normalizedPath = rawPath.replacingOccurrences(of: "\\", with: "/")

        let url = URL(fileURLWithPath: normalizedPath)
        NSWorkspace.shared.open(url)
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.run()
