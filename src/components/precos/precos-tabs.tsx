'use client'

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { PriceList } from '@/components/precos/price-list'
import { PriceImportQueue, ImportJobHistory } from '@/components/precos/price-import-queue'

interface PrecosTabsProps {
  unitSlug: string
  unitId: string
  unitName: string
}

export function PrecosTabs({ unitSlug, unitId, unitName }: PrecosTabsProps) {
  return (
    <div className="flex flex-col gap-4">
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
    </div>
  )
}
