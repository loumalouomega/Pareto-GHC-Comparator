import Chart from "chart.js/auto";
import type { Plugin, ScatterDataPoint } from "chart.js";
import type {
  Billing,
  ChecklistFamily,
  Options,
  Row,
  ScenarioHistory,
  ScenarioProvenance,
  ViewState,
  HostMessage,
} from "../src/types";
import type { Side, OverlayResult, OverlayRow } from "../src/comparison";
import { sources } from "../src/sources";
import { efficiencyOf } from "../src/efficiency";
import { workspaceLabel } from "../src/workspaceLabel";
import { freshnessAlert } from "../src/freshness";
import { plansFor } from "../src/plans";
declare function acquireVsCodeApi(): {
  postMessage(message: unknown): void;
  getState?(): unknown;
  setState?(state: unknown): void;
};
const vscode = acquireVsCodeApi();
const el = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const text = (tag: string, value: string, className?: string) => {
  const node = document.createElement(tag);
  node.textContent = value;
  if (className) node.className = className;
  return node;
};
const send = (type: HostMessage["type"], extra: Record<string, unknown> = {}) =>
  vscode.postMessage(
    state?.comparison && !["ready", "comparison", "target"].includes(type)
      ? {
          type: "target",
          side: state.comparison.active,
          action: { type, ...extra },
        }
      : { type, ...extra },
  );
// Targets a specific side directly, regardless of which one is Editing — for
// controls on the Compare tools tab (like the Tool A/Tool B pickers) that
// must be able to set up both sides without switching Editing back and forth.
const sendToSide = (
  side: "A" | "B",
  type: HostMessage["type"],
  extra: Record<string, unknown> = {},
) => vscode.postMessage({ type: "target", side, action: { type, ...extra } });
const format = (v: number | null) =>
  v === null
    ? "—"
    : new Intl.NumberFormat("en", { maximumSignificantDigits: 5 }).format(v);
const colors: Record<string, string> = {
  OpenAI: "#679fff",
  Anthropic: "#df946e",
  Google: "#51b88d",
  Microsoft: "#b496f6",
  xAI: "#e5b957",
  "Moonshot AI": "#e081c6",
  opencode: "#7dd3fc",
  "opencode-go": "#f0abfc",
  openai: "#679fff",
  Unknown: "#9ba3b4",
};
function hashHue(key: string): number {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return h % 360;
}
const colorForRow = (row: Row): string => {
  const light =
    document.body.classList.contains("vscode-light") ||
    document.body.classList.contains("vscode-high-contrast-light");
  const known = light ? lightColors[row.provider] : colors[row.provider];
  // Provider palette wins when the base model maps 1:1; collisions across
  // different base models sharing a provider fall back to a hashed hue so two
  // models never share an exact color in the same view.
  void known;
  const hue = hashHue(row.baseModelId || row.modelId || row.id);
  const base = `hsl(${hue} 65% ${light ? "38%" : "68%"})`;
  return base;
};
const color = (provider: string): string => {
  const light =
    document.body.classList.contains("vscode-light") ||
    document.body.classList.contains("vscode-high-contrast-light");
  return light
    ? (lightColors[provider] ?? lightColors.Unknown)
    : (colors[provider] ?? colors.Unknown);
};
let state: ViewState | undefined,
  chart: Chart<"scatter"> | undefined,
  initialized = false;
let appliedRevision = -1;
let budgetDraft: Record<Billing, number> = { credits: 1, legacy: 1, usd: 1 };
let displayedBilling: Billing = "credits";
const unitNoun = (billing: Billing) =>
  billing === "credits"
    ? "AI credits"
    : billing === "legacy"
      ? "premium requests"
      : "USD";
const unitCost = (billing: Billing) =>
  billing === "credits"
    ? "estimated AI credits"
    : billing === "legacy"
      ? "premium requests per interaction"
      : "USD";
let variantSearch = "",
  showOtherVariants = false,
  detailsModelId: string | undefined,
  pendingBenchmark: string | undefined,
  detailsMoreOpen = false;
let checklistSearch = "";
let byokDraft: Record<
  string,
  { input: string; read: string; write: string; output: string }
