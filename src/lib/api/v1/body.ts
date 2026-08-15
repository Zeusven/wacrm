// ============================================================
// Shared request-body helpers for /api/v1 write routes.
// ============================================================

/**
 * Coerce a request-body value into an optional foreign-key id: a
 * non-empty string, or `null`. Every optional `*_id` field (contact_id,
 * organization_id, meeting_id, task_id, deal_id) is a UUID column —
 * an empty string is not a valid UUID and fails the insert with a
 * generic Postgres error the route can't tell apart from any other
 * internal failure (surfaces to the caller as a bare 500). Callers
 * sometimes send `''` instead of omitting the key or sending `null`
 * explicitly (e.g. a no-op field in a fixed n8n body template) — this
 * makes every route tolerate that uniformly instead of re-deriving
 * `typeof x === 'string' ? x : null` per route, which does NOT catch
 * the empty-string case.
 */
export function optionalId(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}
