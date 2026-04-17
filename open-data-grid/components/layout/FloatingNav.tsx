"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

import { FredComingSoonModal } from "@/components/fred/FredComingSoonModal";

const NAV_ITEMS = [
  { href: "/imf", label: "IMF" },
  { href: "/worldbank", label: "World Bank" },
  { href: "/fred", label: "FRED", comingSoon: true },
];

export function FloatingNav() {
  const pathname = usePathname();
  const [isFredModalOpen, setIsFredModalOpen] = useState(false);

  return (
    <>
      <div className="floatingNavWrap">
        <nav className="floatingNav" aria-label="Primary">
          <div className="brandLockup" aria-label="Open Data Grid, powered by Alchemy Research & Analytics">
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
            <span className="brandText">
              <span className="brandTitle">Open Data Grid</span>
              <span className="brandSubtitle">powered by Alchemy Research &amp; Analytics</span>
            </span>
          </div>

          <div className="navActions">
            {NAV_ITEMS.map((item) => {
              const isActive = pathname === item.href;

              if (item.comingSoon) {
                return (
                  <button
                    key={item.href}
                    aria-current={isActive ? "page" : undefined}
                    className={`navButton navButton-comingSoon${isActive ? " navButton-active" : ""}`}
                    type="button"
                    onClick={() => setIsFredModalOpen(true)}
                  >
                    <span className="navButtonLabel">{item.label}</span>
                    <span className="navSoonBadge">Soon</span>
                  </button>
                );
              }

              return (
                <Link
                  key={item.href}
                  aria-current={isActive ? "page" : undefined}
                  className={`navButton${isActive ? " navButton-active" : ""}`}
                  href={item.href}
                >
                  {item.label}
                </Link>
              );
            })}
          </div>
        </nav>
      </div>

      <FredComingSoonModal isOpen={isFredModalOpen} onClose={() => setIsFredModalOpen(false)} />
    </>
  );
}