> = {};
let usageFullPaths = false;
// Mirrors Options["scenario"].origin/history for the pending draft: reset to
// "user" on any manual edit, set to "history" only by the prefill button.
let scenarioOrigin: "user" | "history" = "user";
let scenarioHistory: ScenarioHistory | null = null;
let scenarioPlanDraft = "none";
const collapsedFamilies = new Set<string>();
const collapsedModels = new Set<string>();
const mappingLabels = {
  exact: "Exact match",
  user: "User selected",
  selection: "Needs selection",
  missing: "Missing benchmark",
};
const lightColors: Record<string, string> = {
  OpenAI: "#2468cb",
  Anthropic: "#a64923",
  Google: "#167e51",
  Microsoft: "#7652b5",
  xAI: "#926c12",
  "Moonshot AI": "#a23782",
  opencode: "#0369a1",
  "opencode-go": "#a21caf",
  openai: "#2468cb",
  Unknown: "#637084",
};
const labels: Plugin<"scatter"> = {
  id: "modelLabels",
  afterDatasetsDraw(chart) {
    const ctx = chart.ctx;
    ctx.save();
    ctx.font = "11px sans-serif";
    ctx.fillStyle = getComputedStyle(document.body).color;
    const boxes: { x: number; y: number; w: number }[] = [];
    chart.getDatasetMeta(0).data.forEach((point, i) => {
      const row = plotted()[i];
      if (!row) return;
      const name = row.name;
      const width = ctx.measureText(name).width;
      const x = Math.min(point.x + 9, chart.chartArea.right - width),
        y = point.y - 10;
      if (
        y < chart.chartArea.top + 10 ||
        boxes.some(
          (b) =>
            Math.abs(b.y - y) < 15 && x < b.x + b.w + 6 && x + width > b.x - 6,
        )
      )
        return;
      ctx.fillStyle = getComputedStyle(document.body).backgroundColor;
      ctx.fillRect(x - 2, y - 11, width + 4, 14);
      ctx.fillStyle = getComputedStyle(document.body).color;
      ctx.fillText(name, x, y);
      boxes.push({ x, y, w: width });
    });
    ctx.restore();
  },
};
function plotted(): Row[] {
  return state?.rows.filter((r) => r.cost !== null && r.score !== null) ?? [];
}
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
/** Shaded most-attractive quadrant: above-median score at or below median cost. */
function quadrantPlug(xMed: number, yMed: number): Plugin<"scatter"> {
  return {
    id: "attractiveQuadrant",
    beforeDatasetsDraw(chart) {
      const { ctx, chartArea, scales } = chart;
      const x = scales.x,
        y = scales.y;
      if (xMed < x.min || xMed > x.max || yMed < y.min || yMed > y.max) return;
      const left = chartArea.left,
        right = x.getPixelForValue(xMed),
        top = chartArea.top,
        bottom = y.getPixelForValue(yMed);
      if (!(right > left && bottom > top)) return;
      ctx.save();
      ctx.fillStyle = "#22c55e22";
      ctx.fillRect(left, top, right - left, bottom - top);
      ctx.strokeStyle =
        getComputedStyle(document.body)
          .getPropertyValue("--vscode-panel-border")
          .trim() || "#88888855";
      ctx.setLineDash([4, 4]);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(right, top);
      ctx.lineTo(right, chartArea.bottom);
      ctx.moveTo(left, bottom);
      ctx.lineTo(chartArea.right, bottom);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.font = "11px sans-serif";
      ctx.fillStyle = getComputedStyle(document.body).color;
      ctx.fillText("Most attractive quadrant", left + 6, top + 14);
      ctx.restore();
    },
  };
}
function drawChart() {
  if (!state) return;
  const rows = plotted(),
    foreground = getComputedStyle(document.body).color;
  const grid =
    getComputedStyle(document.body)
      .getPropertyValue("--vscode-panel-border")
      .trim() || "#88888833";
  const frontier = rows
    .filter((r) => r.frontier)
    .sort((a, b) => a.cost! - b.cost! || a.score! - b.score!);
  const requested = state.options.display.scale;
  const hasZero = rows.some((r) => r.cost === 0);
  const scale =
    requested === "linear" || (requested === "auto" && hasZero)
      ? "linear"
      : "logarithmic";
  const scaleNote =
    requested === "log" && hasZero ? " (zero-cost rows require linear)" : "";
  const taskView = state.options.display.chart === "task";
  const xNoun =
    state.options.billing === "credits"
      ? taskView
        ? "AI credits per task"
        : "Estimated AI credits"
      : state.options.billing === "legacy"
        ? "Premium requests per interaction"
        : taskView
          ? "USD per task"
          : "Estimated USD";
  el("chart-title").textContent = taskView
    ? "Intelligence vs. cost per task"
    : "Quality vs. usage cost";
  el("chart").setAttribute(
    "aria-label",
    `${rows.length} models: ${state.options.preset} quality versus ${taskView ? `${unitCost(state.options.billing)} per task (fixed illustrative mix)` : unitCost(state.options.billing)}, ${scale} cost scale. The table below provides all values and model selection.`,
  );
  const data: ScatterDataPoint[] = rows.map((r) => ({
    x: r.cost!,
    y: r.score!,
  }));
  chart?.destroy();
  const showFrontier = state.options.display.frontier;
  const showQuadrant = state.options.display.quadrant && rows.length >= 2;
  const plugins: Plugin<"scatter">[] = [
    ...(state.options.display.labels ? [labels] : []),
    ...(showQuadrant
      ? [
          quadrantPlug(
            median(rows.map((r) => r.cost!)),
            median(rows.map((r) => r.score!)),
          ),
        ]
      : []),
  ];
  chart = new Chart(el<HTMLCanvasElement>("chart"), {
    type: "scatter",
    data: {
      datasets: [
        {
          label: "Models",
          data,
          backgroundColor: rows.map((r) => colorForRow(r)),
          borderColor: rows.map((r) =>
            r.id === state!.selected ? foreground : colorForRow(r),
          ),
          borderWidth: rows.map((r) => (r.id === state!.selected ? 3 : 1)),
          pointRadius: rows.map((r) =>
            state!.recommendation.modelIds.includes(r.id)
              ? 11
              : r.frontier
                ? 7
                : (r.requests ?? 0) > 0
                  ? 6
                  : 5,
          ),
          pointHoverRadius: 11,
          pointStyle: rows.map((r) =>
            state!.recommendation.modelIds.includes(r.id) ? "star" : "circle",
          ),
        },
        ...(showFrontier
          ? [
              {
                label: "Pareto frontier" as const,
                data: frontier.map((r) => ({ x: r.cost!, y: r.score! })),
                showLine: true,
                borderColor: foreground,
                borderDash: [3, 5] as number[],
                borderWidth: 2,
                pointRadius: 0,
                pointHitRadius: 0,
              },
            ]
          : []),
      ],
    },
    plugins,
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      layout: { padding: { top: 25, right: 20 } },
      plugins: {
        legend: { display: false },
        tooltip: {
          filter: (item) => item.datasetIndex === 0,
          callbacks: {
            label: (item) => {
              const r = rows[item.dataIndex];
              return `${r.name}: ${format(r.score)} score · ${format(r.cost)} ${taskView ? `${unitNoun(state!.options.billing)} per task` : unitNoun(state!.options.billing)}${r.frontier ? " · Pareto frontier" : ""}${(r.requests ?? 0) > 0 ? ` · ${r.requests} local requests` : ""}`;
            },
          },
        },
      },
      scales: {
        x: {
          type: scale,
          title: {
            display: true,
            text: `${xNoun} (${scale === "linear" ? "linear" : "log"} scale)${scaleNote}`,
            color: foreground,
          },
          ticks: { color: foreground },
          grid: { color: grid },
        },
        y: {
          title: {
            display: true,
            text: `${state.options.preset[0].toUpperCase() + state.options.preset.slice(1)} index · higher is better`,
            color: foreground,
          },
          ticks: { color: foreground },
          grid: { color: grid },
        },
      },
      onClick: (_, elements) => {
        const hit = elements.find((e) => e.datasetIndex === 0);
        if (hit) send("select", { id: rows[hit.index].id });
      },
    },
  });
}
function renderDetails() {
  if (!state) return;
  const target = el("details");
  target.replaceChildren();
  const row = state.rows.find((r) => r.id === state!.selected);
  if (!row) {
    target.append(text("p", "Select a model in the chart or table."));
    return;
  }
  if (detailsModelId !== row.id) {
    detailsModelId = row.id;
    variantSearch = "";
    showOtherVariants = false;
    pendingBenchmark = undefined;
    // Open the extra details for a model that needs the user's action.
    if (
      row.mapping ||
      row.pricing?.suggestion ||
      row.pricing?.byok?.stale ||
      row.pricing?.status === "unresolved"
    )
      detailsMoreOpen = true;
  }
  // Essentials go straight into the panel; the rest sits behind "More details".
  const more = document.createElement("details");
  more.className = "more-details";
  more.append(text("summary", "More details"));
  target.append(text("h3", row.name), text("p", row.id, "hint"));
  const copy = text(
    "button",
    row.invocable ? "Copy model ID" : "Copy model name",
  ) as HTMLButtonElement;
  copy.onclick = () => {
    send("copy", { id: row.id });
  };
  target.append(copy);
  if (row.invocable) {
    target.append(
      text("p", `${row.invocable.ref} — ${row.invocable.usage}`, "hint"),
    );
  }
  target.append(
    text(
      "p",
      row.frontier
        ? "On the Pareto frontier for the displayed models."
        : row.dominatedBy.length
          ? `Dominated by: ${row.dominatedBy.join(", ")}.`
          : "Not currently comparable.",
    ),
  );
  target.append(
    text(
      "p",
      `${format(row.cost)} ${unitCost(state.options.billing)}${row.tier ? ` · ${row.tier}` : ""}`,
    ),
  );
  if (row.breakdown) {
    const b = row.breakdown;
    const writeRate = b.rates.write ?? b.rates.input;
    more.append(
      text(
        "p",
        `Breakdown (${b.unit}): ${b.inputTokens}×${b.rates.input} + ${b.readTokens}×${b.rates.read} + ${b.writeTokens}×${writeRate} + ${b.outputTokens}×${b.rates.output}, ÷${b.divisor}${b.tier ? ` · ${b.tier}` : ""}.`,
        "hint",
      ),
    );
    if (state.options.display.chart === "task")
      more.append(
        text(
          "p",
          "Per-task estimate uses a fixed illustrative token mix, not your workload inputs. Switch the chart view to compare your own workload.",
          "hint",
        ),
      );
  } else if (row.cost === 0) {
    more.append(text("p", "Free tier: no usage cost.", "hint"));
  }
  if (row.expandedBenchmarkId) {
    more.append(
      text(
        "p",
        "Shown automatically once per matching benchmark variant. Use the benchmark dropdown below to keep only one.",
        "hint",
      ),
    );
  } else {
    const pinButton = text(
      "button",
      row.pinnedBenchmarkId ? "Unpin this variant" : "Pin as separate row",
    ) as HTMLButtonElement;
    pinButton.onclick = () => {
      if (row.pinnedBenchmarkId)
        send("unpin", { id: row.modelId, benchmarkId: row.pinnedBenchmarkId });
      else if (row.benchmark)
        send("pin", { id: row.modelId, benchmarkId: row.benchmark.id });
    };
    // Unpinning a stale pin (no resolved benchmark) must stay available;
    // only *creating* a new pin needs a resolved benchmark to pin.
    pinButton.disabled = !row.pinnedBenchmarkId && !row.benchmark;
    more.append(pinButton);
  }
  renderPricingDetail(more, row);
  const skip = new Set(
    [row.mapping?.reason, row.pricing?.reason].filter((r): r is string => !!r),
  );
  for (const reason of row.reasons)
    if (!skip.has(reason)) target.append(text("p", reason, "notice"));
  if (row.benchmark) {
    target.append(
      text("p", `Tested variant: ${row.benchmark.name}`),
      text(
        "p",
        `Selected index score: ${format(row.score)} · version ${state.version ?? "unknown"}`,
      ),
    );
    more.append(text("p", `Benchmark ID: ${row.benchmark.slug}`, "hint"));
    if ((row.requests ?? 0) > 0)
      target.append(
        text(
          "p",
          `${row.requests} local requests in the scanned history.`,
          "hint",
        ),
      );
    const drift = row.benchmark ? state.drift[row.benchmark.id] : undefined;
    if (state.prevVersion && drift) {
      more.append(
        text(
          "p",
          drift.delta === null
            ? `Score change unknown: previous snapshot v${state.prevVersion} has no comparable score.`
            : `Score change since v${state.prevVersion} (retrieved ${state.prevFetchedAt ? new Date(state.prevFetchedAt).toLocaleString() : "unknown date"}): ${drift.delta > 0 ? "+" : ""}${new Intl.NumberFormat("en", { maximumSignificantDigits: 3 }).format(drift.delta)} (was ${format(drift.prevScore)}).`,
          "hint",
        ),
      );
    }
  }
  target.append(text("p", mappingLabels[row.mappingStatus], "mapping-status"));
  if (row.mapping) {
    if (row.mapping.reason)
      more.append(text("p", row.mapping.reason, "notice"));
    if (row.mapping.aliases.length)
      more.append(
        text("p", `Aliases tried: ${row.mapping.aliases.join(", ")}.`, "hint"),
      );
    if (
      row.mapping.issue === "override-stale" ||
      row.mapping.issue === "pin-stale"
    ) {
      more.append(
        text(
          "p",
          `Previously selected benchmark "${row.mapping.staleBenchmarkId}" is no longer available. It was never silently replaced.`,
          "notice",
        ),
      );
      const chooseBtn = text(
        "button",
        "Choose replacement",
      ) as HTMLButtonElement;
      chooseBtn.onclick = () => {
        select.focus();
        select.scrollIntoView({ block: "nearest" });
      };
      more.append(chooseBtn);
    }
    if (row.mapping.suggestions.length) {
      more.append(
        text("p", "Suggested (identifier match — unverified):", "hint"),
      );
      const list = document.createElement("ul");
      list.className = "mapping-suggestions";
      for (const s of row.mapping.suggestions) {
        const item = document.createElement("li");
        item.append(text("span", `${s.name} · ${s.slug}`));
        const applyBtn = text("button", "Apply") as HTMLButtonElement;
        applyBtn.onclick = () =>
          send("mapping", { id: row.id, benchmarkId: s.benchmarkId });
        item.append(applyBtn);
        list.append(item);
      }
      more.append(list);
      more.append(
        text(
          "p",
          "Applying a suggestion selects a benchmark only; it never sets a price.",
          "hint",
        ),
      );
    }
  }
  if (state.recommendation.modelIds.includes(row.id))
    target.append(
      text("p", state.recommendation.explanation, "recommendation-detail"),
    );
  const searchLabel = text("label", "Search benchmark variants");
  const search = document.createElement("input");
  search.id = "variant-search";
  search.type = "search";
  search.value = variantSearch;
  searchLabel.append(search);
  more.append(searchLabel);
  const manualLabel = text("label", "Show other benchmarks for manual mapping");
  manualLabel.className = "checkbox-label";
  const manual = document.createElement("input");
  manual.id = "variant-manual";
  manual.type = "checkbox";
  manual.checked = showOtherVariants;
  manualLabel.prepend(manual);
  more.append(manualLabel);
  const label = text("label", "Benchmark variant");
  const select = document.createElement("select");
  select.id = "benchmark";
  const applyBtn = text("button", "Apply mapping") as HTMLButtonElement;
  const resetBtn = text("button", "Reset to automatic") as HTMLButtonElement;
  const pendingNote = text("p", "", "hint");
  const updateApplyState = () => {
    const current = row.selectedBenchmarkId ?? "";
    const pending = pendingBenchmark ?? current;
    const changed = pending !== current;
    applyBtn.disabled = !changed;
    resetBtn.disabled = !row.selectedBenchmarkId;
    const chosen = state!.models.find((b) => b.id === pending);
    pendingNote.textContent = !changed
      ? ""
      : chosen
        ? `Will map to ${chosen.name} (${chosen.slug}). Not applied yet — Apply mapping to confirm.`
        : "Will reset to automatic matching. Not applied yet — Apply mapping to confirm.";
  };
  const populate = () => {
    select.replaceChildren(new Option("Use automatic matching", ""));
    const candidates = new Set(row.candidateIds);
    const suggested = new Set(
      (row.mapping?.suggestions ?? []).map((s) => s.benchmarkId),
    );
    const matches = state!.models
      .filter((b) =>
        `${b.name} ${b.slug}`
          .toLowerCase()
          .includes(variantSearch.toLowerCase()),
      )
      .sort((a, b) => a.name.localeCompare(b.name));
    for (const [title, list] of [
      ["Matching variants", matches.filter((b) => candidates.has(b.id))],
      [
        "Suggested — identifier match (unverified)",
        matches.filter((b) => suggested.has(b.id) && !candidates.has(b.id)),
      ],
      [
        "Other benchmarks — manual mapping",
        showOtherVariants
          ? matches.filter((b) => !candidates.has(b.id) && !suggested.has(b.id))
          : [],
      ],
    ] as const) {
      if (!list.length) continue;
      const group = document.createElement("optgroup");
      group.label = title;
      for (const b of list)
        group.append(new Option(`${b.name} · ${b.slug}`, b.id));
      select.append(group);
    }
    const shown = row.selectedBenchmarkId ?? "";
    if (shown && !Array.from(select.options).some((o) => o.value === shown)) {
      const current = new Option(
        row.benchmark
          ? `Current selection: ${row.benchmark.name}`
          : "Unavailable benchmark — choose a replacement",
        shown,
      );
      current.disabled = !row.benchmark;
      select.append(current);
    }
    select.value = pendingBenchmark ?? shown;
    updateApplyState();
  };
  search.oninput = () => {
    variantSearch = search.value;
    populate();
  };
  manual.onchange = () => {
    showOtherVariants = manual.checked;
    populate();
  };
  select.onchange = () => {
    pendingBenchmark = select.value;
    updateApplyState();
  };
  applyBtn.onclick = () => {
    send("mapping", {
      id: row.id,
      benchmarkId: pendingBenchmark ?? select.value,
    });
    pendingBenchmark = undefined;
  };
  resetBtn.onclick = () => {
    pendingBenchmark = "";
    send("mapping", { id: row.id, benchmarkId: "" });
  };
  populate();
  label.append(select);
  more.append(label, applyBtn, resetBtn, pendingNote);
  more.append(
    text(
      "p",
      state.options.source === "opencode"
        ? "Matching uses explicit model-family aliases. Multiple benchmark variants are shown as separate rows; the dropdown keeps only one. Manual selections may differ from OpenCode's runtime configuration."
        : "Matching uses explicit model-family aliases. Multiple benchmark variants are shown as separate rows; the dropdown keeps only one. Manual selections may differ from Copilot’s reasoning settings.",
      "hint",
    ),
  );
  more.open = detailsMoreOpen;
  more.ontoggle = () => {
    detailsMoreOpen = more.open;
  };
  target.append(more);
}
/**
 * Pricing provenance and, for an unresolved provider-billed OpenCode model, a
 * same-identifier static-registry rate suggestion — unverified until Apply.
 * A benchmark choice is never involved here and never sets a price.
 */
