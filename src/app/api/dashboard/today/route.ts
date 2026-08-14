import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import type { Meeting, Organization, OrganizationContact } from '@/types';

const HIGH_DECISION_LEVELS = ['DECISOR', 'DECISOR_FINAL', 'SOCIO_PROPIETARIO', 'IT_DECISOR'];

/** ISO date N days after `base` (both 'YYYY-MM-DD'), no timezone math needed
 *  since we only ever compare/format the date part. */
function addDays(base: string, days: number): string {
  const d = new Date(base + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export async function GET() {
  try {
    const ctx = await requireRole('viewer');
    const today = new Date().toISOString().slice(0, 10);
    const weekEnd = addDays(today, 7);

    const [meetingsRes, upcomingRes, orgsRes, orgContactsRes] = await Promise.all([
      ctx.supabase
        .from('meetings')
        .select('*, contact:contacts(*), organization:organizations(*)')
        .lte('next_action_date', today)
        .in('status', ['PROPUESTA', 'AGENDADA'])
        .order('next_action_date', { ascending: true }),
      // "Esta semana": next_action_date after today through +7 days —
      // the agenda view. Kept as a second query (not folded into the
      // overdue one) so the UI can render them as two distinct
      // sections without re-deriving "is this overdue" client-side.
      ctx.supabase
        .from('meetings')
        .select('*, contact:contacts(*), organization:organizations(*)')
        .gt('next_action_date', today)
        .lte('next_action_date', weekEnd)
        .in('status', ['PROPUESTA', 'AGENDADA'])
        .order('next_action_date', { ascending: true }),
      ctx.supabase.from('organizations').select('*'),
      ctx.supabase
        .from('organization_contacts')
        .select('*, contact:contacts(*), organization:organizations(name)'),
    ]);

    if (meetingsRes.error) {
      return NextResponse.json({ error: meetingsRes.error.message }, { status: 500 });
    }
    if (upcomingRes.error) {
      return NextResponse.json({ error: upcomingRes.error.message }, { status: 500 });
    }
    if (orgsRes.error) {
      return NextResponse.json({ error: orgsRes.error.message }, { status: 500 });
    }
    if (orgContactsRes.error) {
      return NextResponse.json({ error: orgContactsRes.error.message }, { status: 500 });
    }

    const dueMeetings = (meetingsRes.data ?? []) as Meeting[];
    const upcomingMeetings = (upcomingRes.data ?? []) as Meeting[];
    const organizations = (orgsRes.data ?? []) as Organization[];
    const orgContacts = (orgContactsRes.data ?? []) as OrganizationContact[];

    // Grouped by date so the UI renders a day-by-day agenda without
    // re-deriving the grouping key from a Meeting on the client.
    const upcomingByDate = upcomingMeetings.reduce<Record<string, Meeting[]>>((acc, m) => {
      const key = m.next_action_date as string;
      (acc[key] ??= []).push(m);
      return acc;
    }, {});

    const orgsWithContacts = new Set(orgContacts.map((oc) => oc.organization_id));
    const organizationsWithoutContacts = organizations.filter((o) => !orgsWithContacts.has(o.id));

    const decisorsMissingChannel = orgContacts.filter(
      (oc) =>
        HIGH_DECISION_LEVELS.includes(oc.decision_level) &&
        !oc.contact?.phone &&
        !oc.contact?.email
    );

    const decisorsIdentified = orgContacts.filter((oc) =>
      HIGH_DECISION_LEVELS.includes(oc.decision_level)
    ).length;

    return NextResponse.json({
      due_meetings: dueMeetings,
      upcoming_by_date: upcomingByDate,
      organizations_without_contacts: organizationsWithoutContacts,
      decisors_missing_channel: decisorsMissingChannel,
      counters: {
        due_today_or_overdue: dueMeetings.length,
        upcoming_this_week: upcomingMeetings.length,
        organizations_without_contacts: organizationsWithoutContacts.length,
        decisors_identified: decisorsIdentified,
        decisors_missing_channel: decisorsMissingChannel.length,
      },
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
