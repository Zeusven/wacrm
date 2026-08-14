// ============================================================
// GET   /api/v1/organizations/{id} — read one institution (scope: organizations:read)
// PATCH /api/v1/organizations/{id} — update institution fields (scope: organizations:write)
//
// Counterpart to POST /api/v1/organizations (find-or-create by name).
// Once an organization exists, enrichment (web lookup, a corrected
// address, a newly-learned specialty) lands here instead of another
// create call — updates only the fields present in the body.
// ============================================================

import { requireApiKey } from '@/lib/auth/api-context';
import { ok, fail, toApiErrorResponse } from '@/lib/api/v1/respond';
import type { Organization } from '@/types';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireApiKey(request, 'organizations:read');
    const { id } = await params;

    const { data, error } = await ctx.supabase
      .from('organizations')
      .select('*')
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .maybeSingle();

    if (error) {
      console.error('[api/v1/organizations] read error:', error);
      return fail('internal', 'Failed to read organization', 500);
    }
    if (!data) return fail('not_found', 'Organization not found', 404);

    return ok(data as Organization);
  } catch (err) {
    return toApiErrorResponse(err);
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireApiKey(request, 'organizations:write');
    const { id } = await params;

    const body = (await request.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    if (!body || typeof body !== 'object') {
      return fail('bad_request', 'Request body must be a JSON object', 400);
    }

    // A field is updated only when its key is PRESENT — omitted fields
    // are untouched, `null` clears them. `specialties` is the one
    // array field (organizations.specialties TEXT[]); everything else
    // is a plain string/enum-as-text column.
    const updates: Record<string, unknown> = {};
    for (const field of [
      'name', 'org_type', 'locality', 'province', 'address', 'website',
      'size_estimate', 'potential', 'commercial_status', 'notes',
    ] as const) {
      if (!(field in body)) continue;
      const value = body[field];
      if (value === null || typeof value === 'string') {
        updates[field] = value;
      } else {
        return fail('bad_request', `'${field}' must be a string or null`, 400);
      }
    }
    if ('specialties' in body) {
      const value = body.specialties;
      if (value === null) {
        updates.specialties = null;
      } else if (Array.isArray(value) && value.every((v) => typeof v === 'string')) {
        updates.specialties = value;
      } else {
        return fail('bad_request', "'specialties' must be an array of strings or null", 400);
      }
    }

    if (Object.keys(updates).length === 0) {
      return fail('bad_request', 'No valid fields to update', 400);
    }
    updates.updated_at = new Date().toISOString();

    const { data, error } = await ctx.supabase
      .from('organizations')
      .update(updates)
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .select('*')
      .maybeSingle();

    if (error) {
      console.error('[api/v1/organizations] update error:', error);
      return fail('internal', 'Failed to update organization', 500);
    }
    if (!data) return fail('not_found', 'Organization not found', 404);

    return ok(data as Organization);
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
