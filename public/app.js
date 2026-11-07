// CHUD: upload a GCSE maths paper → pick a topic → teach Chud → Chud sits the paper's questions.
const $view = document.getElementById("view");
let pollTimer = null;
const MAX_BYTES = 20 * 1024 * 1024;

/* ---------------- helpers ---------------- */
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

async function api(path, body) {
  const res = await fetch(path, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {});
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

/** Your Chud art: confused while learning, smart once it's getting it. */
const isSmart = (mood) => mood === "getting it" || mood === "confident";
const chud = (mood = "confused", cls = "", full = false) =>
  `<img class="chud ${cls}" src="/chud-${isSmart(mood) ? "smart" : "confused"}${full ? "" : "-face"}.png" alt="Chud is ${esc(mood)}">`;

function showNew(on) { document.getElementById("newBtn").hidden = !on; }

const readFile = (file) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve({ name: file.name, type: file.type, data: String(r.result).split(",")[1] });
  r.onerror = () => reject(new Error(`Couldn't read ${file.name}`));
  r.readAsDataURL(file);
});

/* ---------------- 1. upload a paper ---------------- */
function dropzone(id, title, hint, required) {
  return `<label class="drop" id="${id}">
    <input type="file" accept="application/pdf,image/png,image/jpeg,image/webp,image/gif" multiple ${required ? "required" : ""}>
    <span class="ico"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M12 18v-6M9 15l3-3 3 3"/></svg></span>
    <div><b>${title}</b><span class="names">${hint}</span></div>
  </label>`;
}

function wireDrop(el, hint) {
  const input = el.querySelector("input");
  const names = el.querySelector(".names");
  const show = () => {
    const fs = [...input.files];
    el.classList.toggle("filled", fs.length > 0);
    names.textContent = fs.length ? fs.map((f) => f.name).join(", ") : hint;
  };
  input.onchange = show;
  el.ondragover = (e) => { e.preventDefault(); el.classList.add("over"); };
  el.ondragleave = () => el.classList.remove("over");
  el.ondrop = (e) => { e.preventDefault(); el.classList.remove("over"); input.files = e.dataTransfer.files; show(); };
  return input;
}

function viewStart(error = "") {
  showNew(false);
  const last = store.get("lastPaper");
  $view.innerHTML = `
    <section class="start">
      <div class="hero-pair"><img src="/chud-confused.png" alt="Chud before"><span class="arrow">→</span><img class="smart" src="/chud-smart.png" alt="Chud after"></div>
      <h1>Teach Chud maths.<br><em>Prove you get it.</em></h1>
      <p class="sub">Chud is clueless at GCSE maths. Upload a real exam paper, teach Chud one topic, then watch it sit the questions. Chud's marks show how well you really understand it.</p>
      <form class="upload" id="uploadForm">
        ${error ? `<div class="error">${esc(error)}</div>` : ""}
        ${dropzone("paperDrop", "GCSE maths exam paper", "PDF, or photos of the pages", true)}
        ${dropzone("msDrop", "Mark scheme (optional)", "Without one, CHUD writes its own", false)}
        <button class="btn btn-primary btn-lg" style="width:100%" type="submit">Scan paper</button>
        <p class="simple-hint">Works best with <b>simple topics</b> like fractions, percentages, ratio, linear equations, angles and Pythagoras.</p>
      </form>
      ${last ? `<a class="resume" href="#/p/${esc(last.id)}">↻ Continue with “${esc(last.title)}”</a>` : ""}
      <div class="steps">
        <div class="card"><b>1 · Upload</b><p>Add a GCSE maths paper. CHUD sorts its questions by topic.</p></div>
        <div class="card"><b>2 · Teach</b><p>Pick a topic and explain it to Chud. Fix its mistakes as you go.</p></div>
        <div class="card"><b>3 · Exam</b><p>Chud sits that topic's real questions and gets marked like a GCSE.</p></div>
      </div>
    </section>`;
  const form = document.getElementById("uploadForm");
  const paperIn = wireDrop(document.getElementById("paperDrop"), "PDF, or photos of the pages");
  const msIn = wireDrop(document.getElementById("msDrop"), "Without one, CHUD writes its own");
  form.onsubmit = async (e) => {
    e.preventDefault();
    const all = [...paperIn.files, ...msIn.files];
    if (!paperIn.files.length) return viewStart("Please add the exam paper.");
    if (all.reduce((s, f) => s + f.size, 0) > MAX_BYTES) return viewStart("Files are too large. Keep the total under 20 MB.");
    $view.innerHTML = `<div class="loading">${chud("confused", "", true)}<h2 style="margin:16px 0 6px">Chud is flicking through the paper…</h2><p>Reading every question, sorting them by topic and working out the mark scheme. Long papers can take a minute.</p><span class="spinner" style="color:var(--primary)"></span></div>`;
    try {
      const [paper, markScheme] = await Promise.all([Promise.all([...paperIn.files].map(readFile)), Promise.all([...msIn.files].map(readFile))]);
      const { paper: p } = await api("/api/papers", { paper, markScheme });
      store.set("lastPaper", { id: p.id, title: p.title });
      location.hash = `#/p/${p.id}`;
    } catch (err) { viewStart(err.message); }
  };
}

