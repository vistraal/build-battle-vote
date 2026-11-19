import { firebaseConfig } from "./firebase-config.js";

// The one organiser. Must match organiser() in firestore.rules.
const ORGANISER = "contactpavankumarmeduri@gmail.com";
const GRACE_MIN = 10;

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
let toastT;
const toast = (t) => { const el = $("toast"); el.textContent = t; el.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => (el.hidden = true), 3200); };
const err = (id, e) => { const el = $(id); el.textContent = friendly(e); el.hidden = !e; };
const friendly = (e) => {
  if (!e) return "";
  const m = e.code || e.message || String(e);
  if (/permission-denied|insufficient/i.test(m)) return "Not allowed right now: the timer may be over, or this isn't open yet.";
  if (/popup-closed|cancelled-popup/i.test(m)) return "Sign-in window was closed. Try again.";
  if (/unauthorized-domain/i.test(m)) return "This domain is not authorised in Firebase yet.";
  if (/already-exists/i.test(m)) return "You already raised your hand. One per person.";
  return e.message || m;
};
const thumb = (url) => "https://s0.wp.com/mshots/v1/" + encodeURIComponent(url) + "?w=320";
const fmtTime = (ts) => { const d = ts?.toDate?.(); return d ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "—"; };
const ms = (ts) => (ts?.toMillis ? ts.toMillis() : ts ? +new Date(ts) : 0);
const mmss = (left) => { const s = Math.max(0, Math.ceil(left / 1000)); return String(Math.floor(s / 60)).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0"); };

if (!firebaseConfig.apiKey) { $("vSetup").hidden = false; throw new Error("firebase-config.js is empty"); }

const FB = "https://www.gstatic.com/firebasejs/10.14.1/";
const [{ initializeApp }, { getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult, onAuthStateChanged, signOut }, { getFirestore, doc, getDoc, setDoc, updateDoc, deleteDoc, collection, onSnapshot, getDocs, writeBatch, serverTimestamp, Timestamp }] =
  await Promise.all([import(FB + "firebase-app.js"), import(FB + "firebase-auth.js"), import(FB + "firebase-firestore.js")]);

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: "select_account" });

// ---------- state ----------
let user = null, cfg = null, sites = [], votes = null, myVote = null, mine = null, tab = "mine", editing = false, lastPhase = null, autoClosed = false;
const subs = {};
const unsubAll = () => { Object.keys(subs).forEach((k) => { subs[k] && subs[k](); delete subs[k]; }); };
const isAdmin = () => !!user && (user.email || "").toLowerCase() === ORGANISER;
const phase = () => cfg?.phase || "submit";
const firstName = (u) => (u.displayName || u.email || "").split(/[ @]/)[0] || "You";
const now = () => Date.now();
// timers (mirror of the rules)
const subEnds = () => ms(cfg?.submitEndsAt), graceEnds = () => ms(cfg?.graceEndsAt), voteEnds = () => ms(cfg?.voteEndsAt);
const submissionsOpen = () => phase() === "submit" && (!subEnds() || now() < subEnds() || (graceEnds() && now() < graceEnds()));
const votingOpen = () => phase() === "vote" && (!voteEnds() || now() < voteEnds());

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
  sites = []; votes = null; myVote = null; mine = null; cfg = null; lastPhase = null;
  $("me").hidden = !u; $("tabs").hidden = !u; $("status").hidden = true;
  allViews.forEach((v) => ($(v).hidden = true));
  if (!u) { $("vSignIn").hidden = false; return; }
  $("meName").textContent = firstName(u);
  document.querySelectorAll(".tab.stu").forEach((b) => (b.hidden = isAdmin()));
  document.querySelectorAll(".tab.org").forEach((b) => (b.hidden = !isAdmin()));
  const cref = doc(db, "config", "settings");
  if (isAdmin()) {
    const snap = await getDoc(cref).catch(() => null);
    const d = snap?.exists() ? snap.data() : null;
    if (!d || !["submit", "vote", "closed"].includes(d.phase)) await setDoc(cref, { phase: "submit", title: d?.title || "Build Battle", updatedAt: serverTimestamp() }).catch((e) => toast(friendly(e)));
  }
  subs.cfg = onSnapshot(cref, (s) => { cfg = s.data() || { phase: "submit", title: "Build Battle" }; applyCfg(); subscribe(); render(); }, (e) => toast(friendly(e)));
  subs.myVote = onSnapshot(doc(db, "votes", u.uid), (s) => { myVote = s.exists() ? s.data().site : null; render(); }, () => {});
  tab = isAdmin() ? "control" : "mine";
});

