# Agente RM — Referência de Contexto de Precificação

> **Para quem é este documento:**  
> Desenvolvedor mantendo os builders de contexto (`src/lib/agente/`, `src/lib/automo/`, `src/lib/pricing/`),
> gerente de receita entendendo como o agente decide, e qualquer pessoa investigando por que o agente
> gerou (ou não gerou) determinada proposta.

---

## Visão geral do pipeline de contexto

Antes de gerar uma proposta ou responder no chat, o agente recebe um **prompt montado server-side**
composto por até ~20 blocos de contexto. Cada bloco é uma string markdown construída por uma função
pura a partir de dados já buscados em paralelo.

```
Requisição (unitSlug) 
    │
    ├─ Promise.all #1 — KPIs (Automo PostgreSQL)
    │     ├─ fetchCompanyKPIsFromAutomo (período ativo + anterior)
    │     ├─ queryChannelKPIs (mix por canal)
    │     └─ queryPeriodMix (mix por período)
    │
    ├─ Promise.all #2 — Contexto do agente (Supabase)
    │     ├─ rm_agent_config (estratégia, guardrails, contexto, metas, orçamento)
    │     ├─ price_imports (tabelas ativas de preços e descontos)
    │     ├─ competitor_snapshots (últimos 7 dias)
    │     └─ price_proposals aprovadas (histórico)
    │
    ├─ Promise.all #3 — Inteligência aprendida (Automo + Supabase)
    │     ├─ getSuiteAvailabilityByCategory (capacidade instalada)
    │     ├─ getRealtimeOccupancyByCategory (ocupação agora)
    │     ├─ getReservationPace (ritmo de check-ins)
    │     ├─ queryDemandPattern (padrão dia × faixa horária)
    │     ├─ buildRejectionLessonsBlock (motivos de rejeições passadas)
    │     ├─ buildLessonsBlockForUnit (lições de pricing com filtro de relevância)
    │     ├─ getUpcomingSeasonalFactors (fatores sazonais próximos 30d)
    │     ├─ getRecentGaps (price gap vs concorrentes)
    │     └─ getElasticityForUnit (elasticidade-preço por cat/período)
    │
    └─ Prompt final → LLM → JSON → safety net + clamp guardrail → ProposalResponse
```

---

## Blocos de contexto — referência completa

### 1. KPIs Operacionais

**Builder:** `buildKPIContext(unitName, period, company, bookings, channelKPIs?, periodMix?, fmtMoney?)`  
**Fonte:** `src/lib/automo/company-kpis.ts` → banco Automo (read-only)  
**Frequência:** calculado em real-time a cada geração de proposta/mensagem do chat  
**Presente em:** chat ✅ | propostas ✅

**O que inclui:**
- BigNumbers: RevPAR, TRevPAR, Giro, Ocupação, TMO, Faturamento, Ticket Médio, Locações
- Comparativo com período anterior e previsão de fechamento do mês
- Tabela de RevPAR e Giro por categoria × dia da semana (últimos 7 dias pivotados)
- Tabela de KPIs por categoria (Locações, RevPAR, TRevPAR, Ocupação, Giro, Ticket, TMO)
- Mix por canal: Reservas, Receita, Ticket, % Receita
- Mix por período: 3h/6h/12h/Pernoite com Locações, Receita, Ticket, %

**Como o agente deve usar:**
- RevPAR por categoria × dia: identifica subcategorias/dias subprecificados (giro alto, RevPAR baixo) vs sobreprecificados (giro baixo, RevPAR alto)
- Ocupação: indica inelasticidade de demanda — ocupação >35% sugere que aumentos serão absorvidos
- Giro por dia da semana: quantifica o diferencial de demanda semana vs FDS — base para calibrar o premium
- Mix por canal: GUIA_GO com share >40% pode indicar dependência excessiva do canal Guia (desconto caro)
- TMO por categoria: períodos muito longos com giro baixo = clientes podem estar "enchendo" um período mais curto

**Armadilhas:**
- O denominador de RevPAR/Giro/Ocupação usa **suítes-dias disponíveis** (descontando bloqueios ativos no Automo). Não confundir com o total físico de suítes.
- `totalRevpar` usa `valorliquidolocacao` (sem consumo); `totalTrevpar` usa `valortotal` (com consumo/P&S).
- TMO é agregado por categoria, **não por período** — limitação conhecida (ver seção Gaps).

