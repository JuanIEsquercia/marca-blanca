export type EstadoComercial = 'Disponible' | 'Reservado' | 'Vendido'
export type EstadoPago = 'Pendiente' | 'Pagado' | 'Vencido'
export type RolUsuario = 'admin' | 'operador'
export type EstadoReserva = 'Vigente' | 'Convertida' | 'Caída'
export type EstadoLead = 'Nuevo' | 'Contactado' | 'Interesado' | 'Reservado' | 'Vendido' | 'Descartado'

export interface Tipologia {
  id: string
  nombre: string
  m2_propios: number
  m2_comunes: number
  m2_totales: number
  descripcion: string | null
  url_recorrido_360: string | null
  imagen_portada: string | null
  created_at: string
}

export interface Unidad {
  id: string
  piso: number
  numero: string
  letra: string | null
  orientacion: string | null
  m2: number | null
  tipologia_id: string
  precio_lista: number
  entrega_minima_pct: number
  max_cuotas: number
  estado_comercial: EstadoComercial
  created_at: string
  updated_at: string
  tipologias?: Tipologia
}

export interface Amenity {
  id: string
  nombre: string
  descripcion: string | null
  icono: string | null
  orden: number
  activo: boolean
  created_at: string
  amenity_imagenes?: AmenityImagen[]
}

export interface AmenityImagen {
  id: string
  amenity_id: string
  url: string
  alt: string | null
  orden: number
  created_at: string
}

export interface Comprador {
  id: string
  nombre_completo: string
  dni_cuit: string
  email: string | null
  telefono: string | null
  created_at: string
}

export interface ContratoVenta {
  id: string
  unidad_id: string
  comprador_id: string
  precio_final: number
  entrega_efectiva: number
  cantidad_cuotas: number
  fecha_firma: string
  notas: string | null
  cuenta_propia_id: string | null
  created_at: string
  unidades?: Unidad
  compradores?: Comprador
}

export interface Cuota {
  id: string
  contrato_id: string
  numero_cuota: number
  monto_base: number
  monto_cobrado: number | null
  fecha_vencimiento: string
  estado_pago: EstadoPago
  fecha_pago: string | null
  notas_pago: string | null
  cuenta_propia_id: string | null
  created_at: string
  contratos_venta?: ContratoVenta
}

// ── Tesorería ────────────────────────────────────────────────

export interface CuentaPropia {
  id: string
  nombre: string
  tipo: 'banco' | 'caja' | string
  moneda: 'ARS' | 'USD' | string
  saldo_inicial: number
  activa: boolean
  created_at: string
}

export interface Proveedor {
  id: string
  razon_social: string
  cuit: string | null
  email: string | null
  telefono: string | null
  direccion: string | null
  notas: string | null
  activo: boolean
  created_at: string
  cuentas_proveedor?: CuentaProveedor[]
}

export interface CuentaProveedor {
  id: string
  proveedor_id: string
  tipo: string
  denominacion: string | null
  numero: string | null
  moneda: string
  created_at: string
}

export interface CategoriaCosto {
  id: string
  nombre: string
  color: string
  created_at: string
}

export interface Gasto {
  id: string
  proveedor_id: string | null
  cuenta_proveedor_id: string | null
  categoria_id: string | null
  cuenta_propia_id: string | null
  descripcion: string
  monto: number
  moneda: string
  fecha_vencimiento: string
  fecha_pago: string | null
  estado: 'Pendiente' | 'Pagado'
  numero_comprobante: string | null
  comprobante_url: string | null
  notas: string | null
  created_at: string
  proveedores?: Proveedor
  cuentas_proveedor?: CuentaProveedor
  categorias_costo?: CategoriaCosto
  cuentas_propias?: CuentaPropia
}

export interface Perfil {
  id: string
  nombre: string
  rol: RolUsuario
  activo: boolean
  created_at: string
}

// ── Reservas ─────────────────────────────────────────────────

export interface Reserva {
  id: string
  unidad_id: string
  comprador_id: string
  fecha_reserva: string
  fecha_vencimiento: string
  monto_sena: number | null
  cuenta_propia_id: string | null
  notas: string | null
  estado: EstadoReserva
  created_at: string
  unidades?: Unidad
  compradores?: Comprador
  cuentas_propias?: CuentaPropia
}

// ── Leads / CRM ───────────────────────────────────────────────

export interface Lead {
  id: string
  nombre: string
  email: string | null
  telefono: string | null
  tipologia_interes: string | null
  mensaje: string | null
  origen: string
  estado: EstadoLead
  notas_seguimiento: string | null
  created_at: string
}

// Vista pública para landing
export interface StockPublico {
  id: string
  piso: number
  numero: string
  letra: string | null
  orientacion: string | null
  precio_lista: number
  entrega_minima_pct: number
  max_cuotas: number
  estado_comercial: 'Disponible' | 'Reservado'
  tipologia_id: string
  tipologia_nombre: string
  tipologia_descripcion: string | null
  url_recorrido_360: string | null
  m2_propios: number
  m2_comunes: number
  m2_totales: number
  precio_por_m2: number
  monto_entrega_minima: number
}

export interface DashboardStats {
  total: number
  disponibles: number
  reservadas: number
  vendidas: number
  ingresos_contratos: number
  cuotas_pendientes: number
}

export const ORIENTACIONES = [
  'Frente', 'Contrafrente', 'Lateral', 'Interno',
]

export const LEAD_ESTADOS: EstadoLead[] = [
  'Nuevo', 'Contactado', 'Interesado', 'Reservado', 'Vendido', 'Descartado',
]

export const LEAD_ESTADO_COLORS: Record<EstadoLead, string> = {
  Nuevo:       'bg-blue-50 text-blue-700 border-blue-200',
  Contactado:  'bg-indigo-50 text-indigo-700 border-indigo-200',
  Interesado:  'bg-amber-50 text-amber-700 border-amber-200',
  Reservado:   'bg-orange-50 text-orange-700 border-orange-200',
  Vendido:     'bg-emerald-50 text-emerald-700 border-emerald-200',
  Descartado:  'bg-slate-100 text-slate-500 border-slate-200',
}
