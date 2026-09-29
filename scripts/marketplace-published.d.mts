/**
 * Type declarations for the plain-JS Marketplace verification script, so the
 * Vitest suite in `test/marketplace-publish.test.ts` can import its pure
 * helpers without falling back to `any`.
 */

/**
 * `versions` is `unknown` on purpose: the script parses defensively, so the
 * tests must be able to pass a listing whose shape is wrong (a string, an
 * array of non-objects, a missing key) and expect "no versions", not a throw.
 */
export interface GalleryExtension {
  versions?: unknown;
}

export interface GalleryResponse {
  results?: Array<{ extensions?: Array<GalleryExtension> }>;
}

export interface QueryBody {
  filters: Array<{ criteria: Array<{ filterType: number; value: string }> }>;
  flags: number;
}

/** The slice of `Response` the script reads, so tests can stub it. */
export interface MinimalResponse {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}

export interface ConfirmOptions {
  extensionId: string;
  version: string;
  attempts?: number;
  intervalMs?: number;
  fetchImpl?: (url: string, init: RequestInit) => Promise<MinimalResponse>;
  sleepImpl?: (ms: number) => Promise<unknown>;
  log?: (line: string) => void;
}

export interface ConfirmResult {
  ok: boolean;
  attempts: number;
  versions: string[];
}

export function queryBody(extensionId: string): QueryBody;
export function versionsIn(
  payload: GalleryResponse | null | undefined,
): string[];
export function isPublished(
  payload: GalleryResponse | null | undefined,
  version: string,
): boolean;
export function confirmPublished(
  options: ConfirmOptions,
): Promise<ConfirmResult>;
