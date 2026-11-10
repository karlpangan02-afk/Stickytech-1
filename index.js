
const $ = (s) => document.querySelector(s);
const board = $("#board"), empty = $("#empty"), countEl = $("#count"), toastEl = $("#toast");
const HINTS = ["Homework due…", "Exam topic:", "Key formula:", "Question for the teacher", "Study goal:", "Group project idea", "Words to learn"];
let notes = [], color = "yellow", topZ = 1, active = null, saveTimer, toastTimer, folders = [], drawerOpen = false, drawerPinned = false, playToken = 0, schedReady = false;
 
const rand = (a, b) => Math.random() * (b - a) + a;
const uid = () => Math.random().toString(36).slice(2, 9);
const noteEl = (n) => board.querySelector(`[data-id="${n.id}"]`);
const photoEl = (p) => board.querySelector(`.photo[data-pid="${p.id}"]`);

/* ---------- fits any screen: phone, tablet or computer ---------- */
// Notes and pictures remember the pixel spot they were given on the screen they were made on. On a smaller screen the
// whole layout is squeezed toward the top-left so everything stays on screen and reachable. The saved spots only
// change when you move something yourself, so the computer layout is still there when you come back to it.
const lay = {
  fx: 1, fy: 1,
  sx(x) { return 8 + (x - 8) * this.fx; }, sy(y) { return 60 + (y - 60) * this.fy; },   // saved spot -> spot on this screen
  ux(x) { return 8 + (x - 8) / this.fx; }, uy(y) { return 60 + (y - 60) / this.fy; },   // spot on this screen -> saved spot
};
function place(o, el) {
  let x = lay.sx(o.x), y = lay.sy(o.y);
  if (lay.fx < 1 || lay.fy < 1) {
    x = Math.min(x, Math.max(4, innerWidth - el.offsetWidth - 4));
    y = Math.min(y, Math.max(4, innerHeight - el.offsetHeight - 4));
  }
  el.style.left = x + "px"; el.style.top = y + "px";
}
function fitBoard() {
  const W = innerWidth, H = innerHeight, items = [];
  notes.forEach((n) => { if (!n.folder) { const el = noteEl(n); if (el) items.push([n, el]); } });
  sch.images.forEach((p) => { if (p.board) { const el = photoEl(p); if (el) { el.style.width = Math.min(p.w, W - 16) + "px"; items.push([p, el]); } } });
  let fx = 1, fy = 1;
  items.forEach(([o, el]) => {
    if (o.x > 8) fx = Math.min(fx, Math.max(0, W - 16 - el.offsetWidth) / (o.x - 8));
    if (o.y > 60) fy = Math.min(fy, Math.max(0, H - 68 - el.offsetHeight) / (o.y - 60));
  });
  lay.fx = Math.max(0.35, fx); lay.fy = Math.max(0.35, fy);
  items.forEach(([o, el]) => place(o, el));
}
let fitT, lastW = innerWidth;
const fitSoon = () => { cancelAnimationFrame(fitT); fitT = requestAnimationFrame(fitBoard); };
addEventListener("resize", () => {
  const typing = document.activeElement?.closest?.("[contenteditable], input, select, textarea");
  if (typing && innerWidth === lastW) return;   // the on-screen keyboard opened: leave everything where it is
  lastW = innerWidth; fitSoon();
});
addEventListener("orientationchange", () => setTimeout(fitSoon, 250));
if (matchMedia("(pointer: coarse)").matches) empty.textContent = "Double-tap anywhere, or open the Toolbar and press New note, to stick your first note.";
 
/* ---------- Python backend ---------- */
async function load() {
  let data = {};
  try { data = await (await fetch("/api/notes")).json(); } catch {}
  notes = Array.isArray(data) ? data : data.notes || [];
  folders = Array.isArray(data.folders) ? data.folders : [{ id: uid(), name: "Homework", open: true }, { id: uid(), name: "Ideas", open: true }];
  notes.forEach((n) => {
    n.font ||= "hand"; n.emoji ||= ""; n.due ||= ""; n.pinned = !!n.pinned;
    n.folder = folders.some((f) => f.id === n.folder) ? n.folder : "";
    if (!n.folder) draw(n);
  });
  renderFolders(); update(); fitBoard(); setTimeout(remind, 1200);
}
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    fetch("/api/notes", { method: "POST", body: JSON.stringify({ notes, folders }) }).catch(() => toast("Couldn't reach the server"));
  }, 350);
}

/* ---------- notes ---------- */
function addNote(x, y) {
  const w = Math.min(220, innerWidth * 0.45);
  const n = {
    id: uid(), folder: "", color, font: $("#font").value, emoji: $("#emoji").value, due: "", pinned: false,
    x: x ?? rand(20, Math.max(40, innerWidth - w - 20)),
    y: y ?? rand(70, Math.max(90, innerHeight - w - 20)),
    r: +rand(-6, 6).toFixed(1), text: "",
  };
  n.x = lay.ux(Math.max(8, Math.min(innerWidth - w - 8, n.x)));
  n.y = lay.uy(Math.max(70, Math.min(innerHeight - w - 8, n.y)));
  notes.push(n);
  active = n;
  const el = draw(n);
  el.querySelector(".text").focus();
  update(); save();
}
 
function dueInfo(d) {
  if (!d) return { t: "", days: 99 };
  const days = Math.round((new Date(d + "T00:00") - new Date(new Date().toDateString())) / 864e5);
  const t = days < 0 ? `overdue ${-days}d` : days === 0 ? "due today!" : days === 1 ? "tomorrow" : `in ${days}d`;
  return { t, days };
}
 
function paint(n, el) {
  el.dataset.font = n.font;
  el.querySelector(".stamp").textContent = n.emoji;
  el.classList.toggle("pinned", n.pinned);
  el.querySelector(".pin").setAttribute("aria-pressed", n.pinned);
  const d = dueInfo(n.due);
  el.querySelector(".badge").textContent = n.done ? "done ✓" : d.t;
  el.classList.toggle("done", !!n.done);
  el.classList.toggle("late", !n.done && d.days < 0);
  el.classList.toggle("soon", !n.done && d.days >= 0 && d.days <= 2);
}
 
function setActive(n) {
  active = n;
  $("#font").value = n.font;
  $("#emoji").value = n.emoji;
}
 
function draw(n) {
  const el = document.createElement("div");
  el.className = "note";
  el.dataset.color = n.color;
  el.dataset.id = n.id;
  el.style.cssText = `--r:${n.r}deg;z-index:${++topZ}`;
  el.innerHTML = `<span class="stamp"></span>
    <button class="ctl pin" title="Pin: keeps this note on top and in place" aria-label="Pin note">📌</button>
    <button class="ctl emo" title="Add an emoji to this note" aria-label="Add emoji">😀</button>
    <button class="ctl fold" title="Put this note in a folder" aria-label="Put in folder">📁</button>
    <button class="x" aria-label="Toss note">×</button>
    <div class="text" contenteditable="true" spellcheck="false" data-hint="${HINTS[Math.floor(Math.random() * HINTS.length)]}"></div>
    <div class="foot"><input class="due" type="date" title="Due date" aria-label="Due date"><span class="badge"></span></div>`;
  const t = el.querySelector(".text"), due = el.querySelector(".due");
  t.textContent = n.text;
  due.value = n.due;
  paint(n, el);
  t.addEventListener("input", () => { shortcode(); n.text = Array.from(t.innerText).slice(0, 400).join(""); save(); if (n.due) renderSchedule(); });
  el.querySelector(".pin").onclick = () => {
    n.pinned = !n.pinned;
    if (!n.pinned) el.style.zIndex = ++topZ;
    paint(n, el); update(); save();
    toast(n.pinned ? "Pinned 📌 stays on top and in place" : "Unpinned");
  };
  due.onchange = () => { n.due = due.value; n.notified = false; askNotify(); paint(n, el); update(); save(); };
  el.querySelector(".x").addEventListener("click", () => toss(n, el));
  const emo = el.querySelector(".emo");
  emo.onmousedown = (e) => e.preventDefault();
  emo.onclick = () => { setActive(n); openPop($("#tray")); };
  el.querySelector(".fold").onclick = (e) => { setActive(n); folderMenu(e.currentTarget, n); };
  el.addEventListener("pointerdown", (e) => { setActive(n); startDrag(e, n, el); });
  board.appendChild(el);
  place(n, el);
  return el;
}
 