const allViews = ["vSignIn", "vMine", "vGallery", "vSubs", "vVoting", "vControl", "vW1", "vW2", "vW3", "vWinners"];
const tabView = { mine: "vMine", gallery: "vGallery", subs: "vSubs", voting: "vVoting", control: "vControl", w1: "vW1", w2: "vW2", w3: "vW3", winners: "vWinners" };

function applyCfg() {
  $("title").textContent = cfg.title || "Build Battle";
  document.title = (cfg.title || "Build Battle") + " · Vote";
  $("aTitle").value = cfg.title || "";
  if (cfg.submitMinutes) $("subMin").value = cfg.submitMinutes;
  if (cfg.voteMinutes) $("voteMin").value = cfg.voteMinutes;
}

function subscribe() {
  const wantAll = isAdmin() || phase() !== "submit";
  if (wantAll && !subs.sitesAll) {
    subs.sitesOwn && subs.sitesOwn(); delete subs.sitesOwn;
    subs.sitesAll = onSnapshot(collection(db, "sites"), (qs) => setSites(qs.docs.map((d) => ({ id: d.id, ...d.data() }))), (e) => toast(friendly(e)));
  } else if (!wantAll && !subs.sitesOwn) {
    subs.sitesAll && subs.sitesAll(); delete subs.sitesAll;
    subs.sitesOwn = onSnapshot(doc(db, "sites", user.uid), (s) => setSites(s.exists() ? [{ id: s.id, ...s.data() }] : []), () => {});
  }
  const wantVotes = isAdmin() || phase() === "closed";
  if (wantVotes && !subs.votes) subs.votes = onSnapshot(collection(db, "votes"), (qs) => { votes = qs.docs.map((d) => ({ voter: d.id, ...d.data() })); render(); }, () => { votes = []; render(); });
  else if (!wantVotes && subs.votes) { subs.votes(); delete subs.votes; votes = null; }
}
function setSites(list) {
  sites = list.sort((a, b) => ms(a.createdAt) - ms(b.createdAt) || a.id.localeCompare(b.id));
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
  document.querySelectorAll(".tab").forEach((b) => b.classList.toggle("on", b.dataset.tab === tab && !b.hidden));
  allViews.forEach((v) => ($(v).hidden = true)); $(tabView[tab] || "vGallery").hidden = false;
  document.body.classList.toggle("stage-on", admin && ["subs", "voting", "w1", "w2", "w3", "winners"].includes(tab));

  const st = $("status"); st.hidden = admin && tab !== "control" && tab !== "gallery";
  if (p === "submit") { st.className = "banner warn"; st.textContent = !submissionsOpen() ? "Submissions are closed. The gallery opens when voting starts." : mine ? "Submissions open. Your entry is in. The gallery opens when voting starts." : "Submissions open. Add your site under My site. The gallery opens when voting starts."; }
  else if (p === "vote") {
    if (myVote) { const t = sites.find((s) => s.id === myVote); st.className = "banner ok"; st.textContent = "Your hand is up for #" + (t?.no ?? "?") + " " + (t?.name ?? "") + ". One hand per person."; }
    else if (!votingOpen()) { st.className = "banner closed"; st.textContent = "Time's up. Hands are frozen; waiting for the reveal."; }
    else if (admin) { st.className = "banner"; st.textContent = "Voting is open. " + mmss(voteEnds() - now()) + " left."; }
    else if (!mine) { st.className = "banner warn"; st.textContent = "Voting is open, but only entrants can raise a hand."; }
    else { st.className = "banner"; st.textContent = "Voting is open. Open a few sites, then raise your hand once. Not for your own."; }
  } else { st.className = "banner closed"; st.textContent = "Voting is closed. The class has chosen."; }

  if (!admin && p === "closed" && lastPhase && lastPhase !== "closed") showReveal();
  if (admin && p === "closed" && lastPhase && lastPhase !== "closed") { tab = "w1"; allViews.forEach((v) => ($(v).hidden = true)); $("vW1").hidden = false; document.querySelectorAll(".tab").forEach((b) => b.classList.toggle("on", b.dataset.tab === "w1")); }
  lastPhase = p;

  renderMine(); renderGallery();
  if (admin) { renderControl(); renderStages(); }
}

