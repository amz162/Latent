"use client";

export function BrandMark({ size = "md" }: { size?: "sm" | "md" | "lg" }) {
  const dims = size === "sm" ? "h-5 w-5" : size === "lg" ? "h-9 w-9" : "h-7 w-7";
  const text = size === "sm" ? "text-base" : size === "lg" ? "text-2xl" : "text-lg";

  return (
    <div className="flex items-center gap-2.5">
      <div className={`${dims} rounded-md bg-[#00E676] latent-glow-green-sm flex items-center justify-center`}>
        <span className="font-mono font-black text-[#0A0E1A] text-xs">L</span>
      </div>
      <span className={`font-bold ${text} tracking-tight text-[#F4F7FB]`}>
        Latent<span className="text-[#00E676]">.pk</span>
      </span>
    </div>
  );
}