function toss(n, el) {
  if (n.pinned && !confirm("This note is pinned. Toss it anyway?")) return;
  el.classList.add("crumple");
  trash.push(n);
  notes = notes.filter((m) => m.id !== n.id);
  if (active === n) active = null;
  setTimeout(() => { el.remove(); update(); }, 430);
  save();
  toast(notes.length ? "Tossed!" : "Clean desk. Nice.");
}
 
/* ---------- dragging (pinned notes stay put; drop on a folder to file) ---------- */
function startDrag(e, n, el) {
  if (e.target.closest(".x, .ctl, .due") || n.pinned) return;
  el.style.zIndex = ++topZ;
  const inText = e.target.closest(".text");
  const sx = e.clientX, sy = e.clientY, ox = parseFloat(el.style.left) || 0, oy = parseFloat(el.style.top) || 0;
  const touch = e.pointerType === "touch", scroll0 = inText ? inText.scrollTop : 0;
  let moved = false, over = null, peek = false, mode = "";
  const move = (ev) => {
    const dx = ev.clientX - sx, dy = ev.clientY - sy;
    if (!moved && touch && inText && mode !== "drag") {   // a finger sliding up/down on a long note scrolls its text
      if (!mode && Math.hypot(dx, dy) > 8) mode = Math.abs(dy) > Math.abs(dx) && inText.scrollHeight > inText.clientHeight + 2 ? "scroll" : "drag";
      if (mode === "scroll") { inText.scrollTop = scroll0 - dy; return; }
    }
    if (!moved && Math.hypot(dx, dy) < (inText ? 8 : 2)) return;
    if (!moved) {
      moved = true; el.classList.add("drag"); document.activeElement.blur();
      if (!drawerOpen && innerWidth >= 860) { peek = true; setDrawer(true); }   // on a phone the drawer would cover the note: use the 📁 button instead
    }
    const X = Math.max(-60, Math.min(innerWidth - 90, ox + dx)), Y = Math.max(0, Math.min(innerHeight - 90, oy + dy));
    n.x = lay.ux(X); n.y = lay.uy(Y);
    el.style.left = X + "px"; el.style.top = Y + "px";
    el.style.setProperty("--r", (n.r + Math.max(-8, Math.min(8, ev.movementX * 0.6))) + "deg");
    over = document.elementFromPoint(ev.clientX, ev.clientY)?.closest(".folder") || null;
    document.querySelectorAll(".folder.over").forEach((f) => f !== over && f.classList.remove("over"));
    over?.classList.add("over");
  };
  const up = () => {
    removeEventListener("pointermove", move); removeEventListener("pointerup", up);
    el.classList.remove("drag");
    el.style.setProperty("--r", n.r + "deg");
    document.querySelectorAll(".folder.over").forEach((f) => f.classList.remove("over"));
    if (moved && over) store(n, over.dataset.fid);
    else if (moved) save();
    if (peek && !drawerPinned && !over) setDrawer(false);
  };
  addEventListener("pointermove", move);
  addEventListener("pointerup", up);
}

/* ---------- toolbar ---------- */
document.querySelectorAll(".swatch").forEach((b) =>
  b.addEventListener("click", () => {
    color = b.dataset.color;
    document.querySelectorAll(".swatch").forEach((s) => s.classList.toggle("on", s === b));
  }));
$("#add").onclick = () => addNote();
 
// Font and emoji: change the selected note, and are used for the next new note
$("#font").onchange = (e) => {
  if (!active) return toast("New notes will use this font");
  active.font = e.target.value; paint(active, noteEl(active)); save(); toast("Font changed");
};
$("#emoji").onchange = (e) => {
  if (!active) return toast("New notes will get this emoji");
  active.emoji = e.target.value; paint(active, noteEl(active)); save(); toast("Emoji changed");
};
board.addEventListener("pointerdown", (e) => { if (e.target === board) active = null; });
 
// Clear board: pinned notes are spared
$("#clear").onclick = () => {
  const gone = notes.filter((n) => !n.pinned && !n.folder);
  if (!gone.length) return toast(notes.length ? "Only pinned notes left. Unpin to clear them." : "The board is already empty");
  const kept = notes.filter((n) => n.pinned && !n.folder).length;
  if (!confirm(`Toss ${gone.length} note${gone.length > 1 ? "s" : ""}?${kept ? ` (${kept} pinned stay.)` : ""} This can't be undone.`)) return;
  gone.forEach((n, i) => setTimeout(() => noteEl(n)?.classList.add("crumple"), i * 70));
  trash.push(...gone);
  notes = notes.filter((n) => n.pinned || n.folder);
  if (active && !notes.includes(active)) active = null;
  setTimeout(() => { board.querySelectorAll(".note.crumple").forEach((el) => el.remove()); update(); }, gone.length * 70 + 450);
  save();
};
 
/* ---------- student tools ---------- */
// Search: notes that don't match fade out
$("#search").addEventListener("input", (e) => {
  const q = e.target.value.trim().toLowerCase();
  applyDim();
  renderFolders();
});
 
// Board background (remembered between visits)
function setTheme(v) {
  document.body.dataset.theme = v;
  $("#theme").value = v;
  try { localStorage.setItem("theme", v); } catch {}
}
$("#theme").onchange = (e) => setTheme(e.target.value);
try { setTheme(localStorage.getItem("theme") || "desk"); } catch {}
 
