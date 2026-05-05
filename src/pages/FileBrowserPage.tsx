import { FolderOpen } from "lucide-react";
import DirectoryBrowserTab from "@/components/settings/DirectoryBrowserTab";

export default function FileBrowserPage() {
  return (
    <div className="container max-w-4xl py-8 space-y-6">
      <div className="flex items-center gap-3">
        <FolderOpen className="h-6 w-6 text-primary" />
        <h1 className="text-2xl font-semibold">File Browser</h1>
      </div>
      <DirectoryBrowserTab />
    </div>
  );
}