/* ---------------- 2. pick a topic ---------------- */
function viewPaper(p) {
  showNew(true);
  $view.innerHTML = `
    <div class="paper-head">${chud("curious", "", true)}
      <div><h1 style="font-size:clamp(1.6rem,4vw,2.3rem)">${esc(p.title)}</h1>
      <p class="muted" style="margin:4px 0 0">${p.question_count} questions · ${p.total_marks} marks · calculator ${esc(p.calculator)} · ${p.has_mark_scheme ? "official mark scheme" : "mark scheme written by CHUD"}</p></div>
    </div>
    <h2 style="margin-bottom:6px">What will you teach Chud?</h2>
    <p class="muted">Chud will sit every question on that topic from this paper. Starred topics are great for a first go.</p>
    <div class="topics" style="margin-top:16px">
      ${p.topics.map((t) => `<button class="topic" data-topic="${esc(t.topic)}">${t.simple ? '<span class="star chip">★ simple</span>' : ""}<h3>${esc(t.topic)}</h3><div class="meta">${t.questions} question${t.questions === 1 ? "" : "s"} · ${t.marks} mark${t.marks === 1 ? "" : "s"}</div></button>`).join("")}
    </div>
    ${p.skipped.length ? `<details style="margin-top:22px" class="small muted"><summary class="small">${p.skipped.length} question${p.skipped.length === 1 ? "" : "s"} skipped (Chud can't draw)</summary><ul class="plain" style="margin-top:8px">${p.skipped.map((s) => `<li>Q${esc(s.number)}: ${esc(s.reason)}</li>`).join("")}</ul></details>` : ""}`;
  $view.querySelectorAll("[data-topic]").forEach((b) => (b.onclick = () => startTopic(p, b.dataset.topic)));
}

async function startTopic(p, topic) {
  $view.innerHTML = `<div class="loading">${chud("confused", "", true)}<h2 style="margin:16px 0 6px">Chud is getting ready…</h2><p>Working out what Chud needs to learn for ${esc(topic)}. Chud won't see the questions.</p><span class="spinner" style="color:var(--primary)"></span></div>`;
  try {
    const { session } = await api("/api/sessions", { paperId: p.id, topic });
    history.replaceState(null, "", `#/s/${session.id}`);
    renderTeach(session);
  } catch (err) {
    viewPaper(p);
    $view.insertAdjacentHTML("afterbegin", `<div class="error">${esc(err.message)}</div>`);
  }
}

/* ---------------- 3. teach ---------------- */
function renderTeach(s) {
  showNew(true);
  const lastMood = [...s.transcript].reverse().find((t) => t.role === "chud")?.mood || "confused";
  $view.innerHTML = `
    ${s.status === "error" ? `<div class="error">${esc(s.error)} Your teaching is saved, so try the exam again.</div>` : ""}
    <div class="teach">
      <section class="chat">
        <div class="chat-head">
          <div class="who"><span id="headChud">${chud(lastMood)}</span><div style="min-width:0"><h2>Teaching Chud: ${esc(s.title)}</h2><div class="small muted" id="info"></div></div></div>
          <button class="btn btn-primary btn-sm" id="examBtn">Send Chud to the exam</button>
        </div>
        <div class="messages" id="messages"></div>
        <form class="composer" id="composer">
          <textarea id="msg" rows="1" maxlength="4000" placeholder="Explain it like you're helping a mate… or tap the mic and say it!" required></textarea>
          <button class="mic-btn" id="micBtn" type="button" aria-label="Speak your explanation" title="Speak your explanation">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10a7 7 0 0 0 14 0M12 17v5M8 22h8"/></svg>
          </button>
          <button class="btn btn-primary" id="sendBtn" type="submit">Send</button>
        </form>
      </section>
      <aside class="side">
        <div class="card">
          <div class="side-chud"><span id="sideChud">${chud(lastMood)}</span><div><h3>Chud's brain</h3><p class="small muted" style="margin:0">What Chud believes right now</p></div></div>
          <div class="brain"><div class="bar"><span id="brainBar" style="width:0%"></span></div><div class="lbl"><span>clueless</span><span id="brainPct"></span><span>big brain</span></div></div>
          <p class="small muted" style="margin-bottom:8px"><span class="key" style="background:#F59E0B"></span>mistake Chud started with · <span class="key" style="background:var(--primary)"></span>taught by you</p>
          <div id="beliefs"></div><div id="openQs"></div>
        </div>
        <div class="card"><h3 style="margin-bottom:8px">Cover these to pass</h3><ol class="plain small">${s.objectives.map((o) => `<li>${esc(o.text)}</li>`).join("")}</ol>
          <p class="small muted" style="margin:10px 0 0">Chud will sit ${s.exam_count} hidden question${s.exam_count === 1 ? "" : "s"} (${s.exam_marks} marks) from ${esc(s.paper_title)}.</p></div>
      </aside>
    </div>`;

  const $msgs = document.getElementById("messages");
  const $msg = document.getElementById("msg");
  const $send = document.getElementById("sendBtn");
  const $exam = document.getElementById("examBtn");
  let transcript = s.transcript;
  let seen = new Set(s.notebook.beliefs.map((b) => b.statement));

  const renderMsgs = (list, typing = false) => {
    $msgs.innerHTML = list.map((t) => t.role === "chud"
      ? `<div class="msg chud-msg">${chud(t.mood)}<div><div class="bubble">${esc(t.text)}</div>${t.mood ? `<div class="mood">${esc(t.mood)}</div>` : ""}</div></div>`
      : `<div class="msg you"><div class="bubble">${esc(t.text)}</div></div>`).join("")
      + (typing ? `<div class="msg chud-msg">${chud("confused")}<div class="bubble typing"><i></i><i></i><i></i></div></div>` : "");
    $msgs.scrollTop = $msgs.scrollHeight;
  };
  const renderBrain = (nb, flash) => {
    const taught = nb.beliefs.filter((b) => b.origin === "taught").length;
    const pct = nb.beliefs.length ? Math.round((taught / nb.beliefs.length) * 100) : 0;
    document.getElementById("brainBar").style.width = pct + "%";
    document.getElementById("brainPct").textContent = `${pct}%`;
    document.getElementById("beliefs").innerHTML = nb.beliefs.length
      ? nb.beliefs.map((b) => `<div class="belief ${b.origin === "taught" ? "taught" : "start"} ${flash && !seen.has(b.statement) ? "flash" : ""}">${esc(b.statement)}<small>${b.origin === "taught" ? "taught" : "starting mistake"} · ${esc(b.confidence)}</small></div>`).join("")
      : `<p class="small muted">Empty… Chud has forgotten everything!</p>`;
    document.getElementById("openQs").innerHTML = nb.open_questions.length
      ? `<h3 style="margin:14px 0 6px;font-size:.92rem">Chud is wondering…</h3><ul class="plain small">${nb.open_questions.map((q) => `<li>${esc(q)}</li>`).join("")}</ul>` : "";
    seen = new Set(nb.beliefs.map((b) => b.statement));
  };
  const renderInfo = (turns, mood) => {
    document.getElementById("info").textContent = `${turns}/${s.max_turns} messages · Chud is ${mood}`;
    document.getElementById("headChud").innerHTML = chud(mood);
    document.getElementById("sideChud").innerHTML = chud(mood);
    $exam.disabled = turns === 0;
  };

  renderMsgs(transcript);
  renderBrain(s.notebook, false);
  renderInfo(s.turns, lastMood);

  const autosize = () => { $msg.style.height = "auto"; $msg.style.height = Math.min($msg.scrollHeight, 200) + "px"; };
  $msg.oninput = autosize;
  $msg.onkeydown = (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); document.getElementById("composer").requestSubmit(); } };
  $msg.focus();
  const voice = setupVoice($msg, document.getElementById("micBtn"), autosize, $msgs);

  document.getElementById("composer").onsubmit = async (e) => {
    e.preventDefault();
    voice.stop();
    const text = $msg.value.trim();
    if (!text) return;
    $send.disabled = $exam.disabled = $msg.disabled = true;
    renderMsgs([...transcript, { role: "you", text }], true);
    $msg.value = ""; autosize();
    try {
      const { session } = await api(`/api/sessions/${s.id}/messages`, { text });
      transcript = session.transcript;
      renderMsgs(transcript);
      renderBrain(session.notebook, true);
      renderInfo(session.turns, transcript.at(-1)?.mood || "confused");
    } catch (err) {
      renderMsgs(transcript);
      $msg.value = text;
      $msgs.insertAdjacentHTML("beforeend", `<div class="error">${esc(err.message)}</div>`);
      $msgs.scrollTop = $msgs.scrollHeight;
      $exam.disabled = !transcript.some((t) => t.role === "you");
    } finally {
      $send.disabled = $msg.disabled = false;
      $msg.focus();
    }
  };

  $exam.onclick = async () => {
    if (!confirm("Done teaching? Chud sits the exam using only what you taught it. You can't teach more after this.")) return;
    $view.innerHTML = examWaiting();
    try {
      const { session } = await api(`/api/sessions/${s.id}/exam`, {});
      session.status === "complete" ? renderReport(session) : renderTeach(session);
    } catch (err) { alert(err.message); route(); }
  };
}