// Export all notes as a text file, pinned first
$("#export").onclick = () => {
  if (!notes.length) return toast("Nothing to export yet");
  const txt = [...notes].sort((a, b) => b.pinned - a.pinned)
    .map((n) => `${n.folder ? `[${folderName(n.folder)}] ` : ""}${n.pinned ? "📌 " : ""}${n.emoji || "•"} ${n.text.trim() || "(empty)"}${n.due ? `   [due ${n.due}]` : ""}`).join("\n\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([txt], { type: "text/plain" }));
  a.download = "my-notes.txt";
  a.click();
  toast("Exported!");
};
 
/* ---------- small helpers for popups ---------- */
const h = (tag, props = {}, ...kids) => {
  const e = document.createElement(tag);
  Object.assign(e, props);
  kids.flat().forEach((k) => e.append(k));
  return e;
};
const pops = () => document.querySelectorAll(".pop");
function openPop(el) {
  pops().forEach((p) => { if (p !== el) p.hidden = true; });
  const wide = innerWidth >= 860;
  if (!wide && !bar.hidden) setBar(false, true);
  const b = bar.getBoundingClientRect(), beside = wide && !bar.hidden;
  el.style.transform = "none";
  el.style.left = (beside ? b.right + 10 : 10) + "px";
  el.style.top = "58px";
  el.hidden = false;
}
const togglePop = (el) => (el.hidden ? openPop(el) : (el.hidden = true));

/* ---------- emojis inside the note text ---------- */
const EMOJIS = ("😀 😄 😂 🤣 😊 🥰 😍 😘 😎 🤓 🤔 😴 😭 😢 🥺 😞 😔 😤 😡 🥹 🤗 🥳 😅 🙃 😬 😱 🤯 🙄 😌 " +
  "❤️ 🧡 💛 💚 💙 💜 🤍 🖤 💔 💕 💞 💘 💝 ❣️ " +
  "👍 👎 👏 🙏 🙌 💪 ✌️ 🤞 👀 " +
  "🥀 🌹 🌸 🌙 ☀️ 🌧️ ⭐ ✨ 🔥 💡 🎶 🎵 🎧 🎤 📚 ✏️ 📝 📅 ⏰ 🎯 ✅ ❗ ❓ 🧪 🧮 🎨 💻 ☕ 🍜 🍰 🇵🇭").split(" ");
const CODES = {
  heart: "❤️", love: "🥰", broken: "💔", cry: "😭", sob: "😭", sad: "😢", smile: "😊", grin: "😄", laugh: "😂",
  cool: "😎", hug: "🤗", party: "🥳", sleepy: "😴", think: "🤔", fire: "🔥", star: "⭐", sparkles: "✨",
  book: "📚", pencil: "✏️", idea: "💡", music: "🎶", rose: "🥀", moon: "🌙", rain: "🌧️", thumbsup: "👍",
  pray: "🙏", check: "✅", ph: "🇵🇭", coffee: "☕",
  hugot: "🥀", miss: "🥺", pls: "🥺", kilig: "🥰", ghost: "👻", multo: "👻", kiss: "😘", wink: "😉",
  angry: "😡", tired: "😩", cake: "🍰", pizza: "🍕", food: "🍜", rice: "🍚", sun: "☀️", flower: "🌸",
  clap: "👏", muscle: "💪", eyes: "👀", wave: "👋", home: "🏠", school: "🏫", alarm: "⏰", note: "📝",
  headphones: "🎧", mic: "🎤", sparkle: "✨", bulb: "💡", lock: "🔒", skull: "💀", rainbow: "🌈",
};
// text faces that turn into emoji as you type
const FACES = { "<3": "❤️", "</3": "💔", ":)": "🙂", ":(": "🙁", ":'(": "😢", "T_T": "😭", ":P": "😛", ";)": "😉" };
const tray = $("#tray");
EMOJIS.forEach((em) => $("#emojiGrid").append(h("button", { type: "button", textContent: em, title: "Insert " + em, onclick: () => insertEmoji(em) })));
// keep the caret in the note while clicking the tray or the toolbar button
tray.addEventListener("mousedown", (e) => e.preventDefault());
$("#emojiBtn").addEventListener("mousedown", (e) => e.preventDefault());
$("#emojiBtn").onclick = () => togglePop(tray);
board.addEventListener("pointerdown", () => { tray.hidden = true; closeMenu(); if (!drawerPinned) setDrawer(false); });

let savedRange = null;
document.addEventListener("selectionchange", () => {
  const s = getSelection();
  if (!s.rangeCount) return;
  const r = s.getRangeAt(0), el = r.startContainer.nodeType === 1 ? r.startContainer : r.startContainer.parentElement;
  if (el && el.closest(".note .text")) savedRange = r.cloneRange();
});

function insertEmoji(em) {
  if (!active || !noteEl(active)) return toast("Click a note first, then pick an emoji");
  const t = noteEl(active).querySelector(".text");
  t.focus();
  const s = getSelection(), r = document.createRange();
  if (savedRange && t.contains(savedRange.startContainer)) s.removeAllRanges(), s.addRange(savedRange);
  else { r.selectNodeContents(t); r.collapse(false); s.removeAllRanges(); s.addRange(r); }
  if (!document.execCommand("insertText", false, em)) t.append(em);
  t.dispatchEvent(new Event("input"));
}

// typing :heart: or :cry: turns into the emoji
function shortcode() {
  const s = getSelection();
  if (!s.rangeCount || !s.isCollapsed || !s.anchorNode || s.anchorNode.nodeType !== 3) return;
  const node = s.anchorNode, pos = s.anchorOffset, before = node.data.slice(0, pos);
  let start = -1, em = "";
  const m = before.match(/:([a-z0-9_]{2,12}):$/i);
  if (m && CODES[m[1].toLowerCase()]) { start = m.index; em = CODES[m[1].toLowerCase()]; }
  else {
    const face = Object.keys(FACES).sort((a, b) => b.length - a.length).find((k) => before.endsWith(k));
    if (face) { start = pos - face.length; em = FACES[face]; }
  }
  if (start < 0) return;
  node.data = before.slice(0, start) + em + node.data.slice(pos);
  const r = document.createRange();
  r.setStart(node, start + em.length); r.collapse(true);
  s.removeAllRanges(); s.addRange(r);
}

/* ---------- ambient: moods that play inside the browser (no audio files) ---------- */
const MOODS = {
  calm:     { label: "🌿 Calm",     lp: 1400, gap: 8000,  bells: [523.25, 587.33, 659.25, 783.99, 880],
              chords: [[261.63, 329.63, 392], [220, 261.63, 329.63], [174.61, 220, 261.63], [196, 246.94, 293.66]] },
  relapse:  { label: "💔 Relapse",  lp: 1000, gap: 9000,  bells: [440, 523.25, 659.25, 880],
              chords: [[220, 261.63, 329.63], [174.61, 220, 261.63], [146.83, 174.61, 220], [164.81, 207.65, 246.94]] },
  yearning: { label: "🥀 Yearning", lp: 1200, gap: 10000, bells: [659.25, 783.99, 880, 987.77],
              chords: [[174.61, 220, 261.63, 329.63], [164.81, 196, 246.94, 293.66], [146.83, 174.61, 220, 261.63], [220, 261.63, 329.63]] },
  love:     { label: "💕 Love",     lp: 1800, gap: 7000,  bells: [523.25, 659.25, 783.99, 1046.5],
              chords: [[261.63, 329.63, 392], [196, 246.94, 293.66], [220, 261.63, 329.63], [174.61, 220, 261.63]] },
};
let ac, master, lp, musicTimer, musicOn = false, chordIdx = 0, mood = "calm";
const level = () => +$("#vol").value * 0.7;

function tone(f, at, dur, peak, atk) {
  const o = ac.createOscillator(), g = ac.createGain();
  o.type = "sine"; o.frequency.value = f; o.detune.value = rand(-6, 6);
  g.gain.setValueAtTime(0, at);
  g.gain.linearRampToValueAtTime(peak, at + atk);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  o.connect(g); g.connect(master); o.start(at); o.stop(at + dur + 0.1);
}
function playChord() {
  const m = MOODS[mood], t = ac.currentTime, c = m.chords[chordIdx++ % m.chords.length];
  [c[0] / 2, ...c].forEach((f) => tone(f, t, m.gap / 1000 + 2, 0.1, 3.5));
  for (let i = 0; i < 2; i++) tone(m.bells[Math.floor(rand(0, m.bells.length))], t + rand(1, 6), 5, 0.06, 0.05);
}
function startTimer() {
  clearInterval(musicTimer);
  lp.frequency.value = MOODS[mood].lp;
  chordIdx = 0; playChord();
  musicTimer = setInterval(playChord, MOODS[mood].gap);
}
function setMusic(on) {
  musicOn = on;
  if (on) {
    stopPlayer();
    if (!ac) {
      ac = new AudioContext();
      master = ac.createGain(); master.gain.value = 0;
      lp = ac.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 1400;
      const d = ac.createDelay(1), fb = ac.createGain();
      d.delayTime.value = 0.5; fb.gain.value = 0.4;
      d.connect(fb); fb.connect(d);
      master.connect(lp); lp.connect(ac.destination); lp.connect(d); d.connect(ac.destination);
    }
    ac.resume();
    master.gain.setTargetAtTime(level(), ac.currentTime, 1.5);
    startTimer();
  } else {
    clearInterval(musicTimer);
    if (master) master.gain.setTargetAtTime(0, ac.currentTime, 0.6);
  }
  refreshMusic();
}
function setMood(m) {
  mood = m;
  if (musicOn) startTimer();
  refreshMusic();
}
$("#vol").oninput = () => musicOn && master.gain.setTargetAtTime(level(), ac.currentTime, 0.1);
$("#ambToggle").onclick = () => setMusic(!musicOn);
Object.entries(MOODS).forEach(([k, m]) => $("#moods").append(h("button", { type: "button", className: "btn ghost", textContent: m.label, onclick: () => setMood(k) })));

/* ---------- my music: .mp3 files from your computer ---------- */
// Song info is kept in localStorage; the mp3 files themselves are kept in IndexedDB (inside this browser).
let pl;
try { pl = JSON.parse(localStorage.getItem("mp3lists")); } catch {}
if (!pl || !Array.isArray(pl.lists) || !pl.lists.length) pl = { cur: "p1", lists: [{ id: "p1", name: "My music", tracks: [] }] };
const savePL = () => { try { localStorage.setItem("mp3lists", JSON.stringify(pl)); } catch { toast("Couldn't save your playlists"); } };
const curList = () => pl.lists.find((l) => l.id === pl.cur) || pl.lists[0];

const fileDB = new Promise((res, rej) => {
  try {
    const r = indexedDB.open("stickyMusic", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("files");
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  } catch (err) { rej(err); }
});
fileDB.catch(() => {});
const fileOp = async (mode, fn) => {
  const d = await fileDB;
  return new Promise((res, rej) => {
    const tx = d.transaction("files", mode), rq = fn(tx.objectStore("files"));
    tx.oncomplete = () => res(rq.result);
    tx.onerror = tx.onabort = () => rej(tx.error);
  });
};
const putFile = (id, blob) => fileOp("readwrite", (s) => s.put(blob, id));
const getFile = (id) => fileOp("readonly", (s) => s.get(id));
const delFile = (id) => fileOp("readwrite", (s) => s.delete(id)).catch(() => {});

let playing = { l: null, i: -1 }, curUrl = "";

function stopPlayer() {
  playToken++;
  const a = $("#player audio");
  if (a) a.pause();
  $("#player").replaceChildren();
  if (curUrl) { URL.revokeObjectURL(curUrl); curUrl = ""; }
  playing = { l: null, i: -1 };
  renderPL(); refreshMusic();
}
async function playTrack(i) {
  const L = curList(), t = L.tracks[i];
  if (!t) return;
  const tok = ++playToken, n = L.tracks.length;
  let blob = null;
  try { blob = await getFile(t.id); } catch {}
  if (tok !== playToken) return;
  if (!blob) return toast("Couldn't find that file. Remove the song and add the .mp3 again.");
  if (musicOn) setMusic(false);
  if (curUrl) URL.revokeObjectURL(curUrl);
  curUrl = URL.createObjectURL(blob);
  playing = { l: L.id, i };
  $("#player").replaceChildren(
    h("div", { className: "now" },
      h("span", { textContent: "Now playing: " + t.title }),
      h("span", { className: "pbtns" },
        h("button", { type: "button", title: "Previous", textContent: "⏮", onclick: () => playTrack((i - 1 + n) % n) }),
        h("button", { type: "button", title: "Next", textContent: "⏭", onclick: () => playTrack((i + 1) % n) }),
        h("button", { type: "button", title: "Stop", textContent: "⏹", onclick: stopPlayer }))),
    h("audio", {
      src: curUrl, controls: true, autoplay: true,
      onended: () => (n > 1 ? playTrack((i + 1) % n) : stopPlayer()),
      onerror: () => toast("That file can't be played. Is it a real .mp3?"),
    }));
  renderPL(); refreshMusic();
}

function renderPL() {
  const L = curList(), sel = $("#plSel");
  pl.cur = L.id;
  sel.replaceChildren(...pl.lists.map((l) => h("option", { value: l.id, textContent: `${l.name} (${l.tracks.length})` })));
  sel.value = L.id;
  $("#plTracks").replaceChildren(...(L.tracks.length ? L.tracks.map((t, i) => {
    const on = playing.l === L.id && playing.i === i;
    return h("li", { className: on ? "on" : "" },
      h("button", { type: "button", className: "tname", title: "Play", textContent: (on ? "▶ " : "") + t.title, onclick: () => playTrack(i) }),
      h("span", { className: "pbtns" },
        h("button", { type: "button", title: "Remove", textContent: "✕", onclick: () => {
          const wasPlaying = playing.l === L.id && playing.i === i;
          if (playing.l === L.id && i < playing.i) playing.i--;
          L.tracks.splice(i, 1);
          delFile(t.id);
          savePL();
          if (wasPlaying) stopPlayer(); else renderPL();
        } })));
  }) : [h("li", { className: "none", textContent: "No songs yet. Press “Add MP3 files” or drop them here." })]));
}

async function addFiles(files, quiet) {
  const L = curList();
  let added = 0, dupes = 0, bad = 0;
  for (const f of files) {
    if (!/\.mp3$/i.test(f.name) && f.type !== "audio/mpeg") { if (!quiet) bad++; continue; }
    if (L.tracks.some((t) => t.name === f.name && t.size === f.size)) { dupes++; continue; }
    const id = uid();
    try { await putFile(id, new Blob([f], { type: "audio/mpeg" })); }
    catch { toast("Couldn't store that file in this browser"); break; }
    L.tracks.push({ id, name: f.name, size: f.size, title: f.name.replace(/\.mp3$/i, "").replace(/_+/g, " ").trim().slice(0, 80) || "Untitled" });
    added++;
  }
  savePL(); renderPL();
  if (added && navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  const bits = [];
  if (added) bits.push(`Added ${added} to “${L.name}”`);
  if (dupes) bits.push(`${dupes} already there`);
  if (bad) bits.push(`${bad} skipped (not .mp3)`);
  toast(bits.join(" · ") || "No songs added");
}

$("#plSel").onchange = (e) => { pl.cur = e.target.value; savePL(); renderPL(); };
$("#plNew").onclick = () => {
  const name = (prompt("Name your new playlist:", "") || "").trim().slice(0, 30);
  if (!name) return;
  const l = { id: uid(), name, tracks: [] };
  pl.lists.push(l); pl.cur = l.id; savePL(); renderPL();
};
$("#plRename").onclick = () => {
  const name = (prompt("Rename playlist:", curList().name) || "").trim().slice(0, 30);
  if (name) { curList().name = name; savePL(); renderPL(); }
};
$("#plDel").onclick = () => {
  const L = curList();
  if (!confirm(`Delete “${L.name}”${L.tracks.length ? ` and its ${L.tracks.length} songs` : ""}?`)) return;
  if (playing.l === L.id) stopPlayer();
  L.tracks.forEach((t) => delFile(t.id));
  pl.lists = pl.lists.filter((l) => l !== L);
  if (!pl.lists.length) pl.lists = [{ id: uid(), name: "My music", tracks: [] }];
  pl.cur = pl.lists[0].id; savePL(); renderPL();
};
$("#mp3Add").onclick = () => $("#mp3File").click();
$("#mp3File").onchange = (e) => { addFiles([...e.target.files]); e.target.value = ""; };
// a whole folder: take every .mp3 inside it (and its sub-folders), in name order; other files in the folder are ignored
$("#mp3Folder").onclick = () => $("#mp3Dir").click();
$("#mp3Dir").onchange = (e) => {
  const all = [...e.target.files]; e.target.value = "";
  const mp3 = all.filter((f) => /\.mp3$/i.test(f.name)).sort((a, b) => (a.webkitRelativePath || a.name).localeCompare(b.webkitRelativePath || b.name, undefined, { numeric: true }));
  if (!mp3.length) return toast(all.length ? "No .mp3 files found in that folder" : "No folder chosen");
  addFiles(mp3, true);
};
const drop = document.querySelector('.tabpane[data-pane="mine"]');
["dragenter", "dragover"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("over"); }));
["dragleave", "drop"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove("over"); }));
drop.addEventListener("drop", (e) => addFiles([...e.dataTransfer.files]));

