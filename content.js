(() => {
  const APP_ID = "ac-analytics-root";
  const STORAGE_VERSION = 1;

  const API = {
    models: "https://kenkoooo.com/atcoder/resources/problem-models.json",
    userSubmissions: (user, fromSecond) =>
      `https://kenkoooo.com/atcoder/atcoder-api/v3/user/submissions?user=${encodeURIComponent(
        user
      )}&from_second=${fromSecond}`,
  };

  const CFG = {
    // Please be kind to the API (see AtCoderProblems repo notes).
    minDelayBetweenRequestsMs: 1100,
    // Cache difficulty models for 24h
    modelsTtlMs: 24 * 60 * 60 * 1000,
    // Cache submissions per user for 10m (we also do incremental updates)
    submissionsSoftTtlMs: 10 * 60 * 1000,
    // UI
    defaultUnsolvedLimit: 50,
    binSize: 200,
    // AtCoder Problems difficulty can be negative for very easy problems.
    // Clamp display difficulty to >= 0.
    clampDifficultyMin: 0,
    clampDifficultyMax: 4000,
  };

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function getUserIdFromPath() {
    // /users/<name>
    const parts = location.pathname.split("/").filter(Boolean);
    if (parts.length >= 2 && parts[0] === "users") return parts[1];
    return null;
  }

  function fmtInt(n) {
    return Number.isFinite(n) ? n.toLocaleString() : "-";
  }

  function safeText(s) {
    return (s ?? "").toString();
  }

  function difficultyLabel(d) {
    if (!Number.isFinite(d)) return "—";
    return `${Math.round(d)}`;
  }

  function clampDifficulty(d) {
    if (!Number.isFinite(d)) return null;
    return Math.min(CFG.clampDifficultyMax, Math.max(CFG.clampDifficultyMin, d));
  }

  function buildTaskUrl(contestId, problemId) {
    if (!contestId || !problemId) return null;
    return `https://atcoder.jp/contests/${contestId}/tasks/${problemId}`;
  }

  function getTagFromContestOrProblem({ contest_id, problem_id }) {
    const c = (contest_id ?? "").toLowerCase();
    const p = (problem_id ?? "").toLowerCase();

    // Prefer contest_id; fall back to problem_id prefix.
    const k = c || p;
    if (k.startsWith("abc")) return "ABC";
    if (k.startsWith("arc")) return "ARC";
    if (k.startsWith("agc")) return "AGC";
    if (k.startsWith("ahc")) return "AHC";
    if (k.startsWith("typical90")) return "Typical90";
    if (k.startsWith("tessoku-book")) return "Tessoku";
    if (k.startsWith("past")) return "PAST";
    if (k.includes("joi")) return "JOI";
    return "Other";
  }

  async function storageGet(keys) {
    return new Promise((resolve) => chrome.storage.local.get(keys, resolve));
  }

  async function storageSet(obj) {
    return new Promise((resolve) => chrome.storage.local.set(obj, resolve));
  }

  function nowMs() {
    return Date.now();
  }

  function makeLayout(userId) {
    const root = document.createElement("section");
    root.id = APP_ID;
    root.className = "ac-analytics";
    root.innerHTML = `
      <div class="ac-analytics__header">
        <div>
          <h2 class="ac-analytics__title">AtCoder Analytics</h2>
          <div class="ac-analytics__sub">
            Stats for <span class="ac-analytics__user"></span>
          </div>
        </div>
        <div class="ac-analytics__actions">
          <button class="ac-analytics__btn" data-action="refresh">Refresh</button>
        </div>
      </div>

      <div class="ac-analytics__status" aria-live="polite"></div>
      <div class="ac-analytics__tooltip"></div>

      <div class="ac-analytics__grid">
        <div class="ac-analytics__card">
          <div class="ac-analytics__cardTitle">Solved by Difficulty (estimated)</div>
          <div class="ac-analytics__chartWrap">
            <svg class="ac-analytics__chart" viewBox="0 0 800 240" preserveAspectRatio="none"></svg>
          </div>
          <div class="ac-analytics__legend"></div>
        </div>

        <div class="ac-analytics__card">
          <div class="ac-analytics__cardTitle">Solved Tags (by contest series)</div>
          <div class="ac-analytics__donutWrap">
            <svg class="ac-analytics__donut" viewBox="0 0 320 320" aria-label="Solved tags chart"></svg>
          </div>
          <div class="ac-analytics__tagList"></div>
        </div>

        <div class="ac-analytics__card">
          <div class="ac-analytics__cardTitle">Unsolved</div>
          <div class="ac-analytics__unsolvedMeta"></div>
          <div class="ac-analytics__tableWrap">
            <table class="ac-analytics__table">
              <thead>
                <tr>
                  <th>Diff</th>
                  <th>Problem</th>
                  <th>Contest</th>
                </tr>
              </thead>
              <tbody></tbody>
            </table>
          </div>
          <div class="ac-analytics__more">
            <button class="ac-analytics__btn" data-action="more" style="display:none;">Show more</button>
          </div>
        </div>
      </div>
    `;

    root.querySelector(".ac-analytics__user").textContent = userId;
    return root;
  }

  function findInsertPoint() {
    // AtCoder layout changes sometimes; try a few safe anchors.
    return (
      document.querySelector("#main-container") ||
      document.querySelector("main") ||
      document.querySelector(".container") ||
      document.body
    );
  }

  function mount(userId) {
    if (document.getElementById(APP_ID)) return null;

    const insertPoint = findInsertPoint();
    const root = makeLayout(userId);

    // Place it at the bottom of the profile page content.
    insertPoint.appendChild(root);

    return root;
  }

  function setStatus(root, msg, kind = "info") {
    const el = root.querySelector(".ac-analytics__status");
    el.textContent = msg;
    el.dataset.kind = kind;
  }

  function pickBins(values) {
    const known = values.filter((v) => Number.isFinite(v));
    if (!known.length) {
      return { min: CFG.clampDifficultyMin, max: CFG.clampDifficultyMax, bins: [] };
    }

    const rawMin = Math.min(...known);
    const rawMax = Math.max(...known);
    const min = Math.min(
      CFG.clampDifficultyMax,
      Math.max(CFG.clampDifficultyMin, Math.floor(rawMin / CFG.binSize) * CFG.binSize)
    );
    const max = Math.max(
      CFG.clampDifficultyMin,
      Math.min(CFG.clampDifficultyMax, Math.ceil(rawMax / CFG.binSize) * CFG.binSize)
    );

    const bins = [];
    for (let start = min; start <= max; start += CFG.binSize) {
      bins.push({ start, end: start + CFG.binSize - 1, count: 0 });
    }
    return { min, max, bins };
  }

  function colorForDifficultyRange(d) {
    // Color palette by range (after clamping)
    if (!Number.isFinite(d)) return "#94a3b8";
    if (d < 400) return "#9ca3af"; // gray
    if (d < 800) return "#22c55e"; // green
    if (d < 1200) return "#06b6d4"; // cyan
    if (d < 1600) return "#3b82f6"; // blue
    if (d < 2000) return "#a855f7"; // purple
    if (d < 2400) return "#f59e0b"; // amber
    return "#ef4444"; // red
  }

  function renderHistogram(root, difficulties) {
    const svg = root.querySelector(".ac-analytics__chart");
    const legend = root.querySelector(".ac-analytics__legend");

    const { bins } = pickBins(difficulties);
    if (!bins.length) {
      svg.innerHTML = "";
      legend.textContent = "No difficulty data available for solved problems.";
      return;
    }

    for (const d of difficulties) {
      if (!Number.isFinite(d)) continue;
      const idx = Math.floor((d - bins[0].start) / CFG.binSize);
      if (idx >= 0 && idx < bins.length) bins[idx].count += 1;
    }

    const maxCount = Math.max(1, ...bins.map((b) => b.count));

    // SVG render (simple, dependency-free)
    const W = 800;
    const H = 320;
    const pad = { l: 30, r: 10, t: 10, b: 30 };
    const innerW = W - pad.l - pad.r;
    const innerH = H - pad.t - pad.b;
    const barW = innerW / bins.length;

    const parts = [];
    // baseline
    parts.push(
      `<line x1="${pad.l}" y1="${pad.t + innerH}" x2="${pad.l + innerW}" y2="${
        pad.t + innerH
      }" stroke="currentColor" stroke-opacity="0.2"/>`
    );

    bins.forEach((b, i) => {
      const h = (b.count / maxCount) * innerH;
      const x = pad.l + i * barW;
      const y = pad.t + (innerH - h);
      const label = `${b.start}~${b.end}: ${b.count}`;
      const color = colorForDifficultyRange(b.start);
      parts.push(
        `<rect x="${x + 1}" y="${y}" width="${Math.max(0, barW - 2)}" height="${h}" rx="2" class="ac-analytics__bar"
          data-range="${b.start}~${b.end}" data-count="${b.count}" style="fill:${color}">
           <title>${label}</title>
         </rect>`
      );
    });

    // x labels: show every ~6 bars
    const step = Math.max(1, Math.ceil(bins.length / 6));
    bins.forEach((b, i) => {
      if (i % step !== 0 && i !== bins.length - 1) return;
      const x = pad.l + i * barW;
      parts.push(
        `<text x="${x}" y="${H - 10}" font-size="10" fill="currentColor" fill-opacity="0.65">${
          b.start
        }</text>`
      );
    });

    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.innerHTML = parts.join("\n");

    const total = difficulties.length;
    legend.innerHTML = `
      <div>Solved: ${fmtInt(total)}</div>
      <div class="ac-analytics__legendRow">
        <span class="ac-analytics__swatch" style="--c:${colorForDifficultyRange(0)}"></span><span>0–399</span>
        <span class="ac-analytics__swatch" style="--c:${colorForDifficultyRange(400)}"></span><span>400–799</span>
        <span class="ac-analytics__swatch" style="--c:${colorForDifficultyRange(800)}"></span><span>800–1199</span>
        <span class="ac-analytics__swatch" style="--c:${colorForDifficultyRange(1200)}"></span><span>1200–1599</span>
        <span class="ac-analytics__swatch" style="--c:${colorForDifficultyRange(1600)}"></span><span>1600–1999</span>
        <span class="ac-analytics__swatch" style="--c:${colorForDifficultyRange(2000)}"></span><span>2000–2399</span>
        <span class="ac-analytics__swatch" style="--c:${colorForDifficultyRange(2400)}"></span><span>2400+</span>
      </div>
    `;
  }

  function renderSolvedTags(root, solvedProblems) {
    const svg = root.querySelector(".ac-analytics__donut");
    const list = root.querySelector(".ac-analytics__tagList");

    const counts = new Map();
    for (const p of solvedProblems) {
      const tag = getTagFromContestOrProblem(p);
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }

    const entries = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    const total = entries.reduce((s, [, c]) => s + c, 0);
    if (!total) {
      svg.innerHTML = "";
      list.textContent = "No solved problems to summarize.";
      return;
    }

    const palette = ["#3b82f6", "#22c55e", "#f59e0b", "#a855f7", "#06b6d4", "#ef4444", "#64748b"];

    // Donut parameters
    const cx = 160;
    const cy = 160;
    const rOuter = 120;
    const rInner = 75;

    // SVG arc cannot represent a full 360° slice; handle single-category case explicitly.
    if (entries.length === 1) {
      const [tag, c] = entries[0];
      const color = palette[0];
      const rMid = (rOuter + rInner) / 2;
      const strokeW = rOuter - rInner;
      svg.innerHTML = `
        <circle cx="${cx}" cy="${cy}" r="${rMid}" fill="none" stroke="${color}" stroke-width="${strokeW}"
          class="ac-analytics__donutSlice" data-tag="${tag}" data-count="${c}">
          <title>${tag}: ${c}</title>
        </circle>
        <text x="${cx}" y="${cy - 2}" text-anchor="middle" font-size="14" font-weight="600" fill="currentColor">${fmtInt(
          total
        )}</text>
        <text x="${cx}" y="${cy + 16}" text-anchor="middle" font-size="11" fill="currentColor" fill-opacity="0.7">solved</text>
      `;
      list.innerHTML = `<div class="ac-analytics__tagRow"><span class="ac-analytics__swatch" style="--c:${color}"></span><span>${tag}</span><span class="ac-analytics__tagCount">${fmtInt(
        c
      )}</span></div>`;
      return;
    }

    function polarToXY(r, ang) {
      return { x: cx + r * Math.cos(ang), y: cy + r * Math.sin(ang) };
    }

    function arcPath(r1, r2, a0, a1) {
      const large = a1 - a0 > Math.PI ? 1 : 0;
      const p0o = polarToXY(r1, a0);
      const p1o = polarToXY(r1, a1);
      const p1i = polarToXY(r2, a1);
      const p0i = polarToXY(r2, a0);
      return [
        `M ${p0o.x} ${p0o.y}`,
        `A ${r1} ${r1} 0 ${large} 1 ${p1o.x} ${p1o.y}`,
        `L ${p1i.x} ${p1i.y}`,
        `A ${r2} ${r2} 0 ${large} 0 ${p0i.x} ${p0i.y}`,
        "Z",
      ].join(" ");
    }

    let angle = -Math.PI / 2;
    const parts = [];
    entries.forEach(([tag, c], i) => {
      const frac = c / total;
      const a0 = angle;
      const a1 = angle + frac * 2 * Math.PI;
      angle = a1;
      const color = palette[i % palette.length];
      parts.push(
        `<path d="${arcPath(rOuter, rInner, a0, a1)}" fill="${color}" class="ac-analytics__donutSlice" data-tag="${tag}" data-count="${c}">
           <title>${tag}: ${c}</title>
         </path>`
      );
    });

    // Center label
    parts.push(
      `<text x="${cx}" y="${cy - 2}" text-anchor="middle" font-size="14" font-weight="600" fill="currentColor">${fmtInt(
        total
      )}</text>`
    );
    parts.push(
      `<text x="${cx}" y="${cy + 16}" text-anchor="middle" font-size="11" fill="currentColor" fill-opacity="0.7">solved</text>`
    );

    svg.innerHTML = parts.join("\n");

    // List
    list.innerHTML = entries
      .map(([tag, c], i) => {
        const color = palette[i % palette.length];
        return `<div class="ac-analytics__tagRow"><span class="ac-analytics__swatch" style="--c:${color}"></span><span>${tag}</span><span class="ac-analytics__tagCount">${fmtInt(
          c
        )}</span></div>`;
      })
      .join("");
  }

  function renderUnsolved(root, items, limit) {
    const tbody = root.querySelector(".ac-analytics__table tbody");
    const meta = root.querySelector(".ac-analytics__unsolvedMeta");
    const moreBtn = root.querySelector('button[data-action="more"]');

    meta.textContent = `Count: ${fmtInt(items.length)} (showing ${fmtInt(
      Math.min(limit, items.length)
    )})`;

    tbody.innerHTML = "";
    const slice = items.slice(0, limit);
    for (const it of slice) {
      const tr = document.createElement("tr");
      const url = buildTaskUrl(it.contest_id, it.problem_id);
      tr.innerHTML = `
        <td class="ac-analytics__mono">${difficultyLabel(it.difficulty)}</td>
        <td>
          ${
            url
              ? `<a href="${url}" target="_blank" rel="noreferrer">${safeText(it.problem_id)}</a>`
              : safeText(it.problem_id)
          }
        </td>
        <td class="ac-analytics__mono">${safeText(it.contest_id)}</td>
      `;
      tbody.appendChild(tr);
    }

    if (items.length > limit) {
      moreBtn.style.display = "";
    } else {
      moreBtn.style.display = "none";
    }
  }

  async function loadModels() {
    const key = "acAnalytics.models.v" + STORAGE_VERSION;
    const cached = (await storageGet([key]))[key];
    const t = nowMs();
    if (cached && cached.fetchedAt && t - cached.fetchedAt < CFG.modelsTtlMs && cached.data) {
      return cached.data;
    }

    const res = await fetch(API.models, { credentials: "omit" });
    if (!res.ok) throw new Error(`Failed to load problem models: HTTP ${res.status}`);
    const data = await res.json();

    // Store raw object; it's large but avoids re-fetching.
    await storageSet({
      [key]: { fetchedAt: t, data },
    });

    return data;
  }

  async function loadUserCache(userId) {
    const key = `acAnalytics.user.${userId}.v${STORAGE_VERSION}`;
    const cached = (await storageGet([key]))[key];
    return { key, cached };
  }

  async function saveUserCache(key, payload) {
    await storageSet({ [key]: payload });
  }

  async function fetchSubmissionsIncremental(userId, cached, onProgress) {
    const t = nowMs();
    const fromSecond =
      cached && typeof cached.maxEpochSecond === "number" ? cached.maxEpochSecond + 1 : 0;

    // If cache is fresh enough, skip network
    if (
      cached &&
      cached.fetchedAt &&
      t - cached.fetchedAt < CFG.submissionsSoftTtlMs &&
      Array.isArray(cached.submissions)
    ) {
      onProgress?.({ phase: "cache", count: cached.submissions.length, fromSecond });
      return cached.submissions;
    }

    let all = Array.isArray(cached?.submissions) ? cached.submissions.slice() : [];
    let cursor = fromSecond;
    let rounds = 0;

    while (true) {
      rounds += 1;
      onProgress?.({ phase: "fetch", rounds, cursor, count: all.length });

      const res = await fetch(API.userSubmissions(userId, cursor), { credentials: "omit" });
      if (!res.ok) throw new Error(`Failed to load submissions: HTTP ${res.status}`);
      const batch = await res.json();

      if (!Array.isArray(batch) || batch.length === 0) break;

      // Keep only minimal fields to reduce storage size.
      for (const s of batch) {
        all.push({
          epoch_second: s.epoch_second,
          problem_id: s.problem_id,
          contest_id: s.contest_id,
          result: s.result,
        });
      }

      const last = batch[batch.length - 1];
      cursor = (last?.epoch_second ?? cursor) + 1;

      if (batch.length < 500) break;
      await sleep(CFG.minDelayBetweenRequestsMs);
    }

    return all;
  }

  function computeStats(submissions, models) {
    const perProblem = new Map(); // problem_id => {contest_id, attempted, solved, difficulties}

    for (const s of submissions) {
      if (!s?.problem_id) continue;
      let p = perProblem.get(s.problem_id);
      if (!p) {
        p = {
          problem_id: s.problem_id,
          contest_id: s.contest_id,
          attempted: true,
          solved: false,
          difficulty: null,
        };
        perProblem.set(s.problem_id, p);
      }
      p.attempted = true;
      if (!p.contest_id && s.contest_id) p.contest_id = s.contest_id;
      if (s.result === "AC") p.solved = true;
    }

    // Join difficulties
    for (const p of perProblem.values()) {
      const raw = models?.[p.problem_id]?.difficulty;
      p.difficulty = clampDifficulty(raw);
    }

    const solved = [];
    const unsolved = [];
    for (const p of perProblem.values()) {
      if (p.solved) solved.push(p);
      else unsolved.push(p);
    }

    const solvedDifficulties = solved.map((p) => p.difficulty).filter((d) => Number.isFinite(d));

    // Sort unsolved by difficulty asc, unknown last
    unsolved.sort((a, b) => {
      const ad = Number.isFinite(a.difficulty) ? a.difficulty : Infinity;
      const bd = Number.isFinite(b.difficulty) ? b.difficulty : Infinity;
      if (ad !== bd) return ad - bd;
      return a.problem_id.localeCompare(b.problem_id);
    });

    return { solved, unsolved, solvedDifficulties };
  }

  async function run(root, userId, { forceFullRefresh = false } = {}) {
    try {
      setStatus(root, "Loading difficulty models…");
      const models = await loadModels();

      const { key, cached } = await loadUserCache(userId);
      const effectiveCache = forceFullRefresh ? null : cached;

      setStatus(root, "Loading submissions…");
      const submissions = await fetchSubmissionsIncremental(userId, effectiveCache, (p) => {
        if (p.phase === "fetch") {
          setStatus(
            root,
            `Loading submissions… (fetched ${fmtInt(p.count)}; from_second=${fmtInt(p.cursor)})`
          );
        }
      });

      const maxEpochSecond = submissions.reduce(
        (mx, s) => (typeof s.epoch_second === "number" ? Math.max(mx, s.epoch_second) : mx),
        -1
      );

      await saveUserCache(key, {
        fetchedAt: nowMs(),
        maxEpochSecond,
        submissions,
      });

      setStatus(root, "Computing stats…");
      const stats = computeStats(submissions, models);

      renderHistogram(root, stats.solvedDifficulties);
      renderSolvedTags(root, stats.solved);
      root.__acAnalyticsUnsolvedLimit = CFG.defaultUnsolvedLimit;
      root.__acAnalyticsUnsolvedItems = stats.unsolved;
      renderUnsolved(root, stats.unsolved, root.__acAnalyticsUnsolvedLimit);

      setStatus(
        root,
        `Submissions: ${fmtInt(submissions.length)} | Solved problems: ${fmtInt(
          stats.solved.length
        )}`,
        "ok"
      );
    } catch (e) {
      console.error("[AtCoder Analytics] error:", e);
      setStatus(root, `Error: ${e?.message ?? e}`, "error");
    }
  }

  function bind(root, userId) {
    root.addEventListener("click", (ev) => {
      const btn = ev.target?.closest?.("button[data-action]");
      if (!btn) return;
      const action = btn.getAttribute("data-action");
      if (action === "refresh") {
        // Force full refresh if user holds Shift (handy for debugging).
        const force = !!ev.shiftKey;
        run(root, userId, { forceFullRefresh: force });
      } else if (action === "more") {
        const cur = root.__acAnalyticsUnsolvedLimit ?? CFG.defaultUnsolvedLimit;
        root.__acAnalyticsUnsolvedLimit = cur + CFG.defaultUnsolvedLimit;
        renderUnsolved(root, root.__acAnalyticsUnsolvedItems ?? [], root.__acAnalyticsUnsolvedLimit);
      }
    });

    // Hover tooltip for histogram bars + donut slices
    const tip = root.querySelector(".ac-analytics__tooltip");
    root.addEventListener("mousemove", (ev) => {
      const bar = ev.target?.closest?.(".ac-analytics__bar");
      const slice = ev.target?.closest?.(".ac-analytics__donutSlice");

      let text = null;
      if (bar) {
        const count = bar.getAttribute("data-count");
        const range = bar.getAttribute("data-range");
        text = `${count} solved (diff ${range})`;
      } else if (slice) {
        const count = slice.getAttribute("data-count");
        const tag = slice.getAttribute("data-tag");
        text = `${count} solved (${tag})`;
      }

      if (!text) {
        tip.style.display = "none";
        return;
      }

      tip.textContent = text;
      tip.style.display = "block";

      // position relative to the root container
      const rect = root.getBoundingClientRect();
      const x = ev.clientX - rect.left + 12;
      const y = ev.clientY - rect.top + 12;
      tip.style.left = `${Math.max(0, x)}px`;
      tip.style.top = `${Math.max(0, y)}px`;
    });
    root.addEventListener("mouseleave", () => {
      tip.style.display = "none";
    });
    root.addEventListener("mouseover", (ev) => {
      const bar = ev.target?.closest?.(".ac-analytics__bar");
      const slice = ev.target?.closest?.(".ac-analytics__donutSlice");
      if (bar || slice) return;
      tip.style.display = "none";
    });
  }

  function main() {
    const userId = getUserIdFromPath();
    if (!userId) return;
    const root = mount(userId);
    if (!root) return;
    bind(root, userId);
    run(root, userId);
  }

  main();
})();
