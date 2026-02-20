import { Download } from "lucide-react";

export default function DownloadsPage() {
  return (
    <div className="container max-w-4xl py-8 space-y-6">
      <div className="flex items-center gap-3">
        <Download className="h-6 w-6 text-primary" />
        <h1 className="text-2xl font-semibold">Downloads</h1>
      </div>
      <p className="text-muted-foreground">
        Agent downloads and installation instructions will appear here.
      </p>
    </div>
  );
}
