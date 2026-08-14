import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import type { Reminder } from '@/types';

export async function GET(request: Request) {
  try {
    const ctx = await requireRole('viewer');
    const { searchParams } = new URL(request.url);
    const contactId = searchParams.get('contact_id');
    const organizationId = searchParams.get('organization_id');
    const status = searchParams.get('status');

    let query = ctx.supabase
      .from('reminders')
      .select('*, contact:contacts(*), organization:organizations(*)')
      .order('remind_at', { ascending: true });

    if (contactId) query = query.eq('contact_id', contactId);
    if (organizationId) query = query.eq('organization_id', organizationId);
    if (status) query = query.eq('status', status);

    const { data, error } = await query;
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ reminders: (data ?? []) as Reminder[] });
  } catch (error) {
    return toErrorResponse(error);
  }
}

interface CreateReminderBody {
  contact_id?: unknown;
  organization_id?: unknown;
  meeting_id?: unknown;
  task_id?: unknown;
  message?: unknown;
  remind_at?: unknown;
  channel?: unknown;
}

export async function POST(request: Request) {
  try {
    const ctx = await requireRole('agent');
    const body = (await request.json().catch(() => null)) as CreateReminderBody | null;
    const message = typeof body?.message === 'string' ? body.message.trim() : '';
    const remindAt = typeof body?.remind_at === 'string' ? body.remind_at : '';
    if (!message || !remindAt || Number.isNaN(Date.parse(remindAt))) {
      return NextResponse.json(
        { error: 'message and a valid remind_at (ISO timestamp) are required' },
        { status: 400 }
      );
    }

    const { data, error } = await ctx.supabase
      .from('reminders')
      .insert({
        account_id: ctx.accountId,
        contact_id: typeof body?.contact_id === 'string' ? body.contact_id : null,
        organization_id:
          typeof body?.organization_id === 'string' ? body.organization_id : null,
        meeting_id: typeof body?.meeting_id === 'string' ? body.meeting_id : null,
        task_id: typeof body?.task_id === 'string' ? body.task_id : null,
        message,
        remind_at: remindAt,
        channel: typeof body?.channel === 'string' ? body.channel : 'whatsapp',
        created_by: ctx.userId,
      })
      .select('*, contact:contacts(*), organization:organizations(*)')
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ reminder: data as Reminder }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
