import Chart from "chart.js/auto";
import type { Plugin, ScatterDataPoint } from "chart.js";
import type { Options, Row, ViewState } from "../src/types";
declare function acquireVsCodeApi(): { postMessage(message: unknown): void };
const vscode = acquireVsCodeApi();
const el = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const text = (tag: string, value: string, className?: string) => {
  const node = document.createElement(tag);
  node.textContent = value;
  if (className) node.className = className;
  return node;
};
const send = (type: string, extra: Record<string, unknown> = {}) =>
  vscode.postMessage({ type, ...extra });
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
  Unknown: "#9ba3b4",
};
let state: ViewState | undefined,
  chart: Chart<"scatter"> | undefined,
  initialized = false;
const lightColors: Record<string, string> = {
  OpenAI: "#2468cb",
  Anthropic: "#a64923",
  Google: "#167e51",
  Microsoft: "#7652b5",
  xAI: "#926c12",
  "Moonshot AI": "#a23782",
  Unknown: "#637084",
};
const color = (provider: string) =>
  document.body.classList.contains("vscode-light") ||
  document.body.classList.contains("vscode-high-contrast-light")
    ? (lightColors[provider] ?? lightColors.Unknown)
    : (colors[provider] ?? colors.Unknown);
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
  const scale = rows.some((r) => r.cost === 0) ? "linear" : "logarithmic";
  el("chart").setAttribute(
    "aria-label",
    `${rows.length} models: ${state.options.preset} quality versus ${state.options.billing === "credits" ? "estimated AI credits" : "premium requests"}, ${scale} cost scale. The table below provides all values and model selection.`,
  );
  const data: ScatterDataPoint[] = rows.map((r) => ({
    x: r.cost!,
    y: r.score!,
  }));
  chart?.destroy();
  chart = new Chart(el<HTMLCanvasElement>("chart"), {
    type: "scatter",
    data: {
      datasets: [
        {
          label: "Models",
          data,
          backgroundColor: rows.map((r) => color(r.provider)),
          borderColor: rows.map((r) =>
            r.id === state!.selected ? foreground : color(r.provider),
          ),
          borderWidth: rows.map((r) => (r.id === state!.selected ? 3 : 1)),
          pointRadius: rows.map((r) => (r.frontier ? 7 : 5)),
          pointHoverRadius: 9,
        },
        {
          label: "Pareto frontier",
          data: frontier.map((r) => ({ x: r.cost!, y: r.score! })),
          showLine: true,
          borderColor: foreground,
          borderDash: [3, 5],
          borderWidth: 2,
          pointRadius: 0,
          pointHitRadius: 0,
        },
      ],
    },
    plugins: [labels],
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
              return `${r.name}: ${format(r.score)} score · ${format(r.cost)} ${state!.options.billing === "credits" ? "AI credits" : "premium requests"}${r.frontier ? " · Pareto frontier" : ""}`;
            },
          },
        },
      },
      scales: {
        x: {
          type: scale,
          title: {
            display: true,
            text: `${state.options.billing === "credits" ? "Estimated AI credits" : "Premium requests per interaction"} (${scale === "linear" ? "linear" : "log"} scale)`,
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
  target.append(text("h3", row.name), text("p", row.id, "hint"));
  const copy = text("button", "Copy model name") as HTMLButtonElement;
  copy.onclick = () => {
    send("copy", { id: row.id });
  };
  target.append(copy);
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
      `${format(row.cost)} ${state.options.billing === "credits" ? "estimated AI credits" : "premium requests per interaction"}${row.tier ? ` · ${row.tier}` : ""}`,
    ),
  );
  for (const reason of row.reasons) target.append(text("p", reason, "notice"));
  if (row.benchmark) {
    target.append(
      text("p", `Tested variant: ${row.benchmark.name}`),
      text("p", `Benchmark ID: ${row.benchmark.slug}`, "hint"),
      text(
        "p",
        `Selected index score: ${format(row.score)} · version ${state.version ?? "unknown"}`,
      ),
    );
  }
  const label = text("label", "Benchmark variant (explicit mapping)");
  const select = document.createElement("select");
  select.id = "benchmark";
  select.append(new Option("Automatic exact matching", ""));
  for (const b of [...state.models].sort((a, b) =>
    a.name.localeCompare(b.name),
  ))
    select.append(new Option(`${b.name} · ${b.slug}`, b.id));
  // Display the resolved variant. Choosing Automatic removes a previous override.
  select.value = row.benchmark?.id ?? "";
  select.onchange = () =>
    send("mapping", { id: row.id, benchmarkId: select.value });
  label.append(select);
  target.append(
    label,
    text(
      "p",
      "Only select a benchmark that represents this model. Copilot may use different reasoning settings from the tested variant.",
      "hint",
    ),
  );
}
function render(next: ViewState) {
  const focused = document.activeElement as HTMLElement | null;
  const focusedModel = focused?.dataset.modelId;
  const focusedBenchmark = focused?.id === "benchmark";
  state = next;
  if (!initialized) {
    for (const key of ["preset", "billing", "plan", "filter"] as const)
      el<HTMLInputElement>(key).value = state.options[key];
    for (const key of ["input", "read", "write", "output"] as const)
      el<HTMLInputElement>(key).value = String(state.options.tokens[key]);
    initialized = true;
  }
  el("tokens").hidden = state.options.billing === "legacy";
  el("legacy-note").hidden = state.options.billing !== "legacy";
  el("plan-label").hidden = state.options.billing !== "legacy";
  el("status").textContent = state.message;
  el<HTMLButtonElement>("refresh").disabled = state.loading;
  el<HTMLButtonElement>("key").disabled = state.loading;
  el("key").textContent = state.hasKey ? "Update API key" : "Set API key";
  el("catalog").textContent = `Catalog dated ${state.catalogDate}`;
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
    : "No models match. Clear the filter or check GitHub Copilot sign-in and refresh.";
  const legend = el("legend");
  legend.replaceChildren();
  for (const provider of new Set(rows.map((r) => r.provider))) {
    const item = text("span", `● ${provider}`);
    item.style.color = color(provider);
    legend.append(item);
  }
  el("cost-heading").textContent =
    state.options.billing === "credits" ? "AI credits" : "Requests";
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
    name.append(button, text("span", row.provider, "provider"));
    tr.append(
      name,
      text("td", format(row.score)),
      text("td", format(row.cost)),
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
  if (focusedBenchmark) el("benchmark")?.focus();
}
let timer: ReturnType<typeof setTimeout>;
function changeOptions() {
  clearTimeout(timer);
  timer = setTimeout(() => {
    const tokens = {} as Options["tokens"];
    for (const key of ["input", "read", "write", "output"] as const) {
      const input = el<HTMLInputElement>(key);
      if (!input.reportValidity() || input.value === "") return;
      tokens[key] = Number(input.value);
    }
    send("options", {
      options: {
        preset: el<HTMLSelectElement>("preset").value,
        billing: el<HTMLSelectElement>("billing").value,
        plan: el<HTMLSelectElement>("plan").value,
        filter: el<HTMLInputElement>("filter").value,
        tokens,
      },
    });
  }, 150);
}
for (const id of [
  "preset",
  "billing",
  "plan",
  "input",
  "read",
  "write",
  "output",
  "filter",
])
  el(id).addEventListener("input", changeOptions);
el("refresh").onclick = () => send("refresh");
el("key").onclick = () => send("key");
window.addEventListener("message", (event) => {
  if (event.data?.type === "state") render(event.data.state);
});
new MutationObserver(() => drawChart()).observe(document.body, {
  attributes: true,
  attributeFilter: ["class", "style"],
});
send("ready");
