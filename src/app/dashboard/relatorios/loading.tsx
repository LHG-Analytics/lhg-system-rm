export default function RelatoriosLoading() {
  return (
    <div className="flex h-full gap-0">
      {/* Sidebar skeleton */}
      <div className="w-60 border-r flex-shrink-0 p-4 space-y-3">
        <div className="h-8 bg-muted animate-pulse rounded" />
        <div className="h-px bg-border" />
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-12 bg-muted animate-pulse rounded" />
        ))}
      </div>
      {/* Main area skeleton */}
      <div className="flex-1 p-6 space-y-4 overflow-auto">
        <div className="h-32 bg-muted animate-pulse rounded-xl" />
        <div className="h-16 bg-muted animate-pulse rounded-xl" />
        <div className="h-40 bg-muted animate-pulse rounded-xl" />
        <div className="h-64 bg-muted animate-pulse rounded-xl" />
      </div>
    </div>
  )
}
