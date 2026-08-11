import type { AccountStatus } from "@/lib/types";

const COPY: Record<Exclude<AccountStatus, "approved">, { title: string; body: string }> = {
  pending: {
    title: "Waiting for approval",
    body: "An admin needs to approve your account before you can search. Check back soon.",
  },
  denied: {
    title: "Account request denied",
    body: "This account request wasn't approved. Contact whoever runs this site if you think that's a mistake.",
  },
  disabled: {
    title: "Account disabled",
    body: "This account has been disabled. Contact whoever runs this site for details.",
  },
};

export function AccountStatusNotice({ status }: { status: Exclude<AccountStatus, "approved"> }) {
  const { title, body } = COPY[status];
  return (
    <div className="mx-auto max-w-md py-16 text-center">
      <p className="text-lg font-semibold text-slate-800">{title}</p>
      <p className="mt-2 text-sm text-slate-500">{body}</p>
    </div>
  );
}
