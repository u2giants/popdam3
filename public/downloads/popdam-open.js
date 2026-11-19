// PopDAM's Windows URL handler. Windows Script Host supplies the link as data.
(function () {
    var prefix = "popdam://open-folder?path=";
    if (WScript.Arguments.length !== 1) {
        WScript.Quit(1);
    }

    var uri = WScript.Arguments.Item(0);
    if (uri.substring(0, prefix.length).toLowerCase() !== prefix) {
        WScript.Quit(1);
    }

    var path;
    try {
        path = decodeURIComponent(uri.substring(prefix.length)).replace(/\//g, "\\");
    } catch (error) {
        WScript.Quit(1);
    }

    // Accept drive-rooted paths and UNC shares, excluding device namespaces.
    var drivePath = /^[A-Za-z]:\\/.test(path);
    var sharePath = /^\\\\[^\\]+\\[^\\]+/.test(path) && path.indexOf("\\\\.\\") !== 0;
    if ((!drivePath && !sharePath) || /[<>:"|?*\x00-\x1f]/.test(path.substring(2))) {
        WScript.Quit(1);
    }

    var files = new ActiveXObject("Scripting.FileSystemObject");
    if (!files.FolderExists(path)) {
        path = files.GetParentFolderName(path);
    }
    if (!path || !files.FolderExists(path)) {
        WScript.Echo("Folder not found. Check that your NAS or Synology Drive is available.");
        WScript.Quit(1);
    }

    // Pass the directory to Explorer directly, without constructing a command line.
    new ActiveXObject("Shell.Application").Open(path);
}());
