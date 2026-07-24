import { Document, Page, Text, View, StyleSheet, renderToBuffer } from '@react-pdf/renderer'
import { formatCurrency } from '@/lib/utils'
import { sharedStyles, pdfColors, DocHeader, InfoBox, FirmaBlock, formatDate } from './shared'

const styles = StyleSheet.create({
  conformidad: { fontSize: 9.5, color: pdfColors.gray, textAlign: 'center', marginBottom: 4, lineHeight: 1.4 },
})

const ESTADO_LABEL: Record<string, string> = {
  borrador: 'Borrador',
  presentado: 'Presentado al comitente',
  aprobado: 'Aprobado por el comitente',
}

export interface CertificadoPdfData {
  numero: number
  constructoraNombre: string
  obraNombre: string
  obraDireccion: string | null
  clienteNombre: string
  clienteCuit: string | null
  periodo: string
  fechaPresentacion: string | null
  fechaAprobacion: string | null
  estado: string
  porcentajeAvance: number
  montoCertificado: number
  montoTotalContrato: number
  moneda: string
  descripcionAvances: string | null
  notas: string | null
}

function fmtDateOrBlank(d: string | null) {
  return d ? formatDate(d) : '—'
}

function CertificadoDocument(d: CertificadoPdfData) {
  const hoy = formatDate(new Date().toISOString())
  const pctContrato = d.montoTotalContrato > 0 ? ((d.montoCertificado / d.montoTotalContrato) * 100).toFixed(1) : '—'

  return (
    <Document title={`Certificado de avance N.${d.numero}`}>
      <Page size="A4" style={sharedStyles.page}>
        <DocHeader
          constructoraNombre={d.constructoraNombre}
          sub={d.obraDireccion}
          docLabel="CERTIFICADO DE AVANCE"
          codigo={`N.º ${d.numero}`}
          fecha={hoy}
        />

        <InfoBox items={[
          { key: 'COMITENTE', value: d.clienteNombre || '—' },
          { key: 'CUIT', value: d.clienteCuit ?? '—' },
          { key: 'OBRA', value: d.obraNombre },
          { key: 'PERÍODO', value: d.periodo },
          { key: 'FECHA PRESENTACIÓN', value: fmtDateOrBlank(d.fechaPresentacion) },
          { key: 'FECHA APROBACIÓN', value: fmtDateOrBlank(d.fechaAprobacion) },
          { key: 'ESTADO', value: ESTADO_LABEL[d.estado] ?? d.estado, full: true },
        ]} />

        <View style={sharedStyles.highlightRow}>
          <View style={[sharedStyles.highlightBox, { flex: 0.5 }]}>
            <Text style={sharedStyles.highlightLabel}>AVANCE</Text>
            <Text style={sharedStyles.highlightValue}>{d.porcentajeAvance}%</Text>
          </View>
          <View style={sharedStyles.highlightBox}>
            <Text style={sharedStyles.highlightLabel}>MONTO CERTIFICADO</Text>
            <Text style={sharedStyles.highlightValue}>{formatCurrency(d.montoCertificado, d.moneda)}</Text>
            <Text style={sharedStyles.highlightSub}>{pctContrato}% del total · {formatCurrency(d.montoTotalContrato, d.moneda)}</Text>
          </View>
        </View>

        <View style={sharedStyles.section}>
          <Text style={sharedStyles.label}>DESCRIPCIÓN DE TRABAJOS EJECUTADOS EN EL PERÍODO</Text>
          <Text style={sharedStyles.sectionText}>{d.descripcionAvances ?? 'Sin descripción detallada.'}</Text>
        </View>

        {d.notas && (
          <View style={sharedStyles.section}>
            <Text style={sharedStyles.label}>NOTAS</Text>
            <Text style={sharedStyles.sectionText}>{d.notas}</Text>
          </View>
        )}

        <Text style={styles.conformidad}>
          Las partes prestan conformidad con el avance y el monto certificado precedentes,{'\n'}
          comprometiéndose al pago en los plazos acordados.
        </Text>

        <View style={sharedStyles.firmasRow}>
          <FirmaBlock nombre={d.constructoraNombre} rol="EL CONTRATISTA" extra="Fecha: ____/____/________" />
          <FirmaBlock nombre={d.clienteNombre || 'Comitente'} rol="EL COMITENTE" extra={d.clienteCuit ? `CUIT ${d.clienteCuit} · Fecha: ____/____/________` : 'Fecha: ____/____/________'} />
        </View>

        <Text style={sharedStyles.footer} fixed>
          {d.constructoraNombre} · Certificado de Avance N.º{d.numero} · {d.periodo} · Generado {hoy}
        </Text>
      </Page>
    </Document>
  )
}

export async function renderCertificadoPdf(data: CertificadoPdfData): Promise<Buffer> {
  return renderToBuffer(<CertificadoDocument {...data} />)
}
