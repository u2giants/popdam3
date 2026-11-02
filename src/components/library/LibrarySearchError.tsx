import { Button } from "@/components/ui/button";

export default function LibrarySearchError({ searching, onRetry }: {
  searching: boolean;
  onRetry: () => void;
}) {
  return (
    <div role="alert" className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
      <p>{searching ? "Search unavailable. Please try again." : "Library unavailable. Please try again."}</p>
      <Button variant="outline" onClick={onRetry}>Retry</Button>
    </div>
  );
}
