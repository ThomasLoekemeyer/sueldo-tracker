// ==== Storage ====
const KEY_MOVS = "sueldo.movimientos";
const KEY_CRED = "sueldo.credId";
const KEY_VALOR = "sueldo.valorHora";
const KEY_CHECK = "sueldo.checkTime";

const getMovs = () => JSON.parse(localStorage.getItem(KEY_MOVS) || "[]");
const setMovs = (m) => localStorage.setItem(KEY_MOVS, JSON.stringify(m));
const getValorHora = () => Number(localStorage.getItem(KEY_VALOR) || 19000);
const setValorHora = (v) => localStorage.setItem(KEY_VALOR, String(v));
const getCheckTime = () => localStorage.getItem(KEY_CHECK) || "20:27";
const setCheckTime = (t) => localStorage.setItem(KEY_CHECK, t);

// ==== Format ====
const fmt = (n) => "$" + Math.round(n).toLocaleString("es-AR");
const hoyISO = () => new Date().toISOString().slice(0, 10);
const hoyLabel = () => new Date().toLocaleDateString("es-AR", { day: "2-digit", month: "short" });

// ==== WebAuthn (Face ID) ====
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
      authenticatorSelection: {
        authenticatorAttachment: "platform",
        userVerification: "required",
        residentKey: "preferred",
      },
      timeout: 60000,
      attestation: "none",
    },
  });
  if (!cred) throw new Error("No se pudo registrar");
  localStorage.setItem(KEY_CRED, b64urlEncode(cred.rawId));
  return true;
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
  return true;
}

// ==== UI refs ====
const $ = (id) => document.getElementById(id);
const lockScreen = $("lock-screen");
const appScreen = $("app");
const btnUnlock = $("btn-unlock");
const btnSetup = $("btn-setup");
const lockMsg = $("lock-msg");
const lockError = $("lock-error");

// ==== Lock flow ====
function showApp() {
  lockScreen.classList.add("hidden");
  appScreen.classList.remove("hidden");
  render();
  checkConfirmBanner();
  startBannerPolling();
}

function showLock(message) {
  appScreen.classList.add("hidden");
  lockScreen.classList.remove("hidden");
  stopBannerPolling();
  const hasCred = !!localStorage.getItem(KEY_CRED);
  btnUnlock.classList.toggle("hidden", !hasCred);
  btnSetup.classList.toggle("hidden", hasCred);
  lockMsg.textContent = hasCred ? "Desbloqueá con Face ID" : "Configurá Face ID para proteger la app";
  lockError.textContent = message || "";
}

btnUnlock.addEventListener("click", async () => {
  lockError.textContent = "";
  try {
    await authFaceId();
    showApp();
  } catch (e) {
    lockError.textContent = "No se pudo verificar. Probá de nuevo.";
  }
});

btnSetup.addEventListener("click", async () => {
  lockError.textContent = "";
  try {
    await registerFaceId();
    await authFaceId();
    showApp();
  } catch (e) {
    lockError.textContent = "No se pudo configurar: " + (e.message || e);
  }
});

$("btn-lock").addEventListener("click", () => showLock());

// ==== Add form (solo ingreso / egreso) ====
let tipoActivo = "ingreso";
const tabs = document.querySelectorAll(".tab");
const inputValor = $("input-valor");
const inputDesc = $("input-desc");

function setTipo(t) {
  tipoActivo = t;
  tabs.forEach(tab => tab.classList.toggle("active", tab.dataset.tipo === t));
}
tabs.forEach(tab => tab.addEventListener("click", () => setTipo(tab.dataset.tipo)));

$("form-add").addEventListener("submit", (e) => {
  e.preventDefault();
  const monto = Number(inputValor.value);
  if (!monto || monto <= 0) return;
  const desc = inputDesc.value.trim() || tipoActivo;
  agregarDinero(tipoActivo, monto, desc);
  inputValor.value = "";
  inputDesc.value = "";
});

function agregarDinero(tipo, monto, desc) {
  const movs = getMovs();
  movs.unshift({
    id: Date.now(),
    fecha: new Date().toISOString(),
    tipo,
    horas: null,
    monto,
    desc,
  });
  setMovs(movs);
  render();
}

function agregarHoras(horas, desc) {
  const movs = getMovs();
  movs.unshift({
    id: Date.now(),
    fecha: new Date().toISOString(),
    tipo: "horas",
    horas,
    monto: horas * getValorHora(),
    desc,
  });
  setMovs(movs);
  render();
}

// ==== Render ====
function calcSaldo(movs) {
  return movs.reduce((s, m) => s + (m.tipo === "egreso" ? -m.monto : m.monto), 0);
}

function render() {
  const movs = getMovs();
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
    b.addEventListener("click", () => {
      if (!confirm("¿Borrar este movimiento?")) return;
      const id = Number(b.dataset.id);
      setMovs(getMovs().filter(m => m.id !== id));
      render();
    });
  });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// ==== Banner de control diario ====
function yaRegistroHoras(fechaISODia) {
  return getMovs().some(m => m.tipo === "horas" && m.fecha.slice(0, 10) === fechaISODia);
}

function pasoHoraControl() {
  const [hh, mm] = getCheckTime().split(":").map(Number);
  const now = new Date();
  const threshold = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hh, mm, 0);
  return now >= threshold;
}

function checkConfirmBanner() {
  const params = new URLSearchParams(location.search);
  const accion = params.get("action");
  const banner = $("banner-confirm");
  const hoy = hoyISO();

  if (accion === "confirm9to18" && !yaRegistroHoras(hoy)) {
    agregarHoras(9, `Jornada ${hoyLabel()} (9-18hs)`);
    history.replaceState({}, "", location.pathname);
    banner.classList.add("hidden");
    return;
  }
  if (accion === "editar") {
    promptHorasCustom();
    history.replaceState({}, "", location.pathname);
    return;
  }

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
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && !appScreen.classList.contains("hidden")) checkConfirmBanner();
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
  if (nuevoValor === null) return;
  const n = Number(nuevoValor);
  if (n && n > 0) setValorHora(n);

  const nuevaHora = prompt("Horario del control diario (HH:MM):", getCheckTime());
  if (nuevaHora === null) { render(); return; }
  if (/^\d{1,2}:\d{2}$/.test(nuevaHora.trim())) {
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
  const movs = getMovs();
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
if (!localStorage.getItem(KEY_CHECK)) setCheckTime("20:27");
showLock();
