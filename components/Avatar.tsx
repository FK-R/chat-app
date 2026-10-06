/* eslint-disable @next/next/no-img-element */
export default function Avatar({ name, src, size = 36, online }: { name?: string | null; src?: string | null; size?: number; online?: boolean }) {
  const initial = (name?.trim()?.[0] ?? "?").toUpperCase();
  return (
    <span className="relative inline-flex shrink-0" style={{ width: size, height: size }}>
      {src ? (
        <img src={src} alt="" referrerPolicy="no-referrer" className="h-full w-full rounded-full object-cover" />
      ) : (
        <span className="flex h-full w-full items-center justify-center rounded-full bg-slate-300 text-sm font-medium text-slate-700">{initial}</span>
      )}
      {online !== undefined && (
        <span className={`absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full ring-2 ring-white ${online ? "bg-emerald-500" : "bg-slate-300"}`} />
      )}
    </span>
  );
}