document.querySelectorAll(".tab").forEach((b) => b.addEventListener("click", () => {
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("on", t === b));
  document.querySelectorAll(".tabpane").forEach((p) => { p.hidden = p.dataset.pane !== b.dataset.tab; });
}));

function refreshMusic() {
  const busy = musicOn || !!playing.l;
  $("#music").classList.toggle("on", busy);
  $("#music").textContent = busy ? "🎵 Music on" : "🎵 Music";
  $("#ambToggle").textContent = musicOn ? "⏸ Stop ambient" : "▶ Play ambient";
  [...$("#moods").children].forEach((b, i) => b.classList.toggle("sel", Object.keys(MOODS)[i] === mood));
}
$("#music").onclick = () => togglePop($("#musicPanel"));
$("#musicClose").onclick = () => { $("#musicPanel").hidden = true; };
renderPL(); refreshMusic();

/* ---------- header popup (top left) ---------- */
const bar = $("#bar"), menuBtn = $("#menuBtn");
function setBar(open, keep) {
  bar.hidden = !open;
  menuBtn.setAttribute("aria-expanded", open);
  if (!keep) try { localStorage.setItem("barOpen", open ? "1" : "0"); } catch {}
}
menuBtn.onclick = () => {
  const o = bar.hidden; setBar(o);
  if (o && innerWidth < 860) { setDrawer(false); if (schedReady) setSched(false); }
};
try { setBar(localStorage.getItem("barOpen") === "1"); } catch { setBar(false); }

