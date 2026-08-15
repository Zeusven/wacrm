// ============================================================
// GET  /api/v1/meetings  — list meetings/activities (scope: meetings:read)
// POST /api/v1/meetings  — create a meeting        (scope: meetings:write)
//
// Machine-to-machine counterpart of the dashboard's /api/meetings
// (which requires a cookie session and can't be called from n8n).
// Same insert shape and defaults as the internal route — see
// migration 038 (`meetings_has_subject` CHECK: contact_id OR
// organization_id required).
// ============================================================

import { requireApiKey } from '@/lib/auth/api-context';
import { ok, okList, fail, toApiErrorResponse } from '@/lib/api/v1/respond';
import {
  parseListParams,
  keysetFilter,
  buildPage,
} from '@/lib/api/v1/pagination';
import { optionalId } from '@/lib/api/v1/body';
import type { Meeting } from '@/types';

export async function GET(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'meetings:read');
    const { limit, cursor } = parseListParams(request);
    const url = new URL(request.url);
    const contactId = url.searchParams.get('contact_id');
    const organizationId = url.searchParams.get('organization_id');
    const status = url.searchParams.get('status');

    let query = ctx.supabase
      .from('meetings')
      .select('*, contact:contacts(*), organization:organizations(*)')
      .eq('account_id', ctx.accountId);

    if (contactId) query = query.eq('contact_id', contactId);
    if (organizationId) query = query.eq('organization_id', organizationId);
    if (status) query = query.eq('status', status);

    query = query
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(limit + 1);

    const kf = keysetFilter(cursor);
    if (kf) query = query.or(kf);

    const { data, error } = await query;
    if (error) {
      console.error('[api/v1/meetings] list error:', error);
      return fail('internal', 'Failed to list meetings', 500);
    }

    const { items, nextCursor } = buildPage(
      (data ?? []) as unknown as Array<Meeting & { created_at: string; id: string }>,
      limit
    );
    return okList(items, nextCursor);
  } catch (err) {
    return toApiErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'meetings:write');

    const body = (await request.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    if (!body || typeof body !== 'object') {
      return fail('bad_request', 'Request body must be a JSON object', 400);
    }

    const contactId = optionalId(body.contact_id);
    const organizationId = optionalId(body.organization_id);
    if (!contactId && !organizationId) {
      return fail(
        'bad_request',
        "'contact_id' or 'organization_id' is required",
        400
      );
    }

    const { data, error } = await ctx.supabase
      .from('meetings')
      .insert({
        account_id: ctx.accountId,
        contact_id: contactId,
        organization_id: organizationId,
        deal_id: optionalId(body.deal_id),
        meeting_type:
          typeof body.meeting_type === 'string' ? body.meeting_type : 'PRESENCIAL',
        objective: typeof body.objective === 'string' ? body.objective : null,
        channel: typeof body.channel === 'string' ? body.channel : null,
        status: typeof body.status === 'string' ? body.status : 'PROPUESTA',
        scheduled_at:
          typeof body.scheduled_at === 'string' ? body.scheduled_at : null,
        result: typeof body.result === 'string' ? body.result : null,
        next_action: typeof body.next_action === 'string' ? body.next_action : null,
        next_action_date:
          typeof body.next_action_date === 'string' ? body.next_action_date : null,
        // No auth.uid() exists for an API-key caller — `created_by`
        // stays null rather than attributing the row to whichever
        // human happened to mint the key (matches how the public API
        // treats every other "who did this" column: n8n is the actor
        // of record, not a specific dashboard user).
        created_by: null,
      })
      .select('*, contact:contacts(*), organization:organizations(*)')
      .single();

    if (error) {
      console.error('[api/v1/meetings] insert error:', error);
      return fail('internal', 'Failed to create meeting', 500);
    }

    return ok(data as Meeting, 201);
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
