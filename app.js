// ==== Config ====
const APP_VERSION = "1.3";
const SB_URL = "https://ljwlanwmnuqgxftlirhh.supabase.co";
const SB_KEY = "sb_publishable_niVre5BYps9QZVh4qq0UtQ_mMmCrIV0";

// ==== Storage local (cache + config) ====
const KEY_CACHE = "sueldo.cache";
const KEY_CRED = "sueldo.credId";
const KEY_VALOR = "sueldo.valorHora";
const KEY_CHECK = "sueldo.checkTime";

const getCache = () => JSON.parse(localStorage.getItem(KEY_CACHE) || "[]");
const setCache = (m) => localStorage.setItem(KEY_CACHE, JSON.stringify(m));
// Cache de valor_hora desde Supabase. Fallback a localStorage si no hay red.
let valoresHoraCache = JSON.parse(localStorage.getItem("sueldo.valoresCache") || "[]"); // [{mes, valor}]

function mesKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

function getValorHoraForDate(date) {
  const key = mesKey(date);
  const exact = valoresHoraCache.find(v => v.mes === key);
  if (exact) return Number(exact.valor);
  // Fallback: valor más reciente anterior o igual
  const sorted = [...valoresHoraCache].sort((a, b) => b.mes.localeCompare(a.mes));
  const prev = sorted.find(v => v.mes <= key);
  if (prev) return Number(prev.valor);
  return Number(localStorage.getItem(KEY_VALOR) || 19000);
}

const getValorHora = () => getValorHoraForDate(new Date());
const setValorHora = (v) => localStorage.setItem(KEY_VALOR, String(v));
const getCheckTime = () => localStorage.getItem(KEY_CHECK) || "18:00";
const setCheckTime = (t) => localStorage.setItem(KEY_CHECK, t);

// ==== Format ====
const fmt = (n) => "$" + Math.round(n).toLocaleString("es-AR");
const hoyISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const hoyLabel = () => new Date().toLocaleDateString("es-AR", { day: "2-digit", month: "short" });
const fmtDiaMes = (d) => d.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit" });
const isWeekday = (d) => { const x = d.getDay(); return x >= 1 && x <= 5; };

// ==== Supabase REST ====
const sbHeaders = {
  apikey: SB_KEY,
  Authorization: `Bearer ${SB_KEY}`,
  "Content-Type": "application/json",
};

function sbRowToMov(r) {
  return {
    id: r.id,
    fecha: r.fecha,
    tipo: r.tipo,
    horas: r.horas != null ? Number(r.horas) : null,
    monto: Number(r.monto),
    desc: r.descripcion,
  };
}

async function sbFetchAll() {
  const res = await fetch(`${SB_URL}/rest/v1/movimientos?select=*&order=fecha.desc`, { headers: sbHeaders });
  if (!res.ok) throw new Error(`fetch ${res.status}`);
  const rows = await res.json();
  return rows.map(sbRowToMov);
}

