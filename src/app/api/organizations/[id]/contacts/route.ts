import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import type { OrganizationContact } from '@/types';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireRole('viewer');
    const { id: organizationId } = await params;

    const { data, error } = await ctx.supabase
      .from('organization_contacts')
      .select('*, contact:contacts(*)')
      .eq('organization_id', organizationId)
      .order('decision_level', { ascending: true });
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({
      organization_contacts: (data ?? []) as OrganizationContact[],
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}

interface LinkContactBody {
  contact_id?: unknown;
  cargo?: unknown;
  area?: unknown;
  decision_level?: unknown;
  relationship_type?: unknown;
  is_primary?: unknown;
  notes?: unknown;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireRole('agent');
    const { id: organizationId } = await params;
    const body = (await request.json().catch(() => null)) as LinkContactBody | null;
    const contactId = typeof body?.contact_id === 'string' ? body.contact_id : null;
    if (!contactId) {
      return NextResponse.json({ error: 'contact_id required' }, { status: 400 });
    }

    const { data, error } = await ctx.supabase
      .from('organization_contacts')
      .upsert(
        {
          organization_id: organizationId,
          contact_id: contactId,
          cargo: typeof body?.cargo === 'string' ? body.cargo : null,
          area: typeof body?.area === 'string' ? body.area : null,
          decision_level:
            typeof body?.decision_level === 'string' ? body.decision_level : 'NO_DETERMINADO',
          relationship_type:
            typeof body?.relationship_type === 'string' ? body.relationship_type : null,
          is_primary: body?.is_primary === true,
          notes: typeof body?.notes === 'string' ? body.notes : null,
        },
        { onConflict: 'organization_id,contact_id' }
      )
      .select('*, contact:contacts(*)')
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ organization_contact: data as OrganizationContact }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
