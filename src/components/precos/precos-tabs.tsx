'use client'

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { PriceList } from '@/components/precos/price-list'
import { PriceImportQueue, ImportJobHistory } from '@/components/precos/price-import-queue'
import { Separator } from '@/components/ui/separator'

interface PrecosTabsProps {
  unitSlug: string
  unitId: string
  unitName: string
}

export function PrecosTabs({ unitSlug, unitId, unitName }: PrecosTabsProps) {
  return (
    <div className="flex flex-col gap-8">
      {/* ── Seção: Preços ── */}
      <section className="flex flex-col gap-4">
        <div>
          <h2 className="text-base font-semibold">Tabelas de Preços</h2>
          <p className="text-xs text-muted-foreground">Tarifas por canal, categoria e período.</p>
        </div>
        <PriceImportQueue unitSlug={unitSlug} unitName={unitName} importType="prices" />
        <Tabs defaultValue="tabelas">
          <TabsList className="w-full justify-start">
            <TabsTrigger value="tabelas">Tabelas importadas</TabsTrigger>
            <TabsTrigger value="historico">Histórico</TabsTrigger>
          </TabsList>
          <TabsContent value="tabelas" className="mt-4">
            <PriceList unitSlug={unitSlug} unitId={unitId} importType="prices" />
          </TabsContent>
          <TabsContent value="historico" className="mt-4">
            <ImportJobHistory unitSlug={unitSlug} unitId={unitId} unitName={unitName} importType="prices" />
          </TabsContent>
        </Tabs>
      </section>

      <Separator />

      {/* ── Seção: Descontos ── */}
      <section className="flex flex-col gap-4">
        <div>
          <h2 className="text-base font-semibold">Tabelas de Descontos</h2>
          <p className="text-xs text-muted-foreground">Política de descontos do Guia de Motéis.</p>
        </div>
        <PriceImportQueue unitSlug={unitSlug} unitName={unitName} importType="discounts" />
        <Tabs defaultValue="tabelas">
          <TabsList className="w-full justify-start">
            <TabsTrigger value="tabelas">Descontos importados</TabsTrigger>
            <TabsTrigger value="historico">Histórico</TabsTrigger>
          </TabsList>
          <TabsContent value="tabelas" className="mt-4">
            <PriceList unitSlug={unitSlug} unitId={unitId} importType="discounts" />
          </TabsContent>
          <TabsContent value="historico" className="mt-4">
            <ImportJobHistory unitSlug={unitSlug} unitId={unitId} unitName={unitName} importType="discounts" />
          </TabsContent>
        </Tabs>
      </section>
    </div>
  )
}
