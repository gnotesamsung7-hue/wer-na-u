import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getDatabase, ref, get, set, update, remove, push, onValue, off,
  query, orderByChild, startAt, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
import { firebaseConfig } from "./firebase-config.js";

/* ---------- Native plugins (Capacitor) with browser fallbacks ---------- */
const Cap = window.Capacitor;
const isNative = !!(Cap && Cap.isNativePlatform && Cap.isNativePlatform());
const plugin = (name) => (isNative && Cap.registerPlugin ? Cap.registerPlugin(name) : null);
const BG = plugin("BackgroundGeolocation");
const Notify = plugin("LocalNotifications");
const Device = plugin("Device");
const Haptics = plugin("Haptics");

/* ---------- Settings ---------- */
const WRITE_EVERY_MS = 10_000;        // at most one location write per 10s while moving
const HEARTBEAT_MS = 5 * 60_000;      // refresh "last updated" every 5 min while still
const STALE_MS = 15 * 60_000;         // grey out pins older than this
const SOS_WINDOW_MS = 60 * 60_000;    // SOS alerts older than 1 hour are ignored
const SOS_HOLD_MS = 3000;
const PALETTE = ["#D9480F", "#0B7A75", "#1F5FA8", "#5B4B8A", "#B5367A", "#7A5C12", "#2F7D32", "#C92A2A"];
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/* ---------- State ---------- */
const S = {
  uid: null, profile: null, cid: null,
  circle: null, locations: {}, sos: {},
  watcherId: null, webWatchId: null, lastFix: null, lastWrite: 0, heartbeat: null,
  map: null, markers: {}, fitted: false,
  listeners: [],
};

const $ = (id) => document.getElementById(id);
const store = {
  get: (k) => { try { return localStorage.getItem("wnu." + k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem("wnu." + k, v); } catch {} },
};

/* ---------- Screens & UI helpers ---------- */
function show(screen) {
  for (const s of ["loading", "welcome", "permission", "app"]) $("screen-" + s).hidden = s !== screen;
  if (screen === "app") setTimeout(() => S.map && S.map.invalidateSize(), 50);
}
let toastTimer;
function toast(msg) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 3200);
}
function initials(name = "?") {
  const w = name.trim().split(/\s+/);
  return (w.length > 1 ? w[0][0] + w[1][0] : name.trim().slice(0, 2)).toUpperCase();
}
function ago(ts) {
  if (!ts) return "never";
  const s = Math.max(0, (Date.now() - ts) / 1000);
  if (s < 60) return "now";
  if (s < 3600) return Math.floor(s / 60) + "m ago";
  if (s < 86400) return Math.floor(s / 3600) + "h ago";
  return Math.floor(s / 86400) + "d ago";
}
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function hashInt(str) {
  let h = 0;
  for (const c of str) h = (h * 31 + c.charCodeAt(0)) | 0;
  return Math.abs(h) % 2_000_000_000;
}
function makeCode() {
  let c = "";
  const r = crypto.getRandomValues(new Uint32Array(6));
  for (const n of r) c += CODE_CHARS[n % CODE_CHARS.length];
  return c;
}

/* ---------- Firebase ---------- */
if (firebaseConfig.apiKey.startsWith("PASTE")) {
  $("loading-msg").textContent = "Add your Firebase settings in www/firebase-config.js, then rebuild.";
  throw new Error("Firebase config missing");
}
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    try { await signInAnonymously(auth); }
    catch (e) { $("loading-msg").textContent = "Can't connect. Check your internet and Firebase sign-in settings."; console.error(e); }
    return;
  }
  S.uid = user.uid;
  await boot();
});

async function boot() {
  try {
    const snap = await get(ref(db, `users/${S.uid}`));
    S.profile = snap.val();
  } catch (e) { console.error(e); }

  if (S.profile && S.profile.circle) {
    try {
      const m = await get(ref(db, `circles/${S.profile.circle}/members/${S.uid}`));
      if (m.exists()) { S.cid = S.profile.circle; return enterApp(); }
    } catch { /* not a member anymore */ }
  }
  if (S.profile && S.profile.name) $("in-name").value = S.profile.name;
  show("welcome");
}

