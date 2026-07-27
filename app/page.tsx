import { redirect } from 'next/navigation'
import { Fraunces, Public_Sans } from 'next/font/google'
import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import DiamondMark from '@/components/landing/DiamondMark'
import ScrollReveal from '@/components/landing/ScrollReveal'
import styles from './landing.module.css'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Obra — Todo tu negocio de construcción, en un solo lugar',
  description: 'Presupuestos, certificación de avance por ítem, tesorería multi-moneda, inventario y personal — todo tu negocio de construcción en un solo sistema, sin Excel.',
}

// Fuentes propias de la landing (Fraunces + Public Sans) — no se cargan en
// el resto de la app, solo acá. JetBrains Mono ya está disponible global
// (app/layout.tsx + globals.css, var(--font-mono)) así que se reutiliza tal
// cual en app/landing.module.css sin volver a pedirla.
const fraunces = Fraunces({
  subsets: ['latin'],
  weight: 'variable',
  style: ['normal', 'italic'],
  variable: '--font-fraunces',
  display: 'swap',
})
const publicSans = Public_Sans({
  subsets: ['latin'],
  weight: 'variable',
  variable: '--font-public-sans',
  display: 'swap',
})

export default async function RootPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  // Con sesión activa vamos directo al panel — /admin/layout.tsx ya
  // resuelve de ahí si es superadmin. Sin sesión, esta SÍ es la home pública.
  if (user) redirect('/admin')

  return (
    <div className={`${styles.page} ${fraunces.variable} ${publicSans.variable}`}>
      <header className={styles.siteNav}>
        <div className={`${styles.wrap} ${styles.navRow}`}>
          <a className={styles.brand} href="#top" aria-label="Inicio">
            <DiamondMark />
            <span>Obra</span>
          </a>
          <nav className={styles.navLinks}>
            <div className={styles.navLinksInline}>
              <a className={styles.navLink} href="#como-funciona">Cómo funciona</a>
              <a className={styles.navLink} href="#roles">Roles y permisos</a>
              <a className={styles.navLink} href="#excel">Por qué dejar el Excel</a>
            </div>
            <a className={`${styles.btn} ${styles.btnGold} ${styles.navCta}`} href="#cta">Pedir una demo</a>
          </nav>
        </div>
      </header>

      <main id="top">
        {/* ============ HERO ============ */}
        <section className={`${styles.hero} ${styles.onNavy} ${styles.blueprintGrid}`}>
          <div className={`${styles.wrap} ${styles.heroGrid}`}>
            <div>
              <span className={styles.eyebrow}>ERP para constructoras y desarrollos</span>
              <h1>Toda tu obra en un solo lugar.<br />Ni un <em>Excel</em> más.</h1>
              <p className={styles.lede}>
                Presupuestos, certificación de avance, tesorería, gastos, inventario y personal — cada proyecto,
                cada rubro, cada peso, al día. Se terminó perseguir la planilla que alguien no actualizó.
              </p>
              <div className={styles.heroCtas}>
                <a className={`${styles.btn} ${styles.btnGold}`} href="#cta">Pedir una demo</a>
                <a className={`${styles.btn} ${styles.btnGhostDark}`} href="#como-funciona">Ver cómo funciona ↓</a>
              </div>
              <p className={styles.heroNote}>Multi-proyecto · Multi-moneda (ARS / USD) · Roles y permisos por proyecto</p>
            </div>

            <ScrollReveal className="" preClassName={styles.revealPre} activeClassName={styles.revealIn}>
              <div className={`${styles.certCard} ${styles.ticked}`}>
                <div className={styles.certCardHead}>
                  <div>
                    <span className={styles.ccLabel}>Certificado de avance</span>
                    <h3>Estructura — Torre Norte</h3>
                  </div>
                  <span className={styles.ccNum}>N° 014</span>
                </div>

                <div className={styles.ccRow}>
                  <div className={styles.ccRowTop}><span className={styles.ccRubro}>Excavación y fundaciones</span><span className={styles.ccPct}>100%</span></div>
                  <div className={styles.ccBar}><span style={{ width: '100%' }} /></div>
                </div>
                <div className={styles.ccRow}>
                  <div className={styles.ccRowTop}><span className={styles.ccRubro}>Estructura de hormigón</span><span className={styles.ccPct}>72%</span></div>
                  <div className={styles.ccBar}><span style={{ width: '72%' }} /></div>
                </div>
                <div className={styles.ccRow}>
                  <div className={styles.ccRowTop}><span className={styles.ccRubro}>Mampostería</span><span className={styles.ccPct}>18%</span></div>
                  <div className={styles.ccBar}><span style={{ width: '18%' }} /></div>
                </div>

                <div className={styles.ccTotal}>
                  <span className={styles.ccTotalLabel}>Certificado este período</span>
                  <span className={styles.ccTotalAmt}>USD 48.230</span>
                </div>
              </div>
            </ScrollReveal>
          </div>
        </section>

        {/* ============ PROBLEMA ============ */}
        <section className={`${styles.secPad} ${styles.onNavy}`}>
          <ScrollReveal className={styles.wrap} preClassName={styles.revealPre} activeClassName={styles.revealIn}>
            <div className={styles.sectionHead}>
              <span className={styles.eyebrow}>Lo que pasa hoy</span>
              <h2>La obra avanza. El control se atrasa.</h2>
              <p>
                Un Excel por proyecto. El comprobante del gasto perdido entre fotos y papeles sueltos. El avance
                que se le cuenta al cliente a ojo. Cada dato vive en un lugar distinto — y nadie tiene el número
                real hasta cerrar el mes.
              </p>
            </div>
            <div className={styles.painGrid}>
              <div className={styles.painItem}>
                <span className={styles.eyebrow}>Sin versión única</span>
                <p>&quot;final_v2&quot;, &quot;final_v3&quot;, &quot;final_definitivo_ahora_si.xlsx&quot; — y cada uno tiene un número distinto.</p>
              </div>
              <div className={styles.painItem}>
                <span className={styles.eyebrow}>Sin tiempo real</span>
                <p>El gasto de ayer aparece la semana que viene, si aparece. El dato llega tarde para decidir algo con él.</p>
              </div>
              <div className={styles.painItem}>
                <span className={styles.eyebrow}>Sin visibilidad</span>
                <p>Nadie sabe el saldo real de cada cuenta — en pesos o en dólares — hasta que alguien se sienta a sumar todo a mano.</p>
              </div>
            </div>
          </ScrollReveal>
        </section>

        {/* ============ CÓMO FUNCIONA ============ */}
        <section id="como-funciona" className={`${styles.secPad} ${styles.onPaper}`}>
          <ScrollReveal className={styles.wrap} preClassName={styles.revealPre} activeClassName={styles.revealIn}>
            <div className={styles.sectionHead}>
              <span className={styles.eyebrow}>Todo en un solo lugar</span>
              <h2>Un sistema para cada parte del negocio.</h2>
              <p>
                Dos formas de trabajar bajo el mismo techo: desarrollo inmobiliario (unidades, reservas, ventas)
                y obra por contrato (presupuesto, certificación, cobros). Cada proyecto usa lo que le corresponde.
              </p>
            </div>

            <div className={styles.capGrid}>
              <div className={styles.capCard}>
                <span className={styles.capIndex}>Presupuestos</span>
                <h3>De la cotización a la certificación</h3>
                <p>Cotizá por rubro, convertilo en contrato y certificá el avance real ítem por ítem — no un porcentaje global a ojo.</p>
              </div>
              <div className={styles.capCard}>
                <span className={styles.capIndex}>Tesorería</span>
                <h3>Caja al día, en cualquier moneda</h3>
                <p>El saldo real de cada cuenta, en pesos y en dólares, actualizado en el momento — no al cierre del mes.</p>
              </div>
              <div className={styles.capCard}>
                <span className={styles.capIndex}>Proveedores</span>
                <h3>Cuentas por pagar, centralizadas</h3>
                <p>Cada proveedor con su cuenta corriente y su historial de pagos, sin buscar en carpetas sueltas.</p>
              </div>
              <div className={styles.capCard}>
                <span className={styles.capIndex}>Inventario</span>
                <h3>Dónde está cada equipo, y desde cuándo</h3>
                <p>Qué máquina está asignada a qué obra en este momento, y todo su historial de asignaciones anteriores.</p>
              </div>
              <div className={styles.capCard}>
                <span className={styles.capIndex}>Personal</span>
                <h3>Quién está en cada proyecto</h3>
                <p>Cuadrillas y personal asignados a cada obra, sin una planilla de RRHH aparte que nadie actualiza.</p>
              </div>
              <div className={styles.capCard}>
                <span className={styles.capIndex}>Documentos</span>
                <h3>PDF reales, listos para mandar</h3>
                <p>Presupuestos, contratos, certificados y recibos de cobro, con el desglose completo, en un PDF profesional.</p>
              </div>
            </div>

            <div className={styles.flowStrip}>
              <span className={styles.eyebrow}>El flujo de una obra por contrato</span>
              <div className={styles.flowNodes}>
                <div className={styles.flowNode}><span className={styles.fnLabel}>Presupuesto</span><span className={styles.fnSub}>por rubro</span></div>
                <span className={styles.flowArrow}>→</span>
                <div className={styles.flowNode}><span className={styles.fnLabel}>Contrato</span><span className={styles.fnSub}>al aceptarlo</span></div>
                <span className={styles.flowArrow}>→</span>
                <div className={styles.flowNode}><span className={styles.fnLabel}>Certificación</span><span className={styles.fnSub}>ítem por ítem</span></div>
                <span className={styles.flowArrow}>→</span>
                <div className={styles.flowNode}><span className={styles.fnLabel}>Cobro</span><span className={styles.fnSub}>con recibo real</span></div>
              </div>
            </div>
          </ScrollReveal>
        </section>

        {/* ============ ROLES Y PERMISOS ============ */}
        <section id="roles" className={`${styles.secPad} ${styles.onNavy} ${styles.blueprintGrid}`}>
          <ScrollReveal className={styles.wrap} preClassName={styles.revealPre} activeClassName={styles.revealIn}>
            <div className={styles.rolesWrap}>
              <div className={styles.rolesCopy}>
                <div className={styles.sectionHead}>
                  <span className={styles.eyebrow}>Quién ve qué</span>
                  <h2>Cada persona ve exactamente lo que tiene que ver.</h2>
                  <p>
                    Vos controlás todo. A cada persona del equipo le asignás proyectos puntuales — y dentro de
                    cada proyecto, los módulos puntuales que necesita.
                  </p>
                </div>
                <ul className={styles.rolesList}>
                  <li>
                    <span className={styles.rlTitle}>Control total</span>
                    <span className={styles.rlDesc}>Ves y administrás todos los proyectos, usuarios y la tesorería consolidada de la empresa.</span>
                  </li>
                  <li>
                    <span className={styles.rlTitle}>Acceso por proyecto</span>
                    <span className={styles.rlDesc}>Cada operador se asigna a los proyectos concretos en los que trabaja — ni uno más.</span>
                  </li>
                  <li>
                    <span className={styles.rlTitle}>Acceso por módulo</span>
                    <span className={styles.rlDesc}>Dentro de cada proyecto, elegís qué puede ver y cargar: gastos, certificados, ventas, inventario...</span>
                  </li>
                </ul>
              </div>

              <div className={styles.tree}>
                <span className={styles.treeAdmin}>★ Control total</span>
                <div className={styles.treeProjects}>
                  <div className={styles.treeProject}>
                    <span className={styles.tpName}>Torres del Río</span>
                    <span className={styles.tpType}>Desarrollo</span>
                    <div className={styles.tpModules}>
                      <span className={styles.tpMod}>Unidades</span>
                      <span className={styles.tpMod}>Reservas</span>
                      <span className={styles.tpMod}>Ventas</span>
                    </div>
                  </div>
                  <div className={styles.treeProject}>
                    <span className={styles.tpName}>Barrio Norte</span>
                    <span className={styles.tpType}>Obra</span>
                    <div className={styles.tpModules}>
                      <span className={styles.tpMod}>Certificados</span>
                      <span className={styles.tpMod}>Cobros</span>
                      <span className={styles.tpMod}>Gastos</span>
                    </div>
                  </div>
                  <div className={styles.treeProject}>
                    <span className={styles.tpName}>Ampliación Depósito</span>
                    <span className={styles.tpType}>Obra</span>
                    <div className={styles.tpModules}>
                      <span className={styles.tpMod}>Gastos</span>
                      <span className={styles.tpMod}>Inventario</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </ScrollReveal>
        </section>

        {/* ============ POR QUÉ DEJAR EL EXCEL ============ */}
        <section id="excel" className={`${styles.secPad} ${styles.onPaper}`}>
          <ScrollReveal className={styles.wrap} preClassName={styles.revealPre} activeClassName={styles.revealIn}>
            <div className={styles.sectionHead}>
              <span className={styles.eyebrow}>Sin Excel, sin papeles, sin planillas sueltas</span>
              <h2>Lo que cambia el primer día.</h2>
            </div>

            <div className={styles.compare}>
              <div className={styles.compareRow}>
                <div className={`${styles.compareCell} ${styles.compareBefore}`}><span className={styles.compareTag}>Antes</span><p>Un Excel por proyecto, y una versión distinta en cada computadora.</p></div>
                <div className={`${styles.compareCell} ${styles.compareAfter}`}><span className={styles.compareTag}>Ahora</span><p>Un solo sistema, un solo dato — el mismo para todo el equipo.</p></div>
              </div>
              <div className={styles.compareRow}>
                <div className={`${styles.compareCell} ${styles.compareBefore}`}><span className={styles.compareTag}>Antes</span><p>El comprobante de un gasto se pierde entre fotos y papeles sueltos.</p></div>
                <div className={`${styles.compareCell} ${styles.compareAfter}`}><span className={styles.compareTag}>Ahora</span><p>Se carga una sola vez, con el comprobante adjunto, y queda ahí para siempre.</p></div>
              </div>
              <div className={styles.compareRow}>
                <div className={`${styles.compareCell} ${styles.compareBefore}`}><span className={styles.compareTag}>Antes</span><p>El avance de obra se le cuenta al cliente a ojo.</p></div>
                <div className={`${styles.compareCell} ${styles.compareAfter}`}><span className={styles.compareTag}>Ahora</span><p>Certificación real, rubro por rubro, con historial y PDF.</p></div>
              </div>
              <div className={styles.compareRow}>
                <div className={`${styles.compareCell} ${styles.compareBefore}`}><span className={styles.compareTag}>Antes</span><p>El saldo de cada cuenta se sabe recién al cerrar el mes.</p></div>
                <div className={`${styles.compareCell} ${styles.compareAfter}`}><span className={styles.compareTag}>Ahora</span><p>Caja al día, en cualquier moneda, todo el tiempo.</p></div>
              </div>
            </div>
          </ScrollReveal>
        </section>

        {/* ============ CTA FINAL ============ */}
        <section id="cta" className={`${styles.secPad} ${styles.onNavy} ${styles.closing}`}>
          <div className={styles.wrap}>
            <div className={styles.closingInner}>
              <div>
                <h2>Dejá de administrar tu constructora a mano.</h2>
                <p>Te mostramos el sistema funcionando con un caso real en 20 minutos — sin compromiso.</p>
              </div>
              <div className={styles.closingCtas}>
                <a className={`${styles.btn} ${styles.btnGold}`} href="https://wa.me/5493794267780?text=Hola%2C%20quiero%20pedir%20una%20demo%20del%20sistema" target="_blank" rel="noopener noreferrer">Pedir una demo</a>
                <span className={styles.heroNote}>Respondemos en el día</span>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className={styles.siteFooter}>
        <div className={`${styles.wrap} ${styles.footerRow}`}>
          <a className={styles.brand} href="#top">
            <DiamondMark />
            <span>Obra</span>
          </a>
          <span className={styles.footerMeta}>© 2026 — Sistema de gestión para constructoras</span>
        </div>
      </footer>
    </div>
  )
}
