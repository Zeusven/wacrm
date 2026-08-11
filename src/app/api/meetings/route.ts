import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import type { Meeting } from '@/types';

export async function GET(request: Request) {
  try {
    const ctx = await requireRole('viewer');
    const { searchParams } = new URL(request.url);
    const contactId = searchParams.get('contact_id');
    const organizationId = searchParams.get('organization_id');
    const status = searchParams.get('status');

    let query = ctx.supabase
      .from('meetings')
      .select('*, contact:contacts(*), organization:organizations(*)')
      .order('next_action_date', { ascending: true, nullsFirst: false })
      .order('scheduled_at', { ascending: true, nullsFirst: false });

    if (contactId) query = query.eq('contact_id', contactId);
    if (organizationId) query = query.eq('organization_id', organizationId);
    if (status) query = query.eq('status', status);

    const { data, error } = await query;
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ meetings: (data ?? []) as Meeting[] });
  } catch (error) {
    return toErrorResponse(error);
  }
}

interface CreateMeetingBody {
  contact_id?: unknown;
  organization_id?: unknown;
  deal_id?: unknown;
  meeting_type?: unknown;
  objective?: unknown;
  channel?: unknown;
  status?: unknown;
  scheduled_at?: unknown;
  result?: unknown;
  next_action?: unknown;
  next_action_date?: unknown;
}

export async function POST(request: Request) {
  try {
    const ctx = await requireRole('agent');
    const body = (await request.json().catch(() => null)) as CreateMeetingBody | null;
    const contactId = typeof body?.contact_id === 'string' ? body.contact_id : null;
    const organizationId = typeof body?.organization_id === 'string' ? body.organization_id : null;
    if (!contactId && !organizationId) {
      return NextResponse.json(
        { error: 'contact_id or organization_id required' },
        { status: 400 }
      );
    }

    const { data, error } = await ctx.supabase
      .from('meetings')
      .insert({
        account_id: ctx.accountId,
        contact_id: contactId,
        organization_id: organizationId,
        deal_id: typeof body?.deal_id === 'string' ? body.deal_id : null,
        meeting_type: typeof body?.meeting_type === 'string' ? body.meeting_type : 'PRESENCIAL',
        objective: typeof body?.objective === 'string' ? body.objective : null,
        channel: typeof body?.channel === 'string' ? body.channel : null,
        status: typeof body?.status === 'string' ? body.status : 'PROPUESTA',
        scheduled_at: typeof body?.scheduled_at === 'string' ? body.scheduled_at : null,
        result: typeof body?.result === 'string' ? body.result : null,
        next_action: typeof body?.next_action === 'string' ? body.next_action : null,
        next_action_date:
          typeof body?.next_action_date === 'string' ? body.next_action_date : null,
        created_by: ctx.userId,
      })
      .select('*, contact:contacts(*), organization:organizations(*)')
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ meeting: data as Meeting }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