---

### 2. Tabelas de Preços Importadas

**Builder:** inline em `proposals/route.ts` (tabela formatada por canal)  
**Fonte:** tabela `price_imports` (Supabase), campo `parsed_data JSONB`  
**Frequência:** resolvida no momento da requisição (tabela ativa = `valid_from ≤ hoje AND valid_until IS NULL OR ≥ hoje`)  
**Presente em:** chat ✅ | propostas ✅

**O que inclui:**
- Tabela atual: cada linha tem canal | categoria | período | dia_tipo | preço
- Tabela anterior (se houver): mesma estrutura, permite comparação "antes/depois"
- Mapa de preços atuais: string `canal|cat|período|dia_tipo = R$ X` — fonte de verdade para `preco_atual` no JSON

**Como o agente deve usar:**
- O campo `preco_atual` de cada linha da proposta DEVE ser copiado exatamente do mapa de preços atuais
- Ao comparar tabela atual vs anterior, verificar se a direção das mudanças passadas gerou resultados positivos nos KPIs (cruzar com bloco de Memória Estratégica)
- `balcao_site` e `site_programada` são o preço direto ao consumidor; `guia_moteis` é o preço base antes do desconto

**Armadilhas:**
- O agente NUNCA deve inferir `preco_atual` — valores incorretos invalidam toda a análise de variação.
- Mudanças entre tabelas ativas têm lógica bi-temporal: `valid_until = ontem` na tabela anterior, `valid_from = hoje` na nova.

---

### 3. Memória Estratégica

**Builder:** `buildStrategicMemoryBlock(history, kpiAfter, kpiBefore, fmtMoney?)`  
**Fonte:** `price_proposals` (aprovadas) + `kpi_baseline JSONB` congelado na aprovação  
**Frequência:** últimas 3 propostas aprovadas, buscadas em paralelo  
**Presente em:** chat ✅ | propostas ✅

**O que inclui:**
- Lista de propostas aprovadas com data, contexto e todas as linhas com variação ≥ 0.1%
- Resultado observado após a última mudança: RevPAR, TRevPAR, Giro, Ocupação, Ticket Médio (antes × depois)
- Rótulo de confiança: "janela igual de 28 dias — comparação confiável" vs "janelas diferentes — interpretação cautelosa"

**Como o agente deve usar:**
- Se KPIs melhoraram após a última mudança → intensifique a direção (ex: se +5% na semana gerou RevPAR +8%, propor mais +3% ainda tem espaço)
- Se KPIs pioraram → recue ou teste outro caminho (ex: se -5% FDS gerou queda de giro sem aumento de ticket, reverter)
- Baseline congelado na aprovação garante comparação justa (28 dias vs 28 dias); sem baseline, análise é menos confiável

**Armadilhas:**
- `kpi_baseline` só existe a partir de LHG-156; propostas antigas não têm — `kpiBefore` é estimativa por janelas.
- Variações ≥ 0.1% são incluídas (não 1%) — micro-ajustes de centavos são capturados intencionalmente para rastrear padrões.

---

### 4. Guardrails de Preço

**Builder:** `buildGuardrailsBlock(rows, fmtMoney?)` (chat) / inline (propostas)  
**Fonte:** tabela `agent_price_guardrails` (Supabase)  
**Frequência:** buscados a cada requisição  
**Presente em:** chat ✅ | propostas ✅

**O que inclui:**
- Tabela: Categoria | Período | Dia (Semana/FDS/Todos) | Preço Mínimo | Preço Máximo
- Nas propostas: também aplicados como safety net server-side (clamp) após parse do JSON do modelo

**Como o agente deve usar:**
- No chat: consultar antes de sugerir preços verbalmente (evitar sugestões que serão rejeitadas)
- Nas propostas: o modelo tenta gerar dentro dos limites; o servidor faz clamp caso ultrapasse
- `dia_tipo = 'todos'` age como fallback para semana E fds_feriado

**Armadilhas:**
- `dia_tipo='todos'` na guardrail cobre ambos os dias — um guardrail `"Master|3h|todos"` prevalece sobre `"Master|3h|semana"` se não houver guardrail mais específico.
- O clamp server-side é silencioso para o modelo mas visível na UI via `was_clamped: true` + badge âmbar.

---

### 5. Configuração do Agente

