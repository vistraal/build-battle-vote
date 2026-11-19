import { firebaseConfig } from "./firebase-config.js";

const $ = (id) => document.getElementById(id);
const views = ["vSetup", "vSignIn", "vFirstRun", "vRegister", "vGallery", "vResults", "vAdmin"];
const show = (...ids) => views.forEach((v) => ($(v).hidden = !ids.includes(v)));
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
let toastT;
const toast = (t) => { const el = $("toast"); el.textContent = t; el.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => (el.hidden = true), 3200); };
const err = (id, e) => { const el = $(id); el.textContent = friendly(e); el.hidden = !e; };
const friendly = (e) => {
  if (!e) return "";
  const m = e.code || e.message || String(e);
  if (/permission-denied|insufficient/i.test(m)) return "Not allowed. Check: signed in with the right account, voting is open, and you are not voting for yourself.";
  if (/popup-closed|cancelled-popup/i.test(m)) return "Sign-in window was closed. Try again.";
  if (/unauthorized-domain/i.test(m)) return "This domain is not authorised in Firebase yet (Authentication → Settings → Authorized domains).";
  if (/already-exists/i.test(m)) return "You already voted. One vote per person.";
  return e.message || m;
};

// ---------- not configured yet ----------
if (!firebaseConfig.apiKey) { show("vSetup"); throw new Error("firebase-config.js is empty"); }

// Firebase SDK (loaded only once the config exists, so an unconfigured deploy still shows the screen above)
const FB = "https://www.gstatic.com/firebasejs/10.14.1/";
const [{ initializeApp }, { getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult, onAuthStateChanged, signOut }, { getFirestore, doc, getDoc, setDoc, updateDoc, deleteDoc, collection, onSnapshot, getDocs, writeBatch, serverTimestamp }] =
  await Promise.all([import(FB + "firebase-app.js"), import(FB + "firebase-auth.js"), import(FB + "firebase-firestore.js")]);

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: "select_account" });

let user = null, cfg = null, sites = [], votes = null, myVote = null, mine = null, unsubSites = null, unsubCfg = null, unsubVotes = null, unsubMyVote = null;
const isAdmin = () => !!(user && cfg && (cfg.admins || []).map((a) => a.toLowerCase()).includes((user.email || "").toLowerCase()));
const domainOk = () => !cfg?.allowedDomain || (user?.email || "").toLowerCase().endsWith("@" + cfg.allowedDomain.toLowerCase());

// ---------- auth ----------
$("signIn").onclick = async () => {
  err("signInErr", null);
  try { await signInWithPopup(auth, provider); }
  catch (e) { if (/popup-blocked|operation-not-supported/i.test(e.code || "")) { await signInWithRedirect(auth, provider); } else err("signInErr", e); }
};
$("signOut").onclick = () => signOut(auth);
getRedirectResult(auth).catch((e) => err("signInErr", e));

onAuthStateChanged(auth, async (u) => {
  user = u;
  $("me").hidden = !u;
  $("meEmail").textContent = u?.email || "";
  [unsubSites, unsubCfg, unsubVotes, unsubMyVote].forEach((f) => f && f());
  unsubSites = unsubCfg = unsubVotes = unsubMyVote = null;
  if (!u) { cfg = null; show("vSignIn"); return; }
  // config: first run or not
  const cref = doc(db, "config", "settings");
  const snap = await getDoc(cref).catch((e) => { err("signInErr", e); return null; });
  if (snap && !snap.exists()) { show("vFirstRun"); return; }
  unsubCfg = onSnapshot(cref, (s) => { cfg = s.data(); applyCfg(); route(); }, (e) => toast(friendly(e)));
});

// ---------- first run ----------
$("fCreate").onclick = async () => {
  err("fErr", null);
  try {
    await setDoc(doc(db, "config", "settings"), { admins: [user.email.toLowerCase()], open: true, allowedDomain: $("fDomain").value.trim().toLowerCase(), title: $("fTitle").value.trim() || "Build Battle" });
    toast("You are the organiser.");
    unsubCfg = onSnapshot(doc(db, "config", "settings"), (s) => { cfg = s.data(); applyCfg(); route(); });
  } catch (e) { err("fErr", e); }
};

function applyCfg() {
  $("title").textContent = cfg.title || "Build Battle";
  document.title = (cfg.title || "Build Battle") + " · Vote";
  $("aTitle").value = cfg.title || ""; $("aDomain").value = cfg.allowedDomain || ""; $("aAdmins").value = (cfg.admins || []).join(", ");
  $("toggleOpen").textContent = cfg.open ? "Close voting" : "Reopen voting";
  $("domainNote").hidden = !cfg.allowedDomain; $("domainNote").textContent = cfg.allowedDomain ? "Use your @" + cfg.allowedDomain + " account." : "";
}

