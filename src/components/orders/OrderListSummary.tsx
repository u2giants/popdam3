import type { OrderListSummaryCounts } from "@/lib/order-list";

type Props = { counts: OrderListSummaryCounts };

const NUMBER = new Intl.NumberFormat();

export function OrderListSummary({ counts }: Props) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
      <span>
        <strong className="text-foreground">{NUMBER.format(counts.filtered)}</strong> shown of{" "}
        {NUMBER.format(counts.total)} lines
      </span>
      <span>
        Linked to Master Data: <strong className="text-foreground">{NUMBER.format(counts.linked)}</strong>
      </span>
      <span className={counts.ambiguous > 0 ? "text-amber-600 dark:text-amber-400" : undefined}>
        Ambiguous: <strong>{NUMBER.format(counts.ambiguous)}</strong>
      </span>
      <span className={counts.unmatched > 0 ? "text-amber-600 dark:text-amber-400" : undefined}>
        Not linked: <strong>{NUMBER.format(counts.unmatched)}</strong>
      </span>
    </div>
  );
}

export default OrderListSummary;
