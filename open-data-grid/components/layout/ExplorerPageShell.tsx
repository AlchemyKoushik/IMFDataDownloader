import type { ReactNode } from "react";

interface StatItem {
  label: string;
  value: number | string;
}

interface ExplorerPageShellProps {
  children: ReactNode;
  description: string;
  eyebrow: string;
  stats: StatItem[];
  title: string;
}

export function ExplorerPageShell({ children, description, eyebrow, stats, title }: ExplorerPageShellProps) {
  return (
    <main className="pageShell">
      <section className="heroPanel">
        <div className="heroCopy">
          <span className="eyebrow">{eyebrow}</span>
          <h1>{title}</h1>
          <p>{description}</p>

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