function renderPricingDetail(target: HTMLElement, row: Row) {
  if (!state || !row.pricing) return;
  const p = row.pricing;
  const registryLabel = (registry: string) =>
    sources[registry as keyof typeof sources]?.label ?? registry;
  const sourceText =
    p.status === "priced"
      ? p.source === "copilot-catalog"
        ? `Copilot catalog (${state.catalogDate})`
        : p.source === "legacy-multiplier"
          ? "Legacy plan multiplier"
          : p.source === "opencode-cli"
            ? "OpenCode CLI live rate"
            : `Static registry (${state.staticRegistryDate})`
      : p.status === "free"
        ? "Free tier"
        : p.status === "byok"
          ? p.byok?.provenance.kind === "registry"
            ? `User BYOK from ${registryLabel(p.byok.provenance.registry)} registry, ${p.byok.provenance.registryDate}`
            : "User BYOK (manual)"
          : p.status === "not-comparable"
            ? "Not comparable in this billing mode"
            : "Unresolved";
  target.append(text("p", `Pricing: ${sourceText}`, "hint"));
  if (p.status === "unresolved" && p.reason)
    target.append(text("p", p.reason, "notice"));
  if (p.byok?.stale)
    target.append(
      text(
        "p",
        p.byok.stale === "rates-changed"
          ? "The applied registry rate has changed since this was applied; still using the rate you applied."
          : "The registry entry this rate was applied from is no longer available; still using the rate you applied.",
        "notice",
      ),
    );
  if (p.status === "byok") {
    const editBtn = text("button", "Edit in BYOK rates") as HTMLButtonElement;
    editBtn.onclick = () => {
      showTab("usage");
      el("byok-card").scrollIntoView({ block: "nearest" });
    };
    const removeBtn = text("button", "Remove BYOK rate") as HTMLButtonElement;
    removeBtn.onclick = () => send("byokReset", { ids: [row.modelId] });
    target.append(editBtn, removeBtn);
  }
  if (p.suggestion) {
    const s = p.suggestion;
    target.append(
      text(
        "p",
        `${registryLabel(s.registry)} registry lists ${s.registryName} (${s.registryId}) at ${s.rates.input} / ${s.rates.read} / ${s.rates.write ?? s.rates.input} / ${s.rates.output} USD per 1M tokens (input / cache read / cache write / output), registry date ${s.registryDate}. Not applied.`,
        "hint",
      ),
    );
    const link = document.createElement("a");
    link.href = s.sourceUrl;
    link.target = "_blank";
    link.rel = "noopener";
    link.textContent = "Registry source";
    target.append(link);
    const applyRate = text(
      "button",
      "Apply rate to this model",
    ) as HTMLButtonElement;
    applyRate.onclick = () => send("byokApply", { ids: [row.modelId] });
    target.append(applyRate);
    const siblings = [
      ...new Set(
        state.rows
          .filter(
            (r) =>
              r.baseModelId === row.baseModelId &&
              r.pricing?.suggestion?.registryId === s.registryId,
          )
          .map((r) => r.modelId),
      ),
    ];
    if (siblings.length > 1) {
      const applyAll = text(
        "button",
        `Apply to all ${siblings.length} variants`,
      ) as HTMLButtonElement;
      applyAll.onclick = () => send("byokApply", { ids: siblings });
      target.append(applyAll);
    }
  }
}
function groupMatches(
  groups: ChecklistFamily[],
  query: string,
): ChecklistFamily[] {
  const q = query.trim().toLowerCase();
  if (!q) return groups;
  const out: ChecklistFamily[] = [];
  for (const family of groups) {
    const familyHit = family.name.toLowerCase().includes(q);
    const models = [];
    for (const model of family.models) {
      const modelHit =
        model.name.toLowerCase().includes(q) ||
        model.provider.toLowerCase().includes(q);
      const leaves = model.leaves.filter(
        (l) =>
          familyHit ||
          modelHit ||
          l.name.toLowerCase().includes(q) ||
          l.thinking.toLowerCase().includes(q) ||
          l.id.toLowerCase().includes(q),
      );
      if (familyHit || modelHit || leaves.length)
        models.push({
          ...model,
          leaves: familyHit || modelHit ? model.leaves : leaves,
        });
    }
    if (familyHit || models.length) out.push({ ...family, models });
  }
  return out;
}

function visibleLeafIds(groups: ChecklistFamily[], query: string): string[] {
  return groupMatches(groups, query).flatMap((f) =>
    f.models.flatMap((m) => m.leaves.map((l) => l.id)),
  );
}

function checkRow(
  checked: boolean,
  indeterminate: boolean,
  label: string,
  checkId: string,
  onChange: (next: boolean) => void,
): HTMLLabelElement {
  const row = document.createElement("label");
  row.className = "checkbox-label";
  const box = document.createElement("input");
  box.type = "checkbox";
  box.checked = checked;
  box.indeterminate = indeterminate;
  box.setAttribute("aria-label", label);
  (box.dataset as Record<string, string>).checkId = checkId;
  box.onchange = () => onChange(box.checked);
  row.append(box, text("span", label));
  return row;
}

function renderChecklist() {
  if (!state) return;
  const source = state.groups?.length ? state.groups : [];
  const groups = source.length ? groupMatches(source, checklistSearch) : [];
  // Fall back to the flat checklist when grouped data is unavailable
  // (e.g. synthetic states in browser tests that predate grouping).
  const flat = !source.length ? state.checklist : [];
  const searchInput = el<HTMLInputElement>("checklist-search");
  if (searchInput && searchInput.value !== checklistSearch)
    searchInput.value = checklistSearch;
  const searching = checklistSearch.trim().length > 0;
  const allButton = el<HTMLButtonElement>("include-all");
  const noneButton = el<HTMLButtonElement>("include-none");
  if (allButton)
    allButton.textContent = searching ? "Select matching" : "Select all";
  if (noneButton)
    noneButton.textContent = searching ? "Clear matching" : "Select none";
  const checklistEl = el("checklist");
  checklistEl.replaceChildren();
  if (!groups.length && !flat.length) {
    checklistEl.append(
      text(
        "p",
        searching
          ? "No models match this filter."
          : "No models available for this source.",
        "hint",
      ),
    );
    return;
  }
  for (const entry of flat) {
    const row = checkRow(
      entry.included,
      false,
      `${entry.name} (${entry.rowCount})`,
      `leaf:${entry.id}`,
      (next) => send("exclude", { id: entry.id, excluded: !next }),
    );
    checklistEl.append(row);
  }
  for (const family of groups) {
    const wrap = document.createElement("div");
    wrap.className = "check-family";
    const header = document.createElement("div");
    header.className = "check-header";
    const expander = document.createElement("button");
    expander.type = "button";
    expander.className = "secondary check-toggle";
    const collapsed = collapsedFamilies.has(family.id);
    expander.textContent = collapsed ? "▸" : "▾";
    expander.setAttribute(
      "aria-label",
      `${collapsed ? "Expand" : "Collapse"} ${family.name}`,
    );
    (expander.dataset as Record<string, string>).checkId =
      `toggle:${family.id}`;
    expander.onclick = () => {
      if (collapsedFamilies.has(family.id)) collapsedFamilies.delete(family.id);
      else collapsedFamilies.add(family.id);
      renderChecklist();
    };
    const visibleIds = new Set(
      groupMatches([family], checklistSearch).flatMap((f) =>
        f.models.flatMap((m) => m.leaves.map((l) => l.id)),
      ),
    );
    const leaves = family.models.flatMap((m) => m.leaves);
    const visible = leaves.filter((l) => visibleIds.has(l.id));
    const included = visible.filter((l) => l.included).length;
    const allIncluded = visible.length > 0 && included === visible.length;
    const mixed = included > 0 && included < visible.length;
    const row = checkRow(
      searching ? allIncluded : family.state === "checked",
      searching ? mixed : family.state === "mixed",
      `${family.name} (${searching ? included : family.includedCount}/${searching ? visible.length : family.totalCount})`,
      `family:${family.id}`,
      (next) => {
        const ids = searching
          ? visible.map((l) => l.id)
          : family.models.flatMap((m) => m.leaves.map((l) => l.id));
        if (ids.length === 1) send("exclude", { id: ids[0], excluded: !next });
        else send("excludeMany", { ids, excluded: !next });
      },
    );
    row.classList.add("check-family-row");
    header.append(expander, row);
    wrap.append(header);
    if (collapsed) {
      checklistEl.append(wrap);
      continue;
    }
    for (const model of family.models) {
      const modelVisible = model.leaves.filter((l) => visibleIds.has(l.id));
      if (!modelVisible.length) continue;
      const modelWrap = document.createElement("div");
      modelWrap.className = "check-model";
      if (model.leaves.length === 1) {
        const leaf = model.leaves[0];
        const single = checkRow(
          leaf.included,
          false,
          `${model.name} (${leaf.rowCount})`,
          `leaf:${leaf.id}`,
          (next) => send("exclude", { id: leaf.id, excluded: !next }),
        );
        single.classList.add("check-leaf-row");
        modelWrap.append(single);
        wrap.append(modelWrap);
        continue;
      }
      const modelHeader = document.createElement("div");
      modelHeader.className = "check-header";
      const modelToggle = document.createElement("button");
      modelToggle.type = "button";
      modelToggle.className = "secondary check-toggle";
      const modelCollapsed = collapsedModels.has(model.id);
      modelToggle.textContent = modelCollapsed ? "▸" : "▾";
      modelToggle.setAttribute(
        "aria-label",
        `${modelCollapsed ? "Expand" : "Collapse"} ${model.name}`,
      );
      (modelToggle.dataset as Record<string, string>).checkId =
        `toggle:${model.id}`;
      modelToggle.onclick = () => {
        if (collapsedModels.has(model.id)) collapsedModels.delete(model.id);
        else collapsedModels.add(model.id);
        renderChecklist();
      };
      const modelIncluded = modelVisible.filter((l) => l.included).length;
      const modelAll =
        modelVisible.length > 0 && modelIncluded === modelVisible.length;
      const modelMixed =
        modelIncluded > 0 && modelIncluded < modelVisible.length;
      const modelRow = checkRow(
        searching ? modelAll : model.state === "checked",
        searching ? modelMixed : model.state === "mixed",
        `${model.name} (${searching ? modelIncluded : model.includedCount}/${searching ? modelVisible.length : model.totalCount})`,
        `model:${model.id}`,
        (next) => {
          const ids = searching
            ? modelVisible.map((l) => l.id)
            : model.leaves.map((l) => l.id);
          if (ids.length === 1)
            send("exclude", { id: ids[0], excluded: !next });
          else send("excludeMany", { ids, excluded: !next });
        },
      );
      modelRow.classList.add("check-model-row");
      modelHeader.append(modelToggle, modelRow);
      modelWrap.append(modelHeader);
      if (!modelCollapsed) {
        for (const leaf of modelVisible) {
          const leafRow = checkRow(
            leaf.included,
            false,
            model.leaves.length > 1
              ? `${leaf.thinking} · ${leaf.name} (${leaf.rowCount})`
              : `${leaf.name} (${leaf.rowCount})`,
            `leaf:${leaf.id}`,
            (next) => send("exclude", { id: leaf.id, excluded: !next }),
          );
          leafRow.classList.add("check-leaf-row");
          modelWrap.append(leafRow);
        }
      }
      wrap.append(modelWrap);
    }
    checklistEl.append(wrap);
  }
}
function renderByok() {
  const card = el("byok-card") as HTMLElement;
  const show = !!state && state.options.source === "opencode";
  card.hidden = !show;
  if (!show || !state) return;
  const table = el("byok-table");
  table.replaceChildren();
  const seen = new Set<string>();
  // Kept visible for a BYOK-applied model too (status "byok"), fixing the
  // earlier form where a saved rate made its own row disappear.
  const models = state.rows.filter((r) => {
    if (
      seen.has(r.modelId) ||
      !r.modelId.startsWith("opencode:") ||
      !(
        r.pricing?.status === "byok" ||
        r.pricing?.issue === "provider-billed-no-rate"
      )
    )
      return false;
    seen.add(r.modelId);
    return true;
  });
  if (!models.length && !Object.keys(state.byok).length) {
    table.append(
      text("p", "No provider-billed models need rates right now.", "hint"),
    );
    return;
  }
  for (const m of models) {
    const stored = state.byok[m.modelId];
    const draft = (byokDraft[m.modelId] ??= {
      input: stored ? String(stored.rates.input) : "",
      read: stored ? String(stored.rates.read) : "",
      write:
        stored?.rates.write === null || stored?.rates.write === undefined
          ? ""
          : String(stored.rates.write),
      output: stored ? String(stored.rates.output) : "",
    });
    const wrap = document.createElement("div");
    wrap.append(text("strong", m.name));
    if (stored) {
      wrap.append(
        text(
          "span",
          stored.source?.kind === "registry"
            ? ` · from ${sources[stored.source.registry as keyof typeof sources]?.label ?? stored.source.registry} registry, ${stored.source.registryDate}`
            : " · manual",
          "hint",
        ),
      );
      const removeBtn = text("button", "Remove") as HTMLButtonElement;
      removeBtn.onclick = () => send("byokReset", { ids: [m.modelId] });
      wrap.append(removeBtn);
    }
    for (const field of ["input", "read", "write", "output"] as const) {
      const label = document.createElement("label");
      label.append(
        text(
          "span",
          field === "input"
            ? "Input"
            : field === "read"
              ? "Cache read"
              : field === "write"
                ? "Cache write (blank = input)"
                : "Output",
        ),
      );
      const box = document.createElement("input");
      box.type = "number";
      box.min = "0";
      box.step = "any";
      box.value = draft[field];
      box.setAttribute(
        "aria-label",
        `${m.name} ${field} USD per million tokens`,
      );
      box.addEventListener("input", () => {
        draft[field] = box.value;
      });
      label.append(box);
      wrap.append(label);
    }
    table.append(wrap);
  }
  const stale = Object.keys(state.byok).filter((id) => !seen.has(id));
  if (stale.length) {
    table.append(
      text("p", "Saved rates for models not currently listed here:", "hint"),
    );
    for (const id of stale) {
      const row = document.createElement("div");
      row.append(text("span", id, "hint"));
      const removeBtn = text("button", "Remove") as HTMLButtonElement;
      removeBtn.onclick = () => send("byokReset", { ids: [id] });
      row.append(removeBtn);
      table.append(row);
    }
  }
}
function provenanceLabel(p: ScenarioProvenance): string {
  switch (p.kind) {
    case "provider":
      return `provider-verified · plans dated ${p.date}`;
    case "user":
      return "your input";
    case "history":
      return `observed history (${p.from} – ${p.to} UTC)`;
    case "estimate":
      return `displayed ${p.basis === "task" ? "task" : p.basis === "workload" ? "workload" : "legacy"} estimate · catalog ${p.catalogDate}`;
  }
}
const scenarioRange = (r: { low: number; high: number }) =>
  r.low === r.high ? format(r.low) : `${format(r.low)}–${format(r.high)}`;
