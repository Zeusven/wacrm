import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import type { Task } from '@/types';

interface UpdateTaskBody {
  title?: unknown;
  description?: unknown;
  due_date?: unknown;
  status?: unknown;
  contact_id?: unknown;
  organization_id?: unknown;
  meeting_id?: unknown;
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireRole('agent');
    const { id } = await params;
    const body = (await request.json().catch(() => null)) as UpdateTaskBody | null;
    if (!body) {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    const patch: Record<string, unknown> = {};
    for (const key of [
      'title', 'description', 'due_date', 'status',
      'contact_id', 'organization_id', 'meeting_id',
    ] as const) {
      if (key in body) patch[key] = body[key];
    }
    if (patch.status === 'HECHA') {
      patch.completed_at = new Date().toISOString();
    }

    const { data, error } = await ctx.supabase
      .from('tasks')
      .update(patch)
      .eq('id', id)
      .select('*, contact:contacts(*), organization:organizations(*)')
      .single();
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ task: data as Task });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireRole('agent');
    const { id } = await params;
    const { error } = await ctx.supabase.from('tasks').delete().eq('id', id);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return toErrorResponse(error);
  }
}
