/**
 * afterSign hook for electron-builder — notarizes the macOS app.
 * Skips silently if APPLE_ID is not set (dev builds, unsigned CI runs).
 * Add APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID to GitHub Actions
 * secrets to enable notarization.
 */
const { notarize } = require("@electron/notarize");

module.exports = async function notarizeApp(context) {
  if (process.platform !== "darwin") return;

  const { APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID } = process.env;
  if (!APPLE_ID || !APPLE_APP_SPECIFIC_PASSWORD || !APPLE_TEAM_ID) {
    console.log("Notarization skipped — APPLE_ID not configured");
    return;
  }

  const { appOutDir, packager } = context;
  const appName = packager.appInfo.productFilename;
  const appPath = `${appOutDir}/${appName}.app`;

  console.log(`Notarizing ${appPath}…`);
  await notarize({
    tool: "notarytool",
    appPath,
    appleId: APPLE_ID,
    appleIdPassword: APPLE_APP_SPECIFIC_PASSWORD,
    teamId: APPLE_TEAM_ID,
  });
  console.log("Notarization complete");
};
