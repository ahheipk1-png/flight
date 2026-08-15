"use client";

import { useLocale } from "@/lib/i18n/LocaleContext";
import type { AccountStatus } from "@/lib/types";
import type { MessageKey } from "@/lib/i18n/messages";

const COPY_KEYS: Record<Exclude<AccountStatus, "approved">, { title: MessageKey; body: MessageKey }> = {
  pending: { title: "accountStatus.pendingTitle", body: "accountStatus.pendingBody" },
  denied: { title: "accountStatus.deniedTitle", body: "accountStatus.deniedBody" },
  disabled: { title: "accountStatus.disabledTitle", body: "accountStatus.disabledBody" },
};

export function AccountStatusNotice({ status }: { status: Exclude<AccountStatus, "approved"> }) {
  const { t } = useLocale();
  const { title, body } = COPY_KEYS[status];
  return (
    <div className="mx-auto max-w-md py-16 text-center">
      <p className="text-lg font-semibold text-slate-800">{t(title)}</p>
      <p className="mt-2 text-sm text-slate-500">{t(body)}</p>
    </div>
  );
}