/* ---------- folders drawer ---------- */
const dr = $("#drawer"), dPin = $("#dPin");
const folderName = (id) => folders.find((f) => f.id === id)?.name || "";
function setDrawer(open) {
  if (open && innerWidth < 860) { setBar(false, true); if (schedReady) setSched(false); }
  drawerOpen = open;
  dr.classList.toggle("open", open);
  dr.inert = !open;
  $("#dTab").hidden = open;
}
function setPinned(p) {
  drawerPinned = p;
  dPin.classList.toggle("on", p);
  dPin.setAttribute("aria-pressed", p);
  dPin.title = p ? "Unpin: the drawer closes when you click the board" : "Pin: keep the drawer open";
  try { localStorage.setItem("drawerPinned", p ? "1" : "0"); } catch {}
}
dPin.onclick = () => { setPinned(!drawerPinned); toast(drawerPinned ? "Folders pinned open 📌" : "Folders unpinned"); };
$("#dClose").onclick = () => setDrawer(false);
$("#dTab").onclick = () => setDrawer(true);
$("#drawerBtn").onclick = () => setDrawer(!drawerOpen);
try { setPinned(localStorage.getItem("drawerPinned") === "1"); } catch { setPinned(false); }
setDrawer(drawerPinned);

function newFolder() {
  const name = (prompt("Name your new folder:", "") || "").trim().slice(0, 30);
  if (!name) return null;
  const f = { id: uid(), name, open: true };
  folders.push(f); save(); renderFolders();
  return f;
}
$("#fNew").onclick = () => newFolder();

function store(n, fid) {
  if (n.folder === fid) return;
  const f = folders.find((x) => x.id === fid);
  if (!f) return;
  noteEl(n)?.remove();
  n.folder = fid; f.open = true;
  if (active === n) active = null;
  renderFolders(); update(); save();
  toast(`Filed in “${f.name}” 📁`);
}
function unstore(n, x, y) {
  const w = Math.min(220, innerWidth * 0.45);
  n.folder = "";
  n.x = lay.ux(Math.max(8, Math.min(innerWidth - w - 8, x ?? rand(20, Math.max(40, innerWidth - w - 20)))));
  n.y = lay.uy(Math.max(70, Math.min(innerHeight - w - 8, y ?? rand(100, Math.max(120, innerHeight - w - 20)))));
  draw(n); renderFolders(); update(); save();
}
function delFolder(f) {
  const inside = notes.filter((n) => n.folder === f.id);
  if (!confirm(`Delete folder “${f.name}”?${inside.length ? ` Its ${inside.length} note${inside.length > 1 ? "s" : ""} go back to the board.` : ""}`)) return;
  folders = folders.filter((x) => x !== f);
  inside.forEach((n) => unstore(n));
  save(); renderFolders();
}
function tossStored(n) {
  if (!confirm("Toss this note for good?")) return;
  trash.push(n);
  notes = notes.filter((m) => m !== n);
  renderFolders(); update(); save();
}

function fitem(n) {
  const it = h("div", { className: "fitem" + (n.pinned ? " pinned" : ""), draggable: true, title: n.text.trim() || "(empty note)" },
    h("span", { className: "ftext", textContent: `${n.emoji ? n.emoji + " " : ""}${n.text.trim().slice(0, 60) || "(empty note)"}` }),
    h("span", { className: "pbtns" },
      h("button", { type: "button", className: "pp", title: n.pinned ? "Unpin" : "Pin to the top of this folder", textContent: "📌",
        onclick: () => { n.pinned = !n.pinned; save(); renderFolders(); update(); toast(n.pinned ? "Pinned to the top 📌" : "Unpinned"); } }),
      h("button", { type: "button", className: "fold", title: "Move to another folder", textContent: "📁", onclick: (e) => folderMenu(e.currentTarget, n) }),
      h("button", { type: "button", title: "Put back on the board", textContent: "↩", onclick: () => unstore(n) }),
      h("button", { type: "button", title: "Toss", textContent: "✕", onclick: () => tossStored(n) })));
  it.dataset.color = n.color;
  it.ondragstart = (e) => { e.dataTransfer.setData("text/plain", n.id); e.dataTransfer.effectAllowed = "move"; };
  return it;
}

