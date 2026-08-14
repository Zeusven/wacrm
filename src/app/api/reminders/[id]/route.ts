import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import type { Reminder } from '@/types';

interface UpdateReminderBody {
  message?: unknown;
  remind_at?: unknown;
  status?: unknown;
  contact_id?: unknown;
  organization_id?: unknown;
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireRole('agent');
    const { id } = await params;
    const body = (await request.json().catch(() => null)) as UpdateReminderBody | null;
    if (!body) {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    const patch: Record<string, unknown> = {};
    for (const key of [
      'message', 'remind_at', 'status', 'contact_id', 'organization_id',
    ] as const) {
      if (key in body) patch[key] = body[key];
    }

    const { data, error } = await ctx.supabase
      .from('reminders')
      .update(patch)
      .eq('id', id)
      .select('*, contact:contacts(*), organization:organizations(*)')
      .single();
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ reminder: data as Reminder });
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
    const { error } = await ctx.supabase.from('reminders').delete().eq('id', id);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return toErrorResponse(error);
  }
}
