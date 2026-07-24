import { Document, Page, Text, View, StyleSheet, renderToBuffer } from '@react-pdf/renderer'
import { formatCurrency } from '@/lib/utils'
import { sharedStyles, pdfColors, DocHeader, InfoBox, FirmaBlock, formatDate } from './shared'

const styles = StyleSheet.create({
  cuerpo: { fontSize: 11, lineHeight: 1.7, marginBottom: 14 },
  bold: { fontFamily: 'Helvetica-Bold' },
  italic: { fontFamily: 'Helvetica-Oblique' },
  conceptoBox: { backgroundColor: pdfColors.indigoSoft, borderRadius: 3, padding: 12, marginBottom: 16 },
  conceptoLabel: { fontSize: 8, letterSpacing: 1, color: pdfColors.indigo, marginBottom: 4 },
  conceptoTexto: { fontSize: 10, lineHeight: 1.4, color: pdfColors.ink },
})

function numeroALetras(n: number): string {
  return n.toLocaleString('es-AR')
}

export interface CobroPdfData {
  reciboNum: string
  constructoraNombre: string
  obraNombre: string
  obraDireccion: string | null
  clienteNombre: string | null
  clienteCuit: string | null
  monto: number
  moneda: string
  fechaPago: string | null
  cuentaNombre: string | null
  cuentaTipo: string | null
  cuentaMoneda: string | null
  certificadoNumero: number | null
  certificadoPeriodo: string | null
  notas: string | null
}

function CobroDocument(d: CobroPdfData) {
  const hoy = formatDate(new Date().toISOString())
  const fechaPago = d.fechaPago ? formatDate(d.fechaPago) : '—'
  const monedaTexto = d.moneda === 'USD' ? 'dólares estadounidenses' : 'pesos argentinos'

  const infoItems = [
    { key: 'FECHA DE PAGO', value: fechaPago },
    ...(d.cuentaNombre ? [{ key: 'ACREDITADO EN', value: `${d.cuentaNombre} (${d.cuentaTipo} · ${d.cuentaMoneda})` }] : []),
    ...(d.certificadoNumero ? [{ key: 'CERTIFICADO N.º', value: `${d.certificadoNumero} — ${d.certificadoPeriodo}` }] : []),
    { key: 'OBRA', value: d.obraNombre },
  ]

  return (
    <Document title={`Recibo N ${d.reciboNum}`}>
      <Page size="A4" style={sharedStyles.page}>
        <DocHeader
          constructoraNombre={d.constructoraNombre}
          sub={d.obraDireccion}
          docLabel="RECIBO"
          codigo={`N.º ${d.reciboNum}`}
          fecha={fechaPago}
        />

        <Text style={styles.cuerpo}>
          Recibí de <Text style={styles.bold}>{d.clienteNombre ?? '___________________________'}</Text>
          {d.clienteCuit ? `, CUIT N.º ${d.clienteCuit},` : ','} la suma de{' '}
          <Text style={styles.bold}>{formatCurrency(d.monto, d.moneda)}</Text>{' '}
          <Text style={styles.italic}>({numeroALetras(d.monto)} {monedaTexto})</Text> en concepto de lo detallado a continuación.
        </Text>

        <View style={styles.conceptoBox}>
          <Text style={styles.conceptoLabel}>CONCEPTO</Text>
          <Text style={styles.conceptoTexto}>
            Cobro{d.certificadoNumero ? ` correspondiente al Certificado de Avance N.º${d.certificadoNumero} — ${d.certificadoPeriodo}` : ''}. Obra: {d.obraNombre}.
            {d.notas ? ` ${d.notas}` : ''}
          </Text>
        </View>

        <InfoBox items={infoItems} />

        <View style={sharedStyles.totalRow}>
          <View style={sharedStyles.totalBox}>
            <Text style={sharedStyles.totalLabel}>TOTAL RECIBIDO</Text>
            <Text style={sharedStyles.totalValue}>{formatCurrency(d.monto, d.moneda)}</Text>
          </View>
        </View>

        <View style={sharedStyles.firmasRow}>
          <FirmaBlock nombre={d.constructoraNombre} rol="FIRMA Y SELLO" />
          <FirmaBlock nombre={d.clienteNombre ?? 'Comitente'} rol="RECIBÍ CONFORME" extra={d.clienteCuit ? `CUIT ${d.clienteCuit}` : null} />
        </View>

        <Text style={sharedStyles.footer} fixed>
          {d.constructoraNombre} · Recibo N.º{d.reciboNum} · Generado {hoy}
        </Text>
      </Page>
    </Document>
  )
}

export async function renderCobroPdf(data: CobroPdfData): Promise<Buffer> {
  return renderToBuffer(<CobroDocument {...data} />)
}