**Builder:** inline `agentConfigBlock` em proposals e `buildSystemPrompt` no chat  
**Fonte:** tabela `rm_agent_config` (Supabase)  
**Presente em:** chat ✅ | propostas ✅

**O que inclui:**
- `pricing_strategy`: conservador / moderado / agressivo — define magnitude das variações
- `max_variation_pct`: limite máximo por item (5–30%) — hard limit para o modelo
- `focus_metric`: balanceado / revpar / giro / ocupação / ticket / trevpar / tmo — prioridade de otimização

**Como o agente deve usar:**
- `focus_metric` determina qual KPI maximizar quando há trade-off (ex: `revpar` aceita queda de giro se RevPAR sobe)
- `pricing_strategy=agressivo` permite propostas de maior magnitude; `conservador` limita a ~10% por item
- `max_variation_pct` é um limite **absoluto** — nunca propor variação além disso, mesmo que os dados sustentem

**Armadilhas:**
- Se `focus_metric != 'balanceado'`, o agente usa o foco diretamente sem pedir objetivo ao gerente (Regra 13).
- `max_variation_pct` substitui o hardcoded 30% que existia antes da LHG-93 — checar se a config existe antes de usar default.

---

### 6. Estrutura da Unidade

**Builder:** `buildUnitStructureBlock(availability, capacity, channelCosts, realtimeOccupancy?)`  
**Fonte:** `getSuiteAvailabilityByCategory` (Automo, join `bloqueadoapartamento`) + `unit_capacity` + `unit_channel_costs` (Supabase)  
**Presente em:** chat ✅ | propostas ✅

**O que inclui:**
- Por categoria: total de suítes, bloqueadas (com motivo), disponíveis
- Custo variável de locação por categoria (quando configurado)
- Comissões por canal (Balcão=0%, Site=X%, Guia=Y%)
- Ocupação em tempo real: suítes livres/ocupadas agora (se `realtimeOccupancy` disponível)

**Como o agente deve usar:**
- O agente NUNCA pode perguntar "quantas suítes vocês têm?" — o total está aqui
- Suítes bloqueadas reduzem a capacidade efetiva e **já estão descontadas do denominador** dos KPIs
- Canal com comissão alta (ex: Guia 25%) precisa de preço base maior para mesma margem que Balcão
- Ocupação em tempo real ajuda a entender se o período atual está quente ou frio naquele instante

**Armadilhas:**
- Bloqueios sem `datafim` no Automo são interpretados como permanentes — motivo "sem data fim" pode indicar dado inconsistente no ERP.
- `realtimeOccupancy` usa `fimocupacaotipo IS NULL` = locação em aberto; inclui clientes que ainda não finalizaram.

---

### 7. Metas da Unidade

**Builder:** `buildProposalGoalsBlock()` (proposals) / `buildGoalsBlock(...)` (chat)  
**Fonte:** `rm_agent_config.unit_goals JSONB` + sync de `budget_yearly` via Google Sheets  
**Presente em:** chat ✅ | propostas ✅

**O que inclui:**
- Tabela: KPI | Meta | Atual | Gap | Status (✅/⚠️)
- KPIs cobertos: RevPAR, TRevPAR, Ocupação, Receita Mensal (projeção), Giro, Ticket Médio
- Orçamento mensal dos próximos 3 meses (sazonalidade futura para calibrar agressividade)

**Como o agente deve usar:**
- Métricas ⚠️ (abaixo da meta) devem ser priorizadas na proposta
- Próximos 3 meses com meta mais alta = pode ser mais ousado agora para criar momentum
- Próximos 3 meses com meta mais baixa = preservar margem agora, o mercado vai contrair

**Armadilhas:**
- `unit_goals` é substituído mensalmente pelo sync do Google Sheets — metas manuais foram removidas.
- Receita Mensal usa `monthlyForecast.totalAllValueForecast` do Automo, que inclui P&S (não só locação).

---

### 8. Previsão de Receita (30/60/90 dias)

**Builder:** `buildForecastBlock(computeRevenueForecast(kpiActive, budgetYearly))`  
**Fonte:** `computeRevenueForecast` em `src/lib/forecast/revenue-forecast.ts`  
**Presente em:** chat ✅ | propostas ✅

