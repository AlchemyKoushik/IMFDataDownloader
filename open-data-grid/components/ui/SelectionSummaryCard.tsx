interface SelectionSummaryItem {
  caption?: string;
  details?: string[];
  title: string;
}

interface SelectionSummaryCardProps {
  emptyMessage?: string;
  items: SelectionSummaryItem[];
}

export function SelectionSummaryCard({
  emptyMessage = "No selection yet.",
  items,
}: SelectionSummaryCardProps) {
  const visibleItems = items.filter((item) => item.title.trim());

  return (
    <div className="selectionPreview detailPreview" aria-live="polite">
      {visibleItems.length ? (
        visibleItems.map((item) => (
          <div key={`${item.title}-${item.caption ?? ""}`} className="summaryBlock">
            <strong>{item.title}</strong>
            {item.caption ? <span>{item.caption}</span> : null}
            {item.details?.map((detail) => (
              <small key={`${item.title}-${detail}`}>{detail}</small>
            ))}
          </div>
        ))
      ) : (
        <span>{emptyMessage}</span>
      )}
    </div>
  );
}
