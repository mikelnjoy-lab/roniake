import { supabase } from "@/integrations/supabase/client";

// Single offline mechanism: IndexedDB queue of sales keyed by client_txn_id.
// post_sale is idempotent on client_txn_id, so retries can never double-record.
export type PendingSale = {
  client_txn_id: string;
  branch_id: string;
  lines: { product_id: string; qty: number; discount: number }[];
  tenders: { type: string; amount: number; reference?: string | null }[];
  device_id: string;
  customer_id?: string | null;
  created_at: string;
  state: "pending" | "failed";
  error?: string;
};

const DB = "ronia";
const STORE = "pending_sales";

function open(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: "client_txn_id" });
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise((res, rej) => {
    const req = fn(db.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}
export const listPending = () => tx<PendingSale[]>("readonly", (s) => s.getAll() as IDBRequest<PendingSale[]>);
export const putPending = (p: PendingSale) => tx("readwrite", (s) => s.put(p));
const remove = (id: string) => tx("readwrite", (s) => s.delete(id));

export function deviceId() {
  let d = localStorage.getItem("ronia.device");
  if (!d) { d = crypto.randomUUID(); localStorage.setItem("ronia.device", d); }
  return d;
}

export function isNetworkError(e: unknown) {
  const m = String((e as { message?: string })?.message ?? e);
  return !navigator.onLine || /fetch|network|Failed to fetch|Load failed/i.test(m);
}

export async function submitSale(p: Omit<PendingSale, "state" | "created_at">) {
  const { data, error } = await supabase.rpc("post_sale", {
    _branch: p.branch_id, _client_txn_id: p.client_txn_id,
    _lines: p.lines as never, _tenders: p.tenders as never, _device_id: p.device_id,
    ...(p.customer_id ? { _customer: p.customer_id } : {}),
  });
  if (error) throw error;
  return data as { status: string; sale_id: string; receipt_no: string; total: number; change_given: number };
}

// Duplicate key on (business, client_txn_id) means another attempt already recorded this sale.
function isAlreadyRecorded(e: unknown) {
  return (e as { code?: string })?.code === "23505";
}

// One sync at a time per tab: overlapping runs (reconnect + timer) would race the same sale.
let running: Promise<{ synced: number; failed: number }> | null = null;

export function syncPending(opts: { includeFailed?: boolean } = {}) {
  if (running) return running;
  running = (async () => {
    let synced = 0, failed = 0;
    for (const p of await listPending()) {
      // Rejected sales are not retried automatically; a person must look at them first.
      if (p.state === "failed" && !opts.includeFailed) continue;
      try { await submitSale(p); await remove(p.client_txn_id); synced++; }
      catch (e) {
        if (isAlreadyRecorded(e)) { await remove(p.client_txn_id); synced++; continue; }
        if (isNetworkError(e)) break;
        await putPending({ ...p, state: "failed", error: String((e as Error).message) }); failed++;
      }
    }
    return { synced, failed };
  })().finally(() => { running = null; });
  return running;
}

// Remove a rejected sale from this device after the manager has dealt with it (it was never recorded).
export const dismissFailed = (id: string) => remove(id);