/* ---------------- voice input (browser speech recognition) ---------------- */
// Turns common spoken maths into symbols, e.g. "40 divided by 8" → "40 ÷ 8".
const spokenMaths = (t) => t
  .replace(/\bdivided by\b/gi, "÷")
  .replace(/\bmultiplied by\b/gi, "×")
  .replace(/\bsquare root of\s*/gi, "√")
  .replace(/\s*\bsquared\b/gi, "²")
  .replace(/\s*\bcubed\b/gi, "³")
  .replace(/\bequals\b/gi, "=");

function setupVoice($msg, $mic, autosize, $msgs) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR || !window.isSecureContext) {
    $mic.disabled = true;
    $mic.title = !window.isSecureContext ? "Voice needs HTTPS (or localhost)" : "Voice input works in Chrome, Edge or Safari";
    return { stop() {} };
  }
  let rec = null;
  let listening = false;
  let base = "";       // text in the box before this stretch of speech
  let finalText = "";  // confirmed speech so far in this stretch

  const join = (a, b) => (a && b && !/\s$/.test(a) ? `${a} ${b}` : a + b);
  const notice = (msg) => {
    $msgs.insertAdjacentHTML("beforeend", `<div class="error">${esc(msg)}</div>`);
    $msgs.scrollTop = $msgs.scrollHeight;
  };
  const setUi = (on) => {
    $mic.classList.toggle("listening", on);
    $mic.setAttribute("aria-pressed", String(on));
    $mic.title = on ? "Stop listening" : "Speak your explanation";
    $msg.placeholder = on ? "Listening… speak your explanation" : "Explain it like you're helping a mate… or tap the mic and say it!";
  };

  const begin = () => {
    rec = new SR();
    rec.lang = "en-GB";
    rec.continuous = true;
    rec.interimResults = true;
    base = $msg.value;
    finalText = "";
    rec.onresult = (e) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const chunk = e.results[i][0].transcript;
        if (e.results[i].isFinal) finalText = join(finalText, spokenMaths(chunk.trim()));
        else interim += chunk;
      }
      $msg.value = join(join(base, finalText), spokenMaths(interim.trim()));
      autosize();
    };
    rec.onerror = (e) => {
      if (e.error === "no-speech" || e.error === "aborted") return;
      listening = false;
      setUi(false);
      notice(e.error === "not-allowed" || e.error === "service-not-allowed"
        ? "Microphone is blocked. Allow mic access for this site in your browser's address bar, then try again."
        : e.error === "network" ? "Voice input needs an internet connection." : `Voice input error: ${e.error}`);
    };
    // Browsers end recognition after a pause; keep going until the user taps stop.
    rec.onend = () => {
      $msg.value = join(base, finalText);
      autosize();
      if (listening) begin();
    };
    try { rec.start(); } catch { /* already started */ }
  };

  const stop = () => {
    if (!listening) return;
    listening = false;
    setUi(false);
    try { rec?.stop(); } catch {}
  };

  $mic.onclick = () => {
    if (listening) return stop();
    listening = true;
    setUi(true);
    begin();
  };
  return { stop };
}

