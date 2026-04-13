export default function Loading() {
  return (
    <div className="flex flex-1 flex-col gap-6">
      <div className="flex flex-col gap-2">
        <div className="h-8 w-48 rounded-md bg-muted animate-pulse" />
        <div className="h-4 w-80 rounded bg-muted animate-pulse" />
      </div>
      <div className="rounded-xl border bg-card p-5 flex flex-col gap-4">
        <div className="h-5 w-40 rounded bg-muted animate-pulse" />
        <div className="flex flex-col gap-3">
          {[1, 2].map((i) => (
            <div key={i} className="rounded-lg border bg-muted/20 p-3 flex flex-col gap-2">
              <div className="h-4 w-32 rounded bg-muted animate-pulse" />
              <div className="h-10 rounded-md border bg-background animate-pulse" />
            </div>
          ))}
        </div>
        <div className="flex flex-col gap-2 pt-2">
          <div className="h-4 w-36 rounded bg-muted animate-pulse" />
          <div className="h-8 rounded-md bg-muted animate-pulse" />
          <div className="h-8 rounded-md bg-muted animate-pulse" />
          <div className="h-8 rounded-md bg-muted animate-pulse" />
        </div>
      </div>
    </div>
  )
}
