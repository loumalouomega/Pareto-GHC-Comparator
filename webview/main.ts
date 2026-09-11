import Chart from "chart.js/auto";
import type { Plugin, ScatterDataPoint } from "chart.js";
import type { Billing, Options, Row, ViewState, HostMessage } from "../src/types";
import { sources } from "../src/sources";
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
const send = (type: HostMessage["type"], extra: Record<string, unknown> = {}) =>
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
  return light ? (lightColors[provider] ?? lightColors.Unknown) : (colors[provider] ?? colors.Unknown);
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
  detailsModelId: string | undefined;
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
  el("chart").setAttribute(
    "aria-label",
    `${rows.length} models: ${state.options.preset} quality versus ${unitCost(state.options.billing)}, ${scale} cost scale. The table below provides all values and model selection.`,
  );
  const data: ScatterDataPoint[] = rows.map((r) => ({
    x: r.cost!,
    y: r.score!,
  }));
  chart?.destroy();
  const showFrontier = state.options.display.frontier;
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
    plugins: state.options.display.labels ? [labels] : [],
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
              return `${r.name}: ${format(r.score)} score · ${format(r.cost)} ${unitNoun(state!.options.billing)}${r.frontier ? " · Pareto frontier" : ""}`;
            },
          },
        },
      },
      scales: {
        x: {
          type: scale,
          title: {
            display: true,
            text: `${state.options.billing === "credits" ? "Estimated AI credits" : state.options.billing === "legacy" ? "Premium requests per interaction" : "Estimated USD"} (${scale === "linear" ? "linear" : "log"} scale)${scaleNote}`,
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
      `${format(row.cost)} ${unitCost(state.options.billing)}${row.tier ? ` · ${row.tier}` : ""}`,
    ),
  );
  if (row.breakdown) {
    const b = row.breakdown;
    const writeRate = b.rates.write ?? b.rates.input;
    target.append(
      text(
        "p",
        `Breakdown (${b.unit}): ${b.inputTokens}×${b.rates.input} + ${b.readTokens}×${b.rates.read} + ${b.writeTokens}×${writeRate} + ${b.outputTokens}×${b.rates.output}, ÷${b.divisor}${b.tier ? ` · ${b.tier}` : ""}.`,
        "hint",
      ),
    );
  } else if (row.cost === 0) {
    target.append(text("p", "Free tier: no usage cost.", "hint"));
  }
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
  pinButton.disabled = !row.benchmark;
  target.append(pinButton);
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
  target.append(text("p", mappingLabels[row.mappingStatus], "mapping-status"));
  if (state.recommendation.modelIds.includes(row.id))
    target.append(
      text("p", state.recommendation.explanation, "recommendation-detail"),
    );
  if (detailsModelId !== row.id) {
    detailsModelId = row.id;
    variantSearch = "";
    showOtherVariants = false;
  }
  const searchLabel = text("label", "Search benchmark variants");
  const search = document.createElement("input");
  search.id = "variant-search";
  search.type = "search";
  search.value = variantSearch;
  searchLabel.append(search);
  target.append(searchLabel);
  const manualLabel = text("label", "Show other benchmarks for manual mapping");
  manualLabel.className = "checkbox-label";
  const manual = document.createElement("input");
  manual.id = "variant-manual";
  manual.type = "checkbox";
  manual.checked = showOtherVariants;
  manualLabel.prepend(manual);
  target.append(manualLabel);
  const label = text("label", "Benchmark variant");
  const select = document.createElement("select");
  select.id = "benchmark";
  const populate = () => {
    select.replaceChildren(new Option("Use automatic matching", ""));
    const candidates = new Set(row.candidateIds);
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
        "Other benchmarks — manual mapping",
        showOtherVariants ? matches.filter((b) => !candidates.has(b.id)) : [],
      ],
    ] as const) {
      if (!list.length) continue;
      const group = document.createElement("optgroup");
      group.label = title;
      for (const b of list)
        group.append(new Option(`${b.name} · ${b.slug}`, b.id));
      select.append(group);
    }
    if (
      row.selectedBenchmarkId &&
      !Array.from(select.options).some(
        (o) => o.value === row.selectedBenchmarkId,
      )
    ) {
      const current = new Option(
        row.benchmark
          ? `Current selection: ${row.benchmark.name}`
          : "Unavailable benchmark — choose a replacement",
        row.selectedBenchmarkId,
      );
      current.disabled = !row.benchmark;
      select.append(current);
    }
    select.value = row.selectedBenchmarkId ?? "";
  };
  search.oninput = () => {
    variantSearch = search.value;
    populate();
  };
  manual.onchange = () => {
    showOtherVariants = manual.checked;
    populate();
  };
  select.onchange = () =>
    send("mapping", { id: row.id, benchmarkId: select.value });
  populate();
  label.append(select);
  target.append(
    label,
    text(
      "p",
      state.options.source === "opencode"
        ? "Matching uses explicit model-family aliases. Reasoning variants are separate OpenCode rows. Manual selections may differ from OpenCode's runtime configuration."
        : "Matching uses explicit model-family aliases. Multiple reasoning variants require your choice. Manual selections may differ from Copilot’s reasoning settings.",
      "hint",
    ),
  );
}
function render(next: ViewState) {
  const focused = document.activeElement as HTMLElement | null;
  const focusedModel = focused?.dataset.modelId;
  const focusedDetail = [
    "benchmark",
    "variant-search",
    "variant-manual",
  ].includes(focused?.id ?? "")
    ? focused?.id
    : undefined;
  const selectionStart =
    focused instanceof HTMLInputElement && focused.type === "search"
      ? focused.selectionStart
      : null;
  const previousActive = state?.activeProfileId;
  state = next;
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
    for (const key of ["preset", "billing", "plan", "filter", "source"] as const)
      el<HTMLInputElement>(key).value = state.options[key];
    for (const key of ["input", "read", "write", "output"] as const)
      el<HTMLInputElement>(key).value = String(state.options.tokens[key]);
    initialized = true;
  }
  el("tokens").hidden = state.options.billing === "legacy";
  el("legacy-note").hidden = state.options.billing !== "legacy";
  el("plan-label").hidden = state.options.billing !== "legacy";
  const meta = sources[state.options.source];
  const allowed = meta.billing;
  for (const option of Array.from(
    el<HTMLSelectElement>("billing").options,
  )) {
    option.hidden = !(allowed as string[]).includes(option.value);
  }
  el("eyebrow").textContent = meta.eyebrow;
  el("subtitle").textContent = meta.subtitle;
  el("budget-label").hidden = state.options.recommendation.mode !== "budget";
  el("gap-label").hidden = state.options.recommendation.mode !== "nearBest";
  el("budget-unit").textContent =
    state.options.billing === "credits"
      ? "Maximum AI credits"
      : state.options.billing === "legacy"
        ? "Maximum premium requests"
        : "Maximum USD";
  el("recommendation-result").textContent = state.recommendation.explanation;
  renderProfiles(previousActive);
  el("status").textContent = state.message;
  el<HTMLButtonElement>("refresh").disabled = state.loading;
  el<HTMLButtonElement>("key").disabled = state.loading;
  el("key").textContent = state.hasKey ? "Update API key" : "Set API key";
  el("catalog").textContent = `Catalog dated ${state.catalogDate}`;
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
  el("pricing-note").textContent = `${meta.pricingNote} ${meta.availabilityNote}`;
  (el("display-labels") as HTMLInputElement).checked =
    state.options.display.labels;
  (el("display-frontier") as HTMLInputElement).checked =
    state.options.display.frontier;
  (el("display-scale") as HTMLSelectElement).value =
    state.options.display.scale;
  (el("free-only-label") as HTMLElement).hidden =
    state.options.source !== "opencode";
  (el("free-only") as HTMLInputElement).checked = state.options.freeOnly;
  el("spotlight-result").textContent = state.freeSpotlight.explanation;
  (el("spotlight-card") as HTMLElement).hidden =
    state.options.source !== "opencode";
  el("export-note").textContent = state.exportNote ?? "";
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
  const checklistEl = el("checklist");
  checklistEl.replaceChildren();
  for (const entry of state.checklist) {
    const label = document.createElement("label");
    label.className = "checkbox-label";
    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = entry.included;
    box.setAttribute("aria-label", `Include ${entry.name}`);
    box.onchange = () =>
      send("exclude", { id: entry.id, excluded: !box.checked });
    label.append(box, text("span", `${entry.name} (${entry.rowCount})`));
    checklistEl.append(label);
  }
  el("cost-heading").textContent =
    state.options.billing === "credits"
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
  if (focusedDetail) {
    const input = el<HTMLInputElement>(focusedDetail);
    input?.focus();
    if (selectionStart !== null && input?.type === "search")
      input.setSelectionRange(selectionStart, selectionStart);
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
    picked && picked.hidden && state ? state.options.billing : billingSelect.value
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
      scale: (el("display-scale") as HTMLSelectElement).value as Options["display"]["scale"],
    },
    freeOnly: (el("free-only") as HTMLInputElement).checked,
  };
  send("options", { options });
  return true;
}
el("source").addEventListener("change", () => {
  // Source switches reset billing host-side; send immediately, not debounced.
  clearTimeout(timer);
  send("source", {
    source: el<HTMLSelectElement>("source").value,
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
  "display-scale",
  "free-only",
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
    clearTimeout(timer);
    timer = setTimeout(sendOptions, 150);
  });
}
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
el("include-all").onclick = () => send("excludeAll", { excluded: false });
el("include-none").onclick = () => send("excludeAll", { excluded: true });
el("export-csv").onclick = () => send("exportCsv");
el("export-png").onclick = () => {
  const canvas = el("chart") as HTMLCanvasElement;
  const exportCanvas = document.createElement("canvas");
  exportCanvas.width = 1600;
  exportCanvas.height = 900;
  const ctx = exportCanvas.getContext("2d");
  if (!ctx) return;
  ctx.fillStyle = getComputedStyle(document.body).backgroundColor || "#ffffff";
  ctx.fillRect(0, 0, exportCanvas.width, exportCanvas.height);
  ctx.drawImage(canvas, 0, 0, exportCanvas.width, exportCanvas.height);
  send("exportPng", { png: exportCanvas.toDataURL("image/png") });
};
window.addEventListener("message", (event) => {
  if (event.data?.type === "state") render(event.data.state);
});
new MutationObserver(() => drawChart()).observe(document.body, {
  attributes: true,
  attributeFilter: ["class", "style"],
});
send("ready");
