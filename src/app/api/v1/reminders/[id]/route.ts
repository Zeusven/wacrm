// ============================================================
// PATCH /api/v1/reminders/{id} — update/cancel a reminder (scope: reminders:write)
// ============================================================

import { requireApiKey } from '@/lib/auth/api-context';
import { ok, fail, toApiErrorResponse } from '@/lib/api/v1/respond';
import type { Reminder } from '@/types';

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireApiKey(request, 'reminders:write');
    const { id } = await params;

    const body = (await request.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    if (!body || typeof body !== 'object') {
      return fail('bad_request', 'Request body must be a JSON object', 400);
    }

    const updates: Record<string, unknown> = {};
    for (const field of [
      'message', 'remind_at', 'status', 'contact_id', 'organization_id',
    ] as const) {
      if (field in body) updates[field] = body[field];
    }

    const { data, error } = await ctx.supabase
      .from('reminders')
      .update(updates)
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .select('*, contact:contacts(*), organization:organizations(*)')
      .maybeSingle();

    if (error) {
      console.error('[api/v1/reminders] update error:', error);
      return fail('internal', 'Failed to update reminder', 500);
    }
    if (!data) return fail('not_found', 'Reminder not found', 404);

    return ok(data as Reminder);
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
