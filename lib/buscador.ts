import type { SupabaseClient } from '@supabase/supabase-js'
import { SECCIONES_EMPRESA, SECCIONES_PROYECTO } from '@/lib/chat/catalogo-secciones'
import { puedeAcceder, type ProyectoAsignado } from '@/lib/permisos'

// Buscador global del panel (migration_076). Dos fuentes bien distintas:
//
//   - SECCIONES: se resuelven 100% en el navegador contra el catálogo que
//     ya existe en lib/chat/catalogo-secciones.ts (el mismo que usa el
//     chat para navegar, calcado del sidebar). Cero requests, respuesta
//     instantánea mientras se tipea.
//   - DATOS: una sola llamada a la RPC buscar_global, con debounce. La RLS
//     de cada tabla decide qué se ve; acá no hay lógica de permisos.
//
// Mantener esa separación es lo que hace que el buscador sea barato: la
// mayoría de las búsquedas ("gastos", "compras", "caja") se responden sin
// tocar la base.

export type TipoResultado = 'seccion' | 'proyecto' | 'proveedor' | 'cliente' | 'unidad' | 'presupuesto'

export interface ResultadoBusqueda {
  tipo: TipoResultado
  id: string
  titulo: string
  subtitulo: string
  href: string
}

const ETIQUETA_TIPO: Record<TipoResultado, string> = {
  seccion: 'Sección',
  proyecto: 'Proyecto',
  proveedor: 'Proveedor',
  cliente: 'Cliente',
  unidad: 'Unidad',
  presupuesto: 'Presupuesto',
}

export function etiquetaTipo(tipo: TipoResultado): string {
  return ETIQUETA_TIPO[tipo]
}

// Encabezado de cada grupo del panel de resultados.
const ETIQUETA_GRUPO: Record<TipoResultado, string> = {
  seccion: 'Secciones',
  proyecto: 'Proyectos',
  proveedor: 'Proveedores',
  cliente: 'Clientes',
  unidad: 'Unidades',
  presupuesto: 'Presupuestos',
}

// Orden fijo de los grupos. No se confía en el orden que devuelve la RPC:
// un UNION ALL no garantiza el orden de las ramas sin un ORDER BY externo,
// y además las secciones (que se resuelven en el cliente) tienen que ir
// siempre primero — son lo que más se busca y lo que responde al instante.
export const ORDEN_TIPOS: TipoResultado[] = ['seccion', 'proyecto', 'proveedor', 'cliente', 'unidad', 'presupuesto']

export function etiquetaGrupo(tipo: TipoResultado): string {
  return ETIQUETA_GRUPO[tipo]
}

const DIACRITICOS = /[̀-ͯ]/g

function normalizar(texto: string): string {
  // Misma idea que unaccent en la RPC: comparar sin tildes ni mayúsculas,
  // porque acá se escribe "Hormigon" tanto como "Hormigón".
  return texto.normalize('NFD').replace(DIACRITICOS, '').toLowerCase().trim()
}

export interface ContextoBuscador {
  rol: string
  permisosEmpresa: string[]
  proyectos: ProyectoAsignado[]
  // Proyecto en el que está parado el usuario, si está dentro de uno. Las
  // secciones de proyecto solo se ofrecen en ese caso: sin un proyecto no
  // hay a cuál llevarlas, y ofrecerlas para los 15 proyectos accesibles
  // llenaría la lista de ruido.
  proyectoActual: { id: string; nombre: string; tipo: 'desarrollo' | 'obra'; modoCuentas: 'empresa' | 'especificas' } | null
}

// Secciones que matchean, filtradas por los mismos permisos que decide el
// sidebar (puedeAcceder) — el buscador nunca puede ofrecer una pantalla a
// la que el usuario sería rebotado.
export function buscarSecciones(termino: string, ctx: ContextoBuscador): ResultadoBusqueda[] {
  const q = normalizar(termino)
  if (!q) return []
  const resultados: ResultadoBusqueda[] = []

  for (const s of SECCIONES_EMPRESA) {
    if (!normalizar(s.label).includes(q)) continue
    if (s.soloAdmin && ctx.rol !== 'admin') continue
    if (s.modulo && !puedeAcceder(ctx.rol, ctx.permisosEmpresa, ctx.proyectos, s.modulo, null)) continue
    resultados.push({
      tipo: 'seccion',
      id: `empresa:${s.key}`,
      titulo: s.label,
      subtitulo: 'Empresa',
      href: s.ruta,
    })
  }

  const proyecto = ctx.proyectoActual
  if (proyecto) {
    for (const s of SECCIONES_PROYECTO) {
      if (!normalizar(s.label).includes(q)) continue
      if (!s.tipos.includes(proyecto.tipo)) continue
      if (s.soloModoCuentas && proyecto.modoCuentas !== s.soloModoCuentas) continue
      if (s.modulo && !puedeAcceder(ctx.rol, ctx.permisosEmpresa, ctx.proyectos, s.modulo, proyecto.id)) continue
      resultados.push({
        tipo: 'seccion',
        id: `proyecto:${s.key}`,
        titulo: s.label,
        subtitulo: proyecto.nombre,
        href: `/admin/proyectos/${proyecto.id}/${s.segmento}`,
      })
    }
  }

  return resultados
}

interface FilaBusqueda {
  tipo: string
  id: string
  titulo: string
  subtitulo: string
  obra_id: string | null
}

// A dónde lleva cada resultado. Vive acá y no en la RPC porque las rutas
// son de la app: si cambia una URL no hay que tocar la base.
//
// Ninguna de estas entidades tiene hoy pantalla de detalle propia, así que
// el destino es lo más preciso que exista para cada una:
//   - proyecto y unidad: ruta exacta.
//   - proveedor: su módulo con el buscador de esa pantalla ya cargado
//     (?q=), porque ProveedoresManager tiene filtro por texto.
//   - cliente y presupuesto: su módulo, sin ?q=. Esas pantallas no tienen
//     buscador propio todavía; mandar un parámetro que nadie lee sería
//     prometer un filtro que no ocurre.
function hrefDeFila(fila: FilaBusqueda, termino: string): string | null {
  switch (fila.tipo) {
    case 'proyecto':
      return `/admin/proyectos/${fila.id}/dashboard`
    case 'unidad':
      return fila.obra_id ? `/admin/proyectos/${fila.obra_id}/unidades` : null
    case 'proveedor':
      return `/admin/proveedores?q=${encodeURIComponent(termino.trim())}`
    case 'cliente':
      return '/admin/clientes'
    case 'presupuesto':
      return '/admin/presupuestos'
    default:
      return null
  }
}

export async function buscarDatos(
  supabase: SupabaseClient,
  termino: string
): Promise<ResultadoBusqueda[]> {
  const { data, error } = await supabase.rpc('buscar_global', { p_termino: termino })
  if (error) return []

  return ((data ?? []) as FilaBusqueda[])
    .map(f => {
      const href = hrefDeFila(f, termino)
      if (!href) return null
      return {
        tipo: f.tipo as TipoResultado,
        id: `${f.tipo}:${f.id}`,
        titulo: f.titulo,
        subtitulo: f.subtitulo,
        href,
      }
    })
    .filter((r): r is ResultadoBusqueda => r !== null)
}
