#!/usr/bin/env bash
# PopDAM Protocol Handler Installer for macOS
# Run: bash install-popdam-protocol.sh
#
# This creates a minimal .app bundle that handles popdam:// URIs.
# It opens the target folder in Finder (or via smb:// for UNC paths).

set -euo pipefail

APP_NAME="PopDAM Opener"
APP_DIR="$HOME/Applications/${APP_NAME}.app"
CONTENTS_DIR="${APP_DIR}/Contents"
MACOS_DIR="${CONTENTS_DIR}/MacOS"
HANDLER_SCRIPT="${MACOS_DIR}/popdam-open"

echo "Installing PopDAM protocol handler..."

# Create .app bundle structure
mkdir -p "${MACOS_DIR}"

# Write Info.plist
cat > "${CONTENTS_DIR}/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleName</key>
    <string>PopDAM Opener</string>
    <key>CFBundleIdentifier</key>
    <string>com.popdam.opener</string>
    <key>CFBundleVersion</key>
    <string>1.0</string>
    <key>CFBundleExecutable</key>
    <string>popdam-open</string>
    <key>CFBundleURLTypes</key>
    <array>
        <dict>
            <key>CFBundleURLName</key>
            <string>PopDAM Protocol</string>
            <key>CFBundleURLSchemes</key>
            <array>
                <string>popdam</string>
            </array>
        </dict>
    </array>
</dict>
</plist>
PLIST

# Write handler script
cat > "${HANDLER_SCRIPT}" <<'SCRIPT'
#!/usr/bin/env bash
# PopDAM protocol handler — opens folder in Finder
# Receives: popdam://open-folder?path=<url-encoded-path>

URI="$1"

# Strip protocol prefix
ENCODED="${URI#popdam://open-folder?path=}"

# URL-decode using python3 (available on all macOS)
DECODED=$(python3 -c "import urllib.parse, sys; print(urllib.parse.unquote(sys.argv[1]))" "$ENCODED" 2>/dev/null || echo "$ENCODED")

if [ -z "$DECODED" ]; then
    osascript -e 'display alert "PopDAM" message "No path provided in the URI."'
    exit 1
fi

# Check if it's a UNC path (starts with \\)
if [[ "$DECODED" == \\\\* ]]; then
    # Convert \\host\share\path to smb://host/share/path
    SMB_PATH="${DECODED//\\//}"
    SMB_PATH="smb:${SMB_PATH}"
    open "$SMB_PATH"
elif [ -e "$DECODED" ]; then
    # Local path — open in Finder
    if [ -d "$DECODED" ]; then
        open "$DECODED"
    else
        open -R "$DECODED"  # Reveal file in Finder
    fi
else
    # Try parent directory
    PARENT=$(dirname "$DECODED")
    if [ -d "$PARENT" ]; then
        open "$PARENT"
    else
        osascript -e "display alert \"PopDAM\" message \"Path not found: $DECODED\nEnsure Synology Drive is synced or NAS is mounted.\""
    fi
fi
SCRIPT

chmod +x "${HANDLER_SCRIPT}"

# Register the handler with macOS Launch Services
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -u "${APP_DIR}" 2>/dev/null || true
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister "${APP_DIR}"

echo "✅ PopDAM protocol handler installed at: ${APP_DIR}"
echo "   The popdam:// URI scheme is now registered."
echo "   You may need to restart your browser for it to take effect."
