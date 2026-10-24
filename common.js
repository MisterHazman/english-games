/* ============================================================
   English Team Games — shared code
   Setup screen, saving in the browser (localStorage), top bar,
   music, sound effects, "Are you sure?" box and winner screen.
   Every game page loads this file and calls EG.init({...}).
   ============================================================ */
const EG = (() => {
  const COLORS = ["#FF5A5F", "#2EC4B6", "#FFC145", "#A78BFA"];
  const NAMES  = ["Team Red", "Team Teal", "Team Gold", "Team Purple"];
  const YEARS  = [4, 5, 6];
  const MENU_URL = document.body.dataset.menu || "index.html";

  let cfg, settings, current;
  let playing = false, editorOpen = false;
  let counterEl, gameBtns, musicBtn;

  /* ---------------- small helpers ---------------- */
  // h("button", {className: "x", onclick}, "text") -> <button class="x">text</button>
  function h(tag, props = {}, ...kids){
    const el = Object.assign(document.createElement(tag), props);
    el.append(...kids.filter(k => k != null && k !== false && k !== ""));
    return el;
  }
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  function shuffle(arr){
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--){
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
  const plural = (n, [one, many]) => `${n} ${n === 1 ? one : many}`;

  /* ---------------- sound effects (made in code, no files) ---------------- */
  let ctx;
  function audio(){
    ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === "suspended") ctx.resume();
    return ctx;
  }
  function tone(freq, delay, dur, type = "sine", vol = 0.2){
    const c = audio(), t = c.currentTime + delay;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(c.destination);
    o.start(t); o.stop(t + dur + 0.05);
  }
  function noise(dur, vol, fromHz, toHz){
    const c = audio(), n = Math.floor(c.sampleRate * dur), t = c.currentTime;
    const buf = c.createBuffer(1, n, c.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const src = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    src.buffer = buf;
    f.type = "lowpass";
    f.frequency.setValueAtTime(fromHz, t);
    f.frequency.exponentialRampToValueAtTime(toHz, t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f); f.connect(g); g.connect(c.destination);
    src.start(); src.stop(t + dur);
  }
  // a sound problem must never stop the game
  const safe = fn => (...args) => { try { fn(...args); } catch (e) { /* no sound */ } };
  const sfx = {
    correct: safe(() => { tone(660, 0, 0.15, "triangle", 0.3); tone(990, 0.12, 0.3, "triangle", 0.3); }),
    wrong:   safe(() => { tone(220, 0, 0.25, "sawtooth", 0.12); tone(160, 0.18, 0.35, "sawtooth", 0.12); }),
    pop:     safe(() => { tone(520, 0, 0.1, "sine", 0.3); tone(780, 0.05, 0.1, "sine", 0.2); }),
    tick:    safe(urgent => tone(urgent ? 1400 : 900, 0, 0.06, "square", 0.08)),
    whoosh:  safe(() => noise(0.35, 0.4, 3000, 300)),
    boom:    safe(() => { noise(1.2, 0.9, 1200, 40); tone(80, 0, 0.8, "sine", 0.6); }),
    win:     safe(() => [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(f, i * 0.15, 0.4, "square", 0.15)))
  };

  /* ---------------- music: the file only downloads when Music is pressed ---------------- */
  let music;
  function toggleMusic(){
    if (!music){
      music = new Audio("background-music.mp3");
      music.loop = true;
      music.volume = 0.4;
      music.onplay  = () => musicBtn.textContent = "🔊 Music on";
      music.onpause = () => musicBtn.textContent = "🔈 Music off";
    }
    if (music.paused) music.play().catch(err => console.warn("Could not play background-music.mp3:", err));
    else music.pause();
  }

  /* ---------------- modals ---------------- */
  function modal(...kids){
    const back = h("div", { className: "modal-backdrop" }, h("div", { className: "modal", role: "dialog" }, ...kids));
    document.body.append(back);
    return back;
  }
  function closeModals(){ document.querySelectorAll(".modal-backdrop.eg").forEach(m => m.remove()); }

  // "Are you sure?" box. Resolves true for Yes, false for No.
  function ask(title, text, yesLabel = "Yes"){
    return new Promise(resolve => {
      const done = v => { m.remove(); resolve(v); };
      const no = h("button", { className: "btn-ghost btn-big", onclick: () => done(false) }, "No, go back");
      const m = modal(
        h("h3", {}, title),
        h("p", {}, text),
        h("div", { className: "modal-btns" },
          h("button", { className: "btn-danger btn-big", onclick: () => done(true) }, yesLabel),
          no));
      m.classList.add("eg");
      no.focus();   // the safe choice is the default
    });
  }

  function showWinner(title, lines = [], note = ""){
    playing = false;
    closeModals();
    sfx.win();
    const m = modal(
      h("div", { className: "trophy" }, "🏆"),
      h("h3", { className: "winner-title" }, title),
      note && h("p", {}, note),
      lines.length ? h("ul", { className: "score-lines" }, ...lines.map(l => h("li", {}, l))) : null,
      h("div", { className: "modal-btns" },
        h("button", { className: "btn-primary btn-big", onclick: () => { m.remove(); restart(); } }, "🔁 Play again"),
        h("button", { className: "btn-ghost", onclick: () => { m.remove(); showSetup(); } }, "⚙️ Change teams or questions"),
        h("a", { className: "btn-ghost btn-link", href: MENU_URL }, "🏠 Back to menu")));
    m.classList.add("eg");
    m.querySelector("button").focus();
  }

  // winner = highest score; equal top scores = a tie
  function winnerByScore(teams, score, unit, note = ""){
    const best = Math.max(...teams.map(score));
    const top = teams.filter(t => score(t) === best);
    showWinner(
      top.length === 1 ? `🎉 ${top[0].name} wins! 🎉` : "🤝 It's a tie!",
      [...teams].sort((a, b) => score(b) - score(a)).map(t => `${t.name}: ${plural(score(t), unit)}`),
      top.length > 1 ? `${top.map(t => t.name).join(" and ")} have the same score.` : note);
  }

  /* ---------------- team score cards ---------------- */
  function scoreboard(el, teams, { score, extra, button }){
    el.className = "scoreboard";
    el.replaceChildren(...teams.map((t, i) => h("div", {
        className: "score-card" + (t.out ? " out" : "") + (t.turn ? " turn" : ""),
        id: `score-card-${i}`,
        style: `--c:${t.color}`
      },
      h("div", { className: "sc-name" }, t.name),
      h("div", { className: "sc-score" }, String(score(t))),
      extra ? h("div", { className: "sc-extra" }, extra(t)) : null,
      button ? h("button", { className: "btn-ok btn-big", disabled: button.disabled(t), onclick: () => button.onclick(t, i) }, button.label) : null)));
  }
  function bump(i){
    const card = document.getElementById(`score-card-${i}`);
    if (!card) return;
    card.classList.remove("bump");
    void card.offsetWidth;   // restart the animation
    card.classList.add("bump");
  }

  /* ---------------- saved settings ---------------- */
  const storageKey = () => "english-games:" + cfg.id;
  function loadSettings(){
    let s = {};
    try { s = JSON.parse(localStorage.getItem(storageKey())) || {}; } catch (e) { /* private window etc. */ }
    const options = {};
    cfg.options.forEach(o => options[o.key] = o.choices.includes(s.options?.[o.key]) ? s.options[o.key] : o.default);
    return {
      year: YEARS.includes(s.year) ? s.year : 4,
      teamCount: Math.min(cfg.maxTeams, Math.max(cfg.minTeams, Number(s.teamCount) || cfg.defaultTeams)),
      names: Array.isArray(s.names) ? s.names.map(String) : [],
      custom: s.custom && typeof s.custom === "object" ? s.custom : {},
      options
    };
  }
  function persist(){
    try { localStorage.setItem(storageKey(), JSON.stringify(settings)); } catch (e) { /* not saved, game still works */ }
  }
  // the teacher's edited list for this year, or a fresh copy of the built-in one
  function questionsFor(year){
    const c = settings.custom[year];
    return Array.isArray(c) ? c : cfg.banks[year].map(q => ({ ...q }));
  }

  /* ---------------- top bar ---------------- */
  function buildTopbar(){
    counterEl = h("div", { className: "counter hidden" });
    musicBtn = h("button", { className: "btn-ghost", onclick: toggleMusic }, "🔈 Music off");
    gameBtns = h("div", { className: "bar-btns hidden" },
      h("button", { className: "btn-ghost", onclick: () => leave(showSetup) }, "⚙️ Setup"),
      cfg.finish ? h("button", { className: "btn-ghost", onclick: askFinish }, "🏁 End game") : null,
      h("button", { className: "btn-ghost", onclick: askReset }, "🔄 Reset"));
    document.getElementById("topbar").append(
      h("div", { className: "title", innerHTML: cfg.titleHTML }),
      h("div", { className: "bar-btns" },
        counterEl, gameBtns, musicBtn,
        h("button", { className: "btn-ghost", onclick: () => leave(() => location.href = MENU_URL) }, "🏠 Menu")));
  }
  async function leave(go){
    if (!playing || await ask("Leave this game?", "The scores will be lost.", "Yes, leave")) go();
  }
  async function askReset(){
    if (await ask("Reset the game?", "All scores go back to the start. This cannot be undone.", "Yes, reset")) restart();
  }
  async function askFinish(){
    if (await ask("End the game now?", "The team that is winning now will be the winner.", "Yes, end it")) cfg.finish();
  }

  /* ---------------- setup screen ---------------- */
  function showSetup(){
    playing = false;
    closeModals();
    cfg.stop?.();
    document.getElementById("game").classList.add("hidden");
    document.getElementById("setup").classList.remove("hidden");
    gameBtns.classList.add("hidden");
    counterEl.classList.add("hidden");
    renderSetup();
    window.scrollTo(0, 0);
  }

  function renderSetup(){
    const s = settings;
    const box = document.getElementById("setup");
    const card = (title, ...kids) => h("section", { className: "setup-card" }, h("h3", {}, title), ...kids);
    const seg = (items, value, pick) => h("div", { className: "seg" }, ...items.map(([label, v]) =>
      h("button", { className: v === value ? "on" : "", ariaPressed: String(v === value), onclick: () => { pick(v); persist(); renderSetup(); } }, label)));

    const names = h("div", { className: "name-inputs" });
    for (let i = 0; i < s.teamCount; i++){
      names.append(h("label", { className: "name-input", style: `--c:${COLORS[i]}` }, `Team ${i + 1} name`,
        h("input", { type: "text", maxLength: 24, value: s.names[i] ?? NAMES[i],
          oninput: e => { s.names[i] = e.target.value; persist(); } })));
    }
    const teamCounts = [];
    for (let n = cfg.minTeams; n <= cfg.maxTeams; n++) teamCounts.push([`${n} teams`, n]);

    // question editor: every change is saved straight away
    const list = questionsFor(s.year);
    const summary = h("summary", {});
    const setSummary = () => summary.textContent = `✏️ Edit questions — Year ${s.year} (${list.length})`;
    const save = () => { s.custom[s.year] = list; persist(); setSummary(); };
    setSummary();
    const rows = h("div", { className: "q-rows" }, ...list.map((q, i) => h("div", { className: "q-row" },
      h("span", { className: "q-num" }, String(i + 1)),
      ...cfg.fields.map(f => h("input", {
        type: "text", value: q[f.key] ?? "", placeholder: f.label, title: f.label,
        style: `flex-grow:${f.grow || 1}`,
        oninput: e => { q[f.key] = e.target.value; save(); }
      })),
      h("button", { className: "btn-ghost q-del", title: `Delete question ${i + 1}`, onclick: () => { list.splice(i, 1); save(); renderSetup(); } }, "🗑"))));
    const editor = h("details", { className: "setup-card", open: editorOpen },
      summary,
      h("p", { className: "hint" }, `Each row is one question. Boxes: ${cfg.fields.map(f => f.label).join(" · ")}. ${cfg.editorHint || ""} Changes are saved on this computer automatically.`),
      rows,
      h("div", { className: "controls" },
        h("button", { className: "btn-ghost", onclick: () => {
          list.push(Object.fromEntries(cfg.fields.map(f => [f.key, ""])));
          save(); renderSetup();
          const inputs = document.querySelectorAll(".q-row:last-child input");
          inputs[0]?.focus();
        } }, "➕ Add a question"),
        h("button", { className: "btn-ghost", onclick: async () => {
          if (await ask("Use the built-in questions?", `Your changes to the Year ${s.year} questions will be removed.`, "Yes, use built-in")){
            delete s.custom[s.year]; persist(); renderSetup();
          }
        } }, "↩️ Use built-in questions")));
    editor.addEventListener("toggle", () => editorOpen = editor.open);

    const error = h("div", { className: "error", role: "alert" });

    box.replaceChildren(
      h("h2", {}, "Game setup"),
      cfg.howTo ? h("p", { className: "hint", style: "text-align:center;font-size:1.05rem" }, cfg.howTo) : null,
      card("1. Choose the class", seg(YEARS.map(y => [`Year ${y}`, y]), s.year, y => s.year = y)),
      card("2. Teams",
        cfg.maxTeams > cfg.minTeams ? seg(teamCounts, s.teamCount, n => s.teamCount = n) : null,
        names),
      ...cfg.options.map((o, i) => card(`${i + 3}. ${o.label}`,
        seg(o.choices.map(c => [`${c} ${o.unit}`, c]), s.options[o.key], v => s.options[o.key] = v))),
      editor,
      h("div", { className: "start-row" },
        h("button", { className: "btn-primary btn-big", onclick: () => start(error) }, "▶ Start game"),
        error));
  }

  function start(error){
    const s = settings;
    const questions = questionsFor(s.year)
      .filter(q => cfg.fields.every(f => f.optional || String(q[f.key] ?? "").trim()))
      .map(q => ({ ...q }));
    if (!questions.length){
      error.textContent = "Please add at least one question with every box filled in.";
      return;
    }
    current = {
      year: s.year,
      teams: Array.from({ length: s.teamCount }, (_, i) => ({ name: (s.names[i] ?? "").trim() || NAMES[i], color: COLORS[i] })),
      questions,
      options: { ...s.options }
    };
    document.getElementById("setup").classList.add("hidden");
    document.getElementById("game").classList.remove("hidden");
    gameBtns.classList.remove("hidden");
    counterEl.classList.remove("hidden");
    restart();
  }

  // start (or start again) with the same teams and questions
  function restart(){
    closeModals();
    cfg.stop?.();
    playing = true;
    window.scrollTo(0, 0);
    cfg.start({ ...current, teams: current.teams.map(t => ({ ...t })), questions: current.questions.map(q => ({ ...q })) });
  }

  function init(config){
    cfg = { minTeams: 2, maxTeams: 4, defaultTeams: 2, options: [], ...config };
    settings = loadSettings();
    buildTopbar();
    showSetup();
  }

  return {
    init, h, esc, shuffle, plural, sfx, audio, ask, showWinner, winnerByScore, scoreboard, bump,
    setCounter: text => counterEl.textContent = text
  };
})();
