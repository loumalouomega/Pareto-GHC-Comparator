import type { Benchmark, Snapshot } from "./types";
export const endpoint =
  "https://artificialanalysis.ai/api/v2/language/models/free";
export const cacheTtl = 24 * 60 * 60 * 1000;
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown): v is string =>
  typeof v === "string" && v.length > 0 && v.length < 1000;
const score = (v: unknown): v is number | null =>
  v === null || (typeof v === "number" && Number.isFinite(v) && v >= 0);
const validVersion = (v: unknown): boolean =>
  (typeof v === "number" || typeof v === "string") &&
  /^\d+(\.\d+)*$/.test(String(v));
export function parsePage(value: unknown, expectedPage: number) {
  if (
    !object(value) ||
    !Array.isArray(value.data) ||
    !object(value.pagination) ||
    value.pagination.page !== expectedPage ||
    typeof value.pagination.has_more !== "boolean" ||
    !validVersion(value.intelligence_index_version)
  )
    throw new Error("Invalid benchmark API response.");
  const version = String(value.intelligence_index_version);
  const models: Benchmark[] = value.data.map((raw) => {
    if (
      !object(raw) ||
      !str(raw.id) ||
      !str(raw.slug) ||
      !str(raw.name) ||
      !object(raw.model_creator) ||
      !str(raw.model_creator.name) ||
      !object(raw.evaluations)
    )
      throw new Error("Invalid benchmark model.");
    const e = raw.evaluations;
    const general = e.artificial_analysis_intelligence_index ?? null,
      coding = e.artificial_analysis_coding_index ?? null,
      agentic = e.artificial_analysis_agentic_index ?? null;
    if (![general, coding, agentic].every(score))
      throw new Error("Invalid benchmark score.");
    return {
      id: raw.id,
      slug: raw.slug,
      name: raw.name,
      provider: raw.model_creator.name,
      scores: {
        general: general as number | null,
        coding: coding as number | null,
        agentic: agentic as number | null,
      },
    };
  });
  return { version, models, hasMore: value.pagination.has_more };
}
export function validSnapshot(v: unknown): v is Snapshot {
  return (
    object(v) &&
    str(v.version) &&
    validVersion(v.version) &&
    typeof v.fetchedAt === "number" &&
    Number.isFinite(v.fetchedAt) &&
    v.fetchedAt > 0 &&
    Array.isArray(v.models) &&
    v.models.every(
      (m) =>
        object(m) &&
        str(m.id) &&
        str(m.slug) &&
        str(m.name) &&
        str(m.provider) &&
        object(m.scores) &&
        ["general", "coding", "agentic"].every((k) =>
          score((m.scores as Record<string, unknown>)[k]),
        ),
    ) &&
    new Set(v.models.map((m) => m.id)).size === v.models.length
  );
}
export interface CacheStore {
  read(): Promise<unknown>;
  write(value: Snapshot): Promise<void>;
}
export class ApiError extends Error {
  constructor(
    message: string,
    public retryAt?: number,
  ) {
    super(message);
  }
}
export class BenchmarkService {
  private pending?: Promise<Snapshot>;
  private attempted = false;
  public retryAt = 0;
  constructor(
    private store: CacheStore,
    private request: typeof fetch = fetch,
    private now: () => number = Date.now,
  ) {}
  async cached(): Promise<Snapshot | undefined> {
    try {
      const v = await this.store.read();
      return validSnapshot(v) ? v : undefined;
    } catch {
      return undefined;
    }
  }
  async load(key: string | undefined, force = false): Promise<Snapshot> {
    if (this.pending) return this.pending;
    const old = await this.cached();
    if (this.pending) return this.pending;
    if (
      !force &&
      old &&
      this.now() - old.fetchedAt < cacheTtl &&
      old.fetchedAt <= this.now()
    )
      return old;
    if (!key)
      throw new ApiError(
        "Set your Artificial Analysis API key to load benchmark data.",
      );
    if (this.now() < this.retryAt)
      throw new ApiError(
        `API rate limit reached. Try after ${new Date(this.retryAt).toLocaleString()}.`,
        this.retryAt,
      );
    if (!force && this.attempted) {
      if (old) return old;
      throw new ApiError(
        "Automatic refresh already attempted. Use Refresh data to retry.",
      );
    }
    this.attempted = true;
    this.pending = this.download(key).finally(() => {
      this.pending = undefined;
    });
    return this.pending;
  }
  private async download(key: string): Promise<Snapshot> {
    const models: Benchmark[] = [];
    let version = "";
    for (let page = 1; page <= 100; page++) {
      let response: Response;
      try {
        response = await this.request(`${endpoint}?page=${page}`, {
          headers: { "x-api-key": key },
          signal: AbortSignal.timeout(20000),
          redirect: "error",
        });
      } catch {
        throw new ApiError(
          "Could not reach Artificial Analysis. Check your connection and use Refresh data to retry.",
        );
      }
      const reset = Number(response.headers.get("X-RateLimit-Reset")) * 1000;
      if (response.status === 429) {
        const retry = response.headers.get("Retry-After");
        const seconds = retry === null ? NaN : Number(retry);
        const retryTime = Number.isFinite(seconds)
          ? this.now() + seconds * 1000
          : Date.parse(retry ?? "");
        this.retryAt =
          Math.max(
            this.now() + 1000,
            Number.isFinite(reset) && reset > this.now() ? reset : 0,
            Number.isFinite(retryTime) ? retryTime : 0,
          ) || this.now() + cacheTtl;
        if (this.retryAt <= this.now() + 1000)
          this.retryAt = this.now() + cacheTtl;
        throw new ApiError(
          `API rate limit reached. Try after ${new Date(this.retryAt).toLocaleString()}.`,
          this.retryAt,
        );
      }
      if (response.status === 401 || response.status === 403)
        throw new ApiError(
          "Artificial Analysis rejected the API key or its access. Update your API key.",
        );
      if (!response.ok)
        throw new ApiError(
          `Artificial Analysis returned HTTP ${response.status}. Use Refresh data to retry.`,
        );
      let parsed: ReturnType<typeof parsePage>;
      try {
        parsed = parsePage(await response.json(), page);
      } catch {
        throw new ApiError(
          "Artificial Analysis returned invalid benchmark data. The previous cache is preserved.",
        );
      }
      if (version && version !== parsed.version)
        throw new ApiError(
          "Benchmark version changed during pagination. Refresh again.",
        );
      version = parsed.version;
      models.push(...parsed.models);
      if (response.headers.get("X-RateLimit-Remaining") === "0")
        this.retryAt = reset > this.now() ? reset : this.now() + cacheTtl;
      if (!parsed.hasMore) {
        const snapshot = { version, models, fetchedAt: this.now() };
        if (!validSnapshot(snapshot))
          throw new ApiError(
            "Duplicate or invalid benchmark records. The previous cache is preserved.",
          );
        await this.store.write(snapshot);
        return snapshot;
      }
      if (this.now() < this.retryAt)
        throw new ApiError(
          "API quota exhausted before all pages arrived. The previous cache is preserved.",
          this.retryAt,
        );
    }
    throw new ApiError(
      "Too many benchmark pages. The previous cache is preserved.",
    );
  }
}