/* ---------- Onboarding ---------- */
let mode = "create";
document.querySelectorAll(".seg-btn").forEach((b) => b.addEventListener("click", () => {
  mode = b.dataset.mode;
  document.querySelectorAll(".seg-btn").forEach((x) => {
    x.classList.toggle("on", x === b);
    x.setAttribute("aria-selected", x === b);
  });
  $("field-create").hidden = mode !== "create";
  $("field-join").hidden = mode !== "join";
  $("btn-onboard").textContent = mode === "create" ? "Create circle" : "Join circle";
  $("onboard-error").textContent = "";
}));

$("form-onboard").addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = $("in-name").value.trim();
  const err = $("onboard-error");
  const btn = $("btn-onboard");
  err.textContent = "";
  if (!name) { err.textContent = "Enter your name so your family knows it's you."; return; }
  const color = (S.profile && S.profile.color) || PALETTE[Math.floor(Math.random() * PALETTE.length)];
  btn.disabled = true;

  try {
    if (mode === "create") {
      const circleName = $("in-circle").value.trim() || `${name}'s family`;
      const cid = push(ref(db, "circles")).key;
      let code = makeCode();
      for (let i = 0; i < 5 && (await get(ref(db, `circleCodes/${code}`))).exists(); i++) code = makeCode();
      await update(ref(db), {
        [`circles/${cid}/members/${S.uid}`]: { name, color, joinedAt: serverTimestamp() },
        [`circles/${cid}/meta`]: { name: circleName, code, createdBy: S.uid },
        [`circleCodes/${code}`]: cid,
        [`users/${S.uid}`]: { name, color, circle: cid },
      });
      S.cid = cid;
    } else {
      const code = $("in-code").value.trim().toUpperCase();
      if (code.length !== 6) { err.textContent = "Invite codes are 6 letters and numbers."; btn.disabled = false; return; }
      const cidSnap = await get(ref(db, `circleCodes/${code}`));
      if (!cidSnap.exists()) { err.textContent = "No family circle uses that code. Check it and try again."; btn.disabled = false; return; }
      const cid = cidSnap.val();
      await update(ref(db), {
        [`circles/${cid}/members/${S.uid}`]: { name, color, joinedAt: serverTimestamp() },
        [`users/${S.uid}`]: { name, color, circle: cid },
      });
      S.cid = cid;
    }
    S.profile = { name, color, circle: S.cid };
    enterApp();
  } catch (e2) {
    console.error(e2);
    err.textContent = "Couldn't save. Check your internet and try again.";
  }
  btn.disabled = false;
});

/* ---------- Permission explainer ---------- */
$("btn-allow").addEventListener("click", async () => {
  store.set("sharing", "on");
  show("app");
  await startSharing();
});
$("btn-skip").addEventListener("click", () => {
  store.set("sharing", "off");
  show("app");
  renderSharing();
});

/* ---------- Main app ---------- */
function enterApp() {
  initMap();
  listen();
  setupNotifications();
  const pref = store.get("sharing");
  if (!pref) { show("permission"); return; }
  show("app");
  if (pref === "on") startSharing();
  renderSharing();
}

function initMap() {
  if (S.map) return;
  S.map = L.map("map", { zoomControl: false, attributionControl: true }).setView([14.5995, 120.9842], 12);
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap contributors",
  }).addTo(S.map);
}

function listen() {
  stopListening();
  const circleRef = ref(db, `circles/${S.cid}`);
  const locRef = ref(db, `locations/${S.cid}`);
  const sosQuery = query(ref(db, `sos/${S.cid}`), orderByChild("ts"), startAt(Date.now() - SOS_WINDOW_MS));

  onValue(circleRef, (snap) => {
    S.circle = snap.val();
    if (!S.circle || !S.circle.members || !S.circle.members[S.uid]) return; // removed
    $("circle-name").textContent = S.circle.meta ? S.circle.meta.name : "Family";
    $("invite-code").textContent = S.circle.meta ? S.circle.meta.code : "------";
    render();
  }, (e) => console.error(e));
  onValue(locRef, (snap) => { S.locations = snap.val() || {}; render(); }, (e) => console.error(e));
  onValue(sosQuery, (snap) => { S.sos = snap.val() || {}; renderSos(); render(); }, (e) => console.error(e));

  S.listeners = [circleRef, locRef, sosQuery];
}
function stopListening() {
  for (const r of S.listeners) off(r);
  S.listeners = [];
}

setInterval(() => { if (S.circle) render(); }, 30_000);