const examWaiting = () => `<div class="loading">${chud("confused", "", true)}<h2 style="margin:16px 0 6px">Chud is sitting the exam…</h2><p>No calculator, no notes. Chud only has what you taught it. Then an examiner marks every answer.</p><span class="spinner" style="color:var(--primary)"></span></div>`;

/* ---------------- 4. results ---------------- */
function renderReport(s) {
  showNew(true);
  const r = s.report, g = r.grade;
  const q = Object.fromEntries(r.questions.map((x) => [x.id, x]));
  const ans = Object.fromEntries(r.answers.map((a) => [a.question_id, a]));
  const obj = Object.fromEntries(s.objectives.map((o) => [o.id, o.text]));
  const ring = r.score >= 75 ? "var(--good)" : r.score >= 45 ? "var(--primary)" : "var(--bad)";
  const mood = r.score >= 60 ? "confident" : "confused";
  const verdict = r.score >= 85 ? "Big-brain teaching. Chud smashed it." : r.score >= 65 ? "Solid. Chud picked up most of the marks." : r.score >= 40 ? "Chud scraped some marks, but there are gaps." : "Chud is still lost. Time to reteach.";
  const lvl = { solid: "good", partial: "", "misconception remains": "warn", "not taught": "neutral" };
  $view.innerHTML = `
    <div class="report">
      <div class="card"><div class="report-head">
        <div class="score-ring" style="--p:${r.score};--ring:${ring}"><div><div><b>${r.marks}/${r.total}</b><span class="small muted">marks · ${r.score}%</span></div></div></div>
        <div style="flex:1;min-width:220px">
          <h1 style="font-size:1.7rem">${esc(s.title)}</h1>
          <p style="font-size:1.1rem;margin:8px 0 4px">${verdict}</p>
          <p class="small muted">${esc(s.paper_title)} · ${r.questions.length} question${r.questions.length === 1 ? "" : "s"} · ${s.turns} messages of teaching</p>
          <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:6px"><a class="btn btn-primary btn-sm" href="#/p/${esc(s.paper_id)}">Teach another topic</a></div>
        </div>
        ${chud(mood, "", true).replace('class="chud ', 'style="width:120px" class="chud ')}
      </div></div>
      <div class="card tip"><h3>Next time</h3><p style="margin:6px 0 0">${esc(g.coaching_tip)}</p></div>
      <div class="grid-2">
        <div class="card"><h2 style="margin-bottom:10px">What you nailed</h2>${g.strengths.length ? `<ul class="plain">${g.strengths.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : `<p class="muted">Nothing stood out yet.</p>`}</div>
        <div class="card"><h2 style="margin-bottom:10px">Where Chud lost marks</h2>${g.gaps.length ? `<ul class="plain">${g.gaps.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : `<p class="muted">No major gaps.</p>`}
          ${g.lingering_misconceptions.length ? `<h3 style="margin:14px 0 6px">Mistakes Chud still makes</h3><ul class="plain">${g.lingering_misconceptions.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}</div>
      </div>
      <div class="card"><h2 style="margin-bottom:8px">Skill by skill</h2>
        ${g.objective_mastery.map((m) => `<div class="obj"><div><b>${esc(obj[m.objective_id] || m.objective_id)}</b><div class="small muted">${esc(m.note)}</div></div><span class="chip ${lvl[m.level] ?? "neutral"}" style="white-space:nowrap">${esc(m.level)}</span></div>`).join("")}
      </div>
      <div class="card"><h2 style="margin-bottom:8px">Chud's exam script</h2>
        ${r.questions.map((qq) => { const res = g.results.find((x) => x.question_id === qq.id) || { marks_awarded: 0, justification: "Not marked." }; const a = ans[qq.id] || { answer_sheet: "", final_answer: "" }; const cls = res.marks_awarded === qq.marks ? "full" : res.marks_awarded > 0 ? "part" : "zero"; return `<div class="qa">
          <div class="q"><span>Q${esc(qq.number)}. ${esc(qq.text)}</span><span class="marks ${cls}">${res.marks_awarded}/${qq.marks}</span></div>
          ${qq.diagram ? `<div class="diagram">Diagram: ${esc(qq.diagram)}</div>` : ""}
          <div class="a">${chud(res.marks_awarded === qq.marks ? "confident" : "confused")}<div><div class="work">${esc(a.answer_sheet)}</div><div class="final">Answer: ${esc(a.final_answer)}</div></div></div>
          <div class="small">${esc(res.justification)}</div>
          <details class="small" style="margin-top:6px"><summary class="small muted">Mark scheme</summary><p class="small" style="margin-top:6px">Answer: ${esc(qq.answer)}<br>${esc(qq.mark_scheme)}</p></details></div>`; }).join("")}
      </div>
      <details class="card"><summary>Replay the lesson</summary><div style="margin-top:12px">${s.transcript.map((t) => `<p class="small"><b>${t.role === "chud" ? "Chud" : "You"}:</b> ${esc(t.text)}</p>`).join("")}</div></details>
    </div>`;
}

/* ---------------- router ---------------- */
async function route() {
  clearTimeout(pollTimer);
  const hash = location.hash;
  try {
    let m = hash.match(/^#\/p\/([a-f0-9]+)/);
    if (m) { const { paper } = await api(`/api/papers/${m[1]}`); store.set("lastPaper", { id: paper.id, title: paper.title }); return viewPaper(paper); }
    m = hash.match(/^#\/s\/([a-f0-9]+)/);
    if (m) {
      const { session } = await api(`/api/sessions/${m[1]}`);
      if (session.status === "complete") return renderReport(session);
      if (session.status === "examining") { $view.innerHTML = examWaiting(); pollTimer = setTimeout(route, 3000); return; }
      return renderTeach(session);
    }
    viewStart();
  } catch (err) {
    $view.innerHTML = `<div class="error">${esc(err.message)}</div><a href="#/">Start over</a>`;
  }
}

document.getElementById("logo").innerHTML = `<img class="chud" src="/chud-smart-face.png" alt="" style="width:34px;height:34px">CHUD`;
document.getElementById("themeBtn").onclick = () => {
  const root = document.documentElement;
  const dark = root.dataset.theme ? root.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
  root.dataset.theme = dark ? "light" : "dark";
  try { localStorage.setItem("theme", root.dataset.theme); } catch {}
};
window.addEventListener("hashchange", route);
api("/api/config").then((c) => { document.getElementById("mockBanner").hidden = !c.mock; }).catch(() => {});
route();
