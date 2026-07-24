export type EstadoComercial = 'Disponible' | 'Reservado' | 'Vendido'
export type EstadoPago = 'Pendiente' | 'Pagado' | 'Vencido'
export type RolUsuario = 'admin' | 'operador'
export type EstadoReserva = 'Vigente' | 'Convertida' | 'Caída'
export type EstadoObra = 'activa' | 'finalizada' | 'pausada'
export type RolMiembro = 'admin' | 'miembro'
export type TipoProyecto = 'desarrollo' | 'obra'
export type ModoCuentas = 'empresa' | 'especificas'
export type EstadoCertificado = 'borrador' | 'presentado' | 'aprobado'
export type EstadoCobro = 'pendiente' | 'cobrado'

// ── Multi-tenant ──────────────────────────────────────────────

export interface Constructora {
  id: string
  nombre: string
  owner_id: string | null
  activa: boolean
  created_at: string
}

export interface Obra {
  id: string
  constructora_id: string
  nombre: string
  direccion: string | null
  tipo: TipoProyecto
  modo_cuentas: ModoCuentas
  estado: EstadoObra
  created_at: string
}

export interface Miembro {
  constructora_id: string
  user_id: string
  rol: RolMiembro
  created_at: string
}

export interface Tipologia {
  id: string
  constructora_id: string
  obra_id: string
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
  constructora_id: string
  obra_id: string
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
  constructora_id: string
  obra_id: string
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
  constructora_id: string
  nombre_completo: string
  dni_cuit: string | null
  email: string | null
  telefono: string | null
  created_at: string
}

export interface ContratoVenta {
  id: string
  constructora_id: string
  obra_id: string
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
  constructora_id: string
  obra_id: string | null
  nombre: string
  tipo: 'banco' | 'caja' | string
  moneda: 'ARS' | 'USD' | string
  saldo_inicial: number
  activa: boolean
  created_at: string
}

export interface Proveedor {
  id: string
  constructora_id: string
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
  constructora_id: string
  nombre: string
  color: string
  created_at: string
}

export interface Gasto {
  id: string
  constructora_id: string
  obra_id: string | null
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
  monto_neto: number | null
  iva: number | null
  percepciones: number | null
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
  permisos: string[] | null
  constructora_id: string | null
  created_at: string
}

export interface PerfilProyecto {
  id: string
  perfil_id: string
  obra_id: string
  constructora_id: string
  permisos: string[]
  created_at: string
}

// ── Reservas ─────────────────────────────────────────────────

export interface Reserva {
  id: string
  constructora_id: string
  obra_id: string
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

// ── Obra de construcción ─────────────────────────────────────

export interface ContratoObra {
  id: string
  obra_id: string
  constructora_id: string
  cliente_id: string
  monto_total: number
  moneda: string
  fecha_inicio: string | null
  fecha_fin_estimada: string | null
  descripcion: string | null
  estado: 'vigente' | 'terminado' | 'rescindido'
  presupuesto_id: string | null
  created_at: string
  compradores?: Comprador
}

export interface CertificadoAvance {
  id: string
  contrato_obra_id: string
  obra_id: string
  constructora_id: string
  numero: number
  periodo: string
  porcentaje_avance: number
  monto_certificado: number
  descripcion_avances: string | null
  estado: EstadoCertificado
  fecha_presentacion: string | null
  fecha_aprobacion: string | null
  notas: string | null
  created_at: string
  cobros_proyecto?: CobroProyecto[]
  certificado_items?: CertificadoItem[]
}

export type EstadoPresupuesto = 'borrador' | 'enviado' | 'aceptado' | 'rechazado'

export interface Presupuesto {
  id: string
  constructora_id: string
  obra_id: string | null
  contrato_obra_id: string | null
  cliente_nombre: string
  cliente_cuit: string | null
  cliente_email: string | null
  cliente_telefono: string | null
  moneda: string
  estado: EstadoPresupuesto
  fecha_inicio: string | null
  fecha_fin_estimada: string | null
  descripcion: string | null
  notas: string | null
  created_at: string
  presupuesto_items?: PresupuestoItem[]
  obras?: { id: string; nombre: string } | null
}

export interface PresupuestoItem {
  id: string
  presupuesto_id: string
  constructora_id: string
  orden: number
  rubro: string
  unidad: string | null
  cantidad: number
  precio_unitario: number
  subtotal: number
  created_at: string
}

export type OrigenItemContrato = 'presupuesto' | 'adicional'

export interface ContratoObraItem {
  id: string
  contrato_obra_id: string
  constructora_id: string
  orden: number
  rubro: string
  unidad: string | null
  cantidad: number
  precio_unitario: number
  monto_contratado: number
  origen: OrigenItemContrato
  notas: string | null
  created_at: string
  certificado_items?: CertificadoItem[]
}

export interface CertificadoItem {
  id: string
  certificado_id: string
  contrato_obra_item_id: string
  constructora_id: string
  pct_avance_acumulado: number
  monto_certificado: number
  created_at: string
  contrato_obra_items?: ContratoObraItem
}

export type EstadoEquipo = 'disponible' | 'asignado' | 'mantenimiento' | 'baja'

export interface Equipo {
  id: string
  constructora_id: string
  nombre: string
  tipo: string | null
  marca: string | null
  modelo: string | null
  nro_serie: string | null
  estado: EstadoEquipo
  notas: string | null
  created_at: string
  equipo_asignaciones?: EquipoAsignacion[]
}

export interface EquipoAsignacion {
  id: string
  equipo_id: string
  obra_id: string
  constructora_id: string
  fecha_desde: string
  fecha_hasta: string | null
  asignado_por: string | null
  notas: string | null
  created_at: string
  obras?: { id: string; nombre: string }
}

export type EstadoPersonal = 'disponible' | 'asignado' | 'licencia' | 'baja'
export type TipoContratacion = 'relacion_dependencia' | 'contratado' | 'subcontratista'

export interface Personal {
  id: string
  constructora_id: string
  nombre: string
  dni: string | null
  cuil: string | null
  telefono: string | null
  tipo_contratacion: TipoContratacion
  categoria: string | null
  jornal: number | null
  art_aseguradora: string | null
  art_vencimiento: string | null
  fecha_ingreso: string | null
  estado: EstadoPersonal
  cuadrilla_id: string | null
  notas: string | null
  created_at: string
  personal_asignaciones?: PersonalAsignacion[]
  cuadrillas?: { id: string; nombre: string } | null
}

export interface Cuadrilla {
  id: string
  constructora_id: string
  nombre: string
  capataz_id: string | null
  notas: string | null
  created_at: string
  personal?: { id: string; nombre: string; estado: EstadoPersonal }[]
  capataz?: { id: string; nombre: string } | null
}

export interface PersonalAsignacion {
  id: string
  personal_id: string
  obra_id: string
  constructora_id: string
  fecha_desde: string
  fecha_hasta: string | null
  asignado_por: string | null
  notas: string | null
  created_at: string
  obras?: { id: string; nombre: string }
}

export interface CobroProyecto {
  id: string
  obra_id: string
  constructora_id: string
  certificado_id: string | null
  /** @deprecated usar fecha_vencimiento + fecha_pago */
  fecha: string
  fecha_vencimiento: string | null
  fecha_pago: string | null
  numero: number | null
  monto: number
  moneda: string
  estado: EstadoCobro
  cuenta_propia_id: string | null
  notas: string | null
  created_at: string
  certificados_avance?: Pick<CertificadoAvance, 'id' | 'numero' | 'periodo'>
  cuentas_propias?: CuentaPropia
}

