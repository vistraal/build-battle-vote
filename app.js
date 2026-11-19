import { firebaseConfig } from "./firebase-config.js";

// The one organiser. Must match organiser() in firestore.rules.
const ORGANISER = "contactpavankumarmeduri@gmail.com";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
let toastT;
const toast = (t) => { const el = $("toast"); el.textContent = t; el.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => (el.hidden = true), 3200); };
const err = (id, e) => { const el = $(id); el.textContent = friendly(e); el.hidden = !e; };
const friendly = (e) => {
  if (!e) return "";
  const m = e.code || e.message || String(e);
  if (/permission-denied|insufficient/i.test(m)) return "Not allowed right now. Check the phase (voting open?), and that you're not voting for your own site.";
  if (/popup-closed|cancelled-popup/i.test(m)) return "Sign-in window was closed. Try again.";
  if (/unauthorized-domain/i.test(m)) return "This domain is not authorised in Firebase yet.";
  if (/already-exists/i.test(m)) return "You already voted. One vote per person.";
  return e.message || m;
};
const thumb = (url) => "https://s0.wp.com/mshots/v1/" + encodeURIComponent(url) + "?w=320";
const fmtTime = (ts) => { const d = ts?.toDate?.(); return d ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "—"; };

// ---------- not configured ----------
if (!firebaseConfig.apiKey) { $("vSetup").hidden = false; throw new Error("firebase-config.js is empty"); }

const FB = "https://www.gstatic.com/firebasejs/10.14.1/";
const [{ initializeApp }, { getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult, onAuthStateChanged, signOut }, { getFirestore, doc, getDoc, setDoc, updateDoc, deleteDoc, collection, onSnapshot, getDocs, writeBatch, serverTimestamp }] =
  await Promise.all([import(FB + "firebase-app.js"), import(FB + "firebase-auth.js"), import(FB + "firebase-firestore.js")]);

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: "select_account" });

// ---------- state ----------
let lastPhase = null, user = null, cfg = null, sites = [], votes = null, myVote = null, mine = null, tab = "mine", editing = false;
const subs = {};
const unsubAll = () => { Object.keys(subs).forEach((k) => { subs[k] && subs[k](); delete subs[k]; }); };
const isAdmin = () => !!user && (user.email || "").toLowerCase() === ORGANISER;
const phase = () => cfg?.phase || "submit";
const firstName = (u) => (u.displayName || u.email || "").split(/[ @]/)[0] || "You";

// ---------- auth ----------
$("signIn").onclick = async () => {
  err("signInErr", null);
  try { await signInWithPopup(auth, provider); }
  catch (e) { if (/popup-blocked|operation-not-supported/i.test(e.code || "")) { await signInWithRedirect(auth, provider); } else err("signInErr", e); }
};
$("signOut").onclick = () => signOut(auth);
getRedirectResult(auth).catch((e) => err("signInErr", e));

onAuthStateChanged(auth, async (u) => {
  user = u; unsubAll();
  sites = []; votes = null; myVote = null; mine = null; cfg = null;
  $("me").hidden = !u; $("tabs").hidden = !u; $("status").hidden = true;
  ["vSignIn", "vMine", "vGallery", "vAdmin"].forEach((v) => ($(v).hidden = true));
  if (!u) { $("vSignIn").hidden = false; return; }
  $("meName").textContent = firstName(u);
  $("tabAdmin").hidden = !isAdmin(); $("tabMine").hidden = isAdmin();
  const cref = doc(db, "config", "settings");
  if (isAdmin()) {
    // Organiser: make sure the settings doc exists and has a phase.
    const snap = await getDoc(cref).catch(() => null);
    const d = snap?.exists() ? snap.data() : null;
    if (!d || !["submit", "vote", "closed"].includes(d.phase)) {
      await setDoc(cref, { phase: "submit", title: d?.title || "Build Battle", updatedAt: serverTimestamp() }).catch((e) => toast(friendly(e)));
    }
  }
  subs.cfg = onSnapshot(cref, (s) => { cfg = s.data() || { phase: "submit", title: "Build Battle" }; applyCfg(); subscribe(); render(); }, (e) => toast(friendly(e)));
  subs.myVote = onSnapshot(doc(db, "votes", u.uid), (s) => { myVote = s.exists() ? s.data().site : null; render(); }, () => {});
  tab = isAdmin() ? "admin" : "mine"; lastPhase = null;
});