/**
 * Renders the "Monthly spending scenario" card: a what-if projection from
 * plan.ts, kept visibly separate from local history and per-task/workload
 * estimates, with every figure labelled by its provenance. Never a bill.
 */
function renderScenario() {
  if (!state) return;
  const planSelect = el<HTMLSelectElement>("scenario-plan");
  const choices = plansFor(state.options.source, state.options.billing);
  planSelect.replaceChildren(new Option("Off", "none"));
  for (const c of choices) {
    const option = new Option(
      c.available ? c.label : `${c.label} (unavailable)`,
      c.id,
    );
    option.disabled = !c.available;
    if (c.reason) option.title = c.reason;
    planSelect.append(option);
  }
  // An unknown/removed saved plan id is kept visible and disabled, never
  // silently dropped or swapped for another plan.
  if (
    scenarioPlanDraft !== "none" &&
    !choices.some((c) => c.id === scenarioPlanDraft)
  ) {
    const unknown = new Option(
      `Unavailable: ${scenarioPlanDraft}`,
      scenarioPlanDraft,
    );
    unknown.disabled = true;
    planSelect.append(unknown);
  }
  planSelect.value = scenarioPlanDraft;
  const chosen = choices.find((c) => c.id === planSelect.value);
  el("scenario-plan-note").textContent = chosen?.reason ?? "";
  const isCustom = planSelect.value === "custom";
  (el("scenario-custom") as HTMLElement).hidden = !isCustom;
  const unitWord =
    state.options.billing === "legacy" ? "premium request" : "AI credit";
  el("scenario-custom-allowance-unit").textContent =
    `Included ${unitWord}s / month`;
  el("scenario-custom-overage-unit").textContent = `USD per extra ${unitWord}`;

  const prefillBtn = el<HTMLButtonElement>("scenario-prefill");
  const prefill = state.scenarioPrefill;
  prefillBtn.disabled = !prefill;
  el("scenario-prefill-note").textContent = prefill
    ? `Observed history: ${prefill.requests} requests over ${prefill.activeDays} active / ${prefill.calendarDays} calendar days (${prefill.from} – ${prefill.to} UTC)${prefill.undated ? ` · ${prefill.undated} undated excluded` : ""} · all Copilot models.`
    : "Scan local usage to enable a history-based estimate.";

  const result = el("scenario-result");
  result.replaceChildren();
  const notes = el("scenario-notes");
  notes.replaceChildren();
  const s = state.scenario;
  if (s.status === "unavailable") {
    result.append(text("p", s.reason, "notice"));
    for (const n of s.notes) notes.append(text("li", n));
  } else if (s.status === "projected") {
    result.append(
      text(
        "p",
        `Plan: ${s.plan.label}${s.plan.registryDate ? ` · plans dated ${s.plan.registryDate}` : ""}`,
      ),
      text(
        "p",
        `Model: ${s.row.name}${s.row.origin !== "selected" ? ` (${s.row.origin})` : ""}`,
      ),
      text(
        "p",
        `Requests / month: ${scenarioRange(s.requests)} · ${provenanceLabel(s.requests.provenance)}`,
      ),
      text(
        "p",
        `Per-request estimate: ${format(s.perRequest.value)} ${s.plan.unit} · ${provenanceLabel(s.perRequest.provenance)}`,
        "hint",
      ),
      text("p", `Monthly usage: ${scenarioRange(s.usage)} ${s.plan.unit}`),
      text(
        "p",
        `Allowance: ${scenarioRange(s.allowance)} ${s.plan.unit}${s.allowance.flexVariable ? " (base to base + flex)" : ""} · ${provenanceLabel(s.allowance.provenance)}`,
      ),
      text(
        "p",
        `Beyond allowance: ${scenarioRange(s.overageUnits)} ${s.plan.unit}${s.overageUsd ? ` · up to ${format(s.overageUsd.high)} USD if a budget allows` : ""}`,
      ),
      text(
        "p",
        `Plan fee: ${s.feeUsd.value === null ? "not documented — not included" : `${format(s.feeUsd.value)} USD / month${s.feeUsd.basis === "seat" ? " per seat" : ""}`}`,
      ),
      text(
        "p",
        `Estimated monthly total: ${s.totalUsd ? `${scenarioRange(s.totalUsd)} USD` : "unavailable"}`,
        "mapping-status",
      ),
      text(
        "p",
        `Boundary — low estimate: ${s.boundary.low.replace(/-/g, " ")} · high estimate: ${s.boundary.high.replace(/-/g, " ")}`,
        "hint",
      ),
    );
    for (const n of s.notes) notes.append(text("li", n));
  }
  if (s.status !== "off") notes.append(text("li", s.disclaimer, "hint"));
}
function renderUsage() {
  if (!state) return;
  const u = state.usage;
  const d = u?.diagnostics;
  el("usage-diagnostics").textContent = d
    ? `Completeness: ${d.malformed} malformed records · ${d.unsupported} unsupported files · ${d.unreadable} unreadable files · ${d.stale} stale contributions · ${d.missingTokens} requests missing tokens · ${d.estimatedTokens} estimated requests. Prefill and credit budgets use fully observed token pairs only.`
    : "";
  el("usage-watching").textContent = state.usageWatching
    ? "Watching for new sessions."
    : "";
  const summary = el("usage-summary");
  const modelsEl = el("usage-models"),
    daysEl = el("usage-days"),
    wsEl = el("usage-workspaces");
  modelsEl.replaceChildren();
  daysEl.replaceChildren();
  wsEl.replaceChildren();
  el("usage-unknown").textContent = "";
  if (!u) {
    summary.textContent =
      "No local scan yet. Scanning reads VS Code chat sessions on this machine only.";
    return;
  }
  const num = (n: number) =>
    new Intl.NumberFormat("en", { maximumSignificantDigits: 6 }).format(n);
  const range = u.dateRange
    ? `${new Date(u.dateRange.from).toLocaleDateString()} – ${new Date(u.dateRange.to).toLocaleDateString()}`
    : "no dated requests";
  summary.textContent =
    `${u.requestCount} requests · ${num(u.promptTokens)} prompt + ${num(u.outputTokens)} output tokens · ` +
    `≈${num(u.premiumEstimate)} premium requests · ${u.fileCount} files · ${range} · ` +
    `scanned ${new Date(u.scannedAt).toLocaleString()}` +
    (u.estimatedTokens ? ` · ${u.estimatedTokens} text-estimated` : "");
  const table = (title: string, head: string[], rows: string[][]) => {
    const wrap = document.createElement("div");
    wrap.append(text("h3", title));
    const tbl = document.createElement("table");
    const hr = document.createElement("tr");
    for (const h of head) {
      const th = document.createElement("th");
      th.scope = "col";
      th.textContent = h;
      hr.append(th);
    }
    const headEl = document.createElement("thead");
    headEl.append(hr);
    tbl.append(headEl);
    const body = document.createElement("tbody");
    for (const r of rows) {
      const tr = document.createElement("tr");
      for (const c of r) tr.append(text("td", c));
      body.append(tr);
    }
    tbl.append(body);
    wrap.append(tbl);
    return wrap;
  };
  if (u.models.length)
    modelsEl.append(
      table(
        "By model",
        ["Model", "Requests", "Prompt", "Output", "Premium ≈"],
        u.models
          .slice(0, 12)
          .map((m) => [
            m.modelId,
            String(m.requests),
            num(m.promptTokens),
            num(m.outputTokens),
            String(m.premiumEstimate),
          ]),
      ),
    );
  if (u.days.length)
    daysEl.append(
      table(
        "By day",
        ["Date", "Requests", "Prompt", "Output", "Premium ≈"],
        u.days
          .slice(-14)
          .map((d) => [
            d.date,
            String(d.requests),
            num(d.promptTokens),
            num(d.outputTokens),
            String(d.premiumEstimate),
          ]),
      ),
    );
  if (u.workspaces.length) {
    const shown = u.workspaces.slice(0, 20);
    const wrap = table(
      "By workspace",
      ["Workspace", "Requests", "Prompt", "Output", "Premium ≈"],
      shown.map((w) => [
        workspaceLabel(w.path, w.id, usageFullPaths),
        String(w.requests),
        num(w.promptTokens),
        num(w.outputTokens),
        String(w.premiumEstimate),
      ]),
    );
    wrap.querySelectorAll("tbody tr").forEach((tr, i) => {
      const cell = tr.querySelector("td");
      if (cell && shown[i].path) cell.title = shown[i].path;
    });
    wsEl.append(wrap);
  }
  if (u.unknownModels.length)
    el("usage-unknown").textContent =
      `Unknown models use a 1.0 fallback multiplier: ${u.unknownModels.slice(0, 10).join(", ")}` +
      (u.unknownModels.length > 10
        ? ` (+${u.unknownModels.length - 10} more)`
        : "") +
      ".";
}
const comparisonCharts: Chart<"scatter">[] = [];
const overlaySidePointStyle: Record<Side, "circle" | "rectRot"> = {
  A: "circle",
  B: "rectRot",
};
const overlaySideBorderColor: Record<Side, string> = {
  A: "#2f6fed",
  B: "#e2792e",
};
const overlaySideDash: Record<Side, number[]> = { A: [4, 4], B: [8, 4] };
/** Same fill logic as colorForRow (hue hashed from the base model), so the
 * same model keeps the same hue on both sides; side is told apart instead by
 * point shape and border color, since a shared model can appear on both. */
