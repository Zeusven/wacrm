// ============================================================
// GET /api/v1/organizations/briefing?search=  — full institution
// context in one call (scope: organizations:read)
//
// Built for the WhatsApp query agent: "what's missing to close
// Hospital Español" needs the org + its mapped people (with
// decision_level) + its recent/pending meetings in a single
// response, so the agent doesn't have to chain a search call into
// an id-lookup call into a meetings call. Mirrors the same data the
// dashboard's /organizations/[id] briefing section already computes,
// just via a name search instead of an id.
// ============================================================

import { requireApiKey } from '@/lib/auth/api-context';
import { ok, fail, toApiErrorResponse } from '@/lib/api/v1/respond';

function sanitizeSearch(raw: string): string {
  return raw.replace(/[^\p{L}\p{N} +@.\-_]/gu, '').trim();
}

export async function GET(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'organizations:read');
    const url = new URL(request.url);
    const search = sanitizeSearch(url.searchParams.get('search') ?? '');
    if (!search) {
      return fail('bad_request', "'search' is required", 400);
    }

    const { data: org, error: orgErr } = await ctx.supabase
      .from('organizations')
      .select('*')
      .eq('account_id', ctx.accountId)
      .ilike('name', `%${search}%`)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (orgErr) {
      console.error('[api/v1/organizations/briefing] org lookup error:', orgErr);
      return fail('internal', 'Failed to look up organization', 500);
    }
    if (!org) {
      return ok({ found: false, search }, 200);
    }

    const [contactsRes, meetingsRes] = await Promise.all([
      ctx.supabase
        .from('organization_contacts')
        .select('*, contact:contacts(*)')
        .eq('organization_id', org.id)
        .order('decision_level', { ascending: true }),
      ctx.supabase
        .from('meetings')
        .select('*')
        .eq('organization_id', org.id)
        .order('created_at', { ascending: false })
        .limit(10),
    ]);
    if (contactsRes.error) {
      console.error('[api/v1/organizations/briefing] contacts error:', contactsRes.error);
      return fail('internal', 'Failed to load organization contacts', 500);
    }
    if (meetingsRes.error) {
      console.error('[api/v1/organizations/briefing] meetings error:', meetingsRes.error);
      return fail('internal', 'Failed to load organization meetings', 500);
    }

    return ok(
      {
        found: true,
        organization: org,
        contacts: contactsRes.data ?? [],
        recent_meetings: meetingsRes.data ?? [],
      },
      200
    );
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
