// ============================================================
// GET   /api/v1/tasks/{id} — read a task   (scope: tasks:read)
// PATCH /api/v1/tasks/{id} — update a task (scope: tasks:write)
// ============================================================

import { requireApiKey } from '@/lib/auth/api-context';
import { ok, fail, toApiErrorResponse } from '@/lib/api/v1/respond';
import type { Task } from '@/types';

const SELECT = '*, contact:contacts(*), organization:organizations(*)';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireApiKey(request, 'tasks:read');
    const { id } = await params;
    const { data, error } = await ctx.supabase
      .from('tasks')
      .select(SELECT)
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .maybeSingle();
    if (error) {
      console.error('[api/v1/tasks] read error:', error);
      return fail('internal', 'Failed to read task', 500);
    }
    if (!data) return fail('not_found', 'Task not found', 404);
    return ok(data as Task);
  } catch (err) {
    return toApiErrorResponse(err);
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireApiKey(request, 'tasks:write');
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
      'title', 'description', 'due_date', 'status',
      'contact_id', 'organization_id', 'meeting_id',
    ] as const) {
      if (field in body) updates[field] = body[field];
    }
    if (updates.status === 'HECHA') {
      updates.completed_at = new Date().toISOString();
    }

    const { data, error } = await ctx.supabase
      .from('tasks')
      .update(updates)
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .select(SELECT)
      .maybeSingle();

    if (error) {
      console.error('[api/v1/tasks] update error:', error);
      return fail('internal', 'Failed to update task', 500);
    }
    if (!data) return fail('not_found', 'Task not found', 404);

    return ok(data as Task);
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
