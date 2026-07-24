import { Document, Page, Text, View, renderToBuffer } from '@react-pdf/renderer'
import { formatCurrency } from '@/lib/utils'
import { sharedStyles, DocHeader, InfoBox, FirmaBlock, formatDate } from './shared'

export interface ContratoPdfData {
  constructoraNombre: string
  obraNombre: string
  clienteNombre: string
  clienteCuit: string | null
  montoTotal: number
  moneda: string
  fechaInicio: string | null
  fechaFinEstimada: string | null
  descripcion: string | null
  codigo: string
}

function ContratoDocument(d: ContratoPdfData) {
  const fechaInicio = d.fechaInicio ? formatDate(d.fechaInicio) : null
  const fechaFin = d.fechaFinEstimada ? formatDate(d.fechaFinEstimada) : null
  const hoy = formatDate(new Date().toISOString())

  const infoItems = [
    { key: 'CLIENTE', value: d.clienteNombre },
    { key: 'CUIT', value: d.clienteCuit ?? '—' },
    { key: 'OBRA', value: d.obraNombre, full: true },
  ]
  if (fechaInicio || fechaFin) {
    infoItems.push({ key: 'PLAZO', value: `${fechaInicio ?? '—'}${fechaInicio && fechaFin ? ' – ' : ''}${fechaFin ?? ''}`, full: true })
  }

  return (
    <Document title={`Acuerdo de obra ${d.obraNombre}`}>
      <Page size="A4" style={sharedStyles.page}>
        <DocHeader
          constructoraNombre={d.constructoraNombre}
          docLabel="ACUERDO DE OBRA"
          codigo={`N.º ${d.codigo}`}
          fecha={hoy}
        />

        <InfoBox items={infoItems} />

        <View style={sharedStyles.totalRow}>
          <View style={sharedStyles.totalBox}>
            <Text style={sharedStyles.totalLabel}>PRECIO ACORDADO</Text>
            <Text style={sharedStyles.totalValue}>{formatCurrency(d.montoTotal, d.moneda)}</Text>
          </View>
        </View>

        {d.descripcion && (
          <View style={sharedStyles.section}>
            <Text style={sharedStyles.label}>DESCRIPCIÓN DE LOS TRABAJOS</Text>
            <Text style={sharedStyles.sectionText}>{d.descripcion}</Text>
          </View>
        )}

        <View style={sharedStyles.firmasRow}>
          <FirmaBlock nombre={d.constructoraNombre} rol="CONTRATISTA" />
          <FirmaBlock nombre={d.clienteNombre} rol="COMITENTE" extra={d.clienteCuit ? `CUIT ${d.clienteCuit}` : null} />
        </View>

        <Text style={sharedStyles.footer} fixed>
          {d.constructoraNombre} · Acuerdo de obra · {d.obraNombre} · Generado {hoy}
        </Text>
      </Page>
    </Document>
  )
}

export async function renderContratoPdf(data: ContratoPdfData): Promise<Buffer> {
  return renderToBuffer(<ContratoDocument {...data} />)
}
