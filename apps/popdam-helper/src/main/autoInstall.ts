/**
 * Install downloaded Helper updates without a tray Quit (#1423).
 *
 * electron-updater only installs a downloaded update when the app quits, and
 * users never quit the tray Helper. Once an update is downloaded and nothing is
 * checked out, restart into it silently. If files are checked out, wait until
 * the last one is checked in (or discarded), then install.
 */
export interface CheckoutLike {
  status: string;
}

export function hasOutstandingCheckouts(checkouts: CheckoutLike[]): boolean {
  return checkouts.some((c) => !["complete", "discarded"].includes(c.status));
}

export interface AutoInstallDeps {
  getCheckouts: () => CheckoutLike[];
  install: () => void;
  log: (msg: string) => void;
}

export function createAutoInstaller(deps: AutoInstallDeps) {
  let downloadedVersion: string | null = null;
  let installing = false;

  function tryInstall(): boolean {
    if (!downloadedVersion || installing) return false;
    if (hasOutstandingCheckouts(deps.getCheckouts())) {
      deps.log(`Update ${downloadedVersion} downloaded; waiting for checkouts to finish before installing`);
      return false;
    }
    installing = true;
    deps.log(`Installing update ${downloadedVersion} automatically (no outstanding checkouts)`);
    deps.install();
    return true;
  }

  return {
    onUpdateDownloaded(version: string): boolean {
      downloadedVersion = version;
      return tryInstall();
    },
    onCheckoutsChanged(): boolean {
      return tryInstall();
    },
  };
}
