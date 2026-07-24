import { Document, Page, Text, View, StyleSheet, renderToBuffer } from '@react-pdf/renderer'
import { formatCurrency, formatDate } from '@/lib/utils'

const INDIGO = '#4338ca'
const INDIGO_SOFT = '#f4f3fc'
const INDIGO_PALE = '#c7d2fe'
const INK = '#1f2937'
const GRAY = '#6b7280'
const GRAY_LIGHT = '#9ca3af'
const BORDER = '#e5e7eb'

const styles = StyleSheet.create({
  page: { paddingTop: 40, paddingHorizontal: 40, paddingBottom: 56, fontSize: 10, fontFamily: 'Helvetica', color: INK },

  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', paddingBottom: 16, marginBottom: 22, borderBottomWidth: 2, borderBottomColor: INDIGO },
  constructoraNombre: { fontFamily: 'Times-Bold', fontSize: 21 },
  proyectoLabel: { fontSize: 9, color: GRAY, marginTop: 4 },
  headerRight: { alignItems: 'flex-end' },
  presupuestoLabel: { fontSize: 9, color: INDIGO, letterSpacing: 1.5 },
  codigo: { fontSize: 9, color: GRAY_LIGHT, marginTop: 4 },

  infoRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 20 },
  infoCol: { maxWidth: 260 },
  label: { fontSize: 8, letterSpacing: 1, color: GRAY_LIGHT, marginBottom: 7 },
  clienteNombre: { fontSize: 13, fontFamily: 'Helvetica-Bold', marginBottom: 4 },
  clienteDetalle: { fontSize: 9.5, color: GRAY, marginBottom: 2 },

  detalleCol: { alignItems: 'flex-end' },
  detalleRow: { flexDirection: 'row', marginBottom: 4 },
  detalleKey: { fontSize: 9.5, color: GRAY_LIGHT, marginRight: 10 },
  detalleVal: { fontSize: 9.5, fontFamily: 'Helvetica-Bold' },

  section: { marginBottom: 18, paddingTop: 14, borderTopWidth: 1, borderTopColor: BORDER },
  sectionText: { fontSize: 10, lineHeight: 1.5, color: INK },

  table: { marginTop: 4, marginBottom: 4 },
  tableHeaderRow: { flexDirection: 'row', backgroundColor: INDIGO_SOFT, paddingVertical: 8, paddingHorizontal: 10 },
  tableRow: { flexDirection: 'row', paddingVertical: 8, paddingHorizontal: 10, borderBottomWidth: 1, borderBottomColor: BORDER },
  thNum: { width: 22, fontSize: 8, color: INDIGO, letterSpacing: 0.5 },
  thRubro: { flex: 1, fontSize: 8, color: INDIGO, letterSpacing: 0.5 },
  thNumeric: { width: 100, fontSize: 8, color: INDIGO, letterSpacing: 0.5, textAlign: 'right' },
  tdNum: { width: 22, fontSize: 9, color: GRAY_LIGHT },
  tdRubro: { flex: 1, fontSize: 9.5, fontFamily: 'Helvetica-Bold', paddingRight: 8 },
  tdNumeric: { width: 100, fontSize: 9.5, textAlign: 'right' },
  tdNumericBold: { width: 100, fontSize: 9.5, fontFamily: 'Helvetica-Bold', textAlign: 'right' },
  tdUnidad: { fontSize: 9, color: GRAY_LIGHT },

  totalRow: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 18, marginBottom: 24 },
  totalBox: { flexDirection: 'row', alignItems: 'baseline', backgroundColor: INDIGO, paddingVertical: 11, paddingHorizontal: 18 },
  totalLabel: { fontSize: 8, color: INDIGO_PALE, letterSpacing: 1, marginRight: 12 },
  totalValue: { fontSize: 16, fontFamily: 'Helvetica-Bold', color: '#ffffff' },

  footer: { position: 'absolute', bottom: 28, left: 40, right: 40, paddingTop: 10, borderTopWidth: 1, borderTopColor: BORDER, fontSize: 8, color: GRAY_LIGHT },
})

const ESTADO_LABEL: Record<string, string> = {
  borrador: 'Borrador',
  enviado: 'Enviado',
  aceptado: 'Aceptado',
  rechazado: 'Rechazado',
}

export interface PresupuestoPdfItem {
  rubro: string
  cantidad: number
  unidad: string | null
  precio_unitario: number
  subtotal: number
}

export interface PresupuestoPdfData {
  constructoraNombre: string
  obraNombre: string | null
  clienteNombre: string
  clienteCuit: string | null
  clienteEmail: string | null
  clienteTelefono: string | null
  createdAt: string
  estado: string
  fechaInicio: string | null
  fechaFinEstimada: string | null
  descripcion: string | null
  notas: string | null
  moneda: string
  items: PresupuestoPdfItem[]
  total: number
  codigo: string
}

