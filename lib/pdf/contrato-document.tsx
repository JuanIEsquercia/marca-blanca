import { Document, Page, Text, View, StyleSheet, renderToBuffer } from '@react-pdf/renderer'
import { formatCurrency, redondear2 } from '@/lib/utils'
import { sharedStyles, pdfColors, DocHeader, InfoBox, FirmaBlock, formatDate } from './shared'

const styles = StyleSheet.create({
  table: { marginTop: 4, marginBottom: 18 },
  tableHeaderRow: { flexDirection: 'row', backgroundColor: pdfColors.indigoSoft, paddingVertical: 8, paddingHorizontal: 10 },
  tableRow: { flexDirection: 'row', paddingVertical: 8, paddingHorizontal: 10, borderBottomWidth: 1, borderBottomColor: pdfColors.border },
  thNum: { width: 22, fontSize: 8, color: pdfColors.indigo, letterSpacing: 0.5 },
  thRubro: { flex: 1, fontSize: 8, color: pdfColors.indigo, letterSpacing: 0.5 },
  thNumeric: { width: 78, fontSize: 8, color: pdfColors.indigo, letterSpacing: 0.5, textAlign: 'right' },
  tdNum: { width: 22, fontSize: 9, color: pdfColors.grayLight },
  tdRubro: { flex: 1, fontSize: 9.5, fontFamily: 'Helvetica-Bold', paddingRight: 8 },
  tdAdicional: { fontSize: 8, fontFamily: 'Helvetica', color: '#b45309', backgroundColor: '#fef3c7', paddingHorizontal: 5, paddingVertical: 1.5, borderRadius: 2 },
  tdNumeric: { width: 78, fontSize: 9.5, textAlign: 'right' },
  tdNumericBold: { width: 78, fontSize: 9.5, fontFamily: 'Helvetica-Bold', textAlign: 'right' },
  tdUnidad: { fontSize: 8, color: pdfColors.grayLight },
  desgloseRow: { flexDirection: 'row', marginBottom: 6 },
  desgloseKey: { fontSize: 9, color: pdfColors.gray, marginRight: 10 },
  desgloseVal: { fontSize: 9, fontFamily: 'Helvetica-Bold' },
})

export interface ContratoPdfItem {
  rubro: string
  unidad: string | null
  cantidad: number
  precioUnitario: number
  montoContratado: number
  origen: string
}

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
  items: ContratoPdfItem[]
  ivaPct: number | null
  codigo: string
}

function ContratoDocument(d: ContratoPdfData) {
  const fechaInicio = d.fechaInicio ? formatDate(d.fechaInicio) : null
  const fechaFin = d.fechaFinEstimada ? formatDate(d.fechaFinEstimada) : null
  const hoy = formatDate(new Date().toISOString())
  const iva = d.ivaPct ? redondear2(d.montoTotal * d.ivaPct / 100) : 0
  const totalConIva = redondear2(d.montoTotal + iva)

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

        {d.items.length > 0 && (
          <View style={styles.table}>
            <View style={styles.tableHeaderRow}>
              <Text style={styles.thNum}>#</Text>
              <Text style={styles.thRubro}>RUBRO</Text>
              <Text style={styles.thNumeric}>CANTIDAD</Text>
              <Text style={styles.thNumeric}>PRECIO UNIT.</Text>
              <Text style={styles.thNumeric}>MONTO</Text>
            </View>
            {d.items.map((item, i) => (
              <View key={i} style={styles.tableRow} wrap={false}>
                <Text style={styles.tdNum}>{i + 1}</Text>
                <Text style={styles.tdRubro}>
                  {item.rubro}
                  {item.origen === 'adicional' && <Text style={styles.tdAdicional}>  Adicional  </Text>}
                </Text>
                <Text style={styles.tdNumeric}>
                  {item.cantidad} <Text style={styles.tdUnidad}>{item.unidad ?? ''}</Text>
                </Text>
                <Text style={styles.tdNumeric}>{formatCurrency(item.precioUnitario, d.moneda)}</Text>
                <Text style={styles.tdNumericBold}>{formatCurrency(item.montoContratado, d.moneda)}</Text>
              </View>
            ))}
          </View>
        )}

        <View style={sharedStyles.totalRow}>
          {d.ivaPct ? (
            <View style={{ alignItems: 'flex-end' }}>
              <View style={styles.desgloseRow}>
                <Text style={styles.desgloseKey}>Subtotal</Text>
                <Text style={styles.desgloseVal}>{formatCurrency(d.montoTotal, d.moneda)}</Text>
              </View>
              <View style={[styles.desgloseRow, { marginBottom: 10 }]}>
                <Text style={styles.desgloseKey}>+ IVA ({d.ivaPct}%)</Text>
                <Text style={styles.desgloseVal}>{formatCurrency(iva, d.moneda)}</Text>
              </View>
              <View style={sharedStyles.totalBox}>
                <Text style={sharedStyles.totalLabel}>PRECIO ACORDADO</Text>
                <Text style={sharedStyles.totalValue}>{formatCurrency(totalConIva, d.moneda)}</Text>
              </View>
            </View>
          ) : (
            <View style={sharedStyles.totalBox}>
              <Text style={sharedStyles.totalLabel}>PRECIO ACORDADO</Text>
              <Text style={sharedStyles.totalValue}>{formatCurrency(d.montoTotal, d.moneda)}</Text>
            </View>
          )}
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
