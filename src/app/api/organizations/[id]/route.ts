import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import type { Organization, OrganizationDecisionMapRow } from '@/types';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireRole('viewer');
    const { id } = await params;

    const { data: organization, error } = await ctx.supabase
      .from('organizations')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (!organization) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const { data: decisionMap, error: mapError } = await ctx.supabase.rpc(
      'get_organization_decision_map',
      { p_organization_id: id }
    );
    if (mapError) {
      return NextResponse.json({ error: mapError.message }, { status: 500 });
    }

    return NextResponse.json({
      organization: organization as Organization,
      decision_map: (decisionMap ?? []) as OrganizationDecisionMapRow[],
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}

interface UpdateOrganizationBody {
  name?: unknown;
  org_type?: unknown;
  locality?: unknown;
  province?: unknown;
  address?: unknown;
  website?: unknown;
  size_estimate?: unknown;
  specialties?: unknown;
  potential?: unknown;
  commercial_status?: unknown;
  notes?: unknown;
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireRole('agent');
    const { id } = await params;
    const body = (await request.json().catch(() => null)) as UpdateOrganizationBody | null;
    if (!body) {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    const patch: Record<string, unknown> = {};
    for (const key of [
      'name', 'org_type', 'locality', 'province', 'address', 'website',
      'size_estimate', 'specialties', 'potential', 'commercial_status', 'notes',
    ] as const) {
      if (key in body) patch[key] = body[key];
    }

    const { data, error } = await ctx.supabase
      .from('organizations')
      .update(patch)
      .eq('id', id)
      .select()
      .single();
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ organization: data as Organization });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireRole('admin');
    const { id } = await params;
    const { error } = await ctx.supabase.from('organizations').delete().eq('id', id);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return toErrorResponse(error);
  }
}
