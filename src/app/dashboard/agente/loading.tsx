export default function AgenteLoading() {
  return (
    <div className="flex flex-col gap-4 animate-pulse h-[calc(100vh-8rem)]">
      <div className="flex items-center gap-3">
        <div className="h-7 w-36 rounded-md bg-muted" />
        <div className="h-5 w-20 rounded-full bg-muted" />
      </div>
      <div className="flex flex-1 gap-4 min-h-0">
        {/* Sidebar de histórico */}
        <div className="w-56 shrink-0 rounded-xl border bg-card p-3 flex flex-col gap-2">
          <div className="h-4 w-24 rounded bg-muted" />
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-9 w-full rounded-md bg-muted" />
          ))}
        </div>
        {/* Card principal */}
        <div className="flex-1 rounded-xl border bg-card flex flex-col">
          <div className="border-b p-3 flex gap-2">
            <div className="h-8 w-16 rounded-md bg-muted" />
            <div className="h-8 w-20 rounded-md bg-muted" />
          </div>
          <div className="flex-1 p-4 flex flex-col gap-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className={`h-16 rounded-lg bg-muted ${i % 2 === 1 ? 'ml-8' : 'mr-8'}`} />
            ))}
          </div>
          <div className="border-t p-3">
            <div className="h-10 w-full rounded-md bg-muted" />
          </div>
        </div>
      </div>
    </div>
  )
}