function PresupuestoDocument(d: PresupuestoPdfData) {
  const fechaInicio = d.fechaInicio ? formatDate(d.fechaInicio) : null
  const fechaFin = d.fechaFinEstimada ? formatDate(d.fechaFinEstimada) : null

  return (
    <Document title={`Presupuesto ${d.clienteNombre}`}>
      <Page size="A4" style={styles.page}>

        <View style={styles.header}>
          <View>
            <Text style={styles.constructoraNombre}>{d.constructoraNombre}</Text>
            {d.obraNombre && <Text style={styles.proyectoLabel}>Proyecto: {d.obraNombre}</Text>}
          </View>
          <View style={styles.headerRight}>
            <Text style={styles.presupuestoLabel}>PRESUPUESTO</Text>
            <Text style={styles.codigo}>N.º {d.codigo}</Text>
          </View>
        </View>

        <View style={styles.infoRow}>
          <View style={styles.infoCol}>
            <Text style={styles.label}>CLIENTE</Text>
            <Text style={styles.clienteNombre}>{d.clienteNombre}</Text>
            {d.clienteCuit && <Text style={styles.clienteDetalle}>CUIT {d.clienteCuit}</Text>}
            {d.clienteEmail && <Text style={styles.clienteDetalle}>{d.clienteEmail}</Text>}
            {d.clienteTelefono && <Text style={styles.clienteDetalle}>{d.clienteTelefono}</Text>}
          </View>
          <View style={styles.detalleCol}>
            <Text style={styles.label}>DETALLE</Text>
            <View style={styles.detalleRow}>
              <Text style={styles.detalleKey}>Emitido</Text>
              <Text style={styles.detalleVal}>{formatDate(d.createdAt)}</Text>
            </View>
            <View style={styles.detalleRow}>
              <Text style={styles.detalleKey}>Estado</Text>
              <Text style={styles.detalleVal}>{ESTADO_LABEL[d.estado] ?? d.estado}</Text>
            </View>
            {(fechaInicio || fechaFin) && (
              <View style={styles.detalleRow}>
                <Text style={styles.detalleKey}>Plazo</Text>
                <Text style={styles.detalleVal}>
                  {fechaInicio}{fechaInicio && fechaFin ? ' – ' : ''}{fechaFin}
                </Text>
              </View>
            )}
          </View>
        </View>

        {d.descripcion && (
          <View style={styles.section}>
            <Text style={styles.label}>DESCRIPCIÓN DEL TRABAJO</Text>
            <Text style={styles.sectionText}>{d.descripcion}</Text>
          </View>
        )}

        <View style={styles.table}>
          <View style={styles.tableHeaderRow}>
            <Text style={styles.thNum}>#</Text>
            <Text style={styles.thRubro}>RUBRO</Text>
            <Text style={styles.thNumeric}>CANTIDAD</Text>
            <Text style={styles.thNumeric}>PRECIO UNIT.</Text>
            <Text style={styles.thNumeric}>SUBTOTAL</Text>
          </View>
          {d.items.map((item, i) => (
            <View key={i} style={styles.tableRow} wrap={false}>
              <Text style={styles.tdNum}>{i + 1}</Text>
              <Text style={styles.tdRubro}>{item.rubro}</Text>
              <Text style={styles.tdNumeric}>
                {item.cantidad} <Text style={styles.tdUnidad}>{item.unidad ?? ''}</Text>
              </Text>
              <Text style={styles.tdNumeric}>{formatCurrency(item.precio_unitario, d.moneda)}</Text>
              <Text style={styles.tdNumericBold}>{formatCurrency(item.subtotal, d.moneda)}</Text>
            </View>
          ))}
        </View>

        <View style={styles.totalRow}>
          <View style={styles.totalBox}>
            <Text style={styles.totalLabel}>TOTAL</Text>
            <Text style={styles.totalValue}>{formatCurrency(d.total, d.moneda)}</Text>
          </View>
        </View>

        {d.notas && (
          <View style={styles.section}>
            <Text style={styles.label}>NOTAS</Text>
            <Text style={styles.sectionText}>{d.notas}</Text>
          </View>
        )}

        <Text style={styles.footer} fixed>
          Presupuesto emitido el {formatDate(new Date().toISOString())}. Sujeto a aprobación — no válido como factura.
        </Text>

      </Page>
    </Document>
  )
}

export async function renderPresupuestoPdf(data: PresupuestoPdfData): Promise<Buffer> {
  return renderToBuffer(<PresupuestoDocument {...data} />)
}