/* ---------- Rendering ---------- */
function activeSosFor(uid) {
  return Object.entries(S.sos).find(([, s]) => s.uid === uid && s.active && Date.now() - (s.ts || 0) < SOS_WINDOW_MS);
}

function memberStatus(uid, loc) {
  if (activeSosFor(uid)) return { text: "SOS: needs help", cls: "alert" };
  if (!loc) return { text: "No location yet", cls: "" };
  if (loc.sharing === false) return { text: "Paused sharing", cls: "" };
  const age = Date.now() - (loc.ts || 0);
  if (loc.speed && loc.speed > 2.5 && age < 3 * 60_000) return { text: `Moving at ${Math.round(loc.speed * 3.6)} km/h`, cls: "moving" };
  if (age > STALE_MS) return { text: `Last seen ${ago(loc.ts)}`, cls: "" };
  return { text: `Updated ${ago(loc.ts)}`, cls: "" };
}

function render() {
  if (!S.circle || !S.circle.members) return;
  const members = Object.entries(S.circle.members)
    .sort(([a, x], [b, y]) => (a === S.uid ? -1 : b === S.uid ? 1 : (x.name || "").localeCompare(y.name || "")));

  $("circle-count").textContent = `${members.length} ${members.length === 1 ? "member" : "members"}`;

  const list = $("member-list");
  list.innerHTML = "";
  for (const [uid, m] of members) {
    const loc = S.locations[uid];
    const st = memberStatus(uid, loc);
    const batt = loc && typeof loc.battery === "number" ? Math.round(loc.battery * 100) : null;
    const li = document.createElement("li");
    li.innerHTML = `
      <button class="member ${uid === S.uid ? "is-me" : ""}">
        <span class="avatar" style="background:${esc(m.color || PALETTE[0])}">${esc(initials(m.name))}</span>
        <span class="member-main">
          <span class="member-name">${esc(m.name)}${uid === S.uid ? " (you)" : ""}</span><br>
          <span class="member-status ${st.cls}">${esc(st.text)}</span>
        </span>
        <span class="member-meta">${batt !== null ? `<span class="${batt <= 15 && !loc.charging ? "low" : ""}">${batt}%${loc.charging ? " charging" : ""}</span><br>` : ""}${loc ? ago(loc.ts) : ""}</span>
      </button>`;
    li.querySelector("button").addEventListener("click", () => {
      if (loc && loc.lat) S.map.flyTo([loc.lat, loc.lng], 16, { duration: 0.8 });
      else toast(`${m.name} hasn't shared a location yet.`);
    });
    list.appendChild(li);
  }
  if (members.length === 1) {
    const li = document.createElement("li");
    li.className = "empty";
    li.innerHTML = `Invite your family: open Settings and send them your code.`;
    list.appendChild(li);
  }
  renderMarkers(members);
}

function renderMarkers(members) {
  const seen = new Set();
  const pts = [];
  for (const [uid, m] of members) {
    const loc = S.locations[uid];
    if (!loc || typeof loc.lat !== "number") continue;
    seen.add(uid);
    pts.push([loc.lat, loc.lng]);
    const age = Date.now() - (loc.ts || 0);
    const moving = loc.speed && loc.speed > 2.5 && age < 3 * 60_000;
    const cls = [uid === S.uid ? "me" : "", age > STALE_MS || loc.sharing === false ? "stale" : "", activeSosFor(uid) ? "sos" : ""].join(" ");
    const html = `<div class="pin-wrap"><div class="pin-dot ${cls}" style="background:${esc(m.color || PALETTE[0])}">${esc(initials(m.name))}</div>${moving ? `<div class="pin-tag">${Math.round(loc.speed * 3.6)} km/h</div>` : ""}</div>`;
    const icon = L.divIcon({ html, className: "", iconSize: [60, 66], iconAnchor: [30, 25] });
    if (S.markers[uid]) { S.markers[uid].setLatLng([loc.lat, loc.lng]); S.markers[uid].setIcon(icon); }
    else S.markers[uid] = L.marker([loc.lat, loc.lng], { icon, keyboard: false }).addTo(S.map);
  }
  for (const uid of Object.keys(S.markers)) if (!seen.has(uid)) { S.markers[uid].remove(); delete S.markers[uid]; }
  if (!S.fitted && pts.length) { fitAll(pts); S.fitted = true; }
}

