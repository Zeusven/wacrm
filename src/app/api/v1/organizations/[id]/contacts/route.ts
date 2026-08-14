// ============================================================
// GET  /api/v1/organizations/{id}/contacts  — list people mapped to an institution (scope: organizations:read)
// POST /api/v1/organizations/{id}/contacts  — link/update a person's role at an institution (scope: organizations:write)
//
// Machine-to-machine counterpart of the dashboard's
// /api/organizations/[id]/contacts (cookie-auth only, can't be called
// from n8n). Same upsert-on-conflict shape so a note mentioning the
// same person twice updates their role instead of erroring.
// ============================================================

import { requireApiKey } from '@/lib/auth/api-context';
import { ok, okList, fail, toApiErrorResponse } from '@/lib/api/v1/respond';
import type { OrganizationContact } from '@/types';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireApiKey(request, 'organizations:read');
    const { id: organizationId } = await params;

    const { data, error } = await ctx.supabase
      .from('organization_contacts')
      .select('*, contact:contacts(*), organization:organizations!inner(account_id)')
      .eq('organization_id', organizationId)
      .eq('organization.account_id', ctx.accountId)
      .order('decision_level', { ascending: true });
    if (error) {
      console.error('[api/v1/organizations/contacts] list error:', error);
      return fail('internal', 'Failed to list organization contacts', 500);
    }
    return okList(
      (data ?? []) as unknown as OrganizationContact[],
      null
    );
  } catch (err) {
    return toApiErrorResponse(err);
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireApiKey(request, 'organizations:write');
    const { id: organizationId } = await params;

    const body = (await request.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    if (!body || typeof body !== 'object') {
      return fail('bad_request', 'Request body must be a JSON object', 400);
    }

    const contactId = typeof body.contact_id === 'string' ? body.contact_id : null;
    if (!contactId) {
      return fail('bad_request', "'contact_id' is required", 400);
    }

    // Scope check: the organization must belong to this key's account
    // before the upsert — otherwise a caller could link a contact into
    // another tenant's institution by guessing its id.
    const { data: org, error: orgErr } = await ctx.supabase
      .from('organizations')
      .select('id')
      .eq('id', organizationId)
      .eq('account_id', ctx.accountId)
      .maybeSingle();
    if (orgErr) {
      console.error('[api/v1/organizations/contacts] org lookup error:', orgErr);
      return fail('internal', 'Failed to look up organization', 500);
    }
    if (!org) {
      return fail('bad_request', 'Organization not found', 404);
    }

    const { data, error } = await ctx.supabase
      .from('organization_contacts')
      .upsert(
        {
          organization_id: organizationId,
          contact_id: contactId,
          cargo: typeof body.cargo === 'string' ? body.cargo : null,
          area: typeof body.area === 'string' ? body.area : null,
          decision_level:
            typeof body.decision_level === 'string' ? body.decision_level : 'NO_DETERMINADO',
          relationship_type:
            typeof body.relationship_type === 'string' ? body.relationship_type : null,
          is_primary: body.is_primary === true,
          notes: typeof body.notes === 'string' ? body.notes : null,
        },
        { onConflict: 'organization_id,contact_id' }
      )
      .select('*, contact:contacts(*)')
      .single();

    if (error) {
      console.error('[api/v1/organizations/contacts] upsert error:', error);
      return fail('internal', 'Failed to link contact to organization', 500);
    }

    return ok(data as unknown as OrganizationContact, 201);
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