function applyCfg() {
  $("title").textContent = cfg.title || "Build Battle";
  document.title = (cfg.title || "Build Battle") + " · Vote";
  $("aTitle").value = cfg.title || "";
}

// Sites: admin and open phases get the whole gallery; in "submit" a student may only read their own doc.
function subscribe() {
  const wantAll = isAdmin() || phase() !== "submit";
  if (wantAll && !subs.sitesAll) {
    subs.sitesOwn && subs.sitesOwn(); delete subs.sitesOwn;
    subs.sitesAll = onSnapshot(collection(db, "sites"), (qs) => { setSites(qs.docs.map((d) => ({ id: d.id, ...d.data() }))); }, (e) => toast(friendly(e)));
  } else if (!wantAll && !subs.sitesOwn) {
    subs.sitesAll && subs.sitesAll(); delete subs.sitesAll;
    subs.sitesOwn = onSnapshot(doc(db, "sites", user.uid), (s) => { setSites(s.exists() ? [{ id: s.id, ...s.data() }] : []); }, () => {});
  }
  const wantVotes = isAdmin() || phase() === "closed";
  if (wantVotes && !subs.votes) {
    subs.votes = onSnapshot(collection(db, "votes"), (qs) => { votes = qs.docs.map((d) => ({ voter: d.id, ...d.data() })); render(); }, () => { votes = []; render(); });
  } else if (!wantVotes && subs.votes) { subs.votes(); delete subs.votes; votes = null; }
}
function setSites(list) {
  sites = list.sort((a, b) => (a.createdAt?.toMillis?.() || 0) - (b.createdAt?.toMillis?.() || 0) || a.id.localeCompare(b.id));
  sites.forEach((s, i) => (s.no = i + 1));
  mine = sites.find((s) => s.id === user.uid) || null;
  if (mine) editing = false;
  render();
}

// ---------- navigation ----------
document.querySelectorAll(".tab").forEach((b) => (b.onclick = () => { tab = b.dataset.tab; editing = false; render(); }));
$("goGallery").onclick = () => { tab = "gallery"; render(); };

// ---------- render ----------
function render() {
  if (!user || !cfg) return;
  const p = phase(), admin = isAdmin();
  document.querySelectorAll(".tab").forEach((b) => b.classList.toggle("on", b.dataset.tab === tab));
  $("vMine").hidden = tab !== "mine"; $("vGallery").hidden = tab !== "gallery"; $("vAdmin").hidden = tab !== "admin";

  // phase banner
  const st = $("status"); st.hidden = false;
  if (p === "submit") { st.className = "banner warn"; st.textContent = mine ? "Submissions open. Your entry is in. The gallery opens when voting starts." : "Submissions open. Add your site under My site. The gallery opens when voting starts."; }
  else if (p === "vote") {
    if (myVote) { const t = sites.find((s) => s.id === myVote); st.className = "banner ok"; st.textContent = "Your hand is up for #" + (t?.no ?? "?") + " " + (t?.name ?? "") + ". One hand per person."; }
    else if (admin) { st.className = "banner"; st.textContent = "Voting is open. Hands are being counted live under Control."; }
    else if (!mine) { st.className = "banner warn"; st.textContent = "Voting is open, but you need an entry to raise your hand. Add your site under My site."; }
    else { st.className = "banner"; st.textContent = "Voting is open. Open a few sites, then raise your hand once. Not for your own."; }
  } else { st.className = "banner closed"; st.textContent = "Voting is closed. The class has chosen."; }
  if (p === "closed" && lastPhase && lastPhase !== "closed" && (votes || !admin)) showReveal();
  lastPhase = p;

  renderMine(); renderGallery(); if (admin) renderAdmin();
}

