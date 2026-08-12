// ============================================================
// GET  /api/v1/organizations  — list/search institutions (scope: organizations:read)
// POST /api/v1/organizations  — find-or-create by name  (scope: organizations:write)
//
// Mirrors the shape of /api/v1/contacts (same envelope, same
// keyset pagination). Create is find-or-create by case-insensitive
// exact name match — the same institution mentioned in two voice
// notes must land on one row, not a duplicate, and an n8n workflow
// has no UI to dedupe manually. An existing match returns 200 with
// `created: false`; a new row returns 201 with `created: true`.
// ============================================================

import { requireApiKey } from '@/lib/auth/api-context';
import { ok, okList, fail, toApiErrorResponse } from '@/lib/api/v1/respond';
import {
  parseListParams,
  keysetFilter,
  buildPage,
} from '@/lib/api/v1/pagination';
import type { Organization } from '@/types';

// Same character allowlist as contacts' sanitizeSearch — strips
// PostgREST `.ilike()` filter-grammar-breaking characters while
// keeping anything an institution name legitimately contains.
function sanitizeSearch(raw: string): string {
  return raw.replace(/[^\p{L}\p{N} +@.\-_]/gu, '').trim();
}

export async function GET(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'organizations:read');
    const { limit, cursor } = parseListParams(request);
    const url = new URL(request.url);
    const search = sanitizeSearch(url.searchParams.get('search') ?? '');

    let query = ctx.supabase
      .from('organizations')
      .select('*')
      .eq('account_id', ctx.accountId);

    if (search) {
      query = query.ilike('name', `%${search}%`);
    }

    query = query
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(limit + 1);

    const kf = keysetFilter(cursor);
    if (kf) query = query.or(kf);

    const { data, error } = await query;
    if (error) {
      console.error('[api/v1/organizations] list error:', error);
      return fail('internal', 'Failed to list organizations', 500);
    }

    const { items, nextCursor } = buildPage(
      (data ?? []) as unknown as Array<Organization & { created_at: string; id: string }>,
      limit
    );
    return okList(items, nextCursor);
  } catch (err) {
    return toApiErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'organizations:write');

    const body = (await request.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    if (!body || typeof body !== 'object') {
      return fail('bad_request', 'Request body must be a JSON object', 400);
    }

    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) {
      return fail('bad_request', "'name' is required", 400);
    }

    // Find-or-create: exact case-insensitive match on name within the
    // account. `.ilike()` with no wildcards behaves as a case-insensitive
    // equality check here.
    const { data: existing, error: findErr } = await ctx.supabase
      .from('organizations')
      .select('*')
      .eq('account_id', ctx.accountId)
      .ilike('name', name)
      .limit(1)
      .maybeSingle();
    if (findErr) {
      console.error('[api/v1/organizations] lookup error:', findErr);
      return fail('internal', 'Failed to look up organization', 500);
    }
    if (existing) {
      return ok(existing as Organization, 200);
    }

    const { data: created, error: insertErr } = await ctx.supabase
      .from('organizations')
      .insert({
        account_id: ctx.accountId,
        name,
        org_type: typeof body.org_type === 'string' ? body.org_type : null,
        locality: typeof body.locality === 'string' ? body.locality : null,
        province: typeof body.province === 'string' ? body.province : null,
        address: typeof body.address === 'string' ? body.address : null,
        website: typeof body.website === 'string' ? body.website : null,
        size_estimate:
          typeof body.size_estimate === 'string' ? body.size_estimate : null,
        specialties: Array.isArray(body.specialties) ? body.specialties : null,
        potential:
          typeof body.potential === 'string' ? body.potential : 'NO_DETERMINADO',
        commercial_status:
          typeof body.commercial_status === 'string'
            ? body.commercial_status
            : 'NUEVO',
        notes: typeof body.notes === 'string' ? body.notes : null,
      })
      .select()
      .single();
    if (insertErr) {
      console.error('[api/v1/organizations] insert error:', insertErr);
      return fail('internal', 'Failed to create organization', 500);
    }

    return ok(created as Organization, 201);
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