**O que inclui:**
- Mês atual: valor projetado EOM (Automo) vs orçamento
- Mês +1: estimativa via `pace_ratio` amortecido (50% desvio do pace)
- Mês +2: `pace_ratio` amortecido (25% desvio)
- Emoji ✅ ≥-2% / 🟡 ≥-8% / ⚠️ <-8% do orçado

**Como o agente deve usar:**
- 3 meses acima do orçado → contexto favorável para proposta agressiva (demanda forte)
- 2 meses abaixo → contexto para proposta conservadora ou focar em volume
- "Amortecido" significa que o modelo **não extrapola anomalias** — um mês excepcional não projeta outro excepcional

**Armadilhas:**
- Se não há `budget_yearly` no banco, `projected = budget = null` e o bloco fica vazio.
- O clamp 0.75×–1.35× do orçado impede projeções absurdas; valores reais fora desse range serão clampeados.

---

### 9. Pace de Reservas

**Builder:** `buildPaceBlock(reservationPace)`  
**Fonte:** `getReservationPace` em `src/lib/automo/reservation-pace.ts`  
**Presente em:** chat ✅ | propostas ✅

**O que inclui:**
- Check-ins desde 06h BRT hoje vs média das 4 semanas anteriores no mesmo dia/hora
- Janela acumulada do dia + janela das últimas 2 horas
- Sinal consolidado: `acima` / `normal` / `abaixo` / `muito_abaixo`
- Interpretação contextual: "muito abaixo → avalie incentivo"

**Como o agente deve usar:**
- Pace `acima` no momento da análise → demanda aquecida → suporta proposta de aumento
- Pace `muito_abaixo` → demanda fraca naquele dia → redução ou desconto Guia mais agressivo
- Comparar com `fdsSemanaRatio` (bloco de demanda): se FDS tem pace historicamente 1.8× maior, pace fraco numa sexta pode ser normal

**Armadilhas:**
- Pace usa `locacaoapartamento.datainicialdaocupacao` (não `reserva.dataatendimento`) — consistente com demais queries.
- Em datas atípicas (feriado, evento), a média das 4 semanas passadas pode não ser referência válida — cruzar com calendário de eventualidades.

---

### 10. Padrão de Demanda (Dia × Faixa Horária)

**Builder:** `buildDemandPatternBlock(pattern, unitName, 60)`  
**Fonte:** `queryDemandPattern` em `src/lib/automo/demand-pattern.ts`  
**Janela:** últimos 60 dias de locações finalizadas  
**Presente em:** chat ✅ | propostas ✅

**O que inclui:**
- Tabela: Dia da Semana | Faixa Horária (00–05 / 06–11 / 12–17 / 18–23) | Locações | Share %
- `fdsSemanaRatio`: locações/dia FDS ÷ locações/dia Semana — quantifica o diferencial de demanda
- Slots de baixa demanda (share < 70% da média) → candidatos a desconto Guia mais agressivo
- Slots de alta demanda (share > 140% da média) → candidatos a preço premium ou desconto Guia reduzido
- Dias com demanda >120% da média → candidatos a tier de preço próprio

**Como o agente deve usar:**
- `fdsSemanaRatio ≥ 1.5` justifica preço FDS 20–30% acima da semana; ratio próximo de 1 = split pouco justificado
- Slots de baixa demanda (ex: "quarta 00:00-05:59") = espaço para desconto sem canibalizar receita dos picos
- Se há categoria com giro baixo especificamente em certos slots, investigar se o preço naquele dia/faixa está acima da demanda
- `highDemandDays` com frequência acima de 120% da média = candidatos a criar um dia_tipo separado (ex: "sábado" próprio vs "fds_feriado" genérico)

**Armadilhas:**
- Faixas de 6h são menos granulares que análise horária — o heatmap do dashboard tem granularidade de 1h.
- `fdsSemanaRatio` compara locações/dia (não receita/dia) — FDS pode ter ratio mais baixo se as locações forem mais longas (maior ticket unitário).

---

### 11. Sazonalidade Aprendida

**Builder:** `buildSeasonalityBlock(seasonalFactors)`  
**Fonte:** `getUpcomingSeasonalFactors` em `src/lib/seasonality/compute.ts`  
**Janela:** fatores calculados sobre 1 ano de histórico; próximos 30 dias  
**Presente em:** chat ✅ | propostas ✅