function fitAll(pts) {
  pts = pts || Object.values(S.markers).map((mk) => mk.getLatLng());
  if (!pts.length) { toast("No one has shared a location yet."); return; }
  if (pts.length === 1) S.map.setView(pts[0], 15);
  else S.map.fitBounds(pts, { padding: [60, 60], maxZoom: 16 });
}
$("btn-recenter").addEventListener("click", () => fitAll());

/* ---------- Location sharing ---------- */
async function startSharing() {
  if (S.watcherId || S.webWatchId !== null) return;
  try {
    if (BG) {
      S.watcherId = await BG.addWatcher({
        backgroundTitle: "Wer na U? is sharing your location",
        backgroundMessage: "Your family can see where you are. Tap to open.",
        requestPermissions: true,
        stale: false,
        distanceFilter: 20,
      }, onFix);
    } else if (navigator.geolocation) {
      S.webWatchId = navigator.geolocation.watchPosition(
        (p) => onFix({ latitude: p.coords.latitude, longitude: p.coords.longitude, accuracy: p.coords.accuracy, speed: p.coords.speed }),
        (e) => onFix(null, { code: e.code === 1 ? "NOT_AUTHORIZED" : "ERROR", message: e.message }),
        { enableHighAccuracy: true, maximumAge: 10_000 }
      );
    }
    store.set("sharing", "on");
    clearInterval(S.heartbeat);
    S.heartbeat = setInterval(() => S.lastFix && writeLocation(S.lastFix, true), HEARTBEAT_MS);
  } catch (e) {
    console.error(e);
    toast("Couldn't start location sharing.");
  }
  renderSharing();
}

async function stopSharing() {
  if (S.watcherId && BG) { try { await BG.removeWatcher({ id: S.watcherId }); } catch {} }
  if (S.webWatchId !== null) navigator.geolocation.clearWatch(S.webWatchId);
  S.watcherId = null; S.webWatchId = null;
  clearInterval(S.heartbeat);
  store.set("sharing", "off");
  if (S.cid) { try { await update(ref(db, `locations/${S.cid}/${S.uid}`), { sharing: false, ts: serverTimestamp() }); } catch {} }
  renderSharing();
}

function onFix(location, error) {
  if (error) {
    if (error.code === "NOT_AUTHORIZED") {
      stopSharing();
      if (BG && confirm("Wer na U? needs location permission to share where you are. Open settings now?")) BG.openSettings();
      else toast("Location permission is off.");
    }
    return;
  }
  if (!location) return;
  S.lastFix = location;
  if (Date.now() - S.lastWrite >= WRITE_EVERY_MS) writeLocation(location);
}

async function writeLocation(loc, heartbeat = false) {
  if (!S.cid) return;
  S.lastWrite = Date.now();
  let battery = null, charging = false;
  try {
    if (Device) { const b = await Device.getBatteryInfo(); battery = b.batteryLevel ?? null; charging = !!b.isCharging; }
    else if (navigator.getBattery) { const b = await navigator.getBattery(); battery = b.level; charging = b.charging; }
  } catch {}
  const data = {
    lat: loc.latitude, lng: loc.longitude,
    acc: Math.round(loc.accuracy || 0),
    speed: heartbeat ? 0 : (loc.speed || 0),
    sharing: true, ts: serverTimestamp(),
  };
  if (battery !== null) { data.battery = battery; data.charging = charging; }
  try { await set(ref(db, `locations/${S.cid}/${S.uid}`), data); } catch (e) { console.error(e); }
}

function renderSharing() {
  const on = store.get("sharing") === "on";
  $("sharing-off").hidden = on;
  $("tg-sharing").checked = on;
}
$("btn-resume").addEventListener("click", () => startSharing());
$("tg-sharing").addEventListener("change", (e) => (e.target.checked ? startSharing() : stopSharing()));

/* ---------- SOS ---------- */
const sosBtn = $("btn-sos");
let holdTimer = null;
function holdStart(e) {
  e.preventDefault();
  sosBtn.classList.add("holding");
  if (Haptics) Haptics.impact({ style: "LIGHT" }).catch(() => {});
  holdTimer = setTimeout(fireSos, SOS_HOLD_MS);
}
function holdEnd() {
  clearTimeout(holdTimer);
  holdTimer = null;
  sosBtn.classList.remove("holding");
}
sosBtn.addEventListener("pointerdown", holdStart);
["pointerup", "pointerleave", "pointercancel"].forEach((ev) => sosBtn.addEventListener(ev, holdEnd));
sosBtn.addEventListener("contextmenu", (e) => e.preventDefault());
sosBtn.addEventListener("keydown", (e) => { if ((e.key === "Enter" || e.key === " ") && !holdTimer) holdStart(e); });
sosBtn.addEventListener("keyup", holdEnd);

