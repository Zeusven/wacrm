import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import type { Task } from '@/types';

export async function GET(request: Request) {
  try {
    const ctx = await requireRole('viewer');
    const { searchParams } = new URL(request.url);
    const contactId = searchParams.get('contact_id');
    const organizationId = searchParams.get('organization_id');
    const status = searchParams.get('status');

    let query = ctx.supabase
      .from('tasks')
      .select('*, contact:contacts(*), organization:organizations(*)')
      .order('due_date', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: false });

    if (contactId) query = query.eq('contact_id', contactId);
    if (organizationId) query = query.eq('organization_id', organizationId);
    if (status) query = query.eq('status', status);

    const { data, error } = await query;
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ tasks: (data ?? []) as Task[] });
  } catch (error) {
    return toErrorResponse(error);
  }
}

interface CreateTaskBody {
  contact_id?: unknown;
  organization_id?: unknown;
  meeting_id?: unknown;
  title?: unknown;
  description?: unknown;
  due_date?: unknown;
  status?: unknown;
}

export async function POST(request: Request) {
  try {
    const ctx = await requireRole('agent');
    const body = (await request.json().catch(() => null)) as CreateTaskBody | null;
    const title = typeof body?.title === 'string' ? body.title.trim() : '';
    if (!title) {
      return NextResponse.json({ error: 'title required' }, { status: 400 });
    }

    const { data, error } = await ctx.supabase
      .from('tasks')
      .insert({
        account_id: ctx.accountId,
        contact_id: typeof body?.contact_id === 'string' ? body.contact_id : null,
        organization_id:
          typeof body?.organization_id === 'string' ? body.organization_id : null,
        meeting_id: typeof body?.meeting_id === 'string' ? body.meeting_id : null,
        title,
        description: typeof body?.description === 'string' ? body.description : null,
        due_date: typeof body?.due_date === 'string' ? body.due_date : null,
        status: typeof body?.status === 'string' ? body.status : 'PENDIENTE',
        created_by: ctx.userId,
      })
      .select('*, contact:contacts(*), organization:organizations(*)')
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ task: data as Task }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
