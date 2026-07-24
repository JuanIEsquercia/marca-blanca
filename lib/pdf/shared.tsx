import { Text, View, StyleSheet } from '@react-pdf/renderer'
import { formatDate } from '@/lib/utils'

export const pdfColors = {
  indigo: '#4338ca',
  indigoSoft: '#f4f3fc',
  indigoPale: '#c7d2fe',
  ink: '#1f2937',
  gray: '#6b7280',
  grayLight: '#9ca3af',
  border: '#e5e7eb',
  black: '#111827',
}

export const sharedStyles = StyleSheet.create({
  page: { paddingTop: 40, paddingHorizontal: 40, paddingBottom: 56, fontSize: 10, fontFamily: 'Helvetica', color: pdfColors.ink },

  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', paddingBottom: 16, marginBottom: 22, borderBottomWidth: 2, borderBottomColor: pdfColors.indigo },
  constructoraNombre: { fontFamily: 'Times-Bold', fontSize: 21 },
  headerSub: { fontSize: 9, color: pdfColors.gray, marginTop: 4 },
  headerRight: { alignItems: 'flex-end' },
  docLabel: { fontSize: 9, color: pdfColors.indigo, letterSpacing: 1.5 },
  docCodigo: { fontSize: 13, fontFamily: 'Helvetica-Bold', color: pdfColors.ink, marginTop: 3 },
  docFecha: { fontSize: 9, color: pdfColors.grayLight, marginTop: 3 },

  label: { fontSize: 8, letterSpacing: 1, color: pdfColors.grayLight, marginBottom: 7 },

  infoBox: { borderWidth: 1, borderColor: pdfColors.border, borderRadius: 3, padding: 14, marginBottom: 20 },
  infoGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  infoItem: { width: '50%', marginBottom: 8 },
  infoKey: { fontSize: 8, color: pdfColors.grayLight, letterSpacing: 0.5, marginBottom: 2 },
  infoVal: { fontSize: 10, fontFamily: 'Helvetica-Bold', color: pdfColors.ink },

  section: { marginBottom: 18, paddingTop: 14, borderTopWidth: 1, borderTopColor: pdfColors.border },
  sectionText: { fontSize: 10, lineHeight: 1.5, color: pdfColors.ink },

  highlightRow: { flexDirection: 'row', gap: 12, marginBottom: 20 },
  highlightBox: { flex: 1, backgroundColor: pdfColors.indigoSoft, borderRadius: 3, padding: 14, alignItems: 'center' },
  highlightLabel: { fontSize: 8, color: pdfColors.indigo, letterSpacing: 1, marginBottom: 5 },
  highlightValue: { fontSize: 20, fontFamily: 'Helvetica-Bold', color: pdfColors.indigo },
  highlightSub: { fontSize: 8, color: pdfColors.gray, marginTop: 4 },

  totalRow: { flexDirection: 'row', justifyContent: 'flex-end', marginBottom: 20 },
  totalBox: { flexDirection: 'row', alignItems: 'baseline', backgroundColor: pdfColors.indigo, paddingVertical: 11, paddingHorizontal: 18 },
  totalLabel: { fontSize: 8, color: pdfColors.indigoPale, letterSpacing: 1, marginRight: 12 },
  totalValue: { fontSize: 16, fontFamily: 'Helvetica-Bold', color: '#ffffff' },

  firmasRow: { flexDirection: 'row', gap: 40, marginTop: 36 },
  firmaCol: { flex: 1, alignItems: 'center' },
  firmaLinea: { borderTopWidth: 1, borderTopColor: pdfColors.black, width: '100%', paddingTop: 8, alignItems: 'center' },
  firmaNombre: { fontSize: 10, fontFamily: 'Helvetica-Bold' },
  firmaRol: { fontSize: 8, color: pdfColors.gray, marginTop: 2, letterSpacing: 0.5 },
  firmaExtra: { fontSize: 8, color: pdfColors.grayLight, marginTop: 2 },

  footer: { position: 'absolute', bottom: 28, left: 40, right: 40, paddingTop: 10, borderTopWidth: 1, borderTopColor: pdfColors.border, fontSize: 8, color: pdfColors.grayLight, textAlign: 'center' },
})

export function DocHeader({ constructoraNombre, sub, docLabel, codigo, fecha }: {
  constructoraNombre: string
  sub?: string | null
  docLabel: string
  codigo: string
  fecha: string
}) {
  return (
    <View style={sharedStyles.header}>
      <View>
        <Text style={sharedStyles.constructoraNombre}>{constructoraNombre}</Text>
        {sub && <Text style={sharedStyles.headerSub}>{sub}</Text>}
      </View>
      <View style={sharedStyles.headerRight}>
        <Text style={sharedStyles.docLabel}>{docLabel}</Text>
        <Text style={sharedStyles.docCodigo}>{codigo}</Text>
        <Text style={sharedStyles.docFecha}>{fecha}</Text>
      </View>
    </View>
  )
}

export function InfoBox({ items }: { items: { key: string; value: string; full?: boolean }[] }) {
  return (
    <View style={sharedStyles.infoBox}>
      <View style={sharedStyles.infoGrid}>
        {items.map((it, i) => (
          <View key={i} style={[sharedStyles.infoItem, it.full ? { width: '100%' } : {}]}>
            <Text style={sharedStyles.infoKey}>{it.key}</Text>
            <Text style={sharedStyles.infoVal}>{it.value}</Text>
          </View>
        ))}
      </View>
    </View>
  )
}

export function FirmaBlock({ nombre, rol, extra }: { nombre: string; rol: string; extra?: string | null }) {
  return (
    <View style={sharedStyles.firmaCol}>
      <View style={sharedStyles.firmaLinea}>
        <Text style={sharedStyles.firmaNombre}>{nombre}</Text>
        <Text style={sharedStyles.firmaRol}>{rol}</Text>
        {extra && <Text style={sharedStyles.firmaExtra}>{extra}</Text>}
      </View>
    </View>
  )
}

export { formatDate }
