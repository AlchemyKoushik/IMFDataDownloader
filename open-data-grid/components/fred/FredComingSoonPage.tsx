import { ExplorerPageShell } from "@/components/layout/ExplorerPageShell";
import { FredComingSoonContent } from "@/components/fred/FredComingSoonContent";

export function FredComingSoonPage() {
  return (
    <ExplorerPageShell
      description="The FRED workspace is being refined into the same clean, selection-aware, export-ready experience as the rest of Open Data Grid."
      stats={[
        { label: "Status", value: "Soon" },
        { label: "Live today", value: "IMF + World Bank" },
      ]}
      subheading="launching soon inside Open Data Grid"
      title="FRED"
    >
      <FredComingSoonContent />
    </ExplorerPageShell>
  );
}
