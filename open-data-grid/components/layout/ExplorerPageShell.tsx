import type { ReactNode } from "react";

interface StatItem {
  label: string;
  value: number | string;
}

interface ExplorerPageShellProps {
  children: ReactNode;
  description: string;
  stats: StatItem[];
  subheading: string;
  title: string;
}

export function ExplorerPageShell({ children, description, stats, subheading, title }: ExplorerPageShellProps) {
  return (
    <main className="pageShell">
      <section className="heroPanel">
        <div className="heroCopy">
          <h1>{title}</h1>
          <p className="heroSubheading">{subheading}</p>
          <p className="heroDescription">{description}</p>

          <div className="statsRow" aria-label="Catalog statistics">
            {stats.map((stat) => (
              <div key={stat.label} className="statCard">
                <strong>{stat.value}</strong>
                <span>{stat.label}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="downloadCard">{children}</div>
      </section>
    </main>
  );
}