function renderFolders() {
  const q = $("#search").value.trim().toLowerCase();
  $("#folders").replaceChildren(...(folders.length ? folders.map((f) => {
    const all = notes.filter((n) => n.folder === f.id).sort((a, b) => b.pinned - a.pinned);
    const list = q ? all.filter((n) => n.text.toLowerCase().includes(q)) : all;
    const sec = h("section", { className: "folder" + (f.open === false ? " shut" : "") });
    sec.dataset.fid = f.id;
    sec.append(
      h("div", { className: "fhead" },
        h("button", { type: "button", className: "fname", textContent: `${f.open === false ? "▸" : "▾"} 📁 ${f.name}`, onclick: () => { f.open = f.open === false; save(); renderFolders(); } }),
        h("span", { className: "fcount", textContent: all.length }),
        h("span", { className: "pbtns" },
          h("button", { type: "button", title: "Rename folder", textContent: "✎", onclick: () => { const nm = (prompt("Rename folder:", f.name) || "").trim().slice(0, 30); if (nm) { f.name = nm; save(); renderFolders(); } } }),
          h("button", { type: "button", title: "Delete folder", textContent: "🗑", onclick: () => delFolder(f) }))),
      h("div", { className: "flist" }, ...(list.length ? list.map(fitem) : [h("div", { className: "fempty", textContent: all.length ? "No matches." : "Drag a note here, or press 📁 on a note." })])));
    sec.ondragover = (e) => { e.preventDefault(); sec.classList.add("over"); };
    sec.ondragleave = (e) => { if (!sec.contains(e.relatedTarget)) sec.classList.remove("over"); };
    sec.ondrop = (e) => {
      e.preventDefault(); sec.classList.remove("over");
      const n = notes.find((m) => m.id === e.dataTransfer.getData("text/plain"));
      if (n) store(n, f.id);
    };
    return sec;
  }) : [h("div", { className: "fempty", textContent: "No folders yet. Press “+ New folder”." })]));
}

// drag a filed note back out onto the board
board.addEventListener("dragover", (e) => e.preventDefault());
board.addEventListener("drop", (e) => {
  e.preventDefault();
  const n = notes.find((m) => m.id === e.dataTransfer.getData("text/plain"));
  if (n && n.folder) unstore(n, e.clientX - 105, e.clientY - 20);
});

// "put in folder" menu, used by the 📁 button on notes and in the drawer
function closeMenu() { document.querySelectorAll(".fmenu").forEach((m) => m.remove()); }
function folderMenu(btn, n) {
  closeMenu();
  const items = folders.filter((f) => f.id !== n.folder)
    .map((f) => h("button", { type: "button", textContent: "📁 " + f.name, onclick: () => { closeMenu(); store(n, f.id); } }));
  items.push(h("button", { type: "button", textContent: "＋ New folder…", onclick: () => { closeMenu(); const f = newFolder(); if (f) store(n, f.id); } }));
  const m = h("div", { className: "fmenu" }, ...items);
  document.body.append(m);
  const r = btn.getBoundingClientRect();
  m.style.left = Math.max(8, Math.min(innerWidth - m.offsetWidth - 8, r.left)) + "px";
  m.style.top = Math.max(8, Math.min(innerHeight - m.offsetHeight - 8, r.bottom + 4)) + "px";
}
addEventListener("pointerdown", (e) => { if (!e.target.closest(".fmenu, .fold")) closeMenu(); }, true);