// ---------- routing ----------
function route() {
  if (!domainOk()) { show("vSignIn"); err("signInErr", { message: "Sign in with your @" + cfg.allowedDomain + " account. You are signed in as " + user.email + "." }); return; }
  if (!unsubSites) {
    unsubSites = onSnapshot(collection(db, "sites"), (qs) => {
      sites = qs.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (a.createdAt?.toMillis?.() || 0) - (b.createdAt?.toMillis?.() || 0) || a.id.localeCompare(b.id));
      sites.forEach((s, i) => (s.no = i + 1));
      mine = sites.find((s) => s.id === user.uid) || null;
      route();
      if (votes) renderResults();
    }, (e) => toast(friendly(e)));
    unsubMyVote = onSnapshot(doc(db, "votes", user.uid), (s) => { myVote = s.exists() ? s.data().site : null; renderGallery(); }, () => {});
    return;
  }
  const skipped = sessionStorage_get("skipRegister");
  if (!mine && !skipped && !isAdmin()) { show("vRegister"); return; }
  const admin = isAdmin();
  const showResults = admin || cfg.open === false;
  show("vGallery", ...(showResults ? ["vResults"] : []), ...(admin ? ["vAdmin"] : []));
  if (showResults && !unsubVotes) {
    unsubVotes = onSnapshot(collection(db, "votes"), (qs) => { votes = qs.docs.map((d) => ({ voter: d.id, ...d.data() })); renderResults(); }, (e) => { votes = []; renderResults(); if (admin) toast(friendly(e)); });
  }
  if (!showResults && unsubVotes) { unsubVotes(); unsubVotes = null; votes = null; }
  renderGallery();
  renderResults();
}
function sessionStorage_get(k) { try { return sessionStorage.getItem(k); } catch { return null; } }
function sessionStorage_set(k, v) { try { sessionStorage.setItem(k, v); } catch {} }

// ---------- register / edit my site ----------
function openRegister() {
  $("rName").value = mine?.name || user.displayName || ""; $("rUrl").value = mine?.url || "";
  $("rSkip").hidden = !!mine; err("rErr", null); show("vRegister");
}
$("editMine").onclick = openRegister;
$("rSkip").onclick = () => { sessionStorage_set("skipRegister", "1"); route(); };
$("rSave").onclick = async () => {
  const name = $("rName").value.trim(), url = $("rUrl").value.trim();
  if (name.length < 2) return err("rErr", { message: "Type your name." });
  if (!/^https?:\/\/[^\s]{3,}$/i.test(url)) return err("rErr", { message: "Paste the full link, starting with https://" });
  err("rErr", null); $("rSave").disabled = true;
  try {
    const wasNew = !mine;
    const data = { name, url };
    if (wasNew) data.createdAt = serverTimestamp();
    await setDoc(doc(db, "sites", user.uid), data, { merge: true });
    toast(wasNew ? "Your site is in the gallery." : "Updated.");
    sessionStorage_set("skipRegister", "1");
  } catch (e) { err("rErr", e); }
  $("rSave").disabled = false;
};

