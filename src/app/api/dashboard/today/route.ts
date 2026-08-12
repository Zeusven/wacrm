import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import type { Meeting, Organization, OrganizationContact } from '@/types';

const HIGH_DECISION_LEVELS = ['DECISOR', 'DECISOR_FINAL', 'SOCIO_PROPIETARIO', 'IT_DECISOR'];

export async function GET() {
  try {
    const ctx = await requireRole('viewer');
    const today = new Date().toISOString().slice(0, 10);

    const [meetingsRes, orgsRes, orgContactsRes] = await Promise.all([
      ctx.supabase
        .from('meetings')
        .select('*, contact:contacts(*), organization:organizations(*)')
        .lte('next_action_date', today)
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
    if (orgsRes.error) {
      return NextResponse.json({ error: orgsRes.error.message }, { status: 500 });
    }
    if (orgContactsRes.error) {
      return NextResponse.json({ error: orgContactsRes.error.message }, { status: 500 });
    }

    const dueMeetings = (meetingsRes.data ?? []) as Meeting[];
    const organizations = (orgsRes.data ?? []) as Organization[];
    const orgContacts = (orgContactsRes.data ?? []) as OrganizationContact[];

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
      organizations_without_contacts: organizationsWithoutContacts,
      decisors_missing_channel: decisorsMissingChannel,
      counters: {
        due_today_or_overdue: dueMeetings.length,
        organizations_without_contacts: organizationsWithoutContacts.length,
        decisors_identified: decisorsIdentified,
        decisors_missing_channel: decisorsMissingChannel.length,
      },
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
