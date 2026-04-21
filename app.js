// ==== Config ====
const SB_URL = "https://ljwlanwmnuqgxftlirhh.supabase.co";
const SB_KEY = "sb_publishable_niVre5BYps9QZVh4qq0UtQ_mMmCrIV0";

// ==== Storage local (cache + config) ====
const KEY_CACHE = "sueldo.cache";
const KEY_CRED = "sueldo.credId";
const KEY_VALOR = "sueldo.valorHora";
const KEY_CHECK = "sueldo.checkTime";

const getCache = () => JSON.parse(localStorage.getItem(KEY_CACHE) || "[]");
const setCache = (m) => localStorage.setItem(KEY_CACHE, JSON.stringify(m));
const getValorHora = () => Number(localStorage.getItem(KEY_VALOR) || 19000);
const setValorHora = (v) => localStorage.setItem(KEY_VALOR, String(v));
const getCheckTime = () => localStorage.getItem(KEY_CHECK) || "20:30";
const setCheckTime = (t) => localStorage.setItem(KEY_CHECK, t);

// ==== Format ====
const fmt = (n) => "$" + Math.round(n).toLocaleString("es-AR");
const hoyISO = () => new Date().toISOString().slice(0, 10);
const hoyLabel = () => new Date().toLocaleDateString("es-AR", { day: "2-digit", month: "short" });

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

async function sbDelete(id) {
  const res = await fetch(`${SB_URL}/rest/v1/movimientos?id=eq.${id}`, {
    method: "DELETE",
    headers: sbHeaders,
  });
  if (!res.ok) throw new Error(`delete ${res.status}`);
}

async function sbHasHorasToday() {
  const hoy = hoyISO();
  const desde = `${hoy}T00:00:00`;
  const hasta = `${hoy}T23:59:59`;
  const res = await fetch(
    `${SB_URL}/rest/v1/movimientos?select=id&tipo=eq.horas&fecha=gte.${desde}&fecha=lte.${hasta}&limit=1`,
    { headers: sbHeaders }
  );
  if (!res.ok) return false;
  const rows = await res.json();
  return rows.length > 0;
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

async function quickConfirm9a18() {
  await showQuick("⏳", "Registrando jornada...", "");
  try {
    if (await sbHasHorasToday()) {
      await showQuick("✓", "Ya estaba registrada", "Tu jornada de hoy ya estaba cargada.");
      setTimeout(() => window.close(), 1500);
      return;
    }
    const valor = getValorHora();
    await sbInsert({
      fecha: new Date().toISOString(),
      tipo: "horas",
      horas: 9,
      monto: 9 * valor,
      desc: `Jornada ${hoyLabel()} (9-18hs)`,
    });
    await showQuick("✓", "Jornada registrada", `9hs × ${fmt(valor)} = ${fmt(9 * valor)}`);
    setTimeout(() => window.close(), 1500);
  } catch (e) {
    await showQuick("⚠️", "Error", `No se pudo registrar: ${e.message}`);
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
    setTimeout(() => window.close(), 1500);
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
  await syncFromSupabase();
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

$("btn-lock").addEventListener("click", () => showLock());

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

// ==== Add form ====
let tipoActivo = "ingreso";
const tabs = document.querySelectorAll(".tab");
const inputValor = $("input-valor");
const inputDesc = $("input-desc");

function setTipo(t) {
  tipoActivo = t;
  tabs.forEach(tab => tab.classList.toggle("active", tab.dataset.tipo === t));
}
tabs.forEach(tab => tab.addEventListener("click", () => setTipo(tab.dataset.tipo)));

$("form-add").addEventListener("submit", async (e) => {
  e.preventDefault();
  const monto = Number(inputValor.value);
  if (!monto || monto <= 0) return;
  const desc = inputDesc.value.trim() || tipoActivo;
  const btn = e.target.querySelector("button[type=submit]");
  btn.disabled = true;
  try {
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
  } catch (err) {
    alert("No se pudo guardar: " + err.message);
  } finally {
    btn.disabled = false;
  }
});

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
function yaRegistroHoras(fechaISODia) {
  return getCache().some(m => m.tipo === "horas" && m.fecha.slice(0, 10) === fechaISODia);
}

function pasoHoraControl() {
  const [hh, mm] = getCheckTime().split(":").map(Number);
  const now = new Date();
  const threshold = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hh, mm, 0);
  return now >= threshold;
}

function checkConfirmBanner() {
  const banner = $("banner-confirm");
  const hoy = hoyISO();
  if (!yaRegistroHoras(hoy) && pasoHoraControl()) {
    banner.classList.remove("hidden");
  } else {
    banner.classList.add("hidden");
  }
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

$("btn-confirm-si").addEventListener("click", () => {
  agregarHoras(9, `Jornada ${hoyLabel()} (9-18hs)`);
  $("banner-confirm").classList.add("hidden");
});
$("btn-confirm-editar").addEventListener("click", promptHorasCustom);

// ==== Config ====
$("btn-config").addEventListener("click", () => {
  const nuevoValor = prompt("Valor hora (en pesos):", String(getValorHora()));
  if (nuevoValor !== null) {
    const n = Number(nuevoValor);
    if (n && n > 0) setValorHora(n);
  }
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

// ==== Service Worker ====
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}

// ==== Boot ====
(async () => {
  const action = new URLSearchParams(location.search).get("action");
  history.replaceState({}, "", location.pathname);
  if (action === "confirm9to18") {
    await quickConfirm9a18();
    return;
  }
  if (action === "editar") {
    await quickEditar();
    return;
  }
  showLock();
})();
