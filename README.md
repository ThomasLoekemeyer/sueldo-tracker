# Sueldo Tracker

PWA personal para trackear sueldo. Se instala en el iPhone como una app, se desbloquea con Face ID y guarda todo localmente en el celular.

- **Valor hora inicial:** $19.000 (editable desde la app)
- **Protección:** Face ID (WebAuthn)
- **Datos:** sólo en tu iPhone (`localStorage`), no salen a ningún server
- **Hosteo:** GitHub Pages

## Instalar en el iPhone

1. Abrí la URL de GitHub Pages en **Safari** (no Chrome, tiene que ser Safari para que ande Face ID + instalación PWA bien).
2. Tocá el botón de compartir (cuadrado con flecha hacia arriba).
3. "Agregar a pantalla de inicio" → Agregar.
4. Abrí la app desde la pantalla de inicio.
5. Primera vez: tocá "Configurar Face ID" y autorizá con tu cara.
6. Listo. De ahí en más, cada vez que abras la app te pide Face ID.

## Uso

- **Horas**: tocás la pestaña "Horas", ponés la cantidad → calcula `horas × valor_hora` y lo suma al saldo.
- **Ingreso**: pestaña "Ingreso" → suma al saldo (ej: cobro extra).
- **Egreso**: pestaña "Egreso" → resta del saldo.
- **Saldo** = suma de todo lo registrado.
- **Exportar** → baja un CSV con todos los movimientos.
- **Editar valor hora** → footer, tocás "Editar" y cambiás el valor (se aplica a los movimientos nuevos; los viejos quedan con el valor del momento).

## Atajo diario "9 a 18hs"

Configurá un atajo en iOS para que todos los días a las 18hs te pregunte si trabajaste la jornada completa y, con un toque, registre 9 hs automáticamente.

### Pasos

1. Abrí la app **Atajos** (ya viene con iOS).
2. Pestaña **Automatización** → **+** (arriba a la derecha) → **Crear automatización personal**.
3. **Hora del día** → 18:00 → Diariamente → Siguiente.
4. "Ejecutar inmediatamente" activado (así no te pide confirmación cada vez).
5. Agregá acción: **Pedir menú** con el texto "¿Trabajaste hoy 9-18hs?" y opciones:
   - `Sí, 9hs`
   - `Editar horas`
   - `No trabajé`
6. Para cada rama:
   - **Sí, 9hs** → Acción **Abrir URL** → `https://<TU-USUARIO>.github.io/<NOMBRE-REPO>/?action=confirm9to18`
   - **Editar horas** → Acción **Abrir URL** → `https://<TU-USUARIO>.github.io/<NOMBRE-REPO>/?action=editar`
   - **No trabajé** → no hacer nada.
7. Guardá.

La URL real la vas a tener después del deploy, reemplazás el placeholder.

## Estructura

- `index.html` — UI
- `app.js` — lógica, storage, WebAuthn
- `styles.css` — estilos mobile-first
- `manifest.webmanifest` + `sw.js` — PWA (instalable + funciona offline)
- `icon-180.png`, `icon-512.png` — iconos

## Backup

Los datos viven en `localStorage` del iPhone. Si limpiás el historial de Safari o no entrás a la app en 7+ días, iOS puede borrar los datos (ITP). Recomendado: **Exportar CSV** cada tanto.

Si querés que sincronice entre dispositivos más adelante, avisame y lo conectamos a Supabase.
