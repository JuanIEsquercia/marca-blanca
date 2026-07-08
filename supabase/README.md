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

`migration_020.sql` (después de `migration_016.sql` a `migration_019.sql`, que ya deberían estar aplicadas).