// ---------- gallery ----------
$("q").oninput = renderGallery;
function renderGallery() {
  if ($("vGallery").hidden) return;
  const st = $("status");
  if (cfg.open === false) { st.className = "banner closed"; st.textContent = "Voting is closed. Results are below."; }
  else if (myVote) { const t = sites.find((s) => s.id === myVote); st.className = "banner ok"; st.textContent = "Done. You voted for #" + (t?.no ?? "?") + " " + (t?.name ?? "") + ". One vote per person."; }
  else if (!mine && !isAdmin()) { st.className = "banner warn"; st.textContent = "Open a few sites, then vote once. Your own site is not in the gallery yet."; }
  else { st.className = "banner"; st.textContent = "Open a few sites, then vote once. You can't vote for your own."; }
  $("editMine").hidden = !(mine || cfg.open !== false); $("editMine").textContent = mine ? "Edit my site" : "Add my site";
  const q = $("q").value.trim().toLowerCase();
  const rows = sites.filter((s) => !q || String(s.no) === q.replace("#", "") || s.name.toLowerCase().includes(q));
  $("list").innerHTML = rows.length ? rows.map((s) => {
    const isMine = s.id === user.uid, locked = !!myVote || cfg.open === false;
    const btn = isMine ? '<span class="tag">Your site</span>' : myVote === s.id ? '<span class="tag">Your vote</span>' : locked ? "" : '<button class="primary small" data-vote="' + s.id + '">Vote</button>';
    return '<article class="card' + (isMine ? " mine" : "") + '"><div class="num">#' + s.no + '</div><div class="name">' + esc(s.name) + '</div><a href="' + esc(s.url) + '" target="_blank" rel="noopener">' + esc(s.url.replace(/^https?:\/\//, "")) + '</a><div class="actions"><a href="' + esc(s.url) + '" target="_blank" rel="noopener">Open ↗</a>' + btn + "</div></article>";
  }).join("") : '<p class="muted">No sites yet. Be the first to add yours.</p>';
}
$("list").onclick = async (e) => {
  const b = e.target.closest("[data-vote]"); if (!b) return;
  const target = sites.find((s) => s.id === b.dataset.vote);
  if (!target) return;
  // in-page confirmation (no browser dialogs)
  if (b.dataset.armed !== "1") { b.dataset.armed = "1"; b.textContent = "Confirm vote for #" + target.no; setTimeout(() => { if (b.isConnected) { b.dataset.armed = ""; b.textContent = "Vote"; } }, 8000); return; }
  b.disabled = true;
  try { await setDoc(doc(db, "votes", user.uid), { site: target.id, createdAt: serverTimestamp() }); toast("Voted for #" + target.no + " " + target.name); }
  catch (e2) { toast(friendly(e2)); b.disabled = false; b.textContent = "Vote"; }
};

// ---------- results ----------
function renderResults() {
  if ($("vResults").hidden || !votes) return;
  const counts = {}; votes.forEach((v) => (counts[v.site] = (counts[v.site] || 0) + 1));
  const rows = sites.map((s) => ({ ...s, votes: counts[s.id] || 0 })).sort((a, b) => b.votes - a.votes || a.no - b.no);
  const max = Math.max(1, ...rows.map((r) => r.votes));
  const total = votes.length;
  $("resultsTitle").textContent = cfg.open ? "Live results (organiser view)" : "Results";
  $("resultsMeta").textContent = total + " vote" + (total === 1 ? "" : "s") + " · " + sites.length + " sites";
  $("results").innerHTML = rows.map((r, i) => '<div class="rrow' + (i === 0 && r.votes > 0 ? " top" : "") + '"><div class="rank">' + (i + 1) + '</div><div><div><b>#' + r.no + "</b> " + esc(r.name) + (isAdmin() ? ' <button class="del" data-del="' + r.id + '">remove</button>' : "") + '</div><div class="bar"><i style="width:' + (100 * r.votes / max) + '%"></i></div></div><div class="count">' + r.votes + "</div></div>").join("");
}
$("results").onclick = async (e) => {
  const b = e.target.closest("[data-del]"); if (!b) return;
  if (b.dataset.armed !== "1") { b.dataset.armed = "1"; b.textContent = "really remove?"; setTimeout(() => { if (b.isConnected) { b.dataset.armed = ""; b.textContent = "remove"; } }, 8000); return; }
  try { await deleteDoc(doc(db, "sites", b.dataset.del)); toast("Removed."); } catch (e2) { toast(friendly(e2)); }
};

// ---------- organiser ----------
$("toggleOpen").onclick = async () => { try { await updateDoc(doc(db, "config", "settings"), { open: !cfg.open }); toast(cfg.open ? "Voting closed. Everyone sees results now." : "Voting reopened."); } catch (e) { toast(friendly(e)); } };
$("refreshResults").onclick = () => renderResults();
// Reset: wipe sites + votes (organiser only, rules enforce it), keep settings, reopen voting. Two taps within 8 s.
$("resetAll").onclick = async () => {
  const b = $("resetAll");
  if (b.dataset.armed !== "1") { b.dataset.armed = "1"; b.classList.add("armed"); b.textContent = "Tap again to delete everything"; setTimeout(() => { if (b.isConnected) { b.dataset.armed = ""; b.classList.remove("armed"); b.textContent = "Reset…"; } }, 8000); return; }
  b.disabled = true; b.textContent = "Resetting…";
  try {
    const [vs, ss] = await Promise.all([getDocs(collection(db, "votes")), getDocs(collection(db, "sites"))]);
    const refs = [...vs.docs, ...ss.docs].map((d) => d.ref);
    for (let i = 0; i < refs.length; i += 400) { const batch = writeBatch(db); refs.slice(i, i + 400).forEach((r) => batch.delete(r)); await batch.commit(); }
    if (!cfg.open) await updateDoc(doc(db, "config", "settings"), { open: true });
    try { sessionStorage.removeItem("skipRegister"); } catch {}
    toast("Reset done: " + ss.size + " sites and " + vs.size + " votes removed. Voting is open.");
  } catch (e) { toast(friendly(e)); }
  b.disabled = false; b.dataset.armed = ""; b.classList.remove("armed"); b.textContent = "Reset…";
};
$("aSave").onclick = async () => {
  err("aErr", null);
  const admins = $("aAdmins").value.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (!admins.includes(user.email.toLowerCase())) return err("aErr", { message: "Keep your own email in the organiser list." });
  try { await updateDoc(doc(db, "config", "settings"), { title: $("aTitle").value.trim() || "Build Battle", allowedDomain: $("aDomain").value.trim().toLowerCase(), admins }); toast("Saved."); } catch (e) { err("aErr", e); }
};
