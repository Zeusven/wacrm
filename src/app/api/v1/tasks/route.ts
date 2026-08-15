// ============================================================
// GET  /api/v1/tasks  — list tasks (scope: tasks:read)
// POST /api/v1/tasks  — create a task (scope: tasks:write)
//
// Machine-to-machine counterpart of the dashboard's /api/tasks. A
// task is the checklist-item counterpart to a `meetings` row — "el
// próximo movimiento" from a voice note ("contactar a Nicolas
// mañana") lands here with `contact_id` set, not as free text.
// ============================================================

import { requireApiKey } from '@/lib/auth/api-context';
import { ok, okList, fail, toApiErrorResponse } from '@/lib/api/v1/respond';
import {
  parseListParams,
  keysetFilter,
  buildPage,
} from '@/lib/api/v1/pagination';
import { optionalId } from '@/lib/api/v1/body';
import type { Task } from '@/types';

export async function GET(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'tasks:read');
    const { limit, cursor } = parseListParams(request);
    const url = new URL(request.url);
    const contactId = url.searchParams.get('contact_id');
    const organizationId = url.searchParams.get('organization_id');
    const status = url.searchParams.get('status');

    let query = ctx.supabase
      .from('tasks')
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
      console.error('[api/v1/tasks] list error:', error);
      return fail('internal', 'Failed to list tasks', 500);
    }

    const { items, nextCursor } = buildPage(
      (data ?? []) as unknown as Array<Task & { created_at: string; id: string }>,
      limit
    );
    return okList(items, nextCursor);
  } catch (err) {
    return toApiErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'tasks:write');

    const body = (await request.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    if (!body || typeof body !== 'object') {
      return fail('bad_request', 'Request body must be a JSON object', 400);
    }

    const title = typeof body.title === 'string' ? body.title.trim() : '';
    if (!title) {
      return fail('bad_request', "'title' is required", 400);
    }

    const { data, error } = await ctx.supabase
      .from('tasks')
      .insert({
        account_id: ctx.accountId,
        contact_id: optionalId(body.contact_id),
        organization_id: optionalId(body.organization_id),
        meeting_id: optionalId(body.meeting_id),
        title,
        description: typeof body.description === 'string' ? body.description : null,
        due_date: typeof body.due_date === 'string' ? body.due_date : null,
        status: typeof body.status === 'string' ? body.status : 'PENDIENTE',
        // No auth.uid() for an API-key caller — see the same convention
        // on /api/v1/meetings.
        created_by: null,
      })
      .select('*, contact:contacts(*), organization:organizations(*)')
      .single();

    if (error) {
      console.error('[api/v1/tasks] insert error:', error);
      return fail('internal', 'Failed to create task', 500);
    }

    return ok(data as Task, 201);
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
