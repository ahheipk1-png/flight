import Image from "next/image";

export function BrandHeader() {
  return (
    <header className="border-b border-slate-200/70 bg-white/80 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center gap-2.5 px-6 py-4">
        <Image src="/brand/logo-mark.png" alt="" width={28} height={28} preload />
        <span className="text-xl font-bold tracking-tight text-brand-navy">SmartFlighter</span>
      </div>
    </header>
  );
}