// ---------- student: my site ----------
function renderMine() {
  if ($("vMine").hidden) return;
  const open = submissionsOpen(), showForm = !mine || editing;
  $("mineCard").hidden = showForm; $("mineForm").hidden = !showForm;
  $("rCancel").hidden = !mine;
  $("mineTitle").textContent = mine ? "Edit your site" : "Add your site";
  $("mineLead").textContent = open ? "Your published site goes into the gallery. You need an entry to raise your hand later." : "Submissions are closed now.";
  $("rSave").disabled = !open;
  if (showForm && !$("rName").value && !$("rUrl").value) { $("rName").value = mine?.name || user.displayName || ""; $("rUrl").value = mine?.url || ""; }
  if (mine) $("mineView").innerHTML = rowHTML(mine, '<div class="muted">Submitted ' + fmtTime(mine.createdAt) + "</div>");
  $("editMine").hidden = !open;
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

// ---------- gallery ----------
const rowHTML = (s, extra) => '<a class="thumb" href="' + esc(s.url) + '" target="_blank" rel="noopener"><img loading="lazy" src="' + thumb(s.url) + '" alt=""></a><div class="row-main"><div class="num">#' + s.no + '</div><div class="name">' + esc(s.name) + '</div><a class="url" href="' + esc(s.url) + '" target="_blank" rel="noopener">' + esc(s.url.replace(/^https?:\/\//, "")) + " ↗</a>" + (extra || "") + "</div>";
$("q").oninput = renderGallery;
let thumbRetry = 0;
function renderGallery() {
  if ($("vGallery").hidden) return;
  const p = phase(), admin = isAdmin(), open = admin || p !== "submit";
  $("galleryLocked").hidden = open; $("galleryOpen").hidden = !open;
  $("vResults").hidden = !(p === "closed" || (admin && votes));
  if (!open) { $("lockCount").textContent = mine ? "Your entry: #" + mine.no + " " + mine.name : ""; return; }
  const q = $("q").value.trim().toLowerCase();
  const rows = sites.filter((s) => !q || String(s.no) === q.replace("#", "") || s.name.toLowerCase().includes(q));
  $("galleryCount").textContent = sites.length + " site" + (sites.length === 1 ? "" : "s");
  const canRaise = votingOpen() && !myVote && !admin && !!mine;
  $("list").innerHTML = rows.length ? rows.map((s) => {
    const isMine = s.id === user.uid;
    let act = "";
    if (isMine) act = '<span class="tag">Your site</span>';
    else if (myVote === s.id) act = '<span class="hand up">✋ Hand raised</span>';
    else if (canRaise) act = '<button class="hand" data-vote="' + s.id + '">✋ Raise hand</button>';
    else if (votingOpen() && !myVote && !admin && !mine) act = '<span class="tag">Entrants only</span>';
    return '<div class="row-item' + (isMine ? " mine" : "") + '">' + rowHTML(s) + '<div class="row-act">' + act + "</div></div>";
  }).join("") : '<p class="muted">No sites yet.</p>';
  if (!$("vResults").hidden) renderResultsInto("results", "resultsMeta", false);
  $("resultsTitle").textContent = p === "closed" ? "Results" : "Live standings";
  clearTimeout(thumbRetry); thumbRetry = setTimeout(() => document.querySelectorAll("#list .thumb img, #mineView .thumb img").forEach((i) => { i.src = i.src.split("&r=")[0] + "&r=" + Date.now(); }), 12000);
}
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

// ---------- organiser: control ----------
function renderControl() {
  if ($("vControl").hidden) return;
  const p = phase();
  $("stSites").textContent = sites.length; $("stVotes").textContent = votes ? votes.length : 0;
  $("stPhase").textContent = { submit: "Submissions", vote: "Voting", closed: "Closed" }[p];
  const se = subEnds(), ge = graceEnds();
  $("ctlSubState").textContent = p !== "submit" ? "· phase over" : !se ? "· no timer, open" : now() < se ? "· " + mmss(se - now()) + " left" : ge && now() < ge ? "· grace, " + mmss(ge - now()) + " left" : "· closed";
  $("subStart").disabled = p !== "submit"; $("graceStart").disabled = p !== "submit" || !se || (ge && now() < ge); $("subStop").disabled = p !== "submit" || !se;
  $("phVote").disabled = p === "vote"; $("phClosed").disabled = p !== "vote"; $("phSubmit").hidden = p === "submit";
  $("phVoteSub").textContent = p === "vote" ? "Voting is open · " + (votingOpen() ? mmss(voteEnds() - now()) + " left" : "time's up") : p === "closed" ? "Reopen the vote (new timer)" : "Opens the gallery and starts the vote timer";
  $("fastest").innerHTML = sites.length ? sites.slice(0, 5).map((s, i) => '<div class="rrow' + (i === 0 ? " top" : "") + '"><div class="rank">' + (i + 1) + '</div><div><b>#' + s.no + "</b> " + esc(s.name) + ' <a href="' + esc(s.url) + '" target="_blank" rel="noopener" class="muted">open ↗</a></div><div class="count time">' + fmtTime(s.createdAt) + "</div></div>").join("") : '<p class="muted">No submissions yet.</p>';
  renderResultsInto("adminResults", "adminMeta", true);
}
const inMin = (n) => Timestamp.fromMillis(Date.now() + n * 60000);
const save = async (data, msg) => { try { await updateDoc(doc(db, "config", "settings"), { ...data, updatedAt: serverTimestamp() }); if (msg) toast(msg); } catch (e) { toast(friendly(e)); } };
$("subStart").onclick = () => { const m = Math.max(1, +$("subMin").value || 45); save({ submitEndsAt: inMin(m), graceEndsAt: null, submitMinutes: m }, "Submission timer: " + m + " min."); };
$("graceStart").onclick = () => save({ graceEndsAt: inMin(GRACE_MIN) }, "Grace period: " + GRACE_MIN + " more minutes.");
$("subStop").onclick = () => save({ submitEndsAt: null, graceEndsAt: null }, "Timer cleared. Submissions open.");
$("phVote").onclick = () => { const m = Math.max(1, +$("voteMin").value || 10); autoClosed = false; save({ phase: "vote", voteEndsAt: inMin(m), voteMinutes: m }, "Voting started: " + m + " min."); };
$("phClosed").onclick = () => save({ phase: "closed" }, "Voting closed.");
$("phSubmit").onclick = () => save({ phase: "submit", voteEndsAt: null }, "Back to submissions.");
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
    await updateDoc(doc(db, "config", "settings"), { phase: "submit", submitEndsAt: null, graceEndsAt: null, voteEndsAt: null, updatedAt: serverTimestamp() });
    toast("Reset done: " + ss.size + " sites and " + vs.size + " hands removed.");
  } catch (e) { toast(friendly(e)); }
  b.disabled = false; b.textContent = "Delete everything"; $("sheetBg").hidden = true;
};
$("aSave").onclick = () => save({ title: $("aTitle").value.trim() || "Build Battle" }, "Saved.");

// ---------- organiser: projector stages ----------
let lastCount = -1, w1Conf = false;
function renderStages() {
  const p = phase();
  // Submissions
  if (!$("vSubs").hidden) {
    const el = $("subCount"), n = sites.length;
    if (n !== lastCount) { el.textContent = n; el.classList.remove("bump"); void el.offsetWidth; el.classList.add("bump"); lastCount = n; }
    const se = subEnds(), ge = graceEnds(), t = $("subTimer");
    if (p !== "submit") { t.textContent = "closed"; t.className = "stage-timer over"; }
    else if (!se) { t.textContent = "open"; t.className = "stage-timer"; }
    else if (now() < se) { t.textContent = mmss(se - now()); t.className = "stage-timer" + (se - now() < 60000 ? " urgent" : ""); }
    else if (ge && now() < ge) { t.textContent = "grace " + mmss(ge - now()); t.className = "stage-timer urgent"; }
    else { t.textContent = "closed"; t.className = "stage-timer over"; }
  }
  // Voting
  if (!$("vVoting").hidden) {
    const ve = voteEnds(), t = $("voteTimer");
    if (p !== "vote") { t.textContent = p === "closed" ? "closed" : "not yet"; t.className = "stage-timer huge over"; $("voteLabel").textContent = p === "closed" ? "voting is over" : "voting hasn't started"; }
    else if (!ve) { t.textContent = "open"; t.className = "stage-timer huge"; $("voteLabel").textContent = "voting"; }
    else if (now() < ve) { t.textContent = mmss(ve - now()); t.className = "stage-timer huge" + (ve - now() < 60000 ? " urgent" : ""); $("voteLabel").textContent = "raise your hand"; }
    else { t.textContent = "00:00"; t.className = "stage-timer huge over"; $("voteLabel").textContent = "time's up"; }
    $("voteCount").textContent = votes ? votes.length : 0;
  }
  // Winners
  const rows = votes ? ranked() : [];
  const fill = (i, nameId, metaId) => { const r = rows[i]; $(nameId).textContent = r ? r.name : "—"; $(metaId).textContent = r ? "#" + r.no + " · " + r.votes + " hand" + (r.votes === 1 ? "" : "s") : (votes ? "no entry" : "after the reveal"); };
  fill(0, "w1Name", "w1Meta"); fill(1, "w2Name", "w2Meta"); fill(2, "w3Name", "w3Meta");
  if (!$("vW1").hidden && rows.length && !w1Conf) { w1Conf = true; confetti($("confetti")); }
  if ($("vW1").hidden && w1Conf) { w1Conf = false; stopConfetti(); }
  if (!$("vWinners").hidden) $("podium").innerHTML = rows.slice(0, 10).map((r, i) => '<div class="pod' + (i < 3 ? " top" : "") + '"><span class="pr">' + (i + 1) + '</span><span class="pn">' + esc(r.name) + '</span><span class="pc">' + r.votes + "</span></div>").join("") || '<p class="muted">After the reveal.</p>';
}
// tick every second for timers; auto-close the vote when its timer ends (organiser only)
setInterval(() => {
  if (!user || !cfg) return;
  if (isAdmin()) {
    renderControl(); renderStages();
    if (phase() === "vote" && voteEnds() && now() >= voteEnds() && !autoClosed) { autoClosed = true; save({ phase: "closed" }, "Time's up. Voting closed."); }
    if (!$("status").hidden) render();
  } else if (phase() !== "closed") { renderGallery(); renderMine(); const st = $("status"); if (!st.hidden) render(); }
}, 1000);

// ---------- student winner card ----------
function showReveal() {
  const rows = ranked(); if (!rows.length) return;
  const w = rows[0];
  $("revealNum").textContent = "#" + w.no; $("revealName").textContent = w.name;
  $("revealUrl").textContent = w.url.replace(/^https?:\/\//, "") + " ↗"; $("revealUrl").href = w.url;
  $("revealVotes").textContent = w.votes + " hand" + (w.votes === 1 ? "" : "s");
  $("revealRunners").innerHTML = rows.slice(1, 3).map((r, i) => '<span><b>' + (i + 2) + "</b> #" + r.no + " " + esc(r.name) + " · " + r.votes + "</span>").join("");
  $("reveal").hidden = false; confetti($("confetti2"));
}
$("revealClose").onclick = () => { $("reveal").hidden = true; stopConfetti(); tab = "gallery"; render(); };

// ---------- confetti ----------
let confettiRaf = 0;
function stopConfetti() { cancelAnimationFrame(confettiRaf); confettiRaf = 0; }
function confetti(c) {
  const ctx = c.getContext("2d"); let W = c.width = c.clientWidth || innerWidth, H = c.height = c.clientHeight || innerHeight;
  const colors = ["#0066CC", "#0A84FF", "#FF9F0A", "#FF375F", "#30D158", "#BF5AF2", "#FFD60A"];
  const ps = Array.from({ length: 220 }, () => ({ x: Math.random() * W, y: -20 - Math.random() * H * 0.6, w: 6 + Math.random() * 8, h: 8 + Math.random() * 10, c: colors[(Math.random() * colors.length) | 0], vy: 2 + Math.random() * 3.5, vx: -1.2 + Math.random() * 2.4, r: Math.random() * Math.PI, vr: -0.12 + Math.random() * 0.24 }));
  const t0 = performance.now(); stopConfetti();
  const step = (t) => {
    ctx.clearRect(0, 0, W, H);
    ps.forEach((p) => { p.x += p.vx + Math.sin((t + p.y) / 300) * 0.6; p.y += p.vy; p.r += p.vr; if (p.y > H + 20 && t - t0 < 6000) { p.y = -20; p.x = Math.random() * W; }
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.fillStyle = p.c; ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h); ctx.restore(); });
    if (t - t0 < 9000) confettiRaf = requestAnimationFrame(step); else { ctx.clearRect(0, 0, W, H); confettiRaf = 0; }
  };
  confettiRaf = requestAnimationFrame(step);
}
