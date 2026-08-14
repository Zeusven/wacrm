// ============================================================
// GET /api/v1/agenda  — cross-institution commercial snapshot
// (scope: organizations:read)
//
// Answers the aggregate questions a single organization's briefing
// can't ("¿a quién visito hoy?", "¿qué instituciones están
// calientes?", "¿dónde todavía no encontré al decisor?") in one
// call, so the WhatsApp query agent doesn't have to chain N requests
// and merge them itself. Every list is capped and ordered by what
// matters most (soonest due date / highest potential).
// ============================================================

import { requireApiKey } from '@/lib/auth/api-context';
import { ok, fail, toApiErrorResponse } from '@/lib/api/v1/respond';

export async function GET(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'organizations:read');
    const todayIso = new Date().toISOString().slice(0, 10);

    const [meetingsRes, tasksRes, hotOrgsRes, orgContactsRes] = await Promise.all([
      // Follow-ups due today or overdue, not already cancelled.
      ctx.supabase
        .from('meetings')
        .select('id, objective, next_action, next_action_date, status, contact:contacts(id, name, phone), organization:organizations(id, name)')
        .eq('account_id', ctx.accountId)
        .neq('status', 'CANCELADA')
        .not('next_action_date', 'is', null)
        .lte('next_action_date', todayIso)
        .order('next_action_date', { ascending: true })
        .limit(20),
      ctx.supabase
        .from('tasks')
        .select('id, title, due_date, contact:contacts(id, name), organization:organizations(id, name)')
        .eq('account_id', ctx.accountId)
        .eq('status', 'PENDIENTE')
        .or(`due_date.is.null,due_date.lte.${todayIso}`)
        .order('due_date', { ascending: true, nullsFirst: false })
        .limit(20),
      // "Hot" institutions: explicit high/medium potential, most
      // recently touched first.
      ctx.supabase
        .from('organizations')
        .select('id, name, potential, commercial_status, updated_at')
        .eq('account_id', ctx.accountId)
        .in('potential', ['ALTO', 'MEDIO'])
        .order('updated_at', { ascending: false })
        .limit(15),
      // Every mapped person's decision_level, per institution — used
      // below to compute which institutions have NO confirmed
      // decisor yet (JS-side: a cross-table aggregate isn't natural
      // as a single PostgREST filter).
      ctx.supabase
        .from('organization_contacts')
        .select('organization_id, decision_level, organization:organizations!inner(id, name, account_id)')
        .eq('organization.account_id', ctx.accountId),
    ]);

    if (meetingsRes.error) {
      console.error('[api/v1/agenda] meetings error:', meetingsRes.error);
      return fail('internal', 'Failed to load pending meetings', 500);
    }
    if (tasksRes.error) {
      console.error('[api/v1/agenda] tasks error:', tasksRes.error);
      return fail('internal', 'Failed to load pending tasks', 500);
    }
    if (hotOrgsRes.error) {
      console.error('[api/v1/agenda] hot orgs error:', hotOrgsRes.error);
      return fail('internal', 'Failed to load hot organizations', 500);
    }
    if (orgContactsRes.error) {
      console.error('[api/v1/agenda] org contacts error:', orgContactsRes.error);
      return fail('internal', 'Failed to load organization contacts', 500);
    }

    const DECISOR_LEVELS = new Set(['DECISOR', 'DECISOR_FINAL', 'SOCIO_PROPIETARIO']);
    const byOrg = new Map<string, { id: string; name: string; hasDecisor: boolean }>();
    for (const row of orgContactsRes.data ?? []) {
      const org = Array.isArray(row.organization) ? row.organization[0] : row.organization;
      if (!org) continue;
      const entry = byOrg.get(org.id) ?? { id: org.id, name: org.name, hasDecisor: false };
      if (DECISOR_LEVELS.has(row.decision_level as string)) entry.hasDecisor = true;
      byOrg.set(org.id, entry);
    }
    const organizations_missing_decisor = Array.from(byOrg.values())
      .filter((o) => !o.hasDecisor)
      .map((o) => ({ id: o.id, name: o.name }))
      .slice(0, 15);

    return ok(
      {
        today: todayIso,
        meetings_pending: meetingsRes.data ?? [],
        tasks_pending: tasksRes.data ?? [],
        organizations_hot: hotOrgsRes.data ?? [],
        organizations_missing_decisor,
      },
      200
    );
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