async function sbInsert(mov) {
  const body = {
    fecha: mov.fecha,
    tipo: mov.tipo,
    horas: mov.horas,
    monto: mov.monto,
    descripcion: mov.desc,
  };
  const res = await fetch(`${SB_URL}/rest/v1/movimientos`, {
    method: "POST",
    headers: { ...sbHeaders, Prefer: "return=representation" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`insert ${res.status}: ${await res.text()}`);
  const [created] = await res.json();
  return sbRowToMov(created);
}

async function sbFetchValoresHora() {
  try {
    const res = await fetch(`${SB_URL}/rest/v1/valor_hora?select=*&order=mes.desc`, { headers: sbHeaders });
    if (!res.ok) throw new Error(res.status);
    const rows = await res.json();
    valoresHoraCache = rows.map(r => ({ mes: r.mes, valor: Number(r.valor) }));
    localStorage.setItem("sueldo.valoresCache", JSON.stringify(valoresHoraCache));
    return valoresHoraCache;
  } catch (e) {
    console.warn("fetch valor_hora:", e);
    return valoresHoraCache;
  }
}

async function sbRecalcHorasMes(mes, valor) {
  const res = await fetch(`${SB_URL}/rest/v1/rpc/recalc_horas_mes`, {
    method: "POST",
    headers: { ...sbHeaders },
    body: JSON.stringify({ p_mes: mes, p_valor: valor }),
  });
  if (!res.ok) throw new Error(`rpc ${res.status}: ${await res.text()}`);
  return res.json();
}

async function sbDelete(id) {
  const res = await fetch(`${SB_URL}/rest/v1/movimientos?id=eq.${id}`, {
    method: "DELETE",
    headers: sbHeaders,
  });
  if (!res.ok) throw new Error(`delete ${res.status}`);
}

async function sbLastHorasFecha() {
  const res = await fetch(
    `${SB_URL}/rest/v1/movimientos?select=fecha&tipo=eq.horas&order=fecha.desc&limit=1`,
    { headers: sbHeaders }
  );
  if (!res.ok) return null;
  const rows = await res.json();
  return rows[0]?.fecha || null;
}

// Días hábiles pendientes de registrar (desde día siguiente al último horas hasta hoy inclusive)
async function pendingWeekdays() {
  const last = await sbLastHorasFecha();
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  let start;
  if (last) {
    start = new Date(last);
    start.setDate(start.getDate() + 1);
    start.setHours(0, 0, 0, 0);
  } else {
    start = new Date(today);
  }

  const pending = [];
  const cur = new Date(start);
  while (cur <= today) {
    if (isWeekday(cur)) pending.push(new Date(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return pending;
}

// ==== WebAuthn ====
const b64urlEncode = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)))
  .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const b64urlDecode = (str) => {
  str = str.replace(/-/g, "+").replace(/_/g, "/");
  while (str.length % 4) str += "=";
  return Uint8Array.from(atob(str), c => c.charCodeAt(0));
};

async function registerFaceId() {
  const challenge = crypto.getRandomValues(new Uint8Array(32));
  const userId = crypto.getRandomValues(new Uint8Array(16));
  const cred = await navigator.credentials.create({
    publicKey: {
      challenge,
      rp: { name: "Sueldo", id: location.hostname },
      user: { id: userId, name: "thomas", displayName: "Thomas" },
      pubKeyCredParams: [{ alg: -7, type: "public-key" }, { alg: -257, type: "public-key" }],
      authenticatorSelection: { authenticatorAttachment: "platform", userVerification: "required", residentKey: "preferred" },
      timeout: 60000,
      attestation: "none",
    },
  });
  if (!cred) throw new Error("No se pudo registrar");
  localStorage.setItem(KEY_CRED, b64urlEncode(cred.rawId));
}

async function authFaceId() {
  const credIdStr = localStorage.getItem(KEY_CRED);
  if (!credIdStr) throw new Error("NO_CRED");
  const challenge = crypto.getRandomValues(new Uint8Array(32));
  const assertion = await navigator.credentials.get({
    publicKey: {
      challenge,
      allowCredentials: [{ id: b64urlDecode(credIdStr), type: "public-key" }],
      userVerification: "required",
      timeout: 60000,
    },
  });
  if (!assertion) throw new Error("Auth falló");
}

// ==== UI refs ====
const $ = (id) => document.getElementById(id);
const lockScreen = $("lock-screen");
const appScreen = $("app");
const quickScreen = $("quick-action");

// ==== Quick actions (URLs ?action=) ====
async function showQuick(icon, title, msg, allowClose = true) {
  quickScreen.classList.remove("hidden");
  lockScreen.classList.add("hidden");
  appScreen.classList.add("hidden");
  $("qa-icon").textContent = icon;
  $("qa-title").textContent = title;
  $("qa-msg").textContent = msg;
  $("qa-close").classList.toggle("hidden", !allowClose);
}

async function confirmarPendientesBatch() {
  const pending = await pendingWeekdays();
  if (pending.length === 0) return { count: 0 };
  const valor = getValorHora();
  const created = [];
  for (const d of pending) {
    const iso = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 18, 0, 0).toISOString();
    const label = d.toLocaleDateString("es-AR", { day: "2-digit", month: "short" });
    const row = await sbInsert({
      fecha: iso,
      tipo: "horas",
      horas: 9,
      monto: 9 * valor,
      desc: `Jornada ${label} (9-18hs)`,
    });
    created.push(row);
  }
  return { count: pending.length, total: pending.length * 9 * valor, valor };
}

async function quickConfirmar() {
  await showQuick("⏳", "Registrando jornadas...", "");
  try {
    const { count, total, valor } = await confirmarPendientesBatch();
    if (count === 0) {
      await showQuick("✓", "Nada que registrar", "No había jornadas pendientes.");
    } else if (count === 1) {
      await showQuick("✓", "Jornada registrada", `9hs × ${fmt(valor)} = ${fmt(total)}`);
    } else {
      await showQuick("✓", "Registrado", `${count} jornadas × 9hs = ${fmt(total)}`);
    }
    setTimeout(() => window.close(), 4000);
  } catch (e) {
    await showQuick("⚠️", "Error", `No se pudo registrar: ${e.message}`);
  }
}

async function quickSueldo() {
  await showQuick("⏳", "Registrando sueldo...", "");
  try {
    const monto = 2750000;
    const mes = new Date().toLocaleDateString("es-AR", { month: "long", year: "numeric" });
    await sbInsert({
      fecha: new Date().toISOString(),
      tipo: "ingreso",
      horas: null,
      monto,
      desc: `Sueldo ${mes} (incluye +$1M)`,
    });
    await showQuick("✓", "Sueldo registrado", `${fmt(monto)} sumado al saldo.`);
    setTimeout(() => window.close(), 4000);
  } catch (e) {
    await showQuick("⚠️", "Error", e.message);
  }
}

async function quickComision() {
  const txt = prompt("Monto total de comisiones este mes:", "");
  if (!txt) { await showQuick("✓", "Cancelado", ""); setTimeout(() => window.close(), 4000); return; }
  const n = Number(txt);
  if (!n || n <= 0) { await showQuick("⚠️", "Inválido", "Monto inválido"); return; }
  await showQuick("⏳", "Registrando comisión...", "");
  try {
    const mes = new Date().toLocaleDateString("es-AR", { month: "long", year: "numeric" });
    await sbInsert({
      fecha: new Date().toISOString(),
      tipo: "ingreso",
      horas: null,
      monto: n,
      desc: `Comisiones ${mes}`,
    });
    await showQuick("✓", "Comisión registrada", `${fmt(n)} sumado al saldo.`);
    setTimeout(() => window.close(), 4000);
  } catch (e) {
    await showQuick("⚠️", "Error", e.message);
  }
}

async function quickEditar() {
  const txt = prompt("¿Cuántas horas trabajaste hoy?", "9");
  if (!txt) { await showQuick("✓", "Cancelado", "No se registró nada."); return; }
  const h = Number(txt);
  if (!h || h <= 0) { await showQuick("⚠️", "Valor inválido", "Probá de nuevo."); return; }
  const desc = prompt("Descripción (opcional):", `Jornada ${hoyLabel()}`) || `Jornada ${hoyLabel()}`;
  await showQuick("⏳", "Registrando...", "");
  try {
    const valor = getValorHora();
    await sbInsert({
      fecha: new Date().toISOString(),
      tipo: "horas",
      horas: h,
      monto: h * valor,
      desc,
    });
    await showQuick("✓", "Jornada registrada", `${h}hs × ${fmt(valor)} = ${fmt(h * valor)}`);
    setTimeout(() => window.close(), 4000);
  } catch (e) {
    await showQuick("⚠️", "Error", `No se pudo registrar: ${e.message}`);
  }
}

$("qa-close").addEventListener("click", () => window.close());

// ==== Lock flow ====
const btnUnlock = $("btn-unlock");
const btnSetup = $("btn-setup");
const lockMsg = $("lock-msg");
const lockError = $("lock-error");

async function showApp() {
  lockScreen.classList.add("hidden");
  appScreen.classList.remove("hidden");
  quickScreen.classList.add("hidden");
  $("valor-hora-screen").classList.add("hidden");
  await Promise.all([syncFromSupabase(), sbFetchValoresHora()]);
  render();
  checkConfirmBanner();
  startBannerPolling();
}

function showLock(message) {
  appScreen.classList.add("hidden");
  lockScreen.classList.remove("hidden");
  quickScreen.classList.add("hidden");
  stopBannerPolling();
  const hasCred = !!localStorage.getItem(KEY_CRED);
  btnUnlock.classList.toggle("hidden", !hasCred);
  btnSetup.classList.toggle("hidden", hasCred);
  lockMsg.textContent = hasCred ? "Desbloqueá con Face ID" : "Configurá Face ID para proteger la app";
  lockError.textContent = message || "";
}

btnUnlock.addEventListener("click", async () => {
  lockError.textContent = "";
  try { await authFaceId(); await showApp(); }
  catch { lockError.textContent = "No se pudo verificar. Probá de nuevo."; }
});

btnSetup.addEventListener("click", async () => {
  lockError.textContent = "";
  try { await registerFaceId(); await authFaceId(); await showApp(); }
  catch (e) { lockError.textContent = "No se pudo configurar: " + (e.message || e); }
});

const btnLockEl = $("btn-lock");
if (btnLockEl) btnLockEl.addEventListener("click", () => showLock());

// ==== Sync ====
async function syncFromSupabase() {
  try {
    const rows = await sbFetchAll();
    setCache(rows);
    render();
  } catch (e) {
    console.warn("Sync falló, usando cache:", e);
    render();
  }
}

// ==== Add form (ingreso / egreso / compra inversión) ====
let tipoActivo = "ingreso";
const tabs = document.querySelectorAll(".tab");
const inputValor = $("input-valor");
const inputDesc = $("input-desc");
const inputTicker = $("input-ticker");
const inputCantidad = $("input-cantidad");
const inputPrecio = $("input-precio");
const inputFecha = $("input-fecha");
const fieldsDefault = document.querySelector(".fields-default");
const fieldsCompra = document.querySelector(".fields-compra");

function setTipo(t) {
  tipoActivo = t;
  tabs.forEach(tab => tab.classList.toggle("active", tab.dataset.tipo === t));
  const isCompra = t === "compra";
  if (fieldsDefault) fieldsDefault.classList.toggle("hidden", isCompra);
  if (fieldsCompra) fieldsCompra.classList.toggle("hidden", !isCompra);
  if (isCompra && inputFecha && !inputFecha.value) inputFecha.value = hoyISO();
}
tabs.forEach(tab => tab.addEventListener("click", () => setTipo(tab.dataset.tipo)));

function updateCompraPreview() {
  const cant = Number(inputCantidad.value);
  const precio = Number(inputPrecio.value);
  const preview = $("preview-total");
  if (cant && precio) {
    preview.textContent = `Total ${fmt(cant * precio)} (sale del saldo)`;
  } else {
    preview.textContent = "";
  }
}
if (inputCantidad) inputCantidad.addEventListener("input", updateCompraPreview);
if (inputPrecio) inputPrecio.addEventListener("input", updateCompraPreview);

$("form-add").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = e.target.querySelector("button[type=submit]");
  btn.disabled = true;
  try {
    if (tipoActivo === "compra") {
      await handleCompraSubmit();
    } else {
      const monto = Number(inputValor.value);
      if (!monto || monto <= 0) return;
      const desc = inputDesc.value.trim() || tipoActivo;
      const created = await sbInsert({
        fecha: new Date().toISOString(),
        tipo: tipoActivo,
        horas: null,
        monto,
        desc,
      });
      const cache = getCache();
      cache.unshift(created);
      setCache(cache);
      render();
      inputValor.value = "";
      inputDesc.value = "";
    }
  } catch (err) {
    alert("No se pudo guardar: " + err.message);
  } finally {
    btn.disabled = false;
  }
});

