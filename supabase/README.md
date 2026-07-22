# Convención de schema y migraciones

No hay un migration runner automático — todo se corre a mano en **Supabase → SQL Editor → New query → Run**, en orden. Eso significa que Supabase no sabe qué migraciones ya corriste; sos vos (o quien lea este repo) quien tiene que llevar la cuenta.

## Los dos tipos de archivo

- **`schema.sql`** — la foto canónica del estado final. Sirve para entender "cómo es la base hoy" sin tener que leer 17 archivos, y para levantar un ambiente nuevo desde cero. **No hace falta correrlo contra el proyecto Supabase existente** — ya llegó a ese estado a través de las migraciones.
- **`migration_NNN.sql`** — un delta ordenado que se corre **una sola vez**, contra el proyecto real, en el SQL Editor.

## Reglas

1. **Una migración ya corrida no se edita ni se renumera.** Si algo quedó mal o incompleto, se corrige en la siguiente migración (`migration_NNN+1.sql`), nunca reescribiendo la anterior. Esto es lo que evitó que pasara de nuevo lo que generó `migration_009/010/011`: tres "fix completo" sucesivos que recreaban las mismas tablas/políticas/triggers porque cada uno intentaba ser la versión definitiva en vez de un delta acotado.
2. **Cada migración hace un cambio con un propósito claro**, no "fix general". Si estás por escribir una migración que vuelve a tocar RLS de 10 tablas porque "por las dudas", probablemente falta identificar qué cambió puntualmente.
3. **Idempotencia siempre**: `IF NOT EXISTS`, `CREATE OR REPLACE`, `DROP ... IF EXISTS` antes de recrear, `ON CONFLICT DO NOTHING` en backfills. Así, si no estás seguro de si algo ya corrió, correrlo de nuevo no rompe nada.
4. **Después de aplicar una migración en Supabase, actualizá `schema.sql`** para que seguir reflejando el estado final (no hace falta que sea en el mismo commit, pero sí antes de que se acumulen varias migraciones sin reflejar).
5. Los archivos `migration_001.sql` … `migration_016.sql` son historial real de lo que se corrió — no se tocan retroactivamente aunque `schema.sql` ya los tenga "aplanados".

## Próxima migración a correr

`migration_022.sql` a `migration_030.sql` — confirmadas corridas en Supabase (verificado en vivo el 2026-07-21: trigger de perfiles, policies de `obras`, `perfil_proyectos`, índice de reservas, `trg_bloquear_cerrado`, triggers/CHECK de `migration_029` y `resumen_unidades_por_obra` de `migration_030` existen en la base real). `migration_031.sql` a `migration_034.sql` son las pendientes de correr a esta fecha; `schema.sql` ya refleja su estado final.

`migration_029.sql` (2026-07-21, auditoría de cuentas/caja): cierra el gap de inmutabilidad financiera que quedó afuera de `migration_015` — `cuotas` Pagadas y `contratos_venta` con cobros ya registrados (entrega efectiva y/o cuotas pagadas) ahora bloquean UPDATE/DELETE para no-admin, igual que ya pasaba con `gastos`/`certificados_avance`/`cobros_proyecto`. Suma CHECK de moneda (`ARS`/`USD`) en `cuentas_propias`/`gastos` (antes solo lo validaba la UI) y un guard contra división por cero en `generar_cuotas_contrato()` si `cantidad_cuotas` llega en 0 por una vía distinta al formulario.

`migration_030.sql` (2026-07-21): agrega `resumen_unidades_por_obra()`, un RPC que agrega en Postgres el conteo de unidades por proyecto (antes se traían todas las filas y se contaba en JS en el home).

`migration_031.sql` (2026-07-21, presupuestos): agrega `presupuestos`/`presupuesto_items` (módulo Empresa, pre-proyecto), `contrato_obra_items`/`certificado_items` (certificación de avance por rubro en vez de un % global tipeado a mano) y el RPC `aceptar_presupuesto()` que convierte un presupuesto aceptado en el contrato de un proyecto nuevo o existente de forma atómica.

`migration_032.sql` (2026-07-22, inventario): agrega `equipos`/`equipo_asignaciones` (módulo Empresa) — mismo patrón de asignación vigente + historial que reservas/contratos (índice único parcial `WHERE fecha_hasta IS NULL`). RPCs `asignar_equipo()`/`liberar_equipo()` para reasignar/devolver/mandar a mantenimiento/dar de baja de forma atómica.

`migration_033.sql` (2026-07-22): agrega `purgar_obra_completa()` — "Eliminar proyecto" era un `DELETE FROM obras` suelto que dependía de que Postgres lo rechazara por foreign key (casi ninguna tabla de proyecto tiene `ON DELETE CASCADE` a propósito) y mostraba un mensaje de error fijo sin relación con la tabla real que bloqueaba. Ahora borra explícitamente cada tabla del proyecto en el orden que exigen las FK, igual que `purgar_constructora_completa` pero a nivel obra — a propósito NO borra `cuentas_propias` (sobrevive como cuenta de empresa vía su FK `ON DELETE SET NULL` existente, en vez de perder un saldo real).

`migration_034.sql` (2026-07-22): `aceptar_presupuesto()` tenía `modo_cuentas` fijo en `'empresa'` al crear un proyecto nuevo — se agregan los parámetros `p_modo_cuentas`/`p_replicar_cuentas` (mismas opciones que ya ofrece `NuevoProyectoModal` para el alta manual de proyecto).