/* ---------- keys ---------- */
board.addEventListener("dblclick", (e) => { if (e.target === board) addNote(e.clientX - 105, e.clientY - 20); });
addEventListener("keydown", (e) => {
  const typing = e.target.closest?.("[contenteditable], input, select");
  if (!typing && !e.metaKey && !e.ctrlKey) {
    if (e.key.toLowerCase() === "n") { e.preventDefault(); addNote(); }
    if (e.key === "/") { e.preventDefault(); $("#search").focus(); }
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z" && !typing) { e.preventDefault(); undoToss(); }
  if (e.key === "Escape") { $("#lightbox").hidden = true; document.activeElement.blur(); pops().forEach((p) => (p.hidden = true)); closeMenu(); if (!drawerPinned) setDrawer(false); }
});
 
/* ---------- helpers ---------- */
function update() {
  const onBoard = notes.filter((n) => !n.folder), filed = notes.length - onBoard.length;
  empty.style.display = onBoard.length ? "none" : "";
  const soon = onBoard.filter((n) => !n.done && dueInfo(n.due).days <= 2).length, pins = notes.filter((n) => n.pinned).length;
  countEl.textContent = [notes.length === 1 ? "1 note" : `${notes.length} notes`, filed && `📁 ${filed} filed`, pins && `📌 ${pins}`, soon && `⏰ ${soon} due soon`].filter(Boolean).join(" · ");
  renderSchedule();
}
function toast(msg, ms = 1600) {
  toastEl.textContent = msg; toastEl.classList.add("show");
  clearTimeout(toastTimer); toastTimer = setTimeout(() => toastEl.classList.remove("show"), ms);
}
 
/* ---------- toolbar: new tools ---------- */
const trash = [];
function notify(t, b) { try { if (Notification.permission === "granted") new Notification(t, { body: b }); } catch {} }
function askNotify() {}

// templates
const TPL = { todo: "☐ \n☐ \n☐ ", hw: "📚 Subject:\nTask:\nDue:", exam: "🧪 Exam:\nTopics:\n• \n• ", goal: "🎯 Goal:\nSteps:\n1. \n2. " };
$("#tpl").onchange = (e) => {
  const v = e.target.value; e.target.value = "";
  if (!TPL[v]) return;
  addNote();
  active.text = TPL[v]; noteEl(active).querySelector(".text").textContent = TPL[v]; save();
};

// tidy up: grid of loose notes, pinned ones stay put
$("#tidy").onclick = () => {
  const loose = notes.filter((n) => !n.folder && !n.pinned);
  if (!loose.length) return toast("Nothing to tidy");
  const w = noteEl(loose[0])?.offsetWidth || Math.min(220, innerWidth * 0.45), gap = 24;
  const left = (!bar.hidden || sd.classList.contains("open")) && innerWidth >= 860 ? 350 : 16, right = drawerOpen && innerWidth >= 860 ? 350 : 16;
  const span = innerWidth - left - right;
  let cols = Math.max(1, Math.floor((span + gap) / (w + gap)));
  if (innerWidth < 700) cols = Math.max(cols, 2);   // on a phone, overlap a little instead of running off the screen
  const stepX = cols > 1 ? Math.min(w + gap, (span - w) / (cols - 1)) : 0;
  const rows = Math.ceil(loose.length / cols), nh0 = noteEl(loose[0])?.offsetHeight || 230;
  const stepY = rows > 1 ? Math.min(nh0 + gap, Math.max(36, (innerHeight - 78 - nh0) / (rows - 1))) : 0;
  loose.forEach((n, i) => {
    const el = noteEl(n);
    n.x = lay.ux(left + (i % cols) * stepX); n.y = lay.uy(70 + Math.floor(i / cols) * stepY); n.r = +rand(-1.5, 1.5).toFixed(1);
    if (!el) return;
    el.classList.add("fly"); place(n, el); el.style.setProperty("--r", n.r + "deg");
    setTimeout(() => el.classList.remove("fly"), 700);
  });
  save(); toast("Tidied up 🧹");
};

// duplicate the selected note
$("#dup").onclick = () => {
  if (!active || !noteEl(active)) return toast("Click a note first, then duplicate it");
  const c = { ...active, id: uid(), x: active.x + 28, y: active.y + 28, r: +rand(-6, 6).toFixed(1), pinned: false, notified: false };
  notes.push(c); active = c; draw(c); update(); save(); toast("Duplicated 📄");
};

// undo toss
function undoToss() {
  const n = trash.pop();
  if (!n) return toast("Nothing to bring back");
  if (!folders.some((f) => f.id === n.folder)) n.folder = "";
  notes.push(n);
  if (!n.folder) draw(n);
  renderFolders(); update(); save(); toast("Brought back 📝");
}
$("#undo").onclick = undoToss;

// show only one color (works together with search)
let cfil = "";
const cf = $("#cfilter");
["", "yellow", "pink", "mint", "sky", "peach", "lilac", "lime"].forEach((c) => {
  const b = h("button", { type: "button", className: "chip" + (c ? "" : " on"), textContent: c ? "" : "All", title: c ? "Show only " + c : "Show all colors" });
  b.setAttribute("aria-label", b.title);
  if (c) b.dataset.color = c;
  b.onclick = () => { cfil = c; [...cf.querySelectorAll(".chip")].forEach((x) => x.classList.toggle("on", x === b)); applyDim(); };
  cf.append(b);
});
function applyDim() {
  const q = $("#search").value.trim().toLowerCase();
  notes.forEach((n) => noteEl(n)?.classList.toggle("dim", (!!q && !n.text.toLowerCase().includes(q)) || (!!cfil && n.color !== cfil)));
}

// focus timer
let tMin = 25, tLeft = 25 * 60, tEnd = 0, tRun = null;
const fmt = (s) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
function tShow() {
  $("#tClock").textContent = fmt(tLeft);
  $("#tGo").textContent = tRun ? "Pause" : "Start";
  document.title = tRun ? `${fmt(tLeft)} · Sticky Notes` : "Sticky Notes";
}
function tStop() { clearInterval(tRun); tRun = null; }
function chime() {
  try {
    const a = new AudioContext();
    [660, 880, 1100].forEach((f, i) => {
      const o = a.createOscillator(), g = a.createGain(), t = a.currentTime + i * 0.25;
      o.frequency.value = f; g.gain.setValueAtTime(0.2, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
      o.connect(g); g.connect(a.destination); o.start(t); o.stop(t + 0.45);
    });
  } catch {}
}
$("#tGo").onclick = () => {
  if (tRun) tStop();
  else {
    askNotify();
    if (!tLeft) tLeft = tMin * 60;
    tEnd = Date.now() + tLeft * 1000;
    tRun = setInterval(() => {
      tLeft = Math.max(0, Math.round((tEnd - Date.now()) / 1000));
      if (!tLeft) { tStop(); chime(); toast("⏰ Time's up!"); notify("⏰ Time's up!", "Take a breather or start the next round."); }
      tShow();
    }, 250);
  }
  tShow();
};
$("#tReset").onclick = () => { tStop(); tLeft = tMin * 60; tShow(); };
document.querySelectorAll(".tp").forEach((b) => b.addEventListener("click", () => {
  tMin = +b.dataset.min; tStop(); tLeft = tMin * 60; tShow();
  document.querySelectorAll(".tp").forEach((x) => x.classList.toggle("on", x === b));
}));

/* ---------- my schedule ---------- */
function locate(n) {
  if (n.folder) {
    const f = folders.find((x) => x.id === n.folder);
    if (f) f.open = true;
    renderFolders(); return toast(`It's in “${f?.name}” 📁`);
  }
  const el = noteEl(n);
  if (!el) return;
  el.style.zIndex = ++topZ; el.classList.remove("ping"); void el.offsetWidth; el.classList.add("ping");
}
function sitem(n) {
  const d = dueInfo(n.due), cb = h("input", { type: "checkbox", checked: !!n.done, title: "Mark done" });
  cb.onchange = () => { n.done = cb.checked; n.notified = true; const el = noteEl(n); if (el) paint(n, el); update(); save(); };
  const tm = h("input", { type: "time", className: "stime", value: n.time || "", title: "Reminder time (blank uses your default)" });
  tm.onchange = () => { n.time = tm.value; n.notified = false; save(); };
  const it = h("div", { className: "sitem" + (n.done ? " done" : "") + (!n.done && d.days < 0 ? " late" : "") }, cb,
    h("button", { type: "button", className: "stext", title: "Show this note", textContent: `${n.emoji ? n.emoji + " " : ""}${n.text.trim().slice(0, 50) || "(empty note)"}`, onclick: () => locate(n) }),
    tm, h("span", { className: "sdue", textContent: n.done ? "✓" : d.t }));
  it.dataset.color = n.color;
  return it;
}
function renderSchedule() {
  const items = notes.filter((n) => n.due).sort((a, b) => a.due.localeCompare(b.due));
  const G = [["Overdue", (d) => d < 0], ["Today", (d) => d === 0], ["Tomorrow", (d) => d === 1], ["This week", (d) => d <= 7], ["Later", () => true]];
  const out = [];
  G.forEach(([name, test]) => {
    const g = items.filter((n) => !n.done && G.find((x) => x[1](dueInfo(n.due).days))[0] === name);
    if (g.length) out.push(h("p", { className: "sgroup", textContent: name }), ...g.map(sitem));
  });
  const done = items.filter((n) => n.done);
  if (done.length) out.push(h("p", { className: "sgroup", textContent: "Done" }), ...done.map(sitem));
  $("#sList").replaceChildren(...(out.length ? out : [h("div", { className: "fempty", textContent: "Nothing scheduled. Add a reminder above, or set a due date on any note." })]));
}
const today = () => new Date(Date.now() - new Date().getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
$("#sForm").elements.due.value = today();
$("#sForm").onsubmit = (e) => {
  e.preventDefault();
  const f = e.target;
  addNote();
  const n = active, el = noteEl(n);
  n.text = f.elements.text.value.trim(); n.due = f.elements.due.value; n.time = f.elements.time.value; n.emoji ||= "⏰";
  el.querySelector(".text").textContent = n.text; el.querySelector(".due").value = n.due;
  paint(n, el); f.reset(); f.elements.due.value = today();
  askNotify(); update(); save(); toast("Reminder added ⏰");
};


/* ---------- schedule sidebar: picture + reminder settings ---------- */
const sd = $("#sched");
function setSched(o) { if (o && innerWidth < 860) { setDrawer(false); setBar(false, true); }
  sd.classList.toggle("open", o); sd.inert = !o; $("#sTab").hidden = o; }
setSched(false); schedReady = true;
$("#sTab").onclick = () => setSched(true);
$("#sClose").onclick = () => setSched(false);
$("#schedBtn").onclick = () => setSched(!sd.classList.contains("open"));

let sch = { images: [], settings: { time: "08:00", lead: 0, sound: true, notif: false, picBoard: false } }, schTimer;
function saveSch() {
  clearTimeout(schTimer);
  schTimer = setTimeout(() => fetch("/api/schedule", { method: "POST", body: JSON.stringify(sch) })
    .then((r) => { if (!r.ok) toast("Couldn't save your pictures (too big?)"); })
    .catch(() => toast("Couldn't save your schedule")), 400);
}
const canNotify = () => typeof Notification !== "undefined" && Notification.permission === "granted";
function openLightbox(src) { $("#lightbox img").src = src; $("#lightbox").hidden = false; }

// gallery in the schedule drawer + pictures placed on the main board
function showPic() {
  $("#picEmpty").hidden = !!sch.images.length;
  $("#picGrid").replaceChildren(...sch.images.map(picCard));
  renderPhotos();
}
function picCard(p) {
  const img = h("img", { src: p.src, alt: p.name, title: "Click to enlarge" });
  img.onclick = () => openLightbox(p.src);
  const chk = h("input", { type: "checkbox", checked: !!p.board });
  chk.onchange = () => {
    p.board = chk.checked;
    renderPhotos(); saveSch();
    toast(p.board ? "Added to the main page 📌" : "Removed from the main page");
  };
  const del = h("button", { type: "button", className: "xbtn", title: "Delete this picture", textContent: "✕" });
  del.onclick = () => {
    if (!confirm("Delete this picture?")) return;
    sch.images = sch.images.filter((x) => x !== p);
    showPic(); saveSch();
  };
  return h("div", { className: "pcard" }, img, del, h("label", { className: "pshow" }, chk, " Show on main page"));
}
function renderPhotos() {
  board.querySelectorAll(".photo").forEach((e) => e.remove());
  sch.images.filter((p) => p.board).forEach(drawPhoto);
  fitBoard();
}
function drawPhoto(p) {
  const el = h("figure", { className: "photo", title: "Drag to move, double-click to enlarge" },
    h("img", { src: p.src, alt: p.name, draggable: false, onload: fitSoon }),
    h("button", { type: "button", className: "x", title: "Take off the main page", textContent: "×" }),
    h("span", { className: "grip", title: "Drag to resize" }));
  el.dataset.pid = p.id;
  el.style.cssText = `width:${p.w}px;--r:${p.r}deg;z-index:${++topZ}`;
  el.querySelector(".x").onclick = () => { p.board = false; showPic(); saveSch(); };
  el.ondblclick = () => openLightbox(p.src);
  const track = (e, onMove) => {
    e.preventDefault(); e.stopPropagation();
    el.style.zIndex = ++topZ;
    const sx = e.clientX, sy = e.clientY, ox = parseFloat(el.style.left) || 0, oy = parseFloat(el.style.top) || 0, ow = el.offsetWidth;
    const mv = (ev) => onMove(ev.clientX - sx, ev.clientY - sy, ox, oy, ow);
    const up = () => { removeEventListener("pointermove", mv); removeEventListener("pointerup", up); saveSch(); };
    addEventListener("pointermove", mv); addEventListener("pointerup", up);
  };
  el.addEventListener("pointerdown", (e) => {
    if (e.target.closest(".x, .grip")) return;
    track(e, (dx, dy, ox, oy) => {
      const X = Math.max(-60, Math.min(innerWidth - 90, ox + dx)), Y = Math.max(0, Math.min(innerHeight - 60, oy + dy));
      p.x = lay.ux(X); p.y = lay.uy(Y);
      el.style.left = X + "px"; el.style.top = Y + "px";
    });
  });
  el.querySelector(".grip").addEventListener("pointerdown", (e) =>
    track(e, (dx, dy, ox, oy, ow) => { p.w = Math.max(100, Math.min(900, innerWidth - 16, ow + dx)); el.style.width = p.w + "px"; }));
  board.appendChild(el);
  place(p, el);
}
function fillSet() {
  const s = sch.settings;
  $("#picDefault").checked = !!s.picBoard;
  $("#rTime").value = s.time; $("#rLead").value = String(s.lead); $("#rSound").checked = !!s.sound; $("#rNotif").checked = !!s.notif && canNotify();
}
async function loadSch() {
  try {
    const d = await (await fetch("/api/schedule")).json();
    // older saves kept a single picture in "image"
    sch.images = Array.isArray(d.images) ? d.images : d.image ? [{ id: uid(), src: d.image, name: "My class schedule", board: false }] : [];
    Object.assign(sch.settings, d.settings || {});
  } catch {}
  sch.images.forEach((p, i) => {
    p.board = !!p.board; p.w = p.w || 240; p.r = p.r || 0;
    if (p.x == null || (!p.x && !p.y)) { p.x = 60 + i * 30; p.y = 100 + i * 30; }
  });
  showPic(); fillSet();
}

// picture: shrink to a sensible size, then keep it on the server
$("#picAdd").onclick = () => $("#picFile").click();
const shrink = (f) => new Promise((res) => {
  const img = new Image();
  img.onload = () => {
    const k = Math.min(1, 1400 / Math.max(img.width, img.height)), cv = document.createElement("canvas");
    cv.width = Math.round(img.width * k); cv.height = Math.round(img.height * k);
    const g = cv.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, cv.width, cv.height); g.drawImage(img, 0, 0, cv.width, cv.height);
    URL.revokeObjectURL(img.src);
    res(cv.toDataURL("image/jpeg", 0.8));
  };
  img.onerror = () => res(null);
  img.src = URL.createObjectURL(f);
});
$("#picFile").onchange = async (e) => {
  const files = [...e.target.files].filter((f) => f.type.startsWith("image/")); e.target.value = "";
  if (!files.length) return toast("Please pick picture files");
  const onBoard = $("#picDefault").checked;
  let added = 0;
  for (const f of files) {
    if (sch.images.length >= 40) { toast("You can keep up to 40 pictures"); break; }
    const src = await shrink(f);
    if (!src) continue;
    const i = sch.images.length;
    sch.images.push({ id: uid(), src, name: f.name.replace(/\.[^.]+$/, "").slice(0, 80), board: onBoard,
      x: 60 + (i % 8) * 30, y: 100 + (i % 8) * 30, w: 240, r: +rand(-3, 3).toFixed(1) });
    added++;
  }
  showPic(); saveSch();
  toast(added ? `Added ${added} picture${added > 1 ? "s" : ""} 📷` : "None of those could be read as pictures");
};
$("#picDefault").onchange = () => { sch.settings.picBoard = $("#picDefault").checked; saveSch(); };
$("#lightbox").onclick = () => { $("#lightbox").hidden = true; };

// reminder settings
const fireAt = (n) => new Date(`${n.due}T${n.time || sch.settings.time}`).getTime() - sch.settings.lead * 6e4;
function rearm() {
  notes.forEach((n) => { if (n.due && !n.done && fireAt(n) > Date.now()) n.notified = false; });
  saveSch(); save(); toast("Reminder settings saved");
}
$("#rTime").onchange = () => { sch.settings.time = $("#rTime").value || "08:00"; rearm(); };
$("#rLead").onchange = () => { sch.settings.lead = +$("#rLead").value; rearm(); };
$("#rSound").onchange = () => { sch.settings.sound = $("#rSound").checked; saveSch(); };
$("#rNotif").onchange = async () => {
  const box = $("#rNotif");
  if (box.checked) {
    let p = "denied";
    try { p = await Notification.requestPermission(); } catch {}
    if (p !== "granted") { box.checked = false; return toast("Notifications are blocked. Allow them in your browser's site settings.", 3500); }
  }
  sch.settings.notif = box.checked; saveSch();
};
function alertUser(title, body) {
  toast(`${title}: ${body}`, 6000);
  if (sch.settings.sound) chime();
  if (sch.settings.notif) notify(title, body);
}
$("#rTest").onclick = () => alertUser("⏰ Test reminder", "This is how your reminders will look.");

// fires once per note, at its time (minus the lead time you chose)
function remind() {
  const due = notes.filter((n) => n.due && !n.done && !n.notified && fireAt(n) <= Date.now());
  if (!due.length) return;
  due.forEach((n) => (n.notified = true));
  alertUser("⏰ Reminder", due.length === 1 ? `${due[0].text.trim().slice(0, 40) || "A note"} (${dueInfo(due[0].due).t})` : `${due.length} notes are due`);
  save();
}
setInterval(remind, 20000);

loadSch();
load();
