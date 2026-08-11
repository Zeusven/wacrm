import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import type { Meeting } from '@/types';

interface UpdateMeetingBody {
  meeting_type?: unknown;
  objective?: unknown;
  channel?: unknown;
  status?: unknown;
  scheduled_at?: unknown;
  completed_at?: unknown;
  result?: unknown;
  next_action?: unknown;
  next_action_date?: unknown;
  deal_id?: unknown;
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireRole('agent');
    const { id } = await params;
    const body = (await request.json().catch(() => null)) as UpdateMeetingBody | null;
    if (!body) {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    const patch: Record<string, unknown> = {};
    for (const key of [
      'meeting_type', 'objective', 'channel', 'status', 'scheduled_at',
      'completed_at', 'result', 'next_action', 'next_action_date', 'deal_id',
    ] as const) {
      if (key in body) patch[key] = body[key];
    }

    const { data, error } = await ctx.supabase
      .from('meetings')
      .update(patch)
      .eq('id', id)
      .select('*, contact:contacts(*), organization:organizations(*)')
      .single();
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ meeting: data as Meeting });
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
    const { error } = await ctx.supabase.from('meetings').delete().eq('id', id);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return toErrorResponse(error);
  }
}
