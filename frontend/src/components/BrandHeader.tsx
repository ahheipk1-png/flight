import Image from "next/image";

export function BrandHeader({ right }: { right?: React.ReactNode }) {
  return (
    <header className="border-b border-slate-200/70 bg-white/80 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-2.5 px-6 py-4">
        <div className="flex items-center gap-2.5">
          <Image src="/brand/logo-mark.png" alt="" width={28} height={28} preload />
          <span className="text-xl font-bold tracking-tight text-brand-navy">SmartFlighter</span>
        </div>
        {right}
      </div>
    </header>
  );
}
