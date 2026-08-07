"use client";

export function MonitorPlaceholderPage({
  title,
  description,
  note = "二期交付 · 后端 multi / 导入能力可按规格接入",
}: {
  title: string;
  description: string;
  note?: string;
}) {
  return (
    <div className="rounded-xl border border-border/70 bg-card/50 p-8">
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
        {description}
      </p>
      <p className="mt-4 text-xs text-muted-foreground">{note}</p>
    </div>
  );
}