const overlayFillColor = (row: OverlayRow): string => {
  const light =
    document.body.classList.contains("vscode-light") ||
    document.body.classList.contains("vscode-high-contrast-light");
  const hue = hashHue(row.baseModelId || row.id);
  return `hsl(${hue} 65% ${light ? "38%" : "68%"})`;
};
/** Draws the single overlaid chart into `card`: both options' models, each
 * side's own Pareto frontier, and (when comparable) the combined frontier
 * across both. See overlayResult in src/comparison.ts for how rows and the
 * combined frontier are computed. */
function drawOverlay(
  pair: NonNullable<ViewState["comparison"]>,
  overlay: OverlayResult,
  card: HTMLElement,
) {
  const a = pair.sides.A,
    b = pair.sides.B;
  card.append(
    text("h2", "Overlay: quality vs. cost"),
    text(
      "p",
      `A: ${a.name} (${sources[a.options.source].label}) vs B: ${b.name} (${sources[b.options.source].label}) · ${overlay.unit}` +
        (overlay.converted
          ? " (pay-as-you-go equivalent; included allowance and plan fee not counted)"
          : ""),
    ),
  );
  for (const notice of overlay.notices)
    card.append(text("p", notice, "hint comparison-overlay-notice"));
  const wrap = text("div", "", "comparison-overlay-chart");
  const canvas = document.createElement("canvas");
  canvas.id = "comparison-chart-overlay";
  canvas.setAttribute(
    "aria-label",
    "Overlay of both options' quality and cost, with each option's Pareto frontier and the combined frontier across both",
  );
  wrap.append(canvas);
  card.append(wrap);
  const bySide = (side: Side) => overlay.rows.filter((r) => r.side === side);
  const byX = (x: OverlayRow, y: OverlayRow) => x.x - y.x || x.score - y.score;
  const aRows = bySide("A"),
    bRows = bySide("B");
  const aFrontierRows = aRows.filter((r) => r.sideFrontier).sort(byX);
  const bFrontierRows = bRows.filter((r) => r.sideFrontier).sort(byX);
  const combinedRows = overlay.rows.filter((r) => r.combinedFrontier).sort(byX);
  // Parallel to `data` in each dataset below, so onClick/tooltip can map a
  // point back to its originating side and row id.
  const datasetRows = [
    aRows,
    bRows,
    aFrontierRows,
    bFrontierRows,
    combinedRows,
  ];
  if (combinedRows.length)
    card.append(
      text(
        "p",
        `Combined frontier: ${combinedRows.filter((r) => r.side === "A").length} from A, ${combinedRows.filter((r) => r.side === "B").length} from B.`,
        "hint",
      ),
    );
  const showLabels = a.options.display.labels || b.options.display.labels;
  const showQuadrant = a.options.display.quadrant || b.options.display.quadrant;
  const hasZero = overlay.rows.some((r) => r.x === 0);
  comparisonCharts.push(
    new Chart(canvas, {
      type: "scatter",
      plugins: [
        ...(showQuadrant && overlay.rows.length
          ? [
              quadrantPlug(
                median(overlay.rows.map((r) => r.x)),
                median(overlay.rows.map((r) => r.score)),
              ),
            ]
          : []),
        ...(showLabels
          ? [
              {
                id: "overlayLabels",
                afterDatasetsDraw(c: Chart<"scatter">) {
                  c.ctx.save();
                  c.ctx.fillStyle = getComputedStyle(document.body).color;
                  c.ctx.font = "10px sans-serif";
                  for (const index of [0, 1]) {
                    const rows = datasetRows[index];
                    c.getDatasetMeta(index).data.forEach((point, i) => {
                      if (rows[i])
                        c.ctx.fillText(rows[i].name, point.x + 5, point.y - 5);
                    });
                  }
                  c.ctx.restore();
                },
              },
            ]
          : []),
      ],
      data: {
        datasets: [
          {
            label: `A · ${sources[a.options.source].label}`,
            data: aRows.map((r) => ({ x: r.x, y: r.score })),
            backgroundColor: aRows.map(overlayFillColor),
            borderColor: overlaySideBorderColor.A,
            pointStyle: overlaySidePointStyle.A,
            pointRadius: aRows.map((r) => (r.selected ? 8 : 4)),
            pointBorderWidth: 1.5,
          },
          {
            label: `B · ${sources[b.options.source].label}`,
            data: bRows.map((r) => ({ x: r.x, y: r.score })),
            backgroundColor: bRows.map(overlayFillColor),
            borderColor: overlaySideBorderColor.B,
            pointStyle: overlaySidePointStyle.B,
            pointRadius: bRows.map((r) => (r.selected ? 8 : 4)),
            pointBorderWidth: 1.5,
          },
          {
            label: "A frontier",
            hidden: !a.options.display.frontier,
            data: aFrontierRows.map((r) => ({ x: r.x, y: r.score })),
            showLine: true,
            borderColor: overlaySideBorderColor.A,
            borderDash: overlaySideDash.A,
            pointRadius: 0,
          },
          {
            label: "B frontier",
            hidden: !b.options.display.frontier,
            data: bFrontierRows.map((r) => ({ x: r.x, y: r.score })),
            showLine: true,
            borderColor: overlaySideBorderColor.B,
            borderDash: overlaySideDash.B,
            pointRadius: 0,
          },
          {
            label: "Combined frontier",
            data: combinedRows.map((r) => ({ x: r.x, y: r.score })),
            showLine: combinedRows.length > 0,
            borderColor: getComputedStyle(document.body).color,
            borderWidth: 2.5,
            pointRadius: combinedRows.length ? 5 : 0,
            pointBackgroundColor: getComputedStyle(document.body).color,
          },
        ],
      },
      options: {
        animation: false,
        plugins: {
          legend: { display: true },
          tooltip: {
            callbacks: {
              label: (context) => {
                const row =
                  datasetRows[context.datasetIndex]?.[context.dataIndex];
                if (!row)
                  return ["A frontier", "B frontier", "Combined frontier"][
                    context.datasetIndex - 2
                  ];
                return `${row.side} · ${sources[row.source].label} · ${row.name}: ${context.parsed.y} points, ${context.parsed.x} ${overlay.unit}`;
              },
            },
          },
        },
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: {
            type:
              a.options.display.scale === "linear" || hasZero
                ? "linear"
                : "logarithmic",
            title: { display: true, text: overlay.unit },
          },
          y: { title: { display: true, text: a.options.preset } },
        },
        onClick: (_event, elements) => {
          const e = elements[0];
          const row = e && datasetRows[e.datasetIndex]?.[e.index];
          if (row)
            send("target", {
              side: row.side,
              action: { type: "select", id: row.id },
            });
        },
      },
    }),
  );
}
function renderComparison() {
  for (const c of comparisonCharts) c.destroy();
  comparisonCharts.length = 0;
  const focused = document.activeElement as HTMLElement | null;
  const focusSide = focused?.dataset.comparisonSide,
    focusRow = focused?.dataset.comparisonRow;
  const pair = state?.comparison;
  el<HTMLInputElement>("comparison-enabled").checked = !!pair;
  el<HTMLSelectElement>("comparison-source-a").disabled = !pair;
  el<HTMLSelectElement>("comparison-source-b").disabled = !pair;
  el<HTMLSelectElement>("comparison-active").disabled = !pair;
  el<HTMLInputElement>("comparison-name").disabled = !pair;
  el<HTMLInputElement>("comparison-normalize").disabled = !pair;
  el<HTMLInputElement>("comparison-normalize").checked = !!pair?.normalize;
  el<HTMLSelectElement>("comparison-view").disabled = !pair;
  if (pair) el<HTMLSelectElement>("comparison-view").value = pair.view;
  const overlayCard = el("comparison-overlay");
  const showOverlay = !!pair && pair.view === "overlay";
  overlayCard.hidden = !showOverlay;
  overlayCard.replaceChildren();
  const panels = el("comparison-panels");
  panels.hidden = !pair;
  panels.replaceChildren();
  const delta = el("comparison-delta");
  delta.hidden = !pair;
  for (const id of [
    "profile-save",
    "profile-update",
    "profile-rename",
    "profile-delete",
  ])
    el<HTMLButtonElement>(id).disabled = !!pair;
  el("export-badge").textContent = pair
    ? `Export ${pair.active} badge JSON`
    : "Export badge JSON";
  if (!pair) return;
  if (showOverlay && pair.overlay) drawOverlay(pair, pair.overlay, overlayCard);
  el<HTMLSelectElement>("comparison-source-a").value =
    pair.sides.A.options.source;
  el<HTMLSelectElement>("comparison-source-b").value =
    pair.sides.B.options.source;
  el<HTMLSelectElement>("comparison-active").value = pair.active;
  if (document.activeElement !== el("comparison-name"))
    el<HTMLInputElement>("comparison-name").value =
      pair.sides[pair.active].name;
  const scenarioD = pair.delta.scenario;
  const usdD = pair.delta.usd;
  delta.textContent =
    `B minus A · Quality: ${format(pair.delta.score)} · Cost: ${format(pair.delta.cost)} ${pair.delta.reason}` +
    ` · Monthly scenario Δ: ${scenarioD.low === null ? "unavailable" : `${format(scenarioD.low)}–${format(scenarioD.high)} USD`} (${scenarioD.reason})` +
    (usdD
      ? ` · USD equivalent Δ: ${usdD.delta === null ? "unavailable" : `${format(usdD.delta)} USD`} (${usdD.reason})`
      : "");
  for (const side of ["A", "B"] as const) {
    const option = pair.sides[side],
      meta = sources[option.options.source];
    const card = text("section", "", "comparison-panel");
    card.append(
      text("h2", `${side}: ${option.name}`),
      text(
        "p",
        `${meta.label} · ${option.options.billing} · ${option.options.display.chart} · ${option.options.preset}`,
      ),
    );
    card.append(
      text(
        "p",
        `Workload ${Object.entries(option.options.tokens)
          .map(([k, v]) => `${k}: ${v}`)
          .join(" · ")} · Plan ${option.options.plan}`,
      ),
    );
    card.append(
      text(
        "p",
        option.scenario.status === "off"
          ? "Spending scenario: off"
          : option.scenario.status === "unavailable"
            ? `Spending scenario unavailable: ${option.scenario.reason}`
            : `Spending scenario: ${option.scenario.plan.label} · ${scenarioRange(option.scenario.requests)} requests/mo · ${option.scenario.totalUsd ? `${scenarioRange(option.scenario.totalUsd)} USD/mo` : "total unavailable"} (projection, not a bill)`,
        "hint",
      ),
    );
    if (pair.normalize && usdD) {
      const n = usdD[side];
      card.append(
        text(
          "p",
          n.status === "converted"
            ? `Selected cost: ${format(n.original.value)} AI credits ≈ ${format(n.usd)} USD at $${n.rate.usdPerUnit}/AI credit (GitHub Copilot models and pricing, ${n.provenance.date}). ${n.allowanceTreatment}`
            : n.status === "native"
              ? `Selected cost: ${format(n.usd)} USD (native, no conversion)`
              : `USD equivalent unavailable: ${n.reason}`,
          "hint",
        ),
      );
    }
    card.append(
      text("p", meta.availabilityNote),
      text("p", meta.pricingNote),
      text(
        "p",
        `Benchmark ${state?.version ?? "unknown"} · retrieved ${state?.fetchedAt ? new Date(state.fetchedAt).toLocaleString() : "unknown"}`,
      ),
    );
    if (option.discoveryError) card.append(text("p", option.discoveryError));
    card.append(text("p", option.recommendation.explanation));
    // Overlay view draws one shared chart above the panels instead; see
    // drawOverlay. The per-side info card and table stay either way.
    let canvas: HTMLCanvasElement | undefined;
    if (!showOverlay) {
      const wrap = text("div", "", "comparison-chart");
      canvas = document.createElement("canvas");
      canvas.id = `comparison-chart-${side}`;
      canvas.setAttribute("aria-label", `${side} quality and cost chart`);
      wrap.append(canvas);
      card.append(wrap);
    }
    const plotted = option.rows.filter(
      (r) => r.cost !== null && r.score !== null,
    );
    const table = document.createElement("table");
    const head = document.createElement("tr");
    for (const label of ["Model", "Quality", "Cost", "Status"])
      head.append(text("th", label));
    table.append(head);
    for (const row of option.rows) {
      const tr = document.createElement("tr"),
        td = document.createElement("td"),
        button = text("button", row.name);
      button.dataset.comparisonSide = side;
      button.dataset.comparisonRow = row.id;
      button.setAttribute("aria-pressed", String(row.id === option.selected));
      button.onclick = () =>
        send("target", { side, action: { type: "select", id: row.id } });
      td.append(button);
      tr.append(
        td,
        text("td", format(row.score)),
        text("td", format(row.cost)),
        text(
          "td",
          `${row.frontier ? "Frontier · " : ""}${row.tier ?? ""} ${row.reasons.join(" ")}`,
        ),
      );
      table.append(tr);
    }
    card.append(table);
    if (!showOverlay) {
      if (
        option.options.display.scale === "log" &&
        plotted.some((r) => r.cost === 0)
      )
        card.append(
          text(
            "p",
            "Log scale requested; using linear because a model is free.",
          ),
        );
      else if (option.options.display.scale !== "auto")
        card.append(
          text("p", `Scale override: ${option.options.display.scale}`),
        );
    }
    panels.append(card);
    if (canvas)
      comparisonCharts.push(
        new Chart(canvas, {
          type: "scatter",
          plugins: [
            ...(option.options.display.quadrant && plotted.length
              ? [
                  quadrantPlug(
                    median(plotted.map((r) => r.cost!)),
                    median(plotted.map((r) => r.score!)),
                  ),
                ]
              : []),
            ...(option.options.display.labels
              ? [
                  {
                    id: "optionLabels",
                    afterDatasetsDraw(c: Chart<"scatter">) {
                      c.ctx.save();
                      c.ctx.fillStyle = getComputedStyle(document.body).color;
                      c.ctx.font = "10px sans-serif";
                      c.getDatasetMeta(0).data.forEach((point, i) => {
                        if (plotted[i])
                          c.ctx.fillText(
                            plotted[i].name,
                            point.x + 5,
                            point.y - 5,
                          );
                      });
                      c.ctx.restore();
                    },
                  },
                ]
              : []),
          ],
          data: {
            datasets: [
              {
                label: "Models",
                data: plotted.map((r) => ({ x: r.cost!, y: r.score! })),
                backgroundColor: plotted.map(colorForRow),
                pointRadius: plotted.map((r) =>
                  r.id === option.selected ? 7 : 4,
                ),
              },
              {
                label: "Frontier",
                hidden: !option.options.display.frontier,
                data: plotted
                  .filter((r) => r.frontier)
                  .sort((a, b) => a.cost! - b.cost!)
                  .map((r) => ({ x: r.cost!, y: r.score! })),
                showLine: true,
                borderDash: [4, 4],
                pointRadius: 0,
              },
            ],
          },
          options: {
            animation: false,
            plugins: {
              tooltip: {
                callbacks: {
                  label: (context) =>
                    context.datasetIndex === 0
                      ? `${plotted[context.dataIndex]?.name}: ${context.parsed.y} points, ${context.parsed.x} ${option.options.billing}`
                      : "Frontier",
                },
              },
            },
            responsive: true,
            maintainAspectRatio: false,
            scales: {
              x: {
                type:
                  option.options.display.scale === "linear" ||
                  plotted.some((r) => r.cost === 0)
                    ? "linear"
                    : "logarithmic",
                title: { display: true, text: option.options.billing },
              },
              y: { title: { display: true, text: option.options.preset } },
            },
            onClick: (_event, elements) => {
              const e = elements[0];
              if (e?.datasetIndex === 0 && plotted[e.index])
                send("target", {
                  side,
                  action: { type: "select", id: plotted[e.index].id },
                });
            },
          },
        }),
      );
  }
  if (focusSide && focusRow)
    Array.from(panels.querySelectorAll<HTMLButtonElement>("button"))
      .find(
        (b) =>
          b.dataset.comparisonSide === focusSide &&
          b.dataset.comparisonRow === focusRow,
      )
      ?.focus();
}
el<HTMLInputElement>("comparison-enabled").onchange = () => {
  if (state) sendOptions();
  send("comparison", {
    enabled: el<HTMLInputElement>("comparison-enabled").checked,
  });
};
el<HTMLSelectElement>("comparison-active").onchange = () => {
  const active = el<HTMLSelectElement>("comparison-active").value;
  if (state) sendOptions();
  send("comparison", { active });
};
el<HTMLInputElement>("comparison-name").onchange = () =>
  send("comparison", { name: el<HTMLInputElement>("comparison-name").value });