**O que inclui:**
- Apenas dias com fator > 1.15 (quente) ou < 0.85 (frio) nos próximos 30 dias
- Factor por KPI: RevPAR, Giro, Ocupação, Ticket
- Calculado como: `kpi(D) / mediana(kpi de D ± 15 dias históricos)`

**Como o agente deve usar:**
- Dia com fator RevPAR > 1.15 próximo: demanda historicamente alta → proposta mais ousada para aquele período
- Dia com fator < 0.85: demanda historicamente fraca → não é o momento de aumentar preço; avaliar desconto Guia
- Cruzar com calendário de eventualidades para confirmar se a sazonalidade tem causa conhecida

**Armadilhas:**
- Com apenas 1 ano de dados, `confidence='low'` — o bloco aparece mas deve ser tratado como indicação, não certeza.
- Dias com poucas observações (feriados que mudam de data todo ano) podem ter fatores espúrios.
- Recompute semanal via cron; sem dados do Automo o bloco fica vazio.

---

### 12. Price Gap vs Concorrentes

**Builder:** `buildCompetitorGapBlock(competitorGaps)`  
**Fonte:** `getRecentGaps` em `src/lib/competitors/detect-changes.ts`  
**Frequência:** recomputado após cada snapshot de concorrentes  
**Presente em:** chat ✅ | propostas ✅

**O que inclui:**
- Top 15 gaps por magnitude (|gap_pct|)
- Por combinação: Categoria | Período | Dia | Nosso Preço | Mediana Conc. | Gap %
- `position`: `underprice` (estamos mais baratos) / `aligned` / `overprice`

**Como o agente deve usar:**
- `underprice` com gap > 10%: estamos deixando dinheiro na mesa → candidato a aumento
- `overprice` com gap > 10% E giro baixo: possível causa da queda de volume → candidato a redução
- Comparar apenas comodidades equivalentes: hidro vs hidro, piscina vs piscina (usar bloco de Comodidades)
- Gap com um único concorrente (via Guia GM) é mais confiável que Cheerio/Playwright (dados estruturados vs scraping)

**Armadilhas:**
- Correspondência de categoria usa Jaccard ≥ 0.5 nos tokens do nome — nomes muito diferentes não são correspondidos.
- `categoria_competitor='mercado'` indica que não foi encontrada correspondência — é mediana de mercado, não match direto.
- Gaps podem estar desatualizados se o cron Guia GM não rodou recentemente.

---

### 13. Preços de Concorrentes (Snapshots Raw)

**Builder:** inline `competitorBlock` em proposals  
**Fonte:** tabela `competitor_snapshots` (Supabase), últimos 7 dias  
**Presente em:** chat ✅ | propostas ✅

**O que inclui:**
- Por concorrente: tabela com Suíte | Período | Dia | Preço
- Comodidades por suíte (quando modo Guia GM) — extraídas do HTML via regex
- Data da última análise

**Como o agente deve usar:**
- Referência de mercado — não copiar preços, mas usar como âncora perceptual
- Quando concorrente tem comodidade superior (ex: piscina), aceitar gap negativo de 10–15% como justo
- Para modo Cheerio/Playwright: dados menos confiáveis (scraping pode falhar) — usar com cautela; preferir gaps calculados (bloco 12)

---

### 14. Política de Descontos do Guia de Motéis

**Builder:** inline `discountBlock` em proposals  
**Fonte:** `discount_data JSONB` em `price_imports` + imports `import_type='discounts'`  
**Presente em:** chat ✅ | propostas ✅

**O que inclui:**
- Por linha: Categoria | Período | Dia | Horário | Tipo (Percentual/Absoluto) | Desconto | Condição

**Como o agente deve usar:**
- Preços propostos para `guia_moteis` são SEMPRE preços base (antes do desconto)
- Desconto aplicado automaticamente pelo canal — não subtrair manualmente
- Se desconto é 20% e preço base é R$ 100, o cliente paga R$ 80; RevPAR calculado sobre R$ 80
- Ao avaliar competitividade no Guia, usar `preco_efetivo = preço_base × (1 - desconto%)`

**Armadilhas:**
- `dia_semana` (segunda/domingo) ≠ `dia_tipo` (semana/fds_feriado) — tabela de descontos usa dia_semana; tabela de preços usa dia_tipo.
- Categorias com desconto muito alto (>35%) podem precisar de proposta de desconto para rebalancear.

