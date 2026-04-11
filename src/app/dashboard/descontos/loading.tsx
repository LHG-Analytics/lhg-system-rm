export default function DescontosLoading() {
  return (
    <div className="flex flex-col gap-6 animate-pulse">
      <div className="h-7 w-36 rounded-md bg-muted" />
      <div className="rounded-xl border bg-card p-6 flex flex-col gap-4">
        <div className="h-5 w-52 rounded bg-muted" />
        <div className="h-28 w-full rounded-lg border-2 border-dashed bg-muted/40" />
        <div className="h-9 w-full rounded-md bg-muted" />
      </div>
      <div className="rounded-xl border bg-card p-4 flex flex-col gap-3">
        <div className="h-4 w-40 rounded bg-muted" />
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-14 w-full rounded-md bg-muted" />
        ))}
      </div>
    </div>
  )
}
