// ─── Auth ────────────────────────────────────────────────────────────────────

export interface LHGAuthResponse {
  access_token: string
  token_type: string
  expires_in: number // seconds (typically 3600)
  refresh_token?: string
}

// ─── Company KPIs ─────────────────────────────────────────────────────────────

export interface CompanyBigNumbersCurrentDate {
  totalAllValue: number
  totalAllRentalsApartments: number
  totalAllTicketAverage: number
  totalAllTrevpar: number
  totalAllGiro: number
  totalAverageOccupationTime: number
}

export interface CompanyBigNumbersPreviousDate {
  totalAllValuePreviousData: number
  totalAllRentalsApartmentsPreviousData: number
  totalAllTicketAveragePreviousData: number
  totalAllTrevparPreviousData: number
  totalAllGiroPreviousData: number
  totalAverageOccupationTimePreviousData: number
}

export interface CompanyBigNumbersMonthlyForecast {
  totalAllValueForecast: number
  totalAllRentalsApartmentsForecast: number
  totalAllTicketAverageForecast: number
  totalAllTrevparForecast: number
  totalAllGiroForecast: number
  totalAverageOccupationTimeForecast: number
}

export interface CompanyBigNumbers {
  currentDate: CompanyBigNumbersCurrentDate
  previousDate: CompanyBigNumbersPreviousDate
  monthlyForecast: CompanyBigNumbersMonthlyForecast
}

export interface CompanyTotalResult {
  totalAllRentalsApartments: number
  totalAllValue: number
  totalAllTicketAverage: number
  totalGiro: number
  totalRevpar: number
  totalTrevpar: number
  totalAverageOccupationTime: number
  totalOccupancyRate: number
}

export interface ChartDataPoint {
  date?: string
  label?: string
  value: number
  [key: string]: unknown
}

export interface BillingRentalTypeItem {
  rentalType: string
  value: number
  percent: number
}

export interface SuiteCategoryDataPoint {
  suiteCategory: string
  value: number
  [key: string]: unknown
}

export interface DataTableSuiteCategory {
  suiteCategory: string
  rentals: number
  revenue: number
  ticketAverage: number
  giro: number
  revpar: number
  trevpar: number
  occupancyRate: number
  averageOccupationTime: number
}

export interface DataTableByWeek {
  weekDay: string
  [key: string]: unknown
}

export interface CompanyKPIResponse {
  BigNumbers: CompanyBigNumbers[]
  TotalResult: CompanyTotalResult
  BillingRentalType: BillingRentalTypeItem[]
  RevenueByDate: ChartDataPoint[]
  RevenueBySuiteCategory: SuiteCategoryDataPoint[]
  RentalsByDate: ChartDataPoint[]
  RevparByDate: ChartDataPoint[]
  TicketAverageByDate: ChartDataPoint[]
  TrevparByDate: ChartDataPoint[]
  GiroByDate: ChartDataPoint[]
  OccupancyRateByDate: ChartDataPoint[]
  OccupancyRateBySuiteCategory: SuiteCategoryDataPoint[]
  DataTableSuiteCategory: DataTableSuiteCategory[]
  DataTableOccupancyRateByWeek: DataTableByWeek[]
  DataTableGiroByWeek: DataTableByWeek[]
  DataTableRevparByWeek: DataTableByWeek[]
}

// ─── Restaurant (A&B) ─────────────────────────────────────────────────────────

export interface RestaurantBigNumbersCurrentDate {
  totalAllValue: number
  totalAllSalesRevenue: number
  totalAllSales: number
  totalAllTicketAverage: number
  totalAllTicketAverageByTotalRentals: number
  abRepresentativity: number
  salesRepresentativity: number
}

export interface RestaurantBigNumbers {
  currentDate: RestaurantBigNumbersCurrentDate
  previousDate?: Record<string, number>
  monthlyForecast?: Record<string, number>
}

export interface FoodOrDrinkItem {
  name: string
  quantity: number
  revenue: number
}

export interface RestaurantKPIResponse {
  BigNumbers: RestaurantBigNumbers[]
  RevenueAbByPeriod: ChartDataPoint[]
  RevenueAbByPeriodPercent: ChartDataPoint[]
  TicketAverageByPeriod: ChartDataPoint[]
  RevenueByGroupPeriod: ChartDataPoint[]
  RevenueFoodByPeriod: ChartDataPoint[]
  BestSellingFood: FoodOrDrinkItem[]
  LeastSellingFood: FoodOrDrinkItem[]
  BestSellingDrinks: FoodOrDrinkItem[]
  LeastSellingDrinks: FoodOrDrinkItem[]
}

// ─── Bookings ─────────────────────────────────────────────────────────────────

export interface BookingsBigNumbersCurrentDate {
  totalAllValue: number
  totalAllBookings: number
  totalAllTicketAverage: number
  totalAllRepresentativeness: number
}

export interface BookingsBigNumbers {
  currentDate: BookingsBigNumbersCurrentDate
  previousDate: {
    totalAllValuePreviousData: number
    totalAllBookingsPreviousData: number
    totalAllTicketAveragePreviousData: number
    totalAllRepresentativenessPreviousData: number
  }
  monthlyForecast: {
    totalAllValueForecast: number
    totalAllBookingsForecast: number
    totalAllTicketAverageForecast: number
    totalAllRepresentativenessForecast: number
  }
}

export interface ChartCategorySeries {
  categories: string[]
  series: number[]
}

export interface ChannelTypeBreakdown {
  EXPEDIA: number
  BOOKING: number
  GUIA_SCHEDULED: number
  GUIA_GO: number
  INTERNAL: number
  WEBSITE_IMMEDIATE: number
  WEBSITE_SCHEDULED: number
  [key: string]: number
}

export interface KpiTableByChannelTypeItem {
  bookingsTotalRentalsByChannelType: ChannelTypeBreakdown & { TOTALALLBOOKINGS: number }
  bookingsRevenueByChannelType: ChannelTypeBreakdown & { TOTALALLVALUE: number }
  bookingsTicketAverageByChannelType: ChannelTypeBreakdown & { TOTALALLTICKETAVERAGE: number }
  bookingsRepresentativenessByChannelType: ChannelTypeBreakdown & { TOTALALLREPRESENTATIVENESS: number }
}

export interface BookingsKPIResponse {
  Company: string
  BigNumbers: BookingsBigNumbers[]
  PaymentMethods: ChartCategorySeries
  BillingPerChannel: ChartCategorySeries
  ReservationsByRentalType: ChartCategorySeries
  BillingOfReservationsByPeriod: ChartCategorySeries
  RepresentativenessOfReservesByPeriod: ChartCategorySeries
  NumberOfReservationsPerPeriod: ChartCategorySeries
  KpiTableByChannelType: KpiTableByChannelTypeItem[]
  BigNumbersEcommerce: BookingsBigNumbers[]
  ReservationsOfEcommerceByPeriod: ChartCategorySeries
  BillingOfEcommerceByPeriod: ChartCategorySeries
}

// ─── Combined dashboard payload ───────────────────────────────────────────────

export interface UnitKPIData {
  company: CompanyKPIResponse
  restaurant: RestaurantKPIResponse | null
  bookings: BookingsKPIResponse | null
  fetchedAt: string
}

// ─── API request params ───────────────────────────────────────────────────────

export interface KPIQueryParams {
  startDate: string // DD/MM/YYYY
  endDate: string   // DD/MM/YYYY
}
