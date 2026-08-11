import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import type { Organization } from '@/types';

export async function GET(request: Request) {
  try {
    const ctx = await requireRole('viewer');
    const { searchParams } = new URL(request.url);
    const search = searchParams.get('search');
    const potential = searchParams.get('potential');

    let query = ctx.supabase
      .from('organizations')
      .select('*')
      .order('name', { ascending: true });

    if (search) {
      query = query.ilike('name', `%${search}%`);
    }
    if (potential) {
      query = query.eq('potential', potential);
    }

    const { data, error } = await query;
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ organizations: (data ?? []) as Organization[] });
  } catch (error) {
    return toErrorResponse(error);
  }
}

interface CreateOrganizationBody {
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

export async function POST(request: Request) {
  try {
    const ctx = await requireRole('agent');
    const body = (await request.json().catch(() => null)) as CreateOrganizationBody | null;
    const name = typeof body?.name === 'string' ? body.name.trim() : '';
    if (!name) {
      return NextResponse.json({ error: 'name required' }, { status: 400 });
    }

    const { data, error } = await ctx.supabase
      .from('organizations')
      .insert({
        account_id: ctx.accountId,
        name,
        org_type: typeof body?.org_type === 'string' ? body.org_type : null,
        locality: typeof body?.locality === 'string' ? body.locality : null,
        province: typeof body?.province === 'string' ? body.province : null,
        address: typeof body?.address === 'string' ? body.address : null,
        website: typeof body?.website === 'string' ? body.website : null,
        size_estimate: typeof body?.size_estimate === 'string' ? body.size_estimate : null,
        specialties: Array.isArray(body?.specialties) ? body.specialties : null,
        potential: typeof body?.potential === 'string' ? body.potential : 'NO_DETERMINADO',
        commercial_status:
          typeof body?.commercial_status === 'string' ? body.commercial_status : 'NUEVO',
        notes: typeof body?.notes === 'string' ? body.notes : null,
      })
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ organization: data as Organization }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