el<HTMLInputElement>("comparison-normalize").onchange = () =>
  send("comparison", {
    normalize: el<HTMLInputElement>("comparison-normalize").checked,
  });
el<HTMLSelectElement>("comparison-view").onchange = () =>
  send("comparison", {
    view: el<HTMLSelectElement>("comparison-view").value,
  });
function render(next: ViewState) {
  const focused = document.activeElement as HTMLElement | null;
  const focusedModel = focused?.dataset.modelId;
  const focusedCheck = (focused?.dataset as Record<string, string> | undefined)
    ?.checkId;
  const focusedDetail = [
    "benchmark",
    "variant-search",
    "variant-manual",
    "checklist-search",
  ].includes(focused?.id ?? "")
    ? focused?.id
    : undefined;
  const selectionStart =
    focused instanceof HTMLInputElement && focused.type === "search"
      ? focused.selectionStart
      : null;
  const previousActive = state?.activeProfileId;
  state = next;
  renderComparison();
  if (!initialized || appliedRevision !== state.optionsRevision) {
    clearTimeout(timer);
    appliedRevision = state.optionsRevision;
    budgetDraft = { ...state.options.recommendation.budgets };
    displayedBilling = state.options.billing;
    el<HTMLSelectElement>("recommendation-mode").value =
      state.options.recommendation.mode;
    el<HTMLInputElement>("budget").value = String(
      budgetDraft[displayedBilling],
    );
    el<HTMLInputElement>("score-gap").value = String(
      state.options.recommendation.scoreGap,
    );
    for (const key of [
      "preset",
      "billing",
      "plan",
      "filter",
      "source",
    ] as const)
      el<HTMLInputElement>(key).value = state.options[key];
    for (const key of ["input", "read", "write", "output"] as const)
      el<HTMLInputElement>(key).value = String(state.options.tokens[key]);
    el<HTMLInputElement>("scenario-requests-low").value = String(
      state.options.scenario.requestsLow,
    );
    el<HTMLInputElement>("scenario-requests-high").value = String(
      state.options.scenario.requestsHigh,
    );
    for (const [id, value] of [
      ["scenario-custom-fee", state.options.scenario.custom.monthlyFeeUsd],
      ["scenario-custom-allowance", state.options.scenario.custom.allowance],
      [
        "scenario-custom-overage",
        state.options.scenario.custom.overageUsdPerUnit,
      ],
    ] as const)
      el<HTMLInputElement>(id).value = value === null ? "" : String(value);
    scenarioOrigin = state.options.scenario.origin;
    scenarioHistory = state.options.scenario.history;
    scenarioPlanDraft = state.options.scenario.planId;
    initialized = true;
  }
  el("tokens").hidden =
    state.options.billing === "legacy" ||
    state.options.display.chart === "task";
  el("legacy-note").hidden = state.options.billing !== "legacy";
  el("plan-label").hidden = state.options.billing !== "legacy";
  const meta = sources[state.options.source];
  const allowed = meta.billing;
  for (const option of Array.from(el<HTMLSelectElement>("billing").options)) {
    option.hidden = !(allowed as string[]).includes(option.value);
  }
  el("eyebrow").textContent = meta.eyebrow;
  el("subtitle").textContent = meta.subtitle;
  el("budget-label").hidden = state.options.recommendation.mode !== "budget";
  el("gap-label").hidden = state.options.recommendation.mode !== "nearBest";
  const perTask =
    state.options.display.chart === "task" && state.options.billing !== "legacy"
      ? " per task"
      : "";
  el("budget-unit").textContent =
    state.options.billing === "credits"
      ? `Maximum AI credits${perTask}`
      : state.options.billing === "legacy"
        ? "Maximum premium requests"
        : `Maximum USD${perTask}`;
  el("recommendation-result").textContent = state.recommendation.explanation;
  const suggestion = state.budgetSuggestion;
  el("budget-suggestion").textContent = suggestion
    ? suggestion.value === null
      ? `Budget suggestion unavailable: ${suggestion.note}`
      : `Suggested budget ${suggestion.value} (${suggestion.note})`
    : "";
  (el("budget-apply") as HTMLButtonElement).hidden =
    !suggestion || suggestion.value === null;
  renderProfiles(previousActive);
  el("status").textContent = state.message;
  el<HTMLButtonElement>("refresh").disabled = state.loading;
  el<HTMLButtonElement>("key").disabled = state.loading;
  el("key").textContent = state.hasKey ? "Update API key" : "Set API key";
  const stale = freshnessAlert(
    state.catalogDate,
    state.staticRegistryDate,
    undefined,
    state.planRegistryDate,
  );
  el("catalog").textContent =
    `Catalog dated ${state.catalogDate} · Registries dated ${state.staticRegistryDate} · Plans dated ${state.planRegistryDate}` +
    (stale ? ` · ${stale}` : "");
  el("pricing-line").replaceChildren(
    text("span", `${meta.pricingLabel.split(":")[0]}: `),
    (() => {
      const a = document.createElement("a");
      a.href = meta.pricingUrl;
      a.textContent = meta.pricingLabel.split(": ")[1] ?? meta.pricingLabel;
      return a;
    })(),
    text("span", meta.live ? " · live rates" : " · known-model registry"),
  );
  el("pricing-note").textContent =
    `${meta.pricingNote} ${meta.availabilityNote}`;
  (el("display-labels") as HTMLInputElement).checked =
    state.options.display.labels;
  (el("display-frontier") as HTMLInputElement).checked =
    state.options.display.frontier;
  (el("display-scale") as HTMLSelectElement).value =
    state.options.display.scale;
  (el("display-chart") as HTMLSelectElement).value =
    state.options.display.chart;
  (el("display-sort") as HTMLSelectElement).value = state.options.display.sort;
  (el("display-quadrant") as HTMLInputElement).checked =
    state.options.display.quadrant;
  (el("free-only-label") as HTMLElement).hidden =
    state.options.source !== "opencode";
  (el("free-only") as HTMLInputElement).checked = state.options.freeOnly;
  (el("only-mine") as HTMLInputElement).checked = state.options.onlyMine;
  const usageSummary = state.usage;
  const prefill = el("usage-prefill") as HTMLButtonElement;
  prefill.disabled = !usageSummary || usageSummary.medianSample === 0;
  el("usage-prefill-note").textContent = usageSummary
    ? usageSummary.medianSample === 0
      ? "No requests with token data in the local scan."
      : `Median ${usageSummary.medianPrompt} prompt + ${usageSummary.medianOutput} output per request · ` +
        `${usageSummary.medianSample} requests` +
        (usageSummary.dateRange
          ? ` · ${new Date(usageSummary.dateRange.from).toLocaleDateString()} – ${new Date(usageSummary.dateRange.to).toLocaleDateString()}`
          : "")
    : "Scan local usage first.";
  el("spotlight-result").textContent = state.freeSpotlight.explanation;
  (el("spotlight-card") as HTMLElement).hidden =
    state.options.source !== "opencode";
  el("export-note").textContent = state.exportNote ?? "";
  renderByok();
  renderUsage();
  renderScenario();
  el("provenance").textContent = state.fetchedAt
    ? `Index v${state.version} · retrieved ${new Date(state.fetchedAt).toLocaleString()}${Date.now() - state.fetchedAt > 86400000 ? " · older than 24 hours" : ""}`
    : "No benchmark snapshot loaded";
  const rows = plotted();
  el("count").textContent =
    `${rows.length} plotted / ${state.rows.length} models`;
  el("empty").hidden = rows.length > 0;
  el("chart-wrap").hidden = rows.length === 0;
  el("empty").textContent = state.rows.length
    ? "No comparable models. Set an API key to load benchmarks, then select a model below to resolve any missing benchmark mapping."
    : state.options.source === "opencode"
      ? "No models match. Clear the filter or check OpenCode setup and refresh."
      : "No models match. Clear the filter or check GitHub Copilot sign-in and refresh.";
  const legend = el("legend");
  legend.replaceChildren();
  for (const provider of new Set(rows.map((r) => r.provider))) {
    const sample = rows.find((r) => r.provider === provider)!;
    const item = text("span", `● ${provider}`);
    item.style.color = colorForRow(sample);
    legend.append(item);
  }
  renderChecklist();
  el("cost-heading").textContent =
    state.options.display.chart === "task"
      ? state.options.billing === "credits"
        ? "AI credits / task"
        : state.options.billing === "legacy"
          ? "Requests"
          : "USD / task"
      : state.options.billing === "credits"
        ? "AI credits"
        : state.options.billing === "legacy"
          ? "Requests"
          : "USD";
  const body = el("rows");
  body.replaceChildren();
  for (const row of state.rows) {
    const tr = document.createElement("tr");
    if (row.id === state.selected) tr.className = "selected";
    const name = document.createElement("td"),
      button = text("button", row.name, "model-button") as HTMLButtonElement;
    button.dataset.modelId = row.id;
    button.setAttribute("aria-pressed", String(row.id === state.selected));
    button.onclick = () => send("select", { id: row.id });
    name.append(
      button,
      text("span", row.provider, "provider"),
      text("span", mappingLabels[row.mappingStatus], "mapping-status"),
    );
    if (state.recommendation.modelIds.includes(row.id))
      name.append(text("span", "★ Recommended", "recommended"));
    if ((row.requests ?? 0) > 0)
      name.append(text("span", `· ${row.requests} used`, "used-badge"));
    const drift = row.benchmark ? state.drift[row.benchmark.id] : undefined;
    const scoreText =
      format(row.score) +
      (drift && drift.delta !== null
        ? ` (${drift.delta > 0 ? "+" : ""}${new Intl.NumberFormat("en", { maximumSignificantDigits: 3 }).format(drift.delta)})`
        : "");
    tr.append(
      name,
      text("td", scoreText),
      text("td", format(row.cost)),
      text("td", format(efficiencyOf(row))),
      text(
        "td",
        row.frontier
          ? "Pareto frontier"
          : row.reasons.length
            ? row.reasons.join(" ")
            : "Dominated",
        row.frontier ? "frontier" : "",
      ),
    );
    body.append(tr);
  }
  renderDetails();
  drawChart();
  if (focusedModel) {
    const button = Array.from(
      document.querySelectorAll<HTMLButtonElement>(".model-button"),
    ).find((b) => b.dataset.modelId === focusedModel);
    button?.focus();
  }
  if (focusedDetail) {
    const input = el<HTMLInputElement>(focusedDetail);
    input?.focus();
    if (selectionStart !== null && input?.type === "search")
      input.setSelectionRange(selectionStart, selectionStart);
  }
  if (focusedCheck) {
    const target = document.querySelector<HTMLElement>(
      `[data-check-id="${focusedCheck}"]`,
    );
    (target as HTMLElement | null)?.focus?.();
  }
}
function renderProfiles(previousActive: string | undefined) {
  if (!state) return;
  const picker = el<HTMLSelectElement>("profile"),
    previous = picker.value;
  picker.replaceChildren(new Option("Custom", ""));
  for (const p of state.profiles) picker.append(new Option(p.name, p.id));
  picker.value =
    previousActive !== state.activeProfileId
      ? (state.activeProfileId ?? "")
      : state.profiles.some((p) => p.id === previous)
        ? previous
        : (state.activeProfileId ?? "");
  const active = state.profiles.find((p) => p.id === state!.activeProfileId);
  el("profile-state").textContent = active
    ? `${active.name}${state.profileModified ? " · Modified (not saved)" : " · Saved"}`
    : "Custom workload";
  updateProfileButtons();
}
function updateProfileButtons() {
  if (state?.comparison) {
    for (const id of [
      "profile-save",
      "profile-update",
      "profile-rename",
      "profile-delete",
    ])
      el<HTMLButtonElement>(id).disabled = true;
    el<HTMLButtonElement>("profile-apply").disabled =
      !el<HTMLSelectElement>("profile").value;
    return;
  }
  const chosen = el<HTMLSelectElement>("profile").value;
  for (const id of ["profile-apply", "profile-rename", "profile-delete"])
    el<HTMLButtonElement>(id).disabled = !chosen;
  el<HTMLButtonElement>("profile-update").disabled =
    !chosen || chosen !== state?.activeProfileId || !state?.profileModified;
}
let timer: ReturnType<typeof setTimeout>;
function sendOptions(): boolean {
  clearTimeout(timer);
  // A source switch hides the previous billing mode before the synced value
  // arrives; a stale debounced edit must not overwrite the host reset.
  const billingSelect = el<HTMLSelectElement>("billing");
  const picked = billingSelect.selectedOptions[0];
  const billing = (
    picked && picked.hidden && state
      ? state.options.billing
      : billingSelect.value
  ) as Options["billing"];
  const mode = el<HTMLSelectElement>("recommendation-mode")
    .value as Options["recommendation"]["mode"];
  const readNumber = (
    id: string,
    active: boolean,
    fallback: number,
  ): number | undefined => {
    const input = el<HTMLInputElement>(id);
    if (input.value !== "" && input.validity.valid) return Number(input.value);
    if (active) {
      input.reportValidity();
      return undefined;
    }
    input.value = String(fallback);
    return fallback;
  };
  const tokens = {} as Options["tokens"];
  for (const key of ["input", "read", "write", "output"] as const) {
    const value = readNumber(
      key,
      billing === "credits",
      state?.options.tokens[key] ?? 0,
    );
    if (value === undefined) return false;
    tokens[key] = value;
  }
  const budget = readNumber(
    "budget",
    mode === "budget",
    budgetDraft[displayedBilling],
  );
  const scoreGap = readNumber(
    "score-gap",
    mode === "nearBest",
    state?.options.recommendation.scoreGap ?? 3,
  );
  if (budget === undefined || scoreGap === undefined) return false;
  budgetDraft[displayedBilling] = budget;
  const options: Options = {
    source: state?.options.source ?? "copilot",
    preset: el<HTMLSelectElement>("preset").value as Options["preset"],
    billing,
    plan: el<HTMLSelectElement>("plan").value as Options["plan"],
    filter: el<HTMLInputElement>("filter").value,
    tokens,
    recommendation: {
      mode,
      budgets: { ...budgetDraft },
      scoreGap,
    },
    display: {
      labels: (el("display-labels") as HTMLInputElement).checked,
      frontier: (el("display-frontier") as HTMLInputElement).checked,
      scale: (el("display-scale") as HTMLSelectElement)
        .value as Options["display"]["scale"],
      chart: (el("display-chart") as HTMLSelectElement)
        .value as Options["display"]["chart"],
      quadrant: (el("display-quadrant") as HTMLInputElement).checked,
      sort: (el("display-sort") as HTMLSelectElement)
        .value as Options["display"]["sort"],
    },
    freeOnly: (el("free-only") as HTMLInputElement).checked,
    onlyMine: (el("only-mine") as HTMLInputElement).checked,
    scenario: readScenario(),
  };
  send("options", { options });
  return true;
}
/**
 * Scenario inputs are optional and always sent: an empty/invalid field
 * becomes 0 or null (parseScenario is equally tolerant host-side), never a
 * blocked submit — the result explains an incomplete Custom plan instead.
 */