---

### 15. Comodidades das Suítes

**Builder:** `ownAmenitiesBlock` (inline, proposals) / via `buildUnitStructureBlock` (chat)  
**Fonte:** `rm_agent_config.suite_amenities JSONB`  
**Presente em:** chat ✅ | propostas ✅

**O que inclui:**
- Por categoria: lista de comodidades (hidro, piscina, sauna, espelho no teto, etc.)

**Como o agente deve usar:**
- Comparação com concorrentes deve ser equitativa: hidro vs hidro, não hidro vs suite sem hidro
- Categoria com comodidades superiores justifica preço premium
- Regra 11 do system prompt: agente compara comodidades **somente quando o bloco estiver presente**; nunca inventa

---

### 16. Elasticidade-Preço

**Builder:** `buildElasticityBlock(elasticityRows)`  
**Fonte:** `getElasticityForUnit` em `src/lib/pricing/elasticity.ts`  
**Cálculo:** OLS log-log sobre `rm_pricing_lessons`; recomputado mensalmente  
**Presente em:** chat ✅ | propostas ✅

**O que inclui:**
- Por combinação (Categoria | Período | Dia): Elasticidade | IC 95% | n obs | Confiança
- Interpretação: < 0.5 = inelástica (aumentos absorvidos), 0.5–1.0 = moderada, > 1.0 = elástica
- Impacto esperado de receita: `Δreceita% ≈ Δpreço% × (1 + elasticidade)`
- Se sem dados: texto orientativo "mantenha variações ≤15% até acumular 3+ ciclos"

**Como o agente deve usar:**
- Elasticidade < 0.5 para uma combinação: aumento de preço aumenta receita → candidato a +5–10%
- Elasticidade > 1.0: demanda muito sensível → aumento reduz receita → evitar aumentos; considerar redução estratégica
- `expected_revenue_change_pct` é calculado server-side após o clamp e exibido na UI com cor
- Confiança `low` (n=3–4 obs) = usar como indicação; confiança `high` (n≥10) = usar com segurança

**Armadilhas:**
- Elasticidade só acumula com checkpoints de 7/14/28 dias pós-aprovação — demora ~1 mês para ter dados `high` confidence.
- Bootstrap histórico (`bootstrapPricingLessons`) gera dados de qualidade inferior; preferir dados reais de propostas aprovadas.

---

### 17. Lições de Pricing (Filtro de Relevância)

**Builder:** `buildLessonsBlockForUnit(unitId, scenario)`  
**Fonte:** `rm_pricing_lessons` (populada pelos checkpoints de revisão)  
**Filtro:** últimas lições com score ≥ 1 no cenário atual; máx. 5  
**Presente em:** chat ✅ | propostas ✅

**O que inclui:**
- Por lição: Checkpoint | Categoria | Período | Dia | Variação | Resultado | Lição

**Score de relevância:**
- +3 se mesma categoria + período + dia_tipo
- +2 se mesma categoria + período
- +1 se mesma categoria
- +1 se mesmo clima
- +1 se mesmo evento ativo
- Decaimento por idade (30 dias)

**Como o agente deve usar:**
- Lição relevante de `success` confirma que a direção funciona → intensificar
- Lição relevante de `failure` com mesma estratégia → reverter ou testar alternativa
- Lições têm **precedência sobre regras heurísticas de threshold** (`buildPricingThresholdsBlock`) — dados reais >  suposições configuradas

---

### 18. Lições de Rejeição

**Builder:** `buildRejectionLessonsBlock(unitId)`  
**Fonte:** `price_proposals` com `rejection_reason_type NOT NULL` (últimas 90 dias, máx. 5+3)  
**Presente em:** chat ✅ | propostas ✅

**O que inclui:**
- Por rejeição recente: Data | Motivo estruturado | Texto do gestor | Itens rejeitados

**Motivos estruturados (preço):** `precos_muito_altos`, `precos_muito_baixos`, `estrategia_inadequada`, `item_especifico_errado`, `momento_inadequado`, `concorrencia_nao_considerada`, `margem_insuficiente`, `outro`

**Como o agente deve usar:**
- Se última rejeição foi `precos_muito_altos` na categoria Master: sinalizar calibração mais conservadora para Master
- Se `momento_inadequado`: verificar calendário de eventualidades antes de propor aumento
- Padrão repetido do mesmo motivo → aprendizado prioritário na próxima proposta

