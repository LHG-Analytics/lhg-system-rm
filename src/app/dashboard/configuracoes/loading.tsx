export default function Loading() {
  return (
    <div className="flex flex-col gap-6 p-6 animate-pulse">
      <div className="h-8 w-48 rounded-lg bg-muted" />
      <div className="flex gap-2">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-9 w-28 rounded-lg bg-muted" />
        ))}
      </div>
      <div className="rounded-xl border bg-card p-6 flex flex-col gap-4">
        <div className="h-5 w-32 rounded bg-muted" />
        <div className="h-9 w-full rounded-lg bg-muted" />
        <div className="h-9 w-full rounded-lg bg-muted" />
        <div className="h-9 w-24 rounded-lg bg-muted ml-auto" />
      </div>
    </div>
  )
}
