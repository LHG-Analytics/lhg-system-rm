import type { CompanyKPIResponse, BookingsKPIResponse } from '@/lib/lhg-analytics/types'

function formatCurrency(value: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value)
}

function formatPercent(value: number) {
  return `${value.toFixed(1)}%`
}

function formatNumber(value: number) {
  return new Intl.NumberFormat('pt-BR').format(Math.round(value))
}

function formatTime(hours: number) {
  const h = Math.floor(hours)
  const m = Math.round((hours - h) * 60)
  return `${h}h${m > 0 ? `${m}m` : ''}`
}

function delta(current: number, previous: number) {
  if (previous === 0) return null
  const pct = ((current - previous) / previous) * 100
  return pct
}

interface KPICardProps {
  label: string
  value: string
  previous?: string
  deltaPct?: number | null
  description?: string
}

function KPICard({ label, value, previous, deltaPct, description }: KPICardProps) {
  const isPositive = deltaPct !== null && deltaPct !== undefined && deltaPct > 0
  const isNegative = deltaPct !== null && deltaPct !== undefined && deltaPct < 0

  return (
    <div className="rounded-xl border bg-card p-5 text-card-foreground shadow-sm">
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{label}</p>
      <p className="mt-2 text-2xl font-bold tabular-nums">{value}</p>
      {deltaPct !== null && deltaPct !== undefined && (
        <p className={`text-xs mt-1 ${isPositive ? 'text-emerald-500' : isNegative ? 'text-rose-500' : 'text-muted-foreground'}`}>
          {isPositive ? '▲' : isNegative ? '▼' : ''}
          {' '}{Math.abs(deltaPct).toFixed(1)}% vs período anterior
        </p>
      )}
      {description && !deltaPct && (
        <p className="text-xs text-muted-foreground mt-1">{description}</p>
      )}
    </div>
  )
}

interface DashboardKPICardsProps {
  company: CompanyKPIResponse | null
  bookings: BookingsKPIResponse | null
}

export function DashboardKPICards({ company, bookings }: DashboardKPICardsProps) {
  if (!company) {
    return (
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {['Ocupação', 'RevPAR', 'Ticket Médio', 'TRevPAR'].map((label) => (
          <div key={label} className="rounded-xl border bg-card p-5 shadow-sm">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{label}</p>
            <p className="mt-2 text-2xl font-bold text-muted-foreground">—</p>
            <p className="text-xs text-muted-foreground mt-1">Dados indisponíveis</p>
          </div>
        ))}
      </div>
    )
  }

  const r = company.TotalResult
  const bn = company.BigNumbers[0]
  const cur = bn?.currentDate
  const prev = bn?.previousDate

  const cards: KPICardProps[] = [
    {
      label: 'Taxa de Ocupação',
      value: formatPercent(r.totalOccupancyRate),
      deltaPct: prev ? delta(cur.totalAllRentalsApartments, prev.totalAllRentalsApartmentsPreviousData) : null,
    },
    {
      label: 'RevPAR',
      value: formatCurrency(r.totalRevpar),
      deltaPct: prev ? delta(cur.totalAllValue, prev.totalAllValuePreviousData) : null,
    },
    {
      label: 'Ticket Médio',
      value: formatCurrency(r.totalAllTicketAverage),
      deltaPct: prev ? delta(cur.totalAllTicketAverage, prev.totalAllTicketAveragePreviousData) : null,
    },
    {
      label: 'TRevPAR',
      value: formatCurrency(r.totalTrevpar),
      deltaPct: prev ? delta(cur.totalAllTrevpar, prev.totalAllTrevparPreviousData) : null,
    },
    {
      label: 'Locações',
      value: formatNumber(r.totalAllRentalsApartments),
      deltaPct: prev ? delta(cur.totalAllRentalsApartments, prev.totalAllRentalsApartmentsPreviousData) : null,
    },
    {
      label: 'Faturamento',
      value: formatCurrency(r.totalAllValue),
      deltaPct: prev ? delta(cur.totalAllValue, prev.totalAllValuePreviousData) : null,
    },
    {
      label: 'Giro',
      value: r.totalGiro.toFixed(2),
      deltaPct: prev ? delta(cur.totalAllGiro, prev.totalAllGiroPreviousData) : null,
    },
    {
      label: 'Tempo Médio',
      value: formatTime(r.totalAverageOccupationTime),
      deltaPct: prev ? delta(cur.totalAverageOccupationTime, prev.totalAverageOccupationTimePreviousData) : null,
    },
  ]

  // Add bookings card if available
  if (bookings?.BigNumbers?.[0]) {
    const bCur = bookings.BigNumbers[0].currentDate
    const bPrev = bookings.BigNumbers[0].previousDate
    cards.splice(4, 0, {
      label: 'Reservas Online',
      value: formatNumber(bCur.totalAllBookings),
      deltaPct: bPrev ? delta(bCur.totalAllBookings, bPrev.totalAllBookingsPreviousData) : null,
    })
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {cards.map((card) => (
        <KPICard key={card.label} {...card} />
      ))}
    </div>
  )
}
