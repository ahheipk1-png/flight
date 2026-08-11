"use client";

import Image from "next/image";
import { useLocale } from "@/lib/i18n/LocaleContext";
import type { MessageKey } from "@/lib/i18n/messages";
import type { SearchStage } from "@/lib/types";

const STAGE_KEY: Record<SearchStage, MessageKey> = {
  queued: "searching.stage.queued",
  generating: "searching.stage.generating",
  pruning: "searching.stage.pruning",
  verifying: "searching.stage.verifying",
  ranking: "searching.stage.ranking",
  done: "searching.stage.done",
  error: "searching.stage.error",
};

// Both illustrations render in this exact box (spec: "same visual box and
// same rendered dimensions so there is no layout jump when the state
// changes") and both are preloaded so the searching -> complete swap never
// flashes.
const ILLUSTRATION_BOX = "w-[min(420px,78vw)] aspect-[3/2] relative";

export function SearchingState({ stage }: { stage: SearchStage }) {
  const { t } = useLocale();
  return (
    <div className="flex flex-col items-center gap-6 py-12 text-center">
      <div className="rounded-3xl bg-white/70 p-6 shadow-sm ring-1 ring-slate-900/5">
        <div className={ILLUSTRATION_BOX}>
          <Image
            src="/brand/smartflighter-searching.png"
            alt=""
            fill
            sizes="420px"
            preload
            className="object-contain"
          />
        </div>
      </div>
      <div className="space-y-1.5">
        <p className="text-lg font-semibold text-slate-800">{t("searching.title")}</p>
        <p className="text-sm text-slate-500">{t(STAGE_KEY[stage])}</p>
      </div>
    </div>
  );
}

export function CompleteState() {
  const { t } = useLocale();
  return (
    <div className="flex flex-col items-center gap-6 py-12 text-center">
      <div className="rounded-3xl bg-white/70 p-6 shadow-sm ring-1 ring-slate-900/5">
        <div className={ILLUSTRATION_BOX}>
          <Image
            src="/brand/smartflighter-search-complete.png"
            alt=""
            fill
            sizes="420px"
            className="object-contain"
          />
        </div>
      </div>
      <p className="text-lg font-semibold text-slate-800">{t("complete.title")}</p>
    </div>
  );
}

// Preloaded off-screen so the browser already has the complete-state image
// cached the moment the searching state mounts -- otherwise the fade would
// stall on the first paint of a not-yet-fetched image.
export function PreloadCompleteIllustration() {
  return (
    <div className="hidden" aria-hidden>
      <Image src="/brand/smartflighter-search-complete.png" alt="" width={1} height={1} preload />
    </div>
  );
}