async function handleCompraSubmit() {
  const ticker = inputTicker.value.trim().toUpperCase();
  const cantidad = Number(inputCantidad.value);
  const precio = Number(inputPrecio.value);
  const fechaStr = inputFecha.value || hoyISO();
  if (!ticker) { alert("Falta el ticker"); return; }
  if (!cantidad || cantidad <= 0) { alert("Cantidad inválida"); return; }
  if (!precio || precio <= 0) { alert("Precio inválido"); return; }

  const total = cantidad * precio;
  if (!confirm(`Comprar ${cantidad} ${ticker} a ${fmt(precio)}/u = ${fmt(total)} (se descuenta del saldo). ¿Confirmar?`)) return;

  const tipo_activo = ticker === "USD" ? "usd" : "cedear";
  const fechaIso = `${fechaStr} 12:00:00-03:00`;

  await sbInsertInversion({
    ticker,
    tipo_activo,
    cantidad,
    precio_ars: precio,
    precio_usd: null,
    fecha: fechaIso,
    notas: "compra desde app",
  });

  const egreso = await sbInsert({
    fecha: new Date().toISOString(),
    tipo: "egreso",
    horas: null,
    monto: total,
    desc: `Compra ${cantidad} ${ticker}`,
  });
  const cache = getCache();
  cache.unshift(egreso);
  setCache(cache);
  render();

  inputTicker.value = "";
  inputCantidad.value = "";
  inputPrecio.value = "";
  inputFecha.value = hoyISO();
  $("preview-total").textContent = "";
}

