export default function DashboardLoading() {
  return (
    <div className="flex flex-col gap-4 animate-pulse">
      {/* Header skeleton */}
      <div className="flex items-center justify-between">
        <div className="h-7 w-48 rounded-md bg-muted" />
        <div className="h-8 w-64 rounded-md bg-muted" />
      </div>

      {/* KPI cards skeleton */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="rounded-xl border bg-card p-4 flex flex-col gap-2">
            <div className="h-3.5 w-24 rounded bg-muted" />
            <div className="h-6 w-32 rounded bg-muted" />
            <div className="h-3 w-16 rounded bg-muted" />
          </div>
        ))}
      </div>

      {/* Chart skeleton */}
      <div className="rounded-xl border bg-card p-4 flex flex-col gap-3">
        <div className="h-4 w-40 rounded bg-muted" />
        <div className="h-64 w-full rounded bg-muted" />
      </div>
    </div>
  )
}
