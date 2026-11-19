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
let user = null, cfg = null, sites = [], votes = null, myVote = null, mine = null, tab = "mine", editing = false;
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
  $("tabAdmin").hidden = !isAdmin();
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
  tab = isAdmin() ? "admin" : "mine";
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
    if (myVote) { const t = sites.find((s) => s.id === myVote); st.className = "banner ok"; st.textContent = "Done. You voted for #" + (t?.no ?? "?") + " " + (t?.name ?? "") + ". One vote per person."; }
    else { st.className = "banner"; st.textContent = "Voting is open. Open a few sites, then vote once. You can't vote for your own."; }
  } else { st.className = "banner closed"; st.textContent = "Voting is closed. Here are the results."; }

  renderMine(); renderGallery(); if (admin) renderAdmin();
}

function renderMine() {
  if ($("vMine").hidden) return;
  const showForm = !mine || editing;
  $("mineCard").hidden = showForm; $("mineForm").hidden = !showForm;
  $("rSkip").hidden = !!mine; $("rCancel").hidden = !mine;
  $("mineTitle").textContent = mine ? "Edit your site" : "Add your site";
  $("mineLead").textContent = phase() === "closed" ? "Voting is closed; entries can't be changed now." : "Put your published site in the gallery. You can edit it any time before voting closes.";
  $("rSave").disabled = phase() === "closed";
  if (showForm && !$("rName").value && !$("rUrl").value) { $("rName").value = mine?.name || user.displayName || ""; $("rUrl").value = mine?.url || ""; }
  if (mine) $("mineView").innerHTML = '<div class="num">#' + mine.no + '</div><div class="name">' + esc(mine.name) + '</div><a href="' + esc(mine.url) + '" target="_blank" rel="noopener">' + esc(mine.url.replace(/^https?:\/\//, "")) + '</a><div class="muted">Submitted ' + fmtTime(mine.createdAt) + "</div>";
  $("editMine").hidden = phase() === "closed";
}
$("editMine").onclick = () => { editing = true; $("rName").value = mine.name; $("rUrl").value = mine.url; render(); };
$("rCancel").onclick = () => { editing = false; render(); };
$("rSkip").onclick = () => { tab = "gallery"; render(); };
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
  $("list").innerHTML = rows.length ? rows.map((s) => {
    const isMine = s.id === user.uid, canVote = p === "vote" && !myVote && !isMine;
    const btn = isMine ? '<span class="tag">Your site</span>' : myVote === s.id ? '<span class="tag">Your vote</span>' : canVote ? '<button class="primary small" data-vote="' + s.id + '">Vote</button>' : "";
    return '<article class="card' + (isMine ? " mine" : "") + '"><div class="num">#' + s.no + '</div><div class="name">' + esc(s.name) + '</div><a href="' + esc(s.url) + '" target="_blank" rel="noopener">' + esc(s.url.replace(/^https?:\/\//, "")) + '</a><div class="actions"><a href="' + esc(s.url) + '" target="_blank" rel="noopener">Open ↗</a>' + btn + "</div></article>";
  }).join("") : '<p class="muted">No sites yet.</p>';
  if (!$("vResults").hidden) renderResultsInto("results", "resultsMeta", false);
  $("resultsTitle").textContent = p === "closed" ? "Results" : "Live results";
}
$("list").onclick = async (e) => {
  const b = e.target.closest("[data-vote]"); if (!b) return;
  const target = sites.find((s) => s.id === b.dataset.vote); if (!target) return;
  if (b.dataset.armed !== "1") { b.dataset.armed = "1"; b.textContent = "Confirm vote for #" + target.no; setTimeout(() => { if (b.isConnected) { b.dataset.armed = ""; b.textContent = "Vote"; } }, 8000); return; }
  b.disabled = true;
  try { await setDoc(doc(db, "votes", user.uid), { site: target.id, createdAt: serverTimestamp() }); toast("Voted for #" + target.no + " " + target.name); }
  catch (e2) { toast(friendly(e2)); b.disabled = false; b.textContent = "Vote"; }
};

function ranked() {
  const counts = {}; (votes || []).forEach((v) => (counts[v.site] = (counts[v.site] || 0) + 1));
  return sites.map((s) => ({ ...s, votes: counts[s.id] || 0 })).sort((a, b) => b.votes - a.votes || a.no - b.no);
}
function renderResultsInto(listId, metaId, withRemove) {
  if (!votes) { $(listId).innerHTML = '<p class="muted">Results appear when voting closes.</p>'; return; }
  const rows = ranked(), max = Math.max(1, ...rows.map((r) => r.votes)), total = votes.length;
  $(metaId).textContent = total + " vote" + (total === 1 ? "" : "s") + " · " + sites.length + " sites";
  $(listId).innerHTML = rows.length ? rows.map((r, i) => '<div class="rrow' + (i === 0 && r.votes > 0 ? " top" : "") + '"><div class="rank">' + (i + 1) + '</div><div><div><b>#' + r.no + "</b> " + esc(r.name) + (withRemove ? ' <button class="del" data-del="' + r.id + '">remove</button>' : "") + '</div><div class="bar"><i style="width:' + (100 * r.votes / max) + '%"></i></div></div><div class="count">' + r.votes + "</div></div>").join("") : '<p class="muted">No sites yet.</p>';
}

// ---------- organiser ----------
function renderAdmin() {
  if ($("vAdmin").hidden) return;
  const p = phase();
  $("stSites").textContent = sites.length; $("stVotes").textContent = votes ? votes.length : 0;
  $("stPhase").textContent = { submit: "Submissions", vote: "Voting", closed: "Closed" }[p];
  [["phSubmit", "submit"], ["phVote", "vote"], ["phClosed", "closed"]].forEach(([id, ph]) => { $(id).classList.toggle("on", p === ph); });
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
$("resetAll").onclick = async () => {
  const b = $("resetAll");
  if (b.dataset.armed !== "1") { b.dataset.armed = "1"; b.classList.add("armed"); b.textContent = "Tap again to delete everything"; setTimeout(() => { if (b.isConnected) { b.dataset.armed = ""; b.classList.remove("armed"); b.textContent = "Reset…"; } }, 8000); return; }
  b.disabled = true; b.textContent = "Resetting…";
  try {
    const [vs, ss] = await Promise.all([getDocs(collection(db, "votes")), getDocs(collection(db, "sites"))]);
    const refs = [...vs.docs, ...ss.docs].map((d) => d.ref);
    for (let i = 0; i < refs.length; i += 400) { const batch = writeBatch(db); refs.slice(i, i + 400).forEach((r) => batch.delete(r)); await batch.commit(); }
    await updateDoc(doc(db, "config", "settings"), { phase: "submit", updatedAt: serverTimestamp() });
    toast("Reset done: " + ss.size + " sites and " + vs.size + " votes removed. Back to Submissions.");
  } catch (e) { toast(friendly(e)); }
  b.disabled = false; b.dataset.armed = ""; b.classList.remove("armed"); b.textContent = "Reset…";
};
$("aSave").onclick = async () => {
  err("aErr", null);
  try { await updateDoc(doc(db, "config", "settings"), { title: $("aTitle").value.trim() || "Build Battle", updatedAt: serverTimestamp() }); toast("Saved."); } catch (e) { err("aErr", e); }
};