async function agregarHoras(horas, desc) {
  try {
    const created = await sbInsert({
      fecha: new Date().toISOString(),
      tipo: "horas",
      horas,
      monto: horas * getValorHora(),
      desc,
    });
    const cache = getCache();
    cache.unshift(created);
    setCache(cache);
    render();
  } catch (e) {
    alert("No se pudo guardar: " + e.message);
  }
}

// ==== Render ====
function calcSaldo(movs) {
  return movs.reduce((s, m) => s + (m.tipo === "egreso" ? -m.monto : m.monto), 0);
}

function render() {
  const movs = getCache();
  const saldo = calcSaldo(movs);
  const saldoEl = $("saldo");
  saldoEl.textContent = fmt(saldo);
  saldoEl.classList.toggle("negativo", saldo < 0);

  $("valor-hora-label").textContent = fmt(getValorHora());
  $("check-time-label").textContent = getCheckTime();

  const ul = $("lista");
  ul.innerHTML = "";
  if (!movs.length) {
    ul.innerHTML = '<li style="justify-content:center;color:var(--muted)">Sin movimientos todavía</li>';
    return;
  }
  for (const m of movs) {
    const li = document.createElement("li");
    const signo = m.tipo === "egreso" ? "-" : "+";
    const cls = m.tipo === "egreso" ? "neg" : "pos";
    const fecha = new Date(m.fecha).toLocaleDateString("es-AR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
    const extra = m.tipo === "horas" ? ` · ${m.horas}hs` : "";
    li.innerHTML = `
      <div class="mov-info">
        <div class="mov-desc">${escapeHtml(m.desc)}</div>
        <div class="mov-meta">${fecha} · ${m.tipo}${extra}</div>
      </div>
      <div class="mov-monto ${cls}">${signo}${fmt(m.monto)}</div>
      <button class="mov-delete" data-id="${m.id}" aria-label="Borrar">✕</button>
    `;
    ul.appendChild(li);
  }
  ul.querySelectorAll(".mov-delete").forEach(b => {
    b.addEventListener("click", async () => {
      if (!confirm("¿Borrar este movimiento?")) return;
      const id = Number(b.dataset.id);
      try {
        await sbDelete(id);
        setCache(getCache().filter(m => m.id !== id));
        render();
      } catch (e) {
        alert("No se pudo borrar: " + e.message);
      }
    });
  });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// ==== Banner control diario ====
function pasoHoraControl() {
  const [hh, mm] = getCheckTime().split(":").map(Number);
  const now = new Date();
  const threshold = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hh, mm, 0);
  return now >= threshold;
}

async function checkConfirmBanner() {
  const banner = $("banner-confirm");
  const text = $("banner-text");
  const now = new Date();

  // Banner solo aparece en días hábiles después de la hora de control
  if (!isWeekday(now) || !pasoHoraControl()) {
    banner.classList.add("hidden");
    return;
  }

  const pending = await pendingWeekdays();
  if (pending.length === 0) {
    banner.classList.add("hidden");
    return;
  }

  if (pending.length === 1) {
    text.textContent = "¿Trabajaste hoy 9 a 18hs?";
  } else {
    const dates = pending.map(fmtDiaMes).join(", ");
    text.textContent = `${pending.length} jornadas pendientes: ${dates}`;
  }
  banner.classList.remove("hidden");
}

let bannerInterval = null;
function startBannerPolling() {
  stopBannerPolling();
  bannerInterval = setInterval(checkConfirmBanner, 30000);
}
function stopBannerPolling() {
  if (bannerInterval) { clearInterval(bannerInterval); bannerInterval = null; }
}
document.addEventListener("visibilitychange", async () => {
  if (!document.hidden && !appScreen.classList.contains("hidden")) {
    await syncFromSupabase();
    checkConfirmBanner();
  }
});

function promptHorasCustom() {
  const txt = prompt("¿Cuántas horas trabajaste hoy?", "9");
  if (!txt) return;
  const h = Number(txt);
  if (!h || h <= 0) { alert("Valor inválido"); return; }
  const desc = prompt("Descripción (opcional):", `Jornada ${hoyLabel()}`) || `Jornada ${hoyLabel()}`;
  agregarHoras(h, desc);
  $("banner-confirm").classList.add("hidden");
}

$("btn-confirm-si").addEventListener("click", async () => {
  $("btn-confirm-si").disabled = true;
  try {
    const { count } = await confirmarPendientesBatch();
    if (count > 0) {
      await syncFromSupabase();
      $("banner-confirm").classList.add("hidden");
    } else {
      alert("No hay jornadas pendientes");
    }
  } catch (e) {
    alert("Error: " + e.message);
  } finally {
    $("btn-confirm-si").disabled = false;
  }
});
$("btn-confirm-editar").addEventListener("click", promptHorasCustom);

// ==== Config ====
$("btn-config").addEventListener("click", () => {
  const nuevaHora = prompt("Horario del control diario (HH:MM):", getCheckTime());
  if (nuevaHora !== null && /^\d{1,2}:\d{2}$/.test(nuevaHora.trim())) {
    const [h, m] = nuevaHora.trim().split(":").map(Number);
    if (h >= 0 && h < 24 && m >= 0 && m < 60) {
      setCheckTime(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
    }
  }
  render();
  checkConfirmBanner();
});

// ==== Export ====
$("btn-export").addEventListener("click", () => {
  const movs = getCache();
  const rows = [["fecha", "tipo", "horas", "monto", "descripcion"]];
  for (const m of movs) rows.push([m.fecha, m.tipo, m.horas || "", m.monto, m.desc]);
  const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `sueldo-${hoyISO()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
});

// ==== Inversiones ====
const invScreen = $("inversiones-screen");
let inversionesCache = [];
let preciosActualesCache = {}; // {ticker: {precio_ars, precio_usd}}

// Ratio CEDEAR:subyacente (ej SPY: 20 CEDEARs = 1 SPY real)
// precio_usd almacenado y de Yahoo es del subyacente, hay que dividir para convertir a unidades del usuario.
const RATIOS = {
  SPY: 20, BRKB: 22, XLF: 2, XLE: 2, GGAL: 10,
  CEPU: 10, PAMPX: 25, YPF: 1, AAPL: 10, KO: 10, AMZN: 20, MSFT: 20,
};
const ratioDe = (t) => RATIOS[t] || 1;

async function sbFetchInversiones() {
  try {
    const res = await fetch(`${SB_URL}/rest/v1/inversiones?select=*&order=fecha.desc`, { headers: sbHeaders });
    if (!res.ok) throw new Error(res.status);
    inversionesCache = await res.json();
    return inversionesCache;
  } catch (e) {
    console.warn("fetch inversiones:", e);
    return [];
  }
}

async function sbFetchPreciosActuales() {
  try {
    const res = await fetch(`${SB_URL}/rest/v1/precios_actuales?select=*`, { headers: sbHeaders });
    if (!res.ok) throw new Error(res.status);
    const rows = await res.json();
    preciosActualesCache = {};
    for (const r of rows) preciosActualesCache[r.ticker] = r;
    return preciosActualesCache;
  } catch (e) {
    console.warn("fetch precios:", e);
    return {};
  }
}

async function sbInsertInversion(inv) {
  const res = await fetch(`${SB_URL}/rest/v1/inversiones`, {
    method: "POST",
    headers: { ...sbHeaders, Prefer: "return=representation" },
    body: JSON.stringify(inv),
  });
  if (!res.ok) throw new Error(`insert ${res.status}: ${await res.text()}`);
  const [row] = await res.json();
  return row;
}

async function sbDeleteInversion(id) {
  const res = await fetch(`${SB_URL}/rest/v1/inversiones?id=eq.${id}`, {
    method: "DELETE",
    headers: sbHeaders,
  });
  if (!res.ok) throw new Error(`delete ${res.status}`);
}

function aggregatePositions(rows) {
  const map = new Map();
  for (const r of rows) {
    const ticker = r.ticker;
    const cant = Number(r.cantidad);
    const pArs = r.precio_ars != null ? Number(r.precio_ars) : null;
    const pUsd = r.precio_usd != null ? Number(r.precio_usd) : null;
    if (!map.has(ticker)) {
      map.set(ticker, { ticker, tipo_activo: r.tipo_activo, cantidad: 0, costoArs: 0, costoUsd: 0, cantConPrecio: 0 });
    }
    const p = map.get(ticker);
    p.cantidad += cant;
    // Costo solo para compras (cantidad > 0) con precio
    if (cant > 0 && pArs !== null) p.costoArs += cant * pArs;
    if (cant > 0 && pUsd !== null) p.costoUsd += cant * pUsd;
    if (cant > 0 && (pArs !== null || pUsd !== null)) p.cantConPrecio += cant;
  }
  return [...map.values()].map(p => ({
    ...p,
    promArs: p.cantConPrecio > 0 ? p.costoArs / p.cantConPrecio : null,
    promUsd: p.cantConPrecio > 0 ? p.costoUsd / p.cantConPrecio : null,
  }));
}

async function openInversiones() {
  appScreen.classList.add("hidden");
  invScreen.classList.remove("hidden");
  invScreen.scrollTop = 0;
  await Promise.all([sbFetchInversiones(), sbFetchPreciosActuales()]);
  renderInversiones();
}

function closeInversiones() {
  invScreen.classList.add("hidden");
  appScreen.classList.remove("hidden");
}

function renderInversiones() {
  const positions = aggregatePositions(inversionesCache).filter(p => Math.abs(p.cantidad) > 0.0001);
  let totalUsd = 0;

  // Render positions
  const ul = $("inv-positions");
  ul.innerHTML = "";
  if (!positions.length) {
    ul.innerHTML = '<li style="justify-content:center;color:var(--muted)">Sin posiciones</li>';
  } else {
    // Orden: CEDEARs primero, USD al final
    positions.sort((a, b) => (a.tipo_activo === "usd") - (b.tipo_activo === "usd") || a.ticker.localeCompare(b.ticker));
    for (const p of positions) {
      const curr = preciosActualesCache[p.ticker];
      const currUsd = curr?.precio_usd ? Number(curr.precio_usd) : null;
      const currArs = curr?.precio_ars ? Number(curr.precio_ars) : null;

      // Valor actual estimado en USD (aplicando ratio CEDEAR → subyacente)
      const ratio = ratioDe(p.ticker);
      let valorUsd = null;
      if (p.tipo_activo === "usd") {
        valorUsd = p.cantidad; // 1 USD = 1 USD
      } else if (currUsd !== null) {
        valorUsd = (p.cantidad / ratio) * currUsd;
      } else if (p.promUsd !== null) {
        valorUsd = (p.cantidad / ratio) * p.promUsd; // fallback: a costo
      }
      if (valorUsd !== null) totalUsd += valorUsd;

      // P/L %
      let pl = null;
      if (p.tipo_activo === "cedear" && currUsd !== null && p.promUsd !== null && p.promUsd > 0) {
        pl = ((currUsd - p.promUsd) / p.promUsd) * 100;
      }

      const li = document.createElement("li");
      const tickerLabel = p.tipo_activo === "usd" ? "USD cash" : p.ticker;
      const ratioLabel = p.tipo_activo === "cedear" && ratio > 1 ? ` (${ratio}:1)` : "";
      const cantLabel = p.tipo_activo === "usd"
        ? `${Math.round(p.cantidad).toLocaleString("es-AR")} USD`
        : `${p.cantidad} unid`;
      const valorLabel = valorUsd !== null ? `USD ${Math.round(valorUsd).toLocaleString("es-AR")}` : "—";
      const plLabel = pl !== null ? ` ${pl >= 0 ? "+" : ""}${pl.toFixed(1)}%` : "";
      const costSubyacente = p.promUsd !== null ? `compra USD ${p.promUsd.toFixed(2)}/u subyacente` : "";
      const currSubyacente = currUsd !== null ? `hoy USD ${currUsd.toFixed(2)}/u subyacente` : "";
      li.innerHTML = `
        <div class="mov-info">
          <div class="mov-desc"><strong>${tickerLabel}</strong>${ratioLabel} · ${cantLabel}</div>
          <div class="mov-meta">${costSubyacente}${costSubyacente && currSubyacente ? " · " : ""}${currSubyacente}</div>
        </div>
        <div class="mov-monto ${pl !== null && pl < 0 ? "neg" : "pos"}">${valorLabel}<br><small>${plLabel || ""}</small></div>
      `;
      ul.appendChild(li);
    }
  }

  $("inv-total").textContent = `USD ${Math.round(totalUsd).toLocaleString("es-AR")}`;

  // Render transactions
  const txUl = $("inv-transactions");
  txUl.innerHTML = "";
  const recientes = inversionesCache.slice(0, 30);
  if (!recientes.length) {
    txUl.innerHTML = '<li style="justify-content:center;color:var(--muted)">Sin transacciones</li>';
  } else {
    for (const r of recientes) {
      const cant = Number(r.cantidad);
      const signo = cant >= 0 ? "+" : "";
      const fecha = new Date(r.fecha).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "2-digit" });
      const precio = r.precio_ars ? `$${Math.round(Number(r.precio_ars)).toLocaleString("es-AR")}` : (r.precio_usd ? `USD ${r.precio_usd}` : "—");
      const li = document.createElement("li");
      li.innerHTML = `
        <div class="mov-info">
          <div class="mov-desc">${r.ticker} ${signo}${cant}</div>
          <div class="mov-meta">${fecha} · ${precio} ${r.notas ? "· " + escapeHtml(r.notas) : ""}</div>
        </div>
        <button class="mov-delete" data-id="${r.id}" aria-label="Borrar">✕</button>
      `;
      txUl.appendChild(li);
    }
    txUl.querySelectorAll(".mov-delete").forEach(b => {
      b.addEventListener("click", async () => {
        if (!confirm("¿Borrar esta transacción?")) return;
        try {
          await sbDeleteInversion(Number(b.dataset.id));
          inversionesCache = inversionesCache.filter(x => x.id !== Number(b.dataset.id));
          renderInversiones();
        } catch (e) { alert("Error: " + e.message); }
      });
    });
  }
}

async function agregarInversion() {
  const ticker = prompt("Ticker (ej SPY, BRKB, USD):");
  if (!ticker) return;
  const tickerUp = ticker.trim().toUpperCase();
  const tipo = tickerUp === "USD" ? "usd" : "cedear";
  const cantStr = prompt("Cantidad (positivo = compra, negativo = venta):");
  if (!cantStr) return;
  const cantidad = Number(cantStr);
  if (!cantidad) { alert("Cantidad inválida"); return; }
  const pArsStr = prompt(tipo === "usd" ? "Tipo de cambio (ARS por USD):" : "Precio por unidad en ARS:");
  const precio_ars = pArsStr ? Number(pArsStr) : null;
  const pUsdStr = prompt(tipo === "usd" ? "Dejar en 1" : "Precio por unidad en USD (opcional):", tipo === "usd" ? "1" : "");
  const precio_usd = pUsdStr ? Number(pUsdStr) : null;
  const fechaStr = prompt("Fecha (YYYY-MM-DD), vacío = hoy:", hoyISO());
  const fecha = fechaStr ? `${fechaStr} 12:00:00-03:00` : new Date().toISOString();
  const notas = prompt("Notas (opcional):", "") || null;
  try {
    await sbInsertInversion({ ticker: tickerUp, tipo_activo: tipo, cantidad, precio_ars, precio_usd, fecha, notas });
    await sbFetchInversiones();
    renderInversiones();
  } catch (e) {
    alert("Error: " + e.message);
  }
}

$("btn-open-inv").addEventListener("click", openInversiones);
$("btn-inv-back").addEventListener("click", closeInversiones);
$("btn-inv-add").addEventListener("click", agregarInversion);

// ==== Valor hora screen ====
const vhScreen = $("valor-hora-screen");

function mesLabel(mesISO) {
  const d = new Date(mesISO + "T12:00:00");
  return d.toLocaleDateString("es-AR", { month: "long", year: "numeric" });
}

async function openValorHoraScreen() {
  await sbFetchValoresHora();
  appScreen.classList.add("hidden");
  vhScreen.classList.remove("hidden");
  renderValorHora();
}

function closeValorHoraScreen() {
  vhScreen.classList.add("hidden");
  appScreen.classList.remove("hidden");
  render(); // actualizar footer/saldo por si cambió
}

function renderValorHora() {
  $("vh-current").textContent = fmt(getValorHora());
  const ul = $("vh-list");
  ul.innerHTML = "";
  if (!valoresHoraCache.length) {
    ul.innerHTML = '<li style="justify-content:center;color:var(--muted)">Sin entradas todavía</li>';
    return;
  }
  const sorted = [...valoresHoraCache].sort((a, b) => b.mes.localeCompare(a.mes));
  for (const v of sorted) {
    const li = document.createElement("li");
    li.innerHTML = `
      <div class="mov-info">
        <div class="mov-desc">${mesLabel(v.mes)}</div>
        <div class="mov-meta">${v.mes}</div>
      </div>
      <div class="mov-monto pos">${fmt(v.valor)}</div>
      <button class="mov-delete" data-mes="${v.mes}" aria-label="Editar">✎</button>
    `;
    ul.appendChild(li);
  }
  ul.querySelectorAll(".mov-delete").forEach(b => {
    b.addEventListener("click", () => editarValorMes(b.dataset.mes));
  });
}

async function editarValorMes(mes) {
  const existing = valoresHoraCache.find(v => v.mes === mes);
  const currentValor = existing ? existing.valor : 0;
  const nuevo = prompt(`Valor hora para ${mesLabel(mes)}:`, String(currentValor));
  if (nuevo === null) return;
  const n = Number(nuevo);
  if (!n || n <= 0) { alert("Valor inválido"); return; }
  if (!confirm(`Esto va a recalcular TODAS las jornadas de ${mesLabel(mes)}. ¿Confirmar?`)) return;
  try {
    const count = await sbRecalcHorasMes(mes, n);
    alert(`Actualizado. ${count} jornadas recalculadas.`);
    await sbFetchValoresHora();
    await syncFromSupabase();
    renderValorHora();
  } catch (e) {
    alert("Error: " + e.message);
  }
}

async function agregarMesValorHora() {
  const mesStr = prompt("Mes (YYYY-MM):", mesKey(new Date()).slice(0, 7));
  if (!mesStr) return;
  if (!/^\d{4}-\d{2}$/.test(mesStr)) { alert("Formato inválido, usá YYYY-MM"); return; }
  const mes = `${mesStr}-01`;
  const valor = prompt("Valor hora:", String(getValorHora()));
  if (!valor) return;
  const n = Number(valor);
  if (!n || n <= 0) { alert("Valor inválido"); return; }
  try {
    const count = await sbRecalcHorasMes(mes, n);
    alert(`Guardado. ${count} jornadas recalculadas (puede ser 0 si el mes no tiene jornadas aún).`);
    await sbFetchValoresHora();
    await syncFromSupabase();
    renderValorHora();
  } catch (e) {
    alert("Error: " + e.message);
  }
}

$("btn-open-vh").addEventListener("click", openValorHoraScreen);
$("btn-vh-back").addEventListener("click", closeValorHoraScreen);
$("btn-vh-add").addEventListener("click", agregarMesValorHora);

// ==== Service Worker ====
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}

// ==== Version label ====
(function showVersion() {
  const el = document.getElementById("app-version");
  if (el) el.textContent = "v" + APP_VERSION;
})();

// ==== Boot ====
(async () => {
  // Migrar horario del control si venía de versiones anteriores (20:27, 20:30)
  const prev = localStorage.getItem(KEY_CHECK);
  if (prev === "20:27" || prev === "20:30") setCheckTime("18:00");

  const action = new URLSearchParams(location.search).get("action");
  history.replaceState({}, "", location.pathname);
  if (action === "confirmar" || action === "confirm9to18") {
    await quickConfirmar();
    return;
  }
  if (action === "editar") {
    await quickEditar();
    return;
  }
  if (action === "sueldo") {
    await quickSueldo();
    return;
  }
  if (action === "comision") {
    await quickComision();
    return;
  }
  showLock();
})();
