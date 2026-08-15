"use client";

import { useEffect, useRef, useState } from "react";
import { useLocale } from "@/lib/i18n/LocaleContext";
import type { AccountStatus } from "@/lib/types";

interface AccountMenuProps {
  username: string;
  status: AccountStatus | null;
  isAdmin: boolean;
  onOpenSettings: () => void;
  onOpenAdmin: () => void;
  onLogout: () => void;
}

const STATUS_KEY = {
  pending: "status.pending",
  approved: "status.approved",
  denied: "status.denied",
  disabled: "status.disabled",
} as const;

const STATUS_CLASS = {
  pending: "bg-amber-100 text-amber-700",
  approved: "bg-emerald-100 text-emerald-700",
  denied: "bg-red-100 text-red-700",
  disabled: "bg-slate-200 text-slate-600",
} as const;

// Hand-rolled rather than pulling in a headless-menu library: the rest of
// this app's interactive chrome (LanguageSwitcher, AuthForms' tabs) is
// plain Tailwind + useState, and one dropdown doesn't justify a new
// dependency.
export function AccountMenu({ username, status, isAdmin, onOpenSettings, onOpenAdmin, onLogout }: AccountMenuProps) {
  const { t } = useLocale();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  function choose(action: () => void) {
    setOpen(false);
    action();
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-200"
      >
        {username}
        <span aria-hidden className={`text-xs transition-transform ${open ? "rotate-180" : ""}`}>
          ▾
        </span>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 z-20 mt-2 w-56 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg"
        >
          <div className="border-b border-slate-100 px-4 py-3">
            <p className="truncate text-sm font-semibold text-slate-800">{username}</p>
            {status && (
              <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_CLASS[status]}`}>
                {t(STATUS_KEY[status])}
              </span>
            )}
          </div>

          <button type="button" role="menuitem" onClick={() => choose(onOpenSettings)} className={ITEM_CLASS}>
            {t("nav.settings")}
          </button>
          {isAdmin && (
            <button type="button" role="menuitem" onClick={() => choose(onOpenAdmin)} className={ITEM_CLASS}>
              {t("nav.admin")}
            </button>
          )}
          <div className="border-t border-slate-100" />
          <button
            type="button"
            role="menuitem"
            onClick={() => choose(onLogout)}
            className={`${ITEM_CLASS} text-slate-500`}
          >
            {t("nav.logout")}
          </button>
        </div>
      )}
    </div>
  );
}

const ITEM_CLASS = "block w-full px-4 py-2.5 text-left text-sm text-slate-700 transition-colors hover:bg-slate-50";
