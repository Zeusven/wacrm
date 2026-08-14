// ============================================================
// GET  /api/v1/reminders  — list reminders (scope: reminders:read)
// POST /api/v1/reminders  — schedule a reminder (scope: reminders:write)
//
// A reminder is a scheduled WhatsApp nudge (see /api/reminders/cron
// for the sender), optionally linked to contact/organization/meeting/
// task. "Recordame mañana enviarle la propuesta a Nicolas" becomes
// one of these with `contact_id` set to Nicolas, not just free text.
// ============================================================

import { requireApiKey } from '@/lib/auth/api-context';
import { ok, okList, fail, toApiErrorResponse } from '@/lib/api/v1/respond';
import {
  parseListParams,
  keysetFilter,
  buildPage,
} from '@/lib/api/v1/pagination';
import type { Reminder } from '@/types';

export async function GET(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'reminders:read');
    const { limit, cursor } = parseListParams(request);
    const url = new URL(request.url);
    const contactId = url.searchParams.get('contact_id');
    const organizationId = url.searchParams.get('organization_id');
    const status = url.searchParams.get('status');

    let query = ctx.supabase
      .from('reminders')
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
      console.error('[api/v1/reminders] list error:', error);
      return fail('internal', 'Failed to list reminders', 500);
    }

    const { items, nextCursor } = buildPage(
      (data ?? []) as unknown as Array<Reminder & { created_at: string; id: string }>,
      limit
    );
    return okList(items, nextCursor);
  } catch (err) {
    return toApiErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'reminders:write');

    const body = (await request.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    if (!body || typeof body !== 'object') {
      return fail('bad_request', 'Request body must be a JSON object', 400);
    }

    const message = typeof body.message === 'string' ? body.message.trim() : '';
    const remindAt = typeof body.remind_at === 'string' ? body.remind_at : '';
    if (!message || !remindAt || Number.isNaN(Date.parse(remindAt))) {
      return fail(
        'bad_request',
        "'message' and a valid 'remind_at' (ISO timestamp) are required",
        400
      );
    }

    const { data, error } = await ctx.supabase
      .from('reminders')
      .insert({
        account_id: ctx.accountId,
        contact_id: typeof body.contact_id === 'string' ? body.contact_id : null,
        organization_id:
          typeof body.organization_id === 'string' ? body.organization_id : null,
        meeting_id: typeof body.meeting_id === 'string' ? body.meeting_id : null,
        task_id: typeof body.task_id === 'string' ? body.task_id : null,
        message,
        remind_at: remindAt,
        channel: typeof body.channel === 'string' ? body.channel : 'whatsapp',
        created_by: null,
      })
      .select('*, contact:contacts(*), organization:organizations(*)')
      .single();

    if (error) {
      console.error('[api/v1/reminders] insert error:', error);
      return fail('internal', 'Failed to create reminder', 500);
    }

    return ok(data as Reminder, 201);
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