async function fireSos() {
  holdEnd();
  if (Haptics) Haptics.vibrate({ duration: 600 }).catch(() => {});
  const fix = S.lastFix;
  const data = { uid: S.uid, name: S.profile.name, active: true, ts: serverTimestamp() };
  if (fix) { data.lat = fix.latitude; data.lng = fix.longitude; }
  try {
    await push(ref(db, `sos/${S.cid}`), data);
    if (fix) writeLocation(fix);
    toast("SOS sent to your family");
    if (store.get("sharing") !== "on") startSharing();
  } catch (e) {
    console.error(e);
    toast("SOS didn't send. Check your internet, or call for help directly.");
  }
}

async function cancelSos(sid) {
  try { await update(ref(db, `sos/${S.cid}/${sid}`), { active: false, endedAt: serverTimestamp() }); toast("SOS cancelled"); }
  catch (e) { console.error(e); toast("Couldn't cancel. Try again."); }
}

function renderSos() {
  const box = $("sos-banners");
  box.innerHTML = "";
  const notified = new Set(JSON.parse(store.get("notified") || "[]"));
  const active = Object.entries(S.sos).filter(([, s]) => s.active && Date.now() - (s.ts || 0) < SOS_WINDOW_MS);

  for (const [sid, s] of active) {
    const mine = s.uid === S.uid;
    const div = document.createElement("div");
    div.className = "banner" + (mine ? " mine" : "");
    div.innerHTML = mine
      ? `<div class="banner-text"><strong>Your SOS is on</strong><span>Your family can see your location.</span></div><button>Cancel SOS</button>`
      : `<div class="banner-text"><strong>${esc(s.name)} needs help</strong><span>SOS sent ${ago(s.ts)}</span></div><button>Show on map</button>`;
    div.querySelector("button").addEventListener("click", () => {
      if (mine) return cancelSos(sid);
      const loc = S.locations[s.uid];
      const pos = loc && loc.lat ? [loc.lat, loc.lng] : s.lat ? [s.lat, s.lng] : null;
      if (pos) S.map.flyTo(pos, 17, { duration: 0.8 });
      else toast(`No location from ${s.name} yet.`);
    });
    box.appendChild(div);

    if (!mine && !notified.has(sid)) {
      notified.add(sid);
      alertSos(sid, s);
    }
  }
  store.set("notified", JSON.stringify([...notified].slice(-50)));
}

async function setupNotifications() {
  if (!Notify) return;
  try {
    await Notify.requestPermissions();
    await Notify.createChannel({ id: "sos", name: "SOS alerts", description: "When someone in your family presses SOS", importance: 5, visibility: 1, vibration: true });
  } catch (e) { console.warn(e); }
}

async function alertSos(sid, s) {
  if (Haptics) Haptics.vibrate({ duration: 1200 }).catch(() => {});
  if (Notify) {
    try {
      await Notify.schedule({ notifications: [{
        id: hashInt(sid), channelId: "sos",
        title: `${s.name} needs help`,
        body: "They pressed SOS in Wer na U?. Open the app to see where they are.",
      }] });
    } catch (e) { console.warn(e); }
  }
}

/* ---------- Settings ---------- */
$("btn-settings").addEventListener("click", () => { renderSharing(); $("dlg-settings").showModal(); });
$("btn-copy-code").addEventListener("click", async () => {
  const code = $("invite-code").textContent;
  try { await navigator.clipboard.writeText(code); toast("Invite code copied"); }
  catch { toast(`Your invite code is ${code}`); }
});
$("btn-leave").addEventListener("click", async () => {
  if (!confirm("Leave this family circle? Your family will no longer see your location.")) return;
  await stopSharing();
  stopListening();
  try {
    await remove(ref(db, `locations/${S.cid}/${S.uid}`));
    await remove(ref(db, `circles/${S.cid}/members/${S.uid}`));
    await update(ref(db, `users/${S.uid}`), { circle: null });
  } catch (e) { console.error(e); }
  location.reload();
});
