export default function DashboardPage() {
  return (
    <div className="flex flex-1 flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          Visão geral de preços e disponibilidade
        </p>
      </div>

      {/* KPI placeholder grid */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {['Ocupação', 'RevPAR', 'ADR', 'TRevPAR'].map((kpi) => (
          <div
            key={kpi}
            className="rounded-xl border bg-card p-6 text-card-foreground shadow-sm"
          >
            <p className="text-sm font-medium text-muted-foreground">{kpi}</p>
            <p className="mt-2 text-2xl font-bold">—</p>
            <p className="text-xs text-muted-foreground mt-1">Em breve</p>
          </div>
        ))}
      </div>

      <div className="flex flex-1 items-center justify-center rounded-xl border border-dashed">
        <p className="text-sm text-muted-foreground">
          Conteúdo do dashboard em desenvolvimento
        </p>
      </div>
    </div>
  )
}
