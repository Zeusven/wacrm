import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import type { OrganizationContact } from '@/types';

interface UpdateLinkBody {
  cargo?: unknown;
  area?: unknown;
  decision_level?: unknown;
  relationship_type?: unknown;
  is_primary?: unknown;
  notes?: unknown;
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; contactId: string }> }
) {
  try {
    const ctx = await requireRole('agent');
    const { id: organizationId, contactId } = await params;
    const body = (await request.json().catch(() => null)) as UpdateLinkBody | null;
    if (!body) {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    const patch: Record<string, unknown> = {};
    for (const key of [
      'cargo', 'area', 'decision_level', 'relationship_type', 'is_primary', 'notes',
    ] as const) {
      if (key in body) patch[key] = body[key];
    }

    const { data, error } = await ctx.supabase
      .from('organization_contacts')
      .update(patch)
      .eq('organization_id', organizationId)
      .eq('contact_id', contactId)
      .select('*, contact:contacts(*)')
      .single();
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ organization_contact: data as OrganizationContact });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; contactId: string }> }
) {
  try {
    const ctx = await requireRole('agent');
    const { id: organizationId, contactId } = await params;
    const { error } = await ctx.supabase
      .from('organization_contacts')
      .delete()
      .eq('organization_id', organizationId)
      .eq('contact_id', contactId);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return toErrorResponse(error);
  }
}
