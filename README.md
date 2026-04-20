# Sueldo Tracker

**URL:** https://thomasloekemeyer.github.io/sueldo-tracker/

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

## Notificación diaria vía ntfy.sh

Todos los días a las 20:30 (AR) te llega un push real al iPhone preguntando si trabajaste 9 a 18hs, con botones para confirmar o editar.

### Setup (una vez)

1. Instalá la app **ntfy** desde el App Store (gratis).
2. Abrila, tocá **+** para agregar una suscripción.
3. Desactivá "Use another server" (dejá el default `ntfy.sh`).
4. En "Topic" pegá: `sueldo-thomas-70e02ec5b389`
5. Activá las notificaciones cuando te las pida iOS.
6. Listo. De ahí en más a las 20:30 te llega la notificación como push nativo.

### Cómo funciona

- El workflow `.github/workflows/ntfy-daily.yml` corre todos los días a las 23:30 UTC (= 20:30 AR).
- Manda un POST a `ntfy.sh/<topic>` con el mensaje y dos action buttons.
- Tocás **"Sí, 9hs"** → abre la PWA con `?action=confirm9to18` → se registra la jornada y se actualiza el saldo.
- Tocás **"Editar"** → abre la PWA con `?action=editar` → te pide la cantidad de horas manualmente.

### Cambiar el horario

Editá el `cron` en `.github/workflows/ntfy-daily.yml`:
- `30 23 * * *` = 20:30 AR (UTC-3)
- Si querés 18:00 AR, usá `0 21 * * *`
- Para pruebas rápidas también podés disparar el workflow a mano desde la pestaña **Actions** del repo.


## Estructura

- `index.html` — UI
- `app.js` — lógica, storage, WebAuthn
- `styles.css` — estilos mobile-first
- `manifest.webmanifest` + `sw.js` — PWA (instalable + funciona offline)
- `icon-180.png`, `icon-512.png` — iconos

## Backup

Los datos viven en `localStorage` del iPhone. Si limpiás el historial de Safari o no entrás a la app en 7+ días, iOS puede borrar los datos (ITP). Recomendado: **Exportar CSV** cada tanto.

Si querés que sincronice entre dispositivos más adelante, avisame y lo conectamos a Supabase.