function renderMine() {
  if ($("vMine").hidden) return;
  const showForm = !mine || editing;
  $("mineCard").hidden = showForm; $("mineForm").hidden = !showForm;
  $("rCancel").hidden = !mine;
  $("mineTitle").textContent = mine ? "Edit your site" : "Add your site";
  $("mineLead").textContent = phase() === "closed" ? "Voting is closed; entries can't be changed now." : "Put your published site in the gallery. You can edit it any time before voting closes.";
  $("rSave").disabled = phase() === "closed";
  if (showForm && !$("rName").value && !$("rUrl").value) { $("rName").value = mine?.name || user.displayName || ""; $("rUrl").value = mine?.url || ""; }
  if (mine) $("mineView").innerHTML = '<a class="thumb" href="' + esc(mine.url) + '" target="_blank" rel="noopener"><img loading="lazy" src="' + thumb(mine.url) + '" alt=""></a><div class="row-main"><div class="num">#' + mine.no + '</div><div class="name">' + esc(mine.name) + '</div><a class="url" href="' + esc(mine.url) + '" target="_blank" rel="noopener">' + esc(mine.url.replace(/^https?:\/\//, "")) + ' ↗</a><div class="muted">Submitted ' + fmtTime(mine.createdAt) + "</div></div>";
  $("editMine").hidden = phase() === "closed";
}
$("editMine").onclick = () => { editing = true; $("rName").value = mine.name; $("rUrl").value = mine.url; render(); };
$("rCancel").onclick = () => { editing = false; render(); };
$("rSave").onclick = async () => {
  const name = $("rName").value.trim(), url = $("rUrl").value.trim();
  if (name.length < 2) return err("rErr", { message: "Type your name." });
  if (!/^https?:\/\/[^\s]{3,}$/i.test(url)) return err("rErr", { message: "Paste the full link, starting with https://" });
  err("rErr", null); $("rSave").disabled = true;
  try {
    const wasNew = !mine;
    if (wasNew) await setDoc(doc(db, "sites", user.uid), { name, url, createdAt: serverTimestamp() });
    else await updateDoc(doc(db, "sites", user.uid), { name, url });
    toast(wasNew ? "Your site is in." : "Updated.");
    editing = false; $("rName").value = ""; $("rUrl").value = "";
  } catch (e) { err("rErr", e); }
  $("rSave").disabled = false; render();
};

$("q").oninput = renderGallery;
function renderGallery() {
  if ($("vGallery").hidden) return;
  const p = phase(), admin = isAdmin(), open = admin || p !== "submit";
  $("galleryLocked").hidden = open; $("galleryOpen").hidden = !open;
  $("vResults").hidden = !(p === "closed" || admin && votes);
  if (!open) { $("lockCount").textContent = mine ? "Your entry: #" + mine.no + " " + mine.name : ""; return; }
  const q = $("q").value.trim().toLowerCase();
  const rows = sites.filter((s) => !q || String(s.no) === q.replace("#", "") || s.name.toLowerCase().includes(q));
  $("galleryCount").textContent = sites.length + " site" + (sites.length === 1 ? "" : "s");
  $("list").innerHTML = rows.length ? rows.map((s) => {
    const isMine = s.id === user.uid, voted = myVote === s.id;
    let act = "";
    if (isMine) act = '<span class="tag">Your site</span>';
    else if (voted) act = '<span class="hand up">✋ Hand raised</span>';
    else if (p === "vote" && !myVote && !admin) act = mine ? '<button class="hand" data-vote="' + s.id + '">✋ Raise hand</button>' : '<span class="tag">Add your site to vote</span>';
    return '<div class="row-item' + (isMine ? " mine" : "") + '"><a class="thumb" href="' + esc(s.url) + '" target="_blank" rel="noopener"><img loading="lazy" src="' + thumb(s.url) + '" alt=""></a><div class="row-main"><div class="num">#' + s.no + '</div><div class="name">' + esc(s.name) + '</div><a class="url" href="' + esc(s.url) + '" target="_blank" rel="noopener">' + esc(s.url.replace(/^https?:\/\//, "")) + ' ↗</a></div><div class="row-act">' + act + "</div></div>";
  }).join("") : '<p class="muted">No sites yet.</p>';
  if (!$("vResults").hidden) renderResultsInto("results", "resultsMeta", false);
  $("resultsTitle").textContent = p === "closed" ? "Results" : "Live standings";
  // the screenshot service returns a placeholder while it renders a site the first time; refresh thumbs once after a while
  clearTimeout(thumbRetry); thumbRetry = setTimeout(() => document.querySelectorAll("#list .thumb img, #mineView .thumb img").forEach((i) => { i.src = i.src.split("&r=")[0] + "&r=" + Date.now(); }), 12000);
}
let thumbRetry = 0;
$("list").onclick = async (e) => {
  const b = e.target.closest("[data-vote]"); if (!b) return;
  const target = sites.find((s) => s.id === b.dataset.vote); if (!target) return;
  if (b.dataset.armed !== "1") { b.dataset.armed = "1"; b.classList.add("armed"); b.textContent = "Confirm: #" + target.no + "?"; setTimeout(() => { if (b.isConnected) { b.dataset.armed = ""; b.classList.remove("armed"); b.textContent = "✋ Raise hand"; } }, 8000); return; }
  b.disabled = true;
  try { await setDoc(doc(db, "votes", user.uid), { site: target.id, createdAt: serverTimestamp() }); toast("Hand raised for #" + target.no + " " + target.name); }
  catch (e2) { toast(friendly(e2)); b.disabled = false; b.classList.remove("armed"); b.dataset.armed = ""; b.textContent = "✋ Raise hand"; }
};

function ranked() {
  const counts = {}; (votes || []).forEach((v) => (counts[v.site] = (counts[v.site] || 0) + 1));
  return sites.map((s) => ({ ...s, votes: counts[s.id] || 0 })).sort((a, b) => b.votes - a.votes || a.no - b.no);
}
function renderResultsInto(listId, metaId, withRemove) {
  if (!votes) { $(listId).innerHTML = '<p class="muted">Results appear when voting closes.</p>'; return; }
  const rows = ranked(), max = Math.max(1, ...rows.map((r) => r.votes)), total = votes.length;
  $(metaId).textContent = total + " hand" + (total === 1 ? "" : "s") + " · " + sites.length + " sites";
  $(listId).innerHTML = rows.length ? rows.map((r, i) => '<div class="rrow' + (i === 0 && r.votes > 0 ? " top" : "") + '"><div class="rank">' + (i + 1) + '</div><div><div><b>#' + r.no + "</b> " + esc(r.name) + (withRemove ? ' <button class="del" data-del="' + r.id + '">remove</button>' : "") + '</div><div class="bar"><i style="width:' + (100 * r.votes / max) + '%"></i></div></div><div class="count">' + r.votes + "</div></div>").join("") : '<p class="muted">No sites yet.</p>';
}

// ---------- organiser ----------
function renderAdmin() {
  if ($("vAdmin").hidden) return;
  const p = phase();
  $("stSites").textContent = sites.length; $("stVotes").textContent = votes ? votes.length : 0;
  $("stPhase").textContent = { submit: "Submissions", vote: "Voting", closed: "Closed" }[p];
  $("phVote").disabled = p === "vote"; $("phClosed").disabled = p !== "vote"; $("phSubmit").hidden = p === "submit"; $("showReveal").hidden = p !== "closed";
  $("phVote").querySelector(".bb-s").textContent = p === "vote" ? "Voting is open" : p === "closed" ? "Reopen the vote" : "Opens the gallery to everyone";
  $("fastest").innerHTML = sites.length ? sites.slice(0, 5).map((s, i) => '<div class="rrow' + (i === 0 ? " top" : "") + '"><div class="rank">' + (i + 1) + '</div><div><b>#' + s.no + "</b> " + esc(s.name) + ' <a href="' + esc(s.url) + '" target="_blank" rel="noopener" class="muted">open ↗</a></div><div class="count time">' + fmtTime(s.createdAt) + "</div></div>").join("") : '<p class="muted">No submissions yet.</p>';
  renderResultsInto("adminResults", "adminMeta", true);
}
const setPhase = async (ph) => { try { await updateDoc(doc(db, "config", "settings"), { phase: ph, updatedAt: serverTimestamp() }); toast({ submit: "Back to submissions. Gallery hidden.", vote: "Voting started. Everyone can see the gallery now.", closed: "Voting closed. Results are public." }[ph]); } catch (e) { toast(friendly(e)); } };
$("phSubmit").onclick = () => setPhase("submit");
$("phVote").onclick = () => setPhase("vote");
$("phClosed").onclick = () => setPhase("closed");
$("adminResults").onclick = async (e) => {
  const b = e.target.closest("[data-del]"); if (!b) return;
  if (b.dataset.armed !== "1") { b.dataset.armed = "1"; b.textContent = "really remove?"; setTimeout(() => { if (b.isConnected) { b.dataset.armed = ""; b.textContent = "remove"; } }, 8000); return; }
  try { await deleteDoc(doc(db, "sites", b.dataset.del)); toast("Removed."); } catch (e2) { toast(friendly(e2)); }
};
$("resetAll").onclick = () => { $("sheetCounts").textContent = sites.length + " site" + (sites.length === 1 ? "" : "s") + " and " + (votes ? votes.length : 0) + " hand" + ((votes ? votes.length : 0) === 1 ? "" : "s"); $("sheetBg").hidden = false; };
$("sheetCancel").onclick = () => ($("sheetBg").hidden = true);
$("sheetBg").onclick = (e) => { if (e.target === $("sheetBg")) $("sheetBg").hidden = true; };
$("sheetConfirm").onclick = async () => {
  const b = $("sheetConfirm"); b.disabled = true; b.textContent = "Deleting…";
  try {
    const [vs, ss] = await Promise.all([getDocs(collection(db, "votes")), getDocs(collection(db, "sites"))]);
    const refs = [...vs.docs, ...ss.docs].map((d) => d.ref);
    for (let i = 0; i < refs.length; i += 400) { const batch = writeBatch(db); refs.slice(i, i + 400).forEach((r) => batch.delete(r)); await batch.commit(); }
    await updateDoc(doc(db, "config", "settings"), { phase: "submit", updatedAt: serverTimestamp() });
    toast("Reset done: " + ss.size + " sites and " + vs.size + " hands removed.");
  } catch (e) { toast(friendly(e)); }
  b.disabled = false; b.textContent = "Delete everything"; $("sheetBg").hidden = true;
};
$("showReveal").onclick = () => showReveal();

// ---------- winner reveal + confetti ----------
function showReveal() {
  const rows = ranked(); if (!rows.length) return;
  const w = rows[0], tie = rows.filter((r) => r.votes === w.votes).length;
  $("revealNum").textContent = "#" + w.no; $("revealName").textContent = w.name;
  $("revealUrl").textContent = w.url.replace(/^https?:\/\//, "") + " ↗"; $("revealUrl").href = w.url;
  $("revealVotes").textContent = w.votes + " hand" + (w.votes === 1 ? "" : "s") + (tie > 1 ? " · tied with " + (tie - 1) + " other" + (tie > 2 ? "s" : "") + ", #" + w.no + " submitted first" : "");
  $("revealRunners").innerHTML = rows.slice(1, 3).map((r, i) => '<span><b>' + (i + 2) + '</b> #' + r.no + " " + esc(r.name) + " · " + r.votes + "</span>").join("");
  $("reveal").hidden = false; confetti();
}
$("revealClose").onclick = () => { $("reveal").hidden = true; stopConfetti(); if (!isAdmin()) { tab = "gallery"; render(); } };
let confettiRaf = 0;
function stopConfetti() { cancelAnimationFrame(confettiRaf); confettiRaf = 0; }
function confetti() {
  const c = $("confetti"), ctx = c.getContext("2d"); let W = c.width = innerWidth, H = c.height = innerHeight;
  const colors = ["#0066CC", "#0A84FF", "#FF9F0A", "#FF375F", "#30D158", "#BF5AF2", "#FFD60A"];
  const ps = Array.from({ length: 220 }, () => ({ x: Math.random() * W, y: -20 - Math.random() * H * 0.6, w: 6 + Math.random() * 8, h: 8 + Math.random() * 10, c: colors[(Math.random() * colors.length) | 0], vy: 2 + Math.random() * 3.5, vx: -1.2 + Math.random() * 2.4, r: Math.random() * Math.PI, vr: -0.12 + Math.random() * 0.24 }));
  const t0 = performance.now();
  stopConfetti();
  const step = (t) => {
    ctx.clearRect(0, 0, W, H);
    ps.forEach((p) => { p.x += p.vx + Math.sin((t + p.y) / 300) * 0.6; p.y += p.vy; p.r += p.vr; if (p.y > H + 20 && t - t0 < 6000) { p.y = -20; p.x = Math.random() * W; }
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.fillStyle = p.c; ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h); ctx.restore(); });
    if (t - t0 < 9000) confettiRaf = requestAnimationFrame(step); else ctx.clearRect(0, 0, W, H);
  };
  confettiRaf = requestAnimationFrame(step);
  onresize = () => { W = c.width = innerWidth; H = c.height = innerHeight; };
}
$("aSave").onclick = async () => {
  err("aErr", null);
  try { await updateDoc(doc(db, "config", "settings"), { title: $("aTitle").value.trim() || "Build Battle", updatedAt: serverTimestamp() }); toast("Saved."); } catch (e) { err("aErr", e); }
};