---

### 19. Regras de Ajuste Dinâmico (Thresholds)

**Builder:** `buildPricingThresholdsBlock(thresholds)`  
**Fonte:** `rm_agent_config.pricing_thresholds JSONB`  
**Presente em:** chat ✅ | propostas ✅

**O que inclui:**
- Regras do tipo: "Giro > X → demanda aquecida, priorize +N%" / "Ocupação < Y% → avalie redução de N%"

**Como o agente deve usar:**
- Heurística de **fallback** — só aplicar quando não há lições aprendidas (bloco 17) relevantes
- Lições aprendidas têm precedência porque refletem dados reais da unidade vs. suposições genéricas

---

### 20. Contexto Estratégico Compartilhado

**Builder:** `buildSharedContextBlock(text)`  
**Fonte:** `rm_agent_config.shared_context TEXT`  
**Presente em:** chat ✅ (modo `org`) | propostas ✅

**O que inclui:**
- Texto livre cadastrado pelo gestor (ex: "Temporada de alta: março–abril. Prioridade: RevPAR > Giro.")

**Como o agente deve usar:**
- Contexto de alto nível que filtra ou reforça todas as análises
- No modo `personal` de conversa, este bloco é omitido (contexto sem memória coletiva)

---

### 21. Calendário de Eventualidades

**Fonte:** tabela `unit_events` (Supabase); auto-populado com feriados via `seed-holidays`  
**Presente em:** chat ✅ (modo `org`) | propostas (via `shared_context` ou via revisões)

**O que inclui:**
- Por evento: Data | Título | Tipo (positivo/negativo/neutro) | Impacto esperado

**Como o agente deve usar:**
- Evento positivo próximo (ex: Carnaval, show) → demanda acima do normal → proposta mais agressiva
- Evento negativo (ex: obra na rua) → queda esperada de volume → não aumentar preço
- Feriado nacional próximo → padrão FDS/feriado prevalece → verificar ratio FDS vs semana (bloco 10)

---

### 22. Clima Atual e Previsão

**Builder:** `buildWeatherBlock(weatherContext)` (somente chat)  
**Fonte:** OpenWeatherMap API, cidade configurada em `rm_agent_config.city`  
**Presente em:** chat ✅ | propostas ✗ (omitido por custo de latência)

**O que inclui:**
- Condição atual: temperatura, descrição, umidade, vento
- Previsão 3 dias com condição e temperatura
- Correlações históricas clima × demanda (quando disponíveis)

**Como o agente deve usar:**
- Chuva intensa no FDS → demanda por hospedagem fechada pode subir (motéis como "destino" vs "passagem")
- Calor extremo → demanda pode cair (clientes não saem de casa)
- Dados de correlação real em `rm_weather_observations` têm mais peso que intuição genérica

---

## Gaps conhecidos e roadmap

| Gap | Descrição | Impacto | Status |
|-----|-----------|---------|--------|
| **GAP-1** | KPI por categoria × período (RevPAR/Giro/Ticket cruzado) | Alto — proposta homogeniza período sem base | Sem issue |
| **GAP-2** | TMO por período (3h vs 6h vs 12h) | Médio — útil para calibrar preço de períodos longos | Sem issue |
| **GAP-4** | Yield por hora (receita/hora de ocupação) | Médio — compara eficiência real entre períodos | Sem issue |
| **GAP-5** | Taxa de cancelamento por canal | Baixo | Sem issue |

**GAP-3 foi resolvido:** `queryDemandPattern` agora injetado nas propostas (LHG-190, implementado nesta sessão).

---

## Fluxo de decisão do agente