function readScenario(): Options["scenario"] {
  const numOr = (id: string, fallback: number): number => {
    const input = el<HTMLInputElement>(id);
    return input.value !== "" && input.validity.valid
      ? Number(input.value)
      : fallback;
  };
  const numOrNull = (id: string): number | null => {
    const input = el<HTMLInputElement>(id);
    return input.value !== "" && input.validity.valid
      ? Number(input.value)
      : null;
  };
  return {
    planId: el<HTMLSelectElement>("scenario-plan").value,
    requestsLow: numOr("scenario-requests-low", 0),
    requestsHigh: numOr("scenario-requests-high", 0),
    origin: scenarioOrigin,
    history: scenarioOrigin === "history" ? scenarioHistory : null,
    custom: {
      monthlyFeeUsd: numOrNull("scenario-custom-fee"),
      allowance: numOrNull("scenario-custom-allowance"),
      overageUsdPerUnit: numOrNull("scenario-custom-overage"),
    },
  };
}
el("source").addEventListener("change", () => {
  // Source switches reset billing host-side; send immediately, not debounced.
  clearTimeout(timer);
  send("source", {
    source: el<HTMLSelectElement>("source").value,
  });
});
// Tool A/Tool B on the Compare tools tab pick each side's source directly,
// without first switching Editing to it (targets that side explicitly).
el("comparison-source-a").addEventListener("change", () => {
  clearTimeout(timer);
  sendToSide("A", "source", {
    source: el<HTMLSelectElement>("comparison-source-a").value,
  });
});
el("comparison-source-b").addEventListener("change", () => {
  clearTimeout(timer);
  sendToSide("B", "source", {
    source: el<HTMLSelectElement>("comparison-source-b").value,
  });
});
for (const id of [
  "preset",
  "billing",
  "plan",
  "input",
  "read",
  "write",
  "output",
  "filter",
  "recommendation-mode",
  "budget",
  "score-gap",
  "display-labels",
  "display-frontier",
  "display-chart",
  "display-quadrant",
  "display-scale",
  "display-sort",
  "free-only",
  "only-mine",
  "scenario-plan",
  "scenario-requests-low",
  "scenario-requests-high",
  "scenario-custom-fee",
  "scenario-custom-allowance",
  "scenario-custom-overage",
]) {
  el(id).addEventListener("input", () => {
    if (id === "billing") {
      const current = el<HTMLInputElement>("budget");
      if (current.value && current.validity.valid)
        budgetDraft[displayedBilling] = Number(current.value);
      displayedBilling = el<HTMLSelectElement>("billing")
        .value as Options["billing"];
      current.value = String(budgetDraft[displayedBilling]);
    }
    if (id === "scenario-plan") {
      // Keep the live selection across any unrelated render before this
      // edit round-trips (renderScenario reapplies scenarioPlanDraft), and
      // reveal the Custom fields immediately rather than after a round trip.
      scenarioPlanDraft = el<HTMLSelectElement>("scenario-plan").value;
      (el("scenario-custom") as HTMLElement).hidden =
        scenarioPlanDraft !== "custom";
    }
    if (id === "scenario-requests-low" || id === "scenario-requests-high") {
      scenarioOrigin = "user";
      scenarioHistory = null;
    }
    clearTimeout(timer);
    timer = setTimeout(sendOptions, 150);
  });
}
el<HTMLButtonElement>("scenario-prefill").onclick = () => {
  if (!state?.scenarioPrefill) return;
  const p = state.scenarioPrefill;
  el<HTMLInputElement>("scenario-requests-low").value = String(p.low);
  el<HTMLInputElement>("scenario-requests-high").value = String(p.high);
  scenarioOrigin = "history";
  scenarioHistory = {
    from: p.from,
    to: p.to,
    activeDays: p.activeDays,
    calendarDays: p.calendarDays,
    requests: p.requests,
  };
  sendOptions();
};
el("profile").onchange = () => {
  updateProfileButtons();
  if (!el<HTMLSelectElement>("profile").value)
    send("profile", { change: { action: "custom" } });
};
for (const [id, action] of [
  ["profile-save", "saveAs"],
  ["profile-update", "update"],
  ["profile-rename", "rename"],
  ["profile-delete", "delete"],
  ["profile-apply", "apply"],
] as const) {
  el(id).onclick = () => {
    // Flush pending edits before saving; applying a profile deliberately replaces the draft.
    if (action === "apply") {
      clearTimeout(timer);
      if (state)
        send("options", {
          options: {
            ...state.options,
            filter: el<HTMLInputElement>("filter").value,
          },
        });
    } else if (!sendOptions()) return;
    const profileId = el<HTMLSelectElement>("profile").value,
      name = el<HTMLInputElement>("profile-name").value;
    const change =
      action === "saveAs"
        ? { action, name }
        : action === "rename"
          ? { action, id: profileId, name }
          : { action, id: profileId };
    send("profile", { change });
  };
}
el("refresh").onclick = () => send("refresh");
el("key").onclick = () => send("key");
el("checklist-search").addEventListener("input", () => {
  checklistSearch = el<HTMLInputElement>("checklist-search").value;
  renderChecklist();
  const input = el<HTMLInputElement>("checklist-search");
  input.focus();
  const end = input.value.length;
  try {
    input.setSelectionRange(end, end);
  } catch {
    /* selection is best-effort for search inputs */
  }
});
el("include-all").onclick = () => {
  if (state && checklistSearch.trim()) {
    const ids = visibleLeafIds(state.groups ?? [], checklistSearch);
    if (ids.length) {
      send("excludeMany", { ids, excluded: false });
      return;
    }
  }
  send("excludeAll", { excluded: false });
};
el("include-none").onclick = () => {
  if (state && checklistSearch.trim()) {
    const ids = visibleLeafIds(state.groups ?? [], checklistSearch);
    if (ids.length) {
      send("excludeMany", { ids, excluded: true });
      return;
    }
  }
  send("excludeAll", { excluded: true });
};
el("usage-scan").onclick = () => send("scanUsage");
el("usage-clear").onclick = () => send("clearUsage");
el("usage-full-paths").addEventListener("input", () => {
  usageFullPaths = el<HTMLInputElement>("usage-full-paths").checked;
  renderUsage();
});
el("usage-prefill").onclick = () => {
  if (!state?.usage || state.usage.medianSample === 0) return;
  el<HTMLInputElement>("input").value = String(state.usage.medianPrompt);
  el<HTMLInputElement>("output").value = String(state.usage.medianOutput);
  sendOptions();
};
el("budget-apply").onclick = () => {
  const value = state?.budgetSuggestion?.value ?? null;
  if (value === null) return;
  el<HTMLInputElement>("budget").value = String(value);
  sendOptions();
};
el("export-csv").onclick = () => send("exportCsv");
el("export-snapshot").onclick = () => send("exportSnapshot");
el("export-badge").onclick = () => send("exportBadge");
el("byok-save").onclick = () => {
  if (!state) return;
  const next: Record<string, unknown> = { ...state.byok };
  for (const [id, d] of Object.entries(byokDraft)) {
    const raw = {
      input: d.input.trim(),
      read: d.read.trim(),
      write: d.write.trim(),
      output: d.output.trim(),
    };
    if (!raw.input && !raw.read && !raw.write && !raw.output) {
      delete next[id];
      delete byokDraft[id];
      continue;
    }
    const num = (s: string): number | undefined =>
      s === "" ? undefined : Number(s);
    const input = num(raw.input),
      read = num(raw.read),
      output = num(raw.output),
      write = raw.write === "" ? null : num(raw.write);
    if (
      input === undefined ||
      read === undefined ||
      output === undefined ||
      write === undefined ||
      ![input, read, output].every((n) => Number.isFinite(n) && n >= 0) ||
      !(write === null || (Number.isFinite(write) && write >= 0))
    ) {
      el("status").textContent =
        "BYOK rates need nonnegative numbers for input, cache read, and output (cache write may be blank).";
      return;
    }
    next[id] = { rates: { input, read, write, output } };
    delete byokDraft[id];
  }
  send("byok", { rates: next });
};
el("byok-clear").onclick = () => {
  byokDraft = {};
  renderByok();
};
el("export-png").onclick = () => {
  // Export lives on the Settings tab, and charts drawn while their panel is
  // hidden have no size: lay the panel that owns the exported chart(s)
  // out off-screen and redraw first — Compare tools while comparing (its
  // chart(s) are what gets exported below), otherwise Tool analysis.
  const panel = el(state?.comparison ? "panel-tools" : "panel-compare");
  const offscreen = panel.hidden;
  if (offscreen) {
    panel.classList.add("offscreen");
    panel.hidden = false;
    if (state?.comparison) renderComparison();
    else drawChart();
  }
  try {
    const canvas = el("chart") as HTMLCanvasElement;
    const exportCanvas = document.createElement("canvas");
    exportCanvas.width = 1600;
    exportCanvas.height = 900;
    const ctx = exportCanvas.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle =
      getComputedStyle(document.body).backgroundColor || "#ffffff";
    ctx.fillRect(0, 0, exportCanvas.width, exportCanvas.height);
    if (state?.comparison?.view === "overlay" && state.comparison.overlay) {
      ctx.fillStyle = getComputedStyle(document.body).color;
      ctx.font = "20px sans-serif";
      ctx.fillText(
        `A: ${state.comparison.sides.A.name} vs B: ${state.comparison.sides.B.name} · ${state.comparison.overlay.unit}`,
        20,
        35,
      );
      ctx.drawImage(
        el<HTMLCanvasElement>("comparison-chart-overlay"),
        0,
        60,
        1600,
        820,
      );
    } else if (state?.comparison) {
      for (const [index, side] of (["A", "B"] as const).entries()) {
        ctx.fillStyle = getComputedStyle(document.body).color;
        ctx.font = "20px sans-serif";
        ctx.fillText(
          `${side}: ${state.comparison.sides[side].name} · ${state.comparison.sides[side].options.billing}`,
          index * 800 + 20,
          35,
        );
        ctx.drawImage(
          el<HTMLCanvasElement>(`comparison-chart-${side}`),
          index * 800,
          60,
          800,
          800,
        );
      }
    } else ctx.drawImage(canvas, 0, 0, exportCanvas.width, exportCanvas.height);
    send("exportPng", { png: exportCanvas.toDataURL("image/png") });
  } finally {
    if (offscreen) {
      panel.hidden = true;
      panel.classList.remove("offscreen");
    }
  }
};
window.addEventListener("message", (event) => {
  if (event.data?.type === "state") render(event.data.state);
});
new MutationObserver(() => {
  drawChart();
  renderComparison();
}).observe(document.body, {
  attributes: true,
  attributeFilter: ["class", "style"],
});
const sectionTabs = ["compare", "tools", "plan", "usage", "settings"] as const;
type SectionTab = (typeof sectionTabs)[number];
function showTab(tab: SectionTab, focus = false) {
  for (const id of sectionTabs) {
    const button = el<HTMLButtonElement>(`tab-${id}`);
    const active = id === tab;
    button.setAttribute("aria-selected", String(active));
    button.tabIndex = active ? 0 : -1;
    el(`panel-${id}`).hidden = !active;
    if (active && focus) button.focus();
  }
  // Remember the open tab across webview reloads.
  vscode.setState?.({ tab });
  // Charts laid out while their panel was hidden have no size; redraw them.
  if (tab === "compare" && state) drawChart();
  if (tab === "tools" && state) renderComparison();
}
sectionTabs.forEach((id, index) => {
  const button = el<HTMLButtonElement>(`tab-${id}`);
  button.onclick = () => showTab(id);
  button.onkeydown = (event) => {
    const count = sectionTabs.length;
    const next =
      event.key === "ArrowRight"
        ? sectionTabs[(index + 1) % count]
        : event.key === "ArrowLeft"
          ? sectionTabs[(index + count - 1) % count]
          : event.key === "Home"
            ? sectionTabs[0]
            : event.key === "End"
              ? sectionTabs[count - 1]
              : undefined;
    if (!next) return;
    event.preventDefault();
    showTab(next, true);
  };
});
const savedTab = (vscode.getState?.() as { tab?: unknown } | undefined)?.tab;
showTab(
  sectionTabs.includes(savedTab as SectionTab)
    ? (savedTab as SectionTab)
    : "compare",
);
send("ready");
