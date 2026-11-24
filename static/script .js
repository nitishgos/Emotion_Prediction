(() => {
  "use strict";

  const EMOJI = { sadness: "😢", joy: "😄", love: "❤️", anger: "😠", fear: "😨", surprise: "😲" };
  const ORDER = ["sadness", "joy", "love", "anger", "fear", "surprise"];
  const COLORS = {
    idle: ["#8b8fff", "#5ee7ff"],
    sadness: ["#5b8def", "#7fd1ff"],
    joy: ["#ffc83d", "#ff9a3c"],
    love: ["#ff5c8a", "#ff9bb8"],
    anger: ["#ff4d4d", "#ff8a3c"],
    fear: ["#a46bff", "#6b7bff"],
    surprise: ["#2ee6c5", "#5ee7ff"],
  };
  const EXAMPLES = [
    "I feel so happy and excited today!",
    "I miss her so much it hurts",
    "I can't believe he did that to me",
    "I'm terrified of what's behind that door",
    "Wow, I never expected this surprise party",
    "You mean the world to me, always",
  ];
  const WORDS = ["feeling", "hiding", "saying", "screaming", "whispering"];

  const $ = (id) => document.getElementById(id);
  const el = {
    text: $("text"), count: $("count"), analyze: $("analyzeBtn"), clear: $("clearBtn"),
    chips: $("chips"), error: $("error"), placeholder: $("placeholder"), result: $("result"),
    emoji: $("emoji"), name: $("emotionName"), conf: $("confNum"), ring: $("ringFg"),
    bars: $("bars"), status: $("status"), statusText: $("statusText"),
    historyWrap: $("historyWrap"), history: $("history"), clearHistory: $("clearHistory"),
    shift: $("shiftWord"), glow: $("cursorGlow"),
  };

  const RING_LEN = 2 * Math.PI * 52;
  let currentEmotion = "idle";
  let busy = false;

  /* ---------- helpers ---------- */
  const pct = (v) => (v * 100).toFixed(1);
  const hexToRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

  function countUp(node, to, ms = 1100) {
    const start = performance.now();
    const tick = (t) => {
      const p = Math.min((t - start) / ms, 1);
      const eased = 1 - Math.pow(1 - p, 4);
      node.textContent = (to * eased).toFixed(1);
      if (p < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  function setEmotion(e) {
    currentEmotion = e;
    document.body.dataset.emotion = e;
    particles.retint();
  }

  /* ---------- health ---------- */
  function setStatus(kind, text) {
    el.status.className = "status " + kind;
    el.statusText.textContent = text;
  }

  async function checkHealth(attempt = 0) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10000);
    try {
      const r = await fetch("/health?_=" + Date.now(), { cache: "no-store", signal: ctrl.signal });
      clearTimeout(timer);
      const d = await r.json();
      if (r.ok && d.model_loaded) setStatus("ok", "model ready");
      else if (r.ok) setStatus("bad", "model not loaded");
      else throw new Error("bad status " + r.status);
    } catch {
      clearTimeout(timer);
      // Retry a few times (server may be waking up) before showing offline
      if (attempt < 3) {
        setStatus("", "connecting…");
        setTimeout(() => checkHealth(attempt + 1), 2000 * (attempt + 1));
      } else {
        setStatus("bad", "server offline");
      }
    }
  }

  /* ---------- chips ---------- */
  EXAMPLES.forEach((t, i) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "chip";
    b.style.animationDelay = 0.5 + i * 0.07 + "s";
    b.textContent = t.length > 34 ? t.slice(0, 32) + "…" : t;
    b.title = t;
    b.addEventListener("click", () => {
      el.text.value = t;
      onInput();
      analyze();
    });
    el.chips.appendChild(b);
  });

  /* ---------- input ---------- */
  function onInput() {
    el.count.textContent = el.text.value.length;
    el.analyze.disabled = el.text.value.trim().length === 0;
    el.error.hidden = true;
  }
  el.text.addEventListener("input", onInput);
  el.text.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); analyze(); }
  });
  el.clear.addEventListener("click", () => {
    el.text.value = "";
    onInput();
    el.result.hidden = true;
    el.placeholder.hidden = false;
    setEmotion("idle");
    el.text.focus();
  });
  onInput();

  /* ---------- analyze ---------- */
  async function analyze() {
    const text = el.text.value.trim();
    if (!text || busy) return;
    busy = true;
    el.analyze.classList.add("loading");
    el.error.hidden = true;

    try {
      const started = performance.now();
      const res = await fetch("/predict", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) {
        let msg = "Something went wrong.";
        try {
          const j = await res.json();
          msg = typeof j.detail === "string" ? j.detail : "Please check your input (1–2000 characters).";
        } catch {}
        throw new Error(msg);
      }
      const data = await res.json();
      setStatus("ok", "model ready"); // a successful prediction proves the server is up
      // tiny minimum delay so the spinner feels intentional
      const wait = Math.max(0, 450 - (performance.now() - started));
      await new Promise((r) => setTimeout(r, wait));
      render(data);
      addHistory(data);
    } catch (err) {
      el.error.textContent = err.message || "Network error. Is the server running?";
      el.error.hidden = false;
      el.error.style.animation = "none"; void el.error.offsetWidth; el.error.style.animation = "";
    } finally {
      busy = false;
      el.analyze.classList.remove("loading");
    }
  }
  el.analyze.addEventListener("click", analyze);

  /* ---------- render ---------- */
  function render(data) {
    const emotion = data.predicted_emotion;
    const probs = data.all_probabilites || {};

    el.placeholder.hidden = true;
    el.result.hidden = false;
    el.result.classList.remove("enter"); void el.result.offsetWidth; el.result.classList.add("enter");

    setEmotion(emotion);
    swapHeroWord(emotion);

    el.emoji.textContent = EMOJI[emotion] || "🤔";
    el.emoji.classList.remove("pop"); void el.emoji.offsetWidth; el.emoji.classList.add("pop");
    el.name.textContent = emotion;

    // ring
    el.ring.style.transition = "none";
    el.ring.style.strokeDashoffset = RING_LEN;
    void el.ring.getBoundingClientRect();
    el.ring.style.transition = "";
    requestAnimationFrame(() => (el.ring.style.strokeDashoffset = RING_LEN * (1 - data.confidence)));
    countUp(el.conf, data.confidence * 100);

    // bars (sorted high → low)
    const rows = ORDER.map((k) => [k, probs[k] ?? 0]).sort((a, b) => b[1] - a[1]);
    el.bars.innerHTML = "";
    rows.forEach(([k, v], i) => {
      const row = document.createElement("div");
      row.className = "bar" + (k === emotion ? " top" : "");
      row.style.animationDelay = 0.25 + i * 0.08 + "s";
      row.innerHTML =
        `<span class="b-emoji">${EMOJI[k]}</span><span class="b-name">${k}</span>` +
        `<div class="track"><div class="fill"></div></div><span class="b-val">${pct(v)}%</span>`;
      el.bars.appendChild(row);
      setTimeout(() => (row.querySelector(".fill").style.width = Math.max(v * 100, 0.6) + "%"), 350 + i * 90);
    });

    burst(emotion);
    if (window.innerWidth < 860) el.result.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function swapHeroWord(emotion) {
    el.shift.classList.add("out");
    setTimeout(() => {
      el.shift.textContent = emotion === "idle" ? "feeling" : emotion;
      el.shift.classList.remove("out");
    }, 350);
  }

  /* ---------- history ---------- */
  const KEY = "moodscope_history_v1";
  let history = [];
  try { history = JSON.parse(localStorage.getItem(KEY) || "[]"); } catch {}

  function drawHistory() {
    el.history.innerHTML = "";
    el.historyWrap.hidden = history.length === 0;
    history.forEach((h, i) => {
      const li = document.createElement("li");
      li.style.animationDelay = i * 0.05 + "s";
      li.innerHTML = `<span class="h-emoji">${EMOJI[h.emotion] || "🤔"}</span><span class="h-text"></span>` +
        `<span class="h-meta">${h.emotion} · ${pct(h.confidence)}%</span>`;
      li.querySelector(".h-text").textContent = h.text;
      li.addEventListener("click", () => { el.text.value = h.text; onInput(); analyze(); window.scrollTo({ top: 0, behavior: "smooth" }); });
      el.history.appendChild(li);
    });
  }
  function addHistory(d) {
    history.unshift({ text: d.text, emotion: d.predicted_emotion, confidence: d.confidence });
    history = history.slice(0, 5);
    try { localStorage.setItem(KEY, JSON.stringify(history)); } catch {}
    drawHistory();
  }
  el.clearHistory.addEventListener("click", () => {
    history = [];
    try { localStorage.removeItem(KEY); } catch {}
    drawHistory();
  });
  drawHistory();

  /* ---------- 3D tilt + glow on cards ---------- */
  document.querySelectorAll(".tilt").forEach((card) => {
    card.addEventListener("pointermove", (e) => {
      if (e.pointerType === "touch") return;
      const r = card.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width;
      const y = (e.clientY - r.top) / r.height;
      card.style.setProperty("--mx", x * 100 + "%");
      card.style.setProperty("--my", y * 100 + "%");
      card.style.transform = `perspective(1000px) rotateY(${(x - 0.5) * 5}deg) rotateX(${(0.5 - y) * 5}deg)`;
    });
    card.addEventListener("pointerleave", () => (card.style.transform = ""));
  });

  /* ---------- cursor glow ---------- */
  window.addEventListener("pointermove", (e) => {
    el.glow.style.opacity = 1;
    el.glow.style.left = e.clientX + "px";
    el.glow.style.top = e.clientY + "px";
  });

  /* ---------- background particles ---------- */
  const canvas = $("bg");
  const ctx = canvas.getContext("2d");
  const mouse = { x: -999, y: -999 };
  let W, H, DPR;

  const particles = (() => {
    let list = [];
    let rgb = hexToRgb(COLORS.idle[0]);
    let target = rgb.slice();

    function resize() {
      DPR = Math.min(window.devicePixelRatio || 1, 2);
      W = canvas.width = innerWidth * DPR;
      H = canvas.height = innerHeight * DPR;
      canvas.style.width = innerWidth + "px";
      canvas.style.height = innerHeight + "px";
      const n = Math.min(110, Math.floor((innerWidth * innerHeight) / 14000));
      list = Array.from({ length: n }, () => spawn());
    }
    function spawn(x, y, burstMode) {
      const a = Math.random() * Math.PI * 2;
      const s = burstMode ? 2 + Math.random() * 5 : 0.15 + Math.random() * 0.35;
      return {
        x: x ?? Math.random() * W, y: y ?? Math.random() * H,
        vx: Math.cos(a) * s, vy: Math.sin(a) * s,
        r: (burstMode ? 1.5 + Math.random() * 2.5 : 0.8 + Math.random() * 1.8) * DPR,
        life: burstMode ? 1 : null,
      };
    }
    function retint() { target = hexToRgb(COLORS[currentEmotion][0]); }

    function step() {
      ctx.clearRect(0, 0, W, H);
      rgb = rgb.map((c, i) => c + (target[i] - c) * 0.05);
      const col = rgb.map(Math.round).join(",");

      for (let i = list.length - 1; i >= 0; i--) {
        const p = list[i];
        // mouse repel
        const dx = p.x - mouse.x * DPR, dy = p.y - mouse.y * DPR;
        const d2 = dx * dx + dy * dy, R = 160 * DPR;
        if (d2 < R * R) { const d = Math.sqrt(d2) || 1; p.vx += (dx / d) * 0.12; p.vy += (dy / d) * 0.12; }

        p.x += p.vx; p.y += p.vy;
        p.vx *= p.life !== null ? 0.96 : 0.995;
        p.vy *= p.life !== null ? 0.96 : 0.995;

        if (p.life !== null) {
          p.life -= 0.014;
          if (p.life <= 0) { list.splice(i, 1); continue; }
        } else {
          if (p.x < 0) p.x = W; if (p.x > W) p.x = 0;
          if (p.y < 0) p.y = H; if (p.y > H) p.y = 0;
        }
        const alpha = p.life !== null ? p.life : 0.6;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${col},${alpha})`;
        ctx.fill();
      }

      // connect close neighbours
      const maxD = 120 * DPR;
      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
          const a = list[i], b = list[j];
          if (a.life !== null || b.life !== null) continue;
          const dx = a.x - b.x, dy = a.y - b.y, d = Math.hypot(dx, dy);
          if (d < maxD) {
            ctx.strokeStyle = `rgba(${col},${(1 - d / maxD) * 0.22})`;
            ctx.lineWidth = DPR * 0.7;
            ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
          }
        }
      }
      requestAnimationFrame(step);
    }
    function emit(n, x, y) { for (let i = 0; i < n; i++) list.push(spawn(x, y, true)); }

    window.addEventListener("resize", resize);
    resize();
    step();
    return { retint, emit };
  })();

  window.addEventListener("pointermove", (e) => { mouse.x = e.clientX; mouse.y = e.clientY; });

  function burst() {
    const r = el.emoji.getBoundingClientRect();
    particles.emit(46, (r.left + r.width / 2) * DPR, (r.top + r.height / 2) * DPR);
  }

  /* ---------- idle hero word cycle ---------- */
  let wi = 0;
  setInterval(() => {
    if (currentEmotion !== "idle") return;
    el.shift.classList.add("out");
    setTimeout(() => {
      wi = (wi + 1) % WORDS.length;
      el.shift.textContent = WORDS[wi];
      el.shift.classList.remove("out");
    }, 350);
  }, 2600);

  checkHealth();
  setInterval(() => checkHealth(), 30000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) checkHealth(); });
  window.addEventListener("online", () => checkHealth());
})();