```
┌─ Configuração ───────────────────────────────────────────────┐
│  focus_metric + pricing_strategy + max_variation_pct         │
│  shared_context + pricing_thresholds                          │
└──────────────────────────────────────────────────────────────┘
           │
           ▼
┌─ Diagnóstico ────────────────────────────────────────────────┐
│  KPIs atuais vs. período anterior + previsão                  │
│  Comparativo de metas (unit_goals + budget_yearly)            │
│  Pace de reservas (hoje vs. média histórica)                  │
│  Padrão de demanda (fdsSemanaRatio + slots quentes/frios)     │
└──────────────────────────────────────────────────────────────┘
           │
           ▼
┌─ Contexto externo ────────────────────────────────────────────┐
│  Sazonalidade aprendida (próximos 30d)                        │
│  Calendário de eventualidades                                  │
│  Price gap vs. concorrentes + snapshots raw                   │
│  Clima atual e previsão                                        │
└───────────────────────────────────────────────────────────────┘
           │
           ▼
┌─ Aprendizado histórico ───────────────────────────────────────┐
│  Memória estratégica (últimas 3 propostas + resultado real)   │
│  Lições de pricing com filtro de relevância                   │
│  Lições de rejeição (motivos estruturados)                    │
│  Elasticidade-preço por categoria/período                     │
└───────────────────────────────────────────────────────────────┘
           │
           ▼
┌─ Restrições ──────────────────────────────────────────────────┐
│  Guardrails (min/max por cat/período/dia)                     │
│  max_variation_pct (hard limit por item)                      │
│  COBERTURA TOTAL obrigatória (todas as linhas)                │
└───────────────────────────────────────────────────────────────┘
           │
           ▼
     JSON da proposta
           │
    Safety net server-side
    (linhas omitidas → preço mantido + aviso)
    Clamp pelos guardrails → was_clamped = true
    Elasticidade → expected_revenue_change_pct
           │
           ▼
     Aprovação humana obrigatória (MVP)
```

---

## Ordem de precedência em conflito

Quando diferentes blocos sugerem ações conflitantes:

1. **Guardrails** (hard limit) — prevalece sobre tudo
2. **Lições aprendidas** (`rm_pricing_lessons`) — dados reais da unidade
3. **Rejeições recentes** — feedback direto do gestor
4. **Memória estratégica** — resultado de propostas anteriores
5. **Elasticidade-preço** — OLS sobre histórico
6. **Thresholds dinâmicos** — heurística de fallback configurada
7. **KPIs atuais** — diagnóstico do período
8. **Sazonalidade / Concorrentes / Clima** — contexto externo

---

## Manutenção dos builders

| Arquivo | Responsabilidade |
|---------|-----------------|
| `src/lib/agente/system-prompt.ts` | `buildKPIContext`, `buildSystemPrompt`, tabelas semanais |
| `src/lib/agente/context-blocks.ts` | `buildStrategicMemoryBlock`, `buildGuardrailsBlock`, `buildPricingThresholdsBlock`, `buildSharedContextBlock` |
| `src/lib/agente/pricing-lessons.ts` | `buildLessonsBlockForUnit`, scoring de relevância |
| `src/lib/agente/rejection-lessons.ts` | `buildRejectionLessonsBlock` |
| `src/lib/agente/unit-structure.ts` | `buildUnitStructureBlock` (capacidade + ocupação RT + custos) |
| `src/lib/agente/proposal-baseline.ts` | `buildProposalBaseline` (snapshot KPI na aprovação) |
| `src/lib/automo/demand-pattern.ts` | `queryDemandPattern`, `buildDemandPatternBlock` |
| `src/lib/automo/reservation-pace.ts` | `getReservationPace`, `buildPaceBlock` |
| `src/lib/automo/realtime-occupancy.ts` | `getRealtimeOccupancyByCategory` |
| `src/lib/automo/suite-availability.ts` | `getSuiteAvailabilityByCategory` |
| `src/lib/pricing/elasticity.ts` | `buildElasticityBlock`, `expectedRevenueChangePct` |
| `src/lib/seasonality/compute.ts` | `buildSeasonalityBlock`, `getUpcomingSeasonalFactors` |
| `src/lib/competitors/detect-changes.ts` | `buildCompetitorGapBlock`, `getRecentGaps` |
| `src/lib/forecast/revenue-forecast.ts` | `buildForecastBlock`, `computeRevenueForecast` |
| `src/lib/agente/weather-insight.ts` | `getWeatherInsight` (dashboard) |
| `src/lib/agente/weather.ts` | `fetchWeatherData`, `buildWeatherBlock` (chat) |

**Regra ao adicionar novo bloco:**
1. Criar builder puro (sem I/O) que recebe dados e retorna `string`
2. Buscar os dados no `Promise.all` em `chat/route.ts` **e** `proposals/route.ts` em paralelo (zero latência)
3. Incluir no prompt em ambas as rotas
4. Documentar aqui com: Fonte, Frequência, Como usar, Armadilhas
