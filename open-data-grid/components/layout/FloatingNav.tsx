"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_ITEMS = [
  { href: "/imf", label: "IMF" },
  { href: "/worldbank", label: "World Bank" },
];

export function FloatingNav() {
  const pathname = usePathname();

  return (
    <div className="floatingNavWrap">
      <nav className="floatingNav" aria-label="Primary">
        <div className="brandLockup" aria-label="Alchemy's Open Data Grid">
          <span className="brandMark" aria-hidden="true">
            <Image
              alt=""
              className="brandLogoImage"
              height={52}
              priority
              src="/header-logo-title.jpg"
              width={52}
            />
          </span>
          <span className="brandText">Alchemy's Open Data Grid</span>
        </div>

        <div className="navActions">
          {NAV_ITEMS.map((item) => {
            const isActive = pathname === item.href;

            return (
              <Link
                key={item.href}
                className={`navButton${isActive ? " navButton-active" : ""}`}
                href={item.href}
                aria-current={isActive ? "page" : undefined}
              >
                {item.label}
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
