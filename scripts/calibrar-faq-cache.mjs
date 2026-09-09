// Calibra el umbral de similitud de la caché semántica del chat
// (UMBRAL_SIMILITUD en lib/chat/faq-cache.ts).
//
//   node scripts/calibrar-faq-cache.mjs
//
// Qué hace: para cada pregunta "base", mide la similitud coseno contra
// parafraseos suyos (DEBERÍAN pegar) y contra preguntas vecinas de otra
// entidad (NO deberían pegar). El umbral correcto es un número que quede
// por debajo del peor parafraseo y por encima del mejor vecino.
//
// Si esos dos rangos se pisan, no hay umbral seguro: en ese caso conviene
// dejarlo alto (menos hits, cero respuestas equivocadas) antes que bajarlo.
// Una respuesta de más cuesta unos centavos; una respuesta equivocada sobre
// cómo cargar un gasto le hace perder tiempo real a un usuario.
//
// No escribe nada en la base — solo llama a la API de embeddings.
import { readFileSync } from 'node:fs'

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8')
    .split('\n').map(l => l.trim())
    .filter(l => l && !l.startsWith('#') && l.includes('='))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')] })
)

if (!env.VOYAGE_API_KEY) {
  console.error('Falta VOYAGE_API_KEY en .env.local')
  process.exit(1)
}

const MODELO = 'voyage-4-lite'

async function embed(texto, tipo) {
  const res = await fetch('https://api.voyageai.com/v1/embeddings', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.VOYAGE_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODELO, input: texto, input_type: tipo }),
  })
  if (!res.ok) {
    console.error('HTTP', res.status, (await res.text()).slice(0, 300))
    process.exit(1)
  }
  const j = await res.json()
  return j.data[0].embedding
}

const cos = (a, b) => {
  const d = a.reduce((s, v, i) => s + v * b[i], 0)
  const na = Math.sqrt(a.reduce((s, v) => s + v * v, 0))
  const nb = Math.sqrt(b.reduce((s, v) => s + v * v, 0))
  return d / (na * nb)
}

// Vecinos = preguntas que suenan casi igual pero se responden distinto.
// Son las que rompen la caché si el umbral queda bajo.
const CASOS = [
  {
    base: '¿Cómo cargo un gasto?',
    parafraseos: [
      'como cargo un gasto',
      '¿Cómo registro un gasto nuevo?',
      '¿Qué necesito para dar de alta un gasto?',
      'quiero anotar una factura, ¿cómo hago?',
    ],
    vecinos: [
      '¿Cómo cargo un cobro?',
      '¿Cómo cargo un proveedor?',
      '¿Cómo elimino un gasto?',
      '¿Cuánto gasté este mes?',
    ],
  },
  {
    base: '¿Cómo funciona el módulo de Compras?',
    parafraseos: [
      'explicame cómo funciona Compras',
      '¿Qué se puede hacer en Compras?',
      '¿cómo es el circuito de compras?',
    ],
    vecinos: [
      '¿Cómo funciona el módulo de Presupuestos?',
      '¿Cómo funciona el módulo de Gastos?',
      '¿Qué órdenes de compra tengo abiertas?',
    ],
  },
  {
    base: '¿Qué diferencia hay entre una orden de compra y un acopio?',
    parafraseos: [
      'cuándo uso acopio y cuándo orden de compra',
      '¿acopio u orden de compra?',
    ],
    vecinos: [
      '¿Qué diferencia hay entre una reserva y una venta?',
      '¿Qué diferencia hay entre rubro y categoría?',
    ],
  },
]

console.log(`modelo: ${MODELO}`)
let dimension = null
let peorParafraseo = 1
let mejorVecino = 0

for (const caso of CASOS) {
  const base = await embed(caso.base, 'document')
  if (dimension === null) {
    dimension = base.length
    console.log(`dimensión: ${dimension}\n`)
  }
  console.log(`BASE: ${caso.base}`)

  for (const p of caso.parafraseos) {
    const s = cos(base, await embed(p, 'query'))
    peorParafraseo = Math.min(peorParafraseo, s)
    console.log(`  parafraseo  ${s.toFixed(4)}  ${p}`)
  }
  for (const v of caso.vecinos) {
    const s = cos(base, await embed(v, 'query'))
    mejorVecino = Math.max(mejorVecino, s)
    console.log(`  VECINO      ${s.toFixed(4)}  ${v}`)
  }
  console.log('')
}

console.log('----------------------------------------')
console.log(`peor parafraseo (el mínimo que hay que capturar): ${peorParafraseo.toFixed(4)}`)
console.log(`mejor vecino    (el máximo que hay que rechazar): ${mejorVecino.toFixed(4)}`)
if (peorParafraseo > mejorVecino) {
  const sugerido = (mejorVecino + (peorParafraseo - mejorVecino) / 2)
  console.log(`\nHay margen. Umbral sugerido: ${sugerido.toFixed(2)}`)
  console.log('(punto medio entre ambos; subilo si preferís menos hits y cero errores)')
} else {
  console.log('\nNO hay margen: algún vecino puntúa más alto que algún parafraseo.')
  console.log('Dejá el umbral alto (0.95+) y aceptá menos aciertos.')
}
