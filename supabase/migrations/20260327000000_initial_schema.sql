-- ============================================================
-- LHG Revenue Manager — Schema inicial
-- Migration: 20260327000000_initial_schema.sql
-- ============================================================

-- ============================================================
-- ENUMS
-- ============================================================

CREATE TYPE public.user_role AS ENUM ('super_admin', 'admin', 'manager', 'viewer');

CREATE TYPE public.period_label AS ENUM ('3h', '6h', '12h', 'pernoite');

CREATE TYPE public.channel_name AS ENUM (
  'erp',
  'site',
  'guia_moteis',
  'booking',
  'expedia',
  'decolar',
  'airbnb'
);

CREATE TYPE public.sync_status AS ENUM ('success', 'error', 'conflict');

CREATE TYPE public.rm_price_status AS ENUM ('pending', 'approved', 'rejected');

CREATE TYPE public.conversation_status AS ENUM ('active', 'completed');

CREATE TYPE public.override_type AS ENUM (
  'cancelled_before_publish',
  'reverted_after_publish'
);

-- ============================================================
-- TABELAS
-- ============================================================

-- Unidades do motel
CREATE TABLE public.units (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL,
  slug          text NOT NULL UNIQUE,
  address       text,
  city          text,
  state         text,
  phone         text,
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Perfis de usuário com roles
CREATE TABLE public.profiles (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  unit_id     uuid REFERENCES public.units(id) ON DELETE SET NULL,
  role        public.user_role NOT NULL DEFAULT 'viewer',
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Categorias de suíte por unidade
CREATE TABLE public.suite_categories (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id       uuid NOT NULL REFERENCES public.units(id) ON DELETE CASCADE,
  name          text NOT NULL,
  description   text,
  image_url     text,
  total_suites  integer NOT NULL DEFAULT 0,
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Períodos de permanência por categoria
CREATE TABLE public.suite_periods (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id       uuid NOT NULL REFERENCES public.suite_categories(id) ON DELETE CASCADE,
  label             public.period_label NOT NULL,
  duration_minutes  integer NOT NULL,
  base_price        numeric(10, 2) NOT NULL,
  is_active         boolean NOT NULL DEFAULT true,
  UNIQUE (category_id, label)
);

-- Canais de venda por unidade
CREATE TABLE public.sales_channels (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id               uuid NOT NULL REFERENCES public.units(id) ON DELETE CASCADE,
  name                  public.channel_name NOT NULL,
  is_active             boolean NOT NULL DEFAULT true,
  credentials_vault_key text,
  last_sync_at          timestamptz,
  last_sync_status      public.sync_status,
  UNIQUE (unit_id, name)
);

-- Alocação de inventário por canal
CREATE TABLE public.channel_inventory (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id        uuid NOT NULL REFERENCES public.suite_categories(id) ON DELETE CASCADE,
  channel_id         uuid NOT NULL REFERENCES public.sales_channels(id) ON DELETE CASCADE,
  available_quantity integer NOT NULL DEFAULT 0,
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (category_id, channel_id)
);

-- Regras de precificação manual
CREATE TABLE public.price_rules (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id   uuid NOT NULL REFERENCES public.suite_categories(id) ON DELETE CASCADE,
  period_id     uuid NOT NULL REFERENCES public.suite_periods(id) ON DELETE CASCADE,
  channel_id    uuid REFERENCES public.sales_channels(id) ON DELETE CASCADE,
  day_of_week   integer CHECK (day_of_week BETWEEN 0 AND 6),
  time_start    time,
  time_end      time,
  specific_date date,
  price         numeric(10, 2) NOT NULL,
  priority      integer NOT NULL DEFAULT 0,
  valid_from    date NOT NULL DEFAULT CURRENT_DATE,
  valid_to      date,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Configuração do agente RM por unidade
CREATE TABLE public.rm_agent_config (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id                uuid NOT NULL UNIQUE REFERENCES public.units(id) ON DELETE CASCADE,
  is_active              boolean NOT NULL DEFAULT false,
  last_context_update    timestamptz,
  competitor_urls        jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

-- Histórico de conversas com o agente
CREATE TABLE public.rm_conversations (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id    uuid NOT NULL REFERENCES public.units(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  messages   jsonb NOT NULL DEFAULT '[]'::jsonb,
  status     public.conversation_status NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Propostas de preço geradas pelo agente
CREATE TABLE public.rm_generated_prices (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id      uuid NOT NULL REFERENCES public.units(id) ON DELETE CASCADE,
  category_id  uuid NOT NULL REFERENCES public.suite_categories(id) ON DELETE CASCADE,
  period_id    uuid NOT NULL REFERENCES public.suite_periods(id) ON DELETE CASCADE,
  channel_id   uuid REFERENCES public.sales_channels(id) ON DELETE SET NULL,
  price        numeric(10, 2) NOT NULL,
  generated_at timestamptz NOT NULL DEFAULT now(),
  valid_until  timestamptz,
  rationale    text,
  status       public.rm_price_status NOT NULL DEFAULT 'pending'
);

-- Decisões autônomas do agente (pós-MVP)
CREATE TABLE public.rm_price_decisions (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id               uuid NOT NULL REFERENCES public.units(id) ON DELETE CASCADE,
  category_id           uuid NOT NULL REFERENCES public.suite_categories(id) ON DELETE CASCADE,
  period_id             uuid NOT NULL REFERENCES public.suite_periods(id) ON DELETE CASCADE,
  channel_id            uuid REFERENCES public.sales_channels(id) ON DELETE SET NULL,
  price_before          numeric(10, 2) NOT NULL,
  price_after           numeric(10, 2) NOT NULL,
  trigger               text,
  rationale             text,
  weather_snapshot      jsonb,
  occupancy_at_decision numeric(5, 2),
  competitor_prices     jsonb,
  was_reverted          boolean NOT NULL DEFAULT false,
  reverted_by           uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  decided_at            timestamptz NOT NULL DEFAULT now()
);

-- Limites do agente autônomo (guardrails)
CREATE TABLE public.rm_price_guardrails (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id                  uuid NOT NULL REFERENCES public.units(id) ON DELETE CASCADE,
  category_id              uuid NOT NULL REFERENCES public.suite_categories(id) ON DELETE CASCADE,
  period_id                uuid NOT NULL REFERENCES public.suite_periods(id) ON DELETE CASCADE,
  floor_price              numeric(10, 2) NOT NULL,
  ceiling_price            numeric(10, 2) NOT NULL,
  max_change_pct           numeric(5, 2) NOT NULL,
  freeze_minutes           integer NOT NULL DEFAULT 60,
  loop_interval_minutes    integer NOT NULL DEFAULT 30,
  notify_before_publish    boolean NOT NULL DEFAULT true,
  notify_window_minutes    integer NOT NULL DEFAULT 10,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  UNIQUE (unit_id, category_id, period_id)
);

-- Cancelamentos e reversões do agente
CREATE TABLE public.rm_agent_overrides (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id        uuid NOT NULL REFERENCES public.units(id) ON DELETE CASCADE,
  decision_id    uuid NOT NULL REFERENCES public.rm_price_decisions(id) ON DELETE CASCADE,
  override_type  public.override_type NOT NULL,
  overridden_by  uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  reason         text,
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- Padrões aprendidos: clima × demanda
CREATE TABLE public.rm_weather_demand_patterns (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id              uuid NOT NULL REFERENCES public.units(id) ON DELETE CASCADE,
  category_id          uuid NOT NULL REFERENCES public.suite_categories(id) ON DELETE CASCADE,
  weather_condition    text NOT NULL,
  day_of_week          integer CHECK (day_of_week BETWEEN 0 AND 6),
  avg_demand_delta_pct numeric(7, 2) NOT NULL DEFAULT 0,
  sample_count         integer NOT NULL DEFAULT 0,
  last_updated         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (unit_id, category_id, weather_condition, day_of_week)
);

-- Cache de KPIs do ERP
CREATE TABLE public.kpi_snapshots (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id            uuid NOT NULL REFERENCES public.units(id) ON DELETE CASCADE,
  category_id        uuid REFERENCES public.suite_categories(id) ON DELETE SET NULL,
  date               date NOT NULL,
  hour               integer CHECK (hour BETWEEN 0 AND 23),
  day_of_week        integer CHECK (day_of_week BETWEEN 0 AND 6),
  occupancy_rate     numeric(5, 2),
  revpar             numeric(10, 2),
  trevpar            numeric(10, 2),
  tmo                interval,
  giro               numeric(10, 4),
  revenue            numeric(12, 2),
  avg_ticket         numeric(10, 2),
  reservations_count integer,
  period_label       text,
  synced_at          timestamptz NOT NULL DEFAULT now()
);

-- Log de sincronização com canais
CREATE TABLE public.channel_sync_log (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id uuid NOT NULL REFERENCES public.sales_channels(id) ON DELETE CASCADE,
  unit_id    uuid NOT NULL REFERENCES public.units(id) ON DELETE CASCADE,
  status     public.sync_status NOT NULL,
  payload    jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Notificações para usuários
CREATE TABLE public.notifications (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type       text NOT NULL,
  title      text NOT NULL,
  body       text NOT NULL,
  read_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ============================================================
-- ÍNDICES
-- ============================================================

CREATE INDEX idx_profiles_user_id      ON public.profiles(user_id);
CREATE INDEX idx_profiles_unit_id      ON public.profiles(unit_id);
CREATE INDEX idx_suite_categories_unit ON public.suite_categories(unit_id);
CREATE INDEX idx_suite_periods_cat     ON public.suite_periods(category_id);
CREATE INDEX idx_sales_channels_unit   ON public.sales_channels(unit_id);
CREATE INDEX idx_channel_inventory_cat ON public.channel_inventory(category_id);
CREATE INDEX idx_price_rules_cat       ON public.price_rules(category_id);
CREATE INDEX idx_price_rules_period    ON public.price_rules(period_id);
CREATE INDEX idx_rm_conversations_unit ON public.rm_conversations(unit_id);
CREATE INDEX idx_rm_gen_prices_unit    ON public.rm_generated_prices(unit_id);
CREATE INDEX idx_rm_decisions_unit     ON public.rm_price_decisions(unit_id);
CREATE INDEX idx_kpi_snapshots_unit    ON public.kpi_snapshots(unit_id, date);
CREATE INDEX idx_channel_sync_unit     ON public.channel_sync_log(unit_id);
CREATE INDEX idx_notifications_user    ON public.notifications(user_id, read_at);

-- ============================================================
-- TRIGGER: cria perfil automaticamente no signup
-- ============================================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (user_id, role)
  VALUES (NEW.id, 'viewer');
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

ALTER TABLE public.units                     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.suite_categories          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.suite_periods             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_channels            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.channel_inventory         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.price_rules               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rm_agent_config           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rm_conversations          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rm_generated_prices       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rm_price_decisions        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rm_price_guardrails       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rm_agent_overrides        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rm_weather_demand_patterns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kpi_snapshots             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.channel_sync_log          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications             ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- FUNÇÃO AUXILIAR: retorna o role do usuário atual
-- ============================================================

CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS public.user_role
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT role FROM public.profiles WHERE user_id = auth.uid() LIMIT 1;
$$;

-- Retorna o unit_id do usuário atual
CREATE OR REPLACE FUNCTION public.current_user_unit_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT unit_id FROM public.profiles WHERE user_id = auth.uid() LIMIT 1;
$$;

-- ============================================================
-- RLS POLICIES — units
-- ============================================================

CREATE POLICY "units: super_admin acesso total"
  ON public.units
  FOR ALL
  USING (public.current_user_role() = 'super_admin');

CREATE POLICY "units: demais roles veem sua unit"
  ON public.units
  FOR SELECT
  USING (
    public.current_user_role() IN ('admin', 'manager', 'viewer')
    AND id = public.current_user_unit_id()
  );

-- ============================================================
-- RLS POLICIES — profiles
-- ============================================================

CREATE POLICY "profiles: super_admin acesso total"
  ON public.profiles
  FOR ALL
  USING (public.current_user_role() = 'super_admin');

CREATE POLICY "profiles: usuário vê/edita seu próprio perfil"
  ON public.profiles
  FOR ALL
  USING (user_id = auth.uid());

CREATE POLICY "profiles: admin vê profiles da sua unit"
  ON public.profiles
  FOR SELECT
  USING (
    public.current_user_role() = 'admin'
    AND unit_id = public.current_user_unit_id()
  );

-- ============================================================
-- RLS POLICIES — suite_categories
-- ============================================================

CREATE POLICY "suite_categories: super_admin acesso total"
  ON public.suite_categories
  FOR ALL
  USING (public.current_user_role() = 'super_admin');

CREATE POLICY "suite_categories: admin acesso total na sua unit"
  ON public.suite_categories
  FOR ALL
  USING (
    public.current_user_role() = 'admin'
    AND unit_id = public.current_user_unit_id()
  );

CREATE POLICY "suite_categories: manager/viewer leitura na sua unit"
  ON public.suite_categories
  FOR SELECT
  USING (
    public.current_user_role() IN ('manager', 'viewer')
    AND unit_id = public.current_user_unit_id()
  );

-- ============================================================
-- RLS POLICIES — suite_periods
-- ============================================================

CREATE POLICY "suite_periods: super_admin acesso total"
  ON public.suite_periods
  FOR ALL
  USING (public.current_user_role() = 'super_admin');

CREATE POLICY "suite_periods: admin acesso total na sua unit"
  ON public.suite_periods
  FOR ALL
  USING (
    public.current_user_role() = 'admin'
    AND EXISTS (
      SELECT 1 FROM public.suite_categories sc
      WHERE sc.id = category_id
        AND sc.unit_id = public.current_user_unit_id()
    )
  );

CREATE POLICY "suite_periods: manager update na sua unit"
  ON public.suite_periods
  FOR UPDATE
  USING (
    public.current_user_role() = 'manager'
    AND EXISTS (
      SELECT 1 FROM public.suite_categories sc
      WHERE sc.id = category_id
        AND sc.unit_id = public.current_user_unit_id()
    )
  );

CREATE POLICY "suite_periods: manager/viewer leitura na sua unit"
  ON public.suite_periods
  FOR SELECT
  USING (
    public.current_user_role() IN ('manager', 'viewer')
    AND EXISTS (
      SELECT 1 FROM public.suite_categories sc
      WHERE sc.id = category_id
        AND sc.unit_id = public.current_user_unit_id()
    )
  );

-- ============================================================
-- RLS POLICIES — sales_channels
-- ============================================================

CREATE POLICY "sales_channels: super_admin acesso total"
  ON public.sales_channels
  FOR ALL
  USING (public.current_user_role() = 'super_admin');

CREATE POLICY "sales_channels: admin acesso total na sua unit"
  ON public.sales_channels
  FOR ALL
  USING (
    public.current_user_role() = 'admin'
    AND unit_id = public.current_user_unit_id()
  );

CREATE POLICY "sales_channels: manager/viewer leitura na sua unit"
  ON public.sales_channels
  FOR SELECT
  USING (
    public.current_user_role() IN ('manager', 'viewer')
    AND unit_id = public.current_user_unit_id()
  );

-- ============================================================
-- RLS POLICIES — channel_inventory
-- ============================================================

CREATE POLICY "channel_inventory: super_admin acesso total"
  ON public.channel_inventory
  FOR ALL
  USING (public.current_user_role() = 'super_admin');

CREATE POLICY "channel_inventory: admin acesso total na sua unit"
  ON public.channel_inventory
  FOR ALL
  USING (
    public.current_user_role() = 'admin'
    AND EXISTS (
      SELECT 1 FROM public.suite_categories sc
      WHERE sc.id = category_id
        AND sc.unit_id = public.current_user_unit_id()
    )
  );

CREATE POLICY "channel_inventory: manager update na sua unit"
  ON public.channel_inventory
  FOR UPDATE
  USING (
    public.current_user_role() = 'manager'
    AND EXISTS (
      SELECT 1 FROM public.suite_categories sc
      WHERE sc.id = category_id
        AND sc.unit_id = public.current_user_unit_id()
    )
  );

CREATE POLICY "channel_inventory: manager/viewer leitura na sua unit"
  ON public.channel_inventory
  FOR SELECT
  USING (
    public.current_user_role() IN ('manager', 'viewer')
    AND EXISTS (
      SELECT 1 FROM public.suite_categories sc
      WHERE sc.id = category_id
        AND sc.unit_id = public.current_user_unit_id()
    )
  );

-- ============================================================
-- RLS POLICIES — price_rules
-- ============================================================

CREATE POLICY "price_rules: super_admin acesso total"
  ON public.price_rules
  FOR ALL
  USING (public.current_user_role() = 'super_admin');

CREATE POLICY "price_rules: admin acesso total na sua unit"
  ON public.price_rules
  FOR ALL
  USING (
    public.current_user_role() = 'admin'
    AND EXISTS (
      SELECT 1 FROM public.suite_categories sc
      WHERE sc.id = category_id
        AND sc.unit_id = public.current_user_unit_id()
    )
  );

CREATE POLICY "price_rules: manager select/update na sua unit"
  ON public.price_rules
  FOR ALL
  USING (
    public.current_user_role() = 'manager'
    AND EXISTS (
      SELECT 1 FROM public.suite_categories sc
      WHERE sc.id = category_id
        AND sc.unit_id = public.current_user_unit_id()
    )
  );

CREATE POLICY "price_rules: viewer leitura na sua unit"
  ON public.price_rules
  FOR SELECT
  USING (
    public.current_user_role() = 'viewer'
    AND EXISTS (
      SELECT 1 FROM public.suite_categories sc
      WHERE sc.id = category_id
        AND sc.unit_id = public.current_user_unit_id()
    )
  );

-- ============================================================
-- RLS POLICIES — rm_agent_config
-- ============================================================

CREATE POLICY "rm_agent_config: super_admin acesso total"
  ON public.rm_agent_config
  FOR ALL
  USING (public.current_user_role() = 'super_admin');

CREATE POLICY "rm_agent_config: admin acesso total na sua unit"
  ON public.rm_agent_config
  FOR ALL
  USING (
    public.current_user_role() = 'admin'
    AND unit_id = public.current_user_unit_id()
  );

CREATE POLICY "rm_agent_config: manager/viewer leitura na sua unit"
  ON public.rm_agent_config
  FOR SELECT
  USING (
    public.current_user_role() IN ('manager', 'viewer')
    AND unit_id = public.current_user_unit_id()
  );

-- ============================================================
-- RLS POLICIES — rm_conversations
-- ============================================================

CREATE POLICY "rm_conversations: super_admin acesso total"
  ON public.rm_conversations
  FOR ALL
  USING (public.current_user_role() = 'super_admin');

CREATE POLICY "rm_conversations: usuário vê suas próprias conversas"
  ON public.rm_conversations
  FOR ALL
  USING (user_id = auth.uid());

-- ============================================================
-- RLS POLICIES — rm_generated_prices
-- ============================================================

CREATE POLICY "rm_generated_prices: super_admin acesso total"
  ON public.rm_generated_prices
  FOR ALL
  USING (public.current_user_role() = 'super_admin');

CREATE POLICY "rm_generated_prices: admin acesso total na sua unit"
  ON public.rm_generated_prices
  FOR ALL
  USING (
    public.current_user_role() = 'admin'
    AND unit_id = public.current_user_unit_id()
  );

CREATE POLICY "rm_generated_prices: manager select/update na sua unit"
  ON public.rm_generated_prices
  FOR ALL
  USING (
    public.current_user_role() = 'manager'
    AND unit_id = public.current_user_unit_id()
  );

CREATE POLICY "rm_generated_prices: viewer leitura na sua unit"
  ON public.rm_generated_prices
  FOR SELECT
  USING (
    public.current_user_role() = 'viewer'
    AND unit_id = public.current_user_unit_id()
  );

-- ============================================================
-- RLS POLICIES — rm_price_decisions
-- ============================================================

CREATE POLICY "rm_price_decisions: super_admin acesso total"
  ON public.rm_price_decisions
  FOR ALL
  USING (public.current_user_role() = 'super_admin');

CREATE POLICY "rm_price_decisions: admin/manager/viewer leitura na sua unit"
  ON public.rm_price_decisions
  FOR SELECT
  USING (
    public.current_user_role() IN ('admin', 'manager', 'viewer')
    AND unit_id = public.current_user_unit_id()
  );

CREATE POLICY "rm_price_decisions: admin pode reverter na sua unit"
  ON public.rm_price_decisions
  FOR UPDATE
  USING (
    public.current_user_role() = 'admin'
    AND unit_id = public.current_user_unit_id()
  );

-- ============================================================
-- RLS POLICIES — rm_price_guardrails
-- ============================================================

CREATE POLICY "rm_price_guardrails: super_admin acesso total"
  ON public.rm_price_guardrails
  FOR ALL
  USING (public.current_user_role() = 'super_admin');

CREATE POLICY "rm_price_guardrails: admin acesso total na sua unit"
  ON public.rm_price_guardrails
  FOR ALL
  USING (
    public.current_user_role() = 'admin'
    AND unit_id = public.current_user_unit_id()
  );

CREATE POLICY "rm_price_guardrails: manager/viewer leitura na sua unit"
  ON public.rm_price_guardrails
  FOR SELECT
  USING (
    public.current_user_role() IN ('manager', 'viewer')
    AND unit_id = public.current_user_unit_id()
  );

-- ============================================================
-- RLS POLICIES — rm_agent_overrides
-- ============================================================

CREATE POLICY "rm_agent_overrides: super_admin acesso total"
  ON public.rm_agent_overrides
  FOR ALL
  USING (public.current_user_role() = 'super_admin');

CREATE POLICY "rm_agent_overrides: admin acesso total na sua unit"
  ON public.rm_agent_overrides
  FOR ALL
  USING (
    public.current_user_role() = 'admin'
    AND unit_id = public.current_user_unit_id()
  );

CREATE POLICY "rm_agent_overrides: manager/viewer leitura na sua unit"
  ON public.rm_agent_overrides
  FOR SELECT
  USING (
    public.current_user_role() IN ('manager', 'viewer')
    AND unit_id = public.current_user_unit_id()
  );

-- ============================================================
-- RLS POLICIES — rm_weather_demand_patterns
-- ============================================================

CREATE POLICY "rm_weather_demand_patterns: super_admin acesso total"
  ON public.rm_weather_demand_patterns
  FOR ALL
  USING (public.current_user_role() = 'super_admin');

CREATE POLICY "rm_weather_demand_patterns: admin acesso total na sua unit"
  ON public.rm_weather_demand_patterns
  FOR ALL
  USING (
    public.current_user_role() = 'admin'
    AND unit_id = public.current_user_unit_id()
  );

CREATE POLICY "rm_weather_demand_patterns: manager/viewer leitura na sua unit"
  ON public.rm_weather_demand_patterns
  FOR SELECT
  USING (
    public.current_user_role() IN ('manager', 'viewer')
    AND unit_id = public.current_user_unit_id()
  );

-- ============================================================
-- RLS POLICIES — kpi_snapshots
-- ============================================================

CREATE POLICY "kpi_snapshots: super_admin acesso total"
  ON public.kpi_snapshots
  FOR ALL
  USING (public.current_user_role() = 'super_admin');

CREATE POLICY "kpi_snapshots: admin acesso total na sua unit"
  ON public.kpi_snapshots
  FOR ALL
  USING (
    public.current_user_role() = 'admin'
    AND unit_id = public.current_user_unit_id()
  );

CREATE POLICY "kpi_snapshots: manager/viewer leitura na sua unit"
  ON public.kpi_snapshots
  FOR SELECT
  USING (
    public.current_user_role() IN ('manager', 'viewer')
    AND unit_id = public.current_user_unit_id()
  );

-- ============================================================
-- RLS POLICIES — channel_sync_log
-- ============================================================

CREATE POLICY "channel_sync_log: super_admin acesso total"
  ON public.channel_sync_log
  FOR ALL
  USING (public.current_user_role() = 'super_admin');

CREATE POLICY "channel_sync_log: admin acesso total na sua unit"
  ON public.channel_sync_log
  FOR ALL
  USING (
    public.current_user_role() = 'admin'
    AND unit_id = public.current_user_unit_id()
  );

CREATE POLICY "channel_sync_log: manager/viewer leitura na sua unit"
  ON public.channel_sync_log
  FOR SELECT
  USING (
    public.current_user_role() IN ('manager', 'viewer')
    AND unit_id = public.current_user_unit_id()
  );

-- ============================================================
-- RLS POLICIES — notifications
-- ============================================================

CREATE POLICY "notifications: usuário vê e gerencia suas notificações"
  ON public.notifications
  FOR ALL
  USING (user_id = auth.uid());

CREATE POLICY "notifications: super_admin acesso total"
  ON public.notifications
  FOR ALL
  USING (public.current_user_role() = 'super_admin');
