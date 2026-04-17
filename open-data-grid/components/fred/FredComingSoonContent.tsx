import Link from "next/link";

interface FredComingSoonContentProps {
  compact?: boolean;
  onNavigate?: () => void;
  titleId?: string;
}

const FEATURE_ITEMS = [
  {
    title: "Smart series discovery",
    description: "Search, compare, and shortlist FRED series with a tighter research-focused flow.",
  },
  {
    title: "Selection-aware ranges",
    description: "Year windows will follow the combined coverage of the series you choose.",
  },
  {
    title: "Blank-year preservation",
    description: "Missing years inside your selected span stay blank so exports remain honest and readable.",
  },
  {
    title: "Excel-ready handoff",
    description: "Normalized annual output with the same polished download experience as the live modules.",
  },
];

export function FredComingSoonContent({ compact = false, onNavigate, titleId }: FredComingSoonContentProps) {
  return (
    <div className={`fredComingSoonCard${compact ? " fredComingSoonCard-compact" : ""}`}>
      <div className="fredComingSoonTopline">
        <span className="fredComingSoonKicker">FRED Workspace</span>
        <span className="fredComingSoonBadge">Coming Soon</span>
      </div>

      <div className="fredComingSoonHeadlineRow">
        <div>
          <h2 id={titleId}>We&apos;re giving FRED the full Open Data Grid treatment.</h2>
          <p className="fredComingSoonLead">
            The foundation is in place, but the launch experience still needs polish. We&apos;re holding it back until it feels
            as cohesive and dependable as IMF and World Bank.
          </p>
        </div>

        <div className="fredComingSoonPulse" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
      </div>

      <div className="fredComingSoonFeatureGrid">
        {FEATURE_ITEMS.map((item, index) => (
          <article key={item.title} className="fredComingSoonFeatureCard">
            <span className="fredComingSoonFeatureIndex">{index + 1}</span>
            <strong>{item.title}</strong>
            <p>{item.description}</p>
          </article>
        ))}
      </div>

      <div className="fredComingSoonStatusRow">
        <div className="fredComingSoonStatus">
          <span className="fredComingSoonStatusDot" aria-hidden="true" />
          IMF and World Bank are fully live right now.
        </div>

        <div className="fredComingSoonActionRow">
          <Link className="fredComingSoonPrimary" href="/imf" onClick={onNavigate}>
            Open IMF
          </Link>
          <Link className="fredComingSoonSecondary" href="/worldbank" onClick={onNavigate}>
            Open World Bank
          </Link>
        </div>
      </div>
    </div>
  );
}
