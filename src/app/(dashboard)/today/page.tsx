'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';

import type { Meeting, Organization, OrganizationContact } from '@/types';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { CalendarClock, CalendarDays, Building2, UserX, Loader2, ListChecks } from 'lucide-react';

interface TodayData {
  due_meetings: Meeting[];
  upcoming_by_date: Record<string, Meeting[]>;
  organizations_without_contacts: Organization[];
  decisors_missing_channel: OrganizationContact[];
  counters: {
    due_today_or_overdue: number;
    upcoming_this_week: number;
    organizations_without_contacts: number;
    decisors_identified: number;
    decisors_missing_channel: number;
  };
}

const DOW_LONG = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

function formatDayHeader(isoDate: string): string {
  const d = new Date(isoDate + 'T00:00:00Z');
  return `${DOW_LONG[d.getUTCDay()]} ${d.getUTCDate()}/${d.getUTCMonth() + 1}`;
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border p-4">
      <div className="text-2xl font-bold">{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

export default function TodayPage() {
  const t = useTranslations('Today');
  const router = useRouter();
  const [data, setData] = useState<TodayData | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/dashboard/today');
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? t('loadError'));
      setData(body as TodayData);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('loadError'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading || !data) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-4 p-4 md:p-6">
      <div className="flex items-center gap-2">
        <ListChecks className="h-5 w-5 text-muted-foreground" />
        <h1 className="text-xl font-semibold">{t('title')}</h1>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <StatCard label={t('statDue')} value={data.counters.due_today_or_overdue} />
        <StatCard label={t('weekTitle')} value={data.counters.upcoming_this_week} />
        <StatCard label={t('statOrgsWithoutContacts')} value={data.counters.organizations_without_contacts} />
        <StatCard label={t('statDecisorsIdentified')} value={data.counters.decisors_identified} />
        <StatCard label={t('statDecisorsMissingChannel')} value={data.counters.decisors_missing_channel} />
      </div>

      <div className="flex items-center gap-2 pt-2">
        <CalendarClock className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold">{t('dueTitle')}</h2>
      </div>
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('colOrganization')}</TableHead>
              <TableHead>{t('colNextAction')}</TableHead>
              <TableHead>{t('colDate')}</TableHead>
              <TableHead>{t('colStatus')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.due_meetings.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="h-20 text-center text-muted-foreground">
                  {t('noDue')}
                </TableCell>
              </TableRow>
            ) : (
              data.due_meetings.map((m) => (
                <TableRow
                  key={m.id}
                  className={m.organization_id ? 'cursor-pointer' : ''}
                  onClick={() =>
                    m.organization_id && router.push(`/organizations/${m.organization_id}`)
                  }
                >
                  <TableCell className="font-medium">
                    {m.organization?.name ?? m.contact?.name ?? '—'}
                  </TableCell>
                  <TableCell>{m.next_action ?? '—'}</TableCell>
                  <TableCell>{m.next_action_date ?? '—'}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{m.status}</Badge>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex items-center gap-2 pt-2">
        <CalendarDays className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold">{t('weekTitle')}</h2>
      </div>
      {Object.keys(data.upcoming_by_date).length === 0 ? (
        <div className="rounded-md border p-4 text-center text-sm text-muted-foreground">
          {t('noUpcoming')}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {Object.entries(data.upcoming_by_date)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([date, meetings]) => (
              <div key={date} className="rounded-md border">
                <div className="border-b bg-muted/50 px-3 py-2 text-xs font-semibold uppercase text-muted-foreground">
                  {formatDayHeader(date)}
                </div>
                <Table>
                  <TableBody>
                    {meetings.map((m) => (
                      <TableRow
                        key={m.id}
                        className={m.organization_id ? 'cursor-pointer' : ''}
                        onClick={() =>
                          m.organization_id && router.push(`/organizations/${m.organization_id}`)
                        }
                      >
                        <TableCell className="font-medium">
                          {m.organization?.name ?? m.contact?.name ?? '—'}
                        </TableCell>
                        <TableCell>{m.next_action ?? '—'}</TableCell>
                        <TableCell>
                          <Badge variant="outline">{m.status}</Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ))}
        </div>
      )}

      <div className="flex items-center gap-2 pt-2">
        <Building2 className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold">{t('orgsWithoutContactsTitle')}</h2>
      </div>
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('colOrganization')}</TableHead>
              <TableHead>{t('colType')}</TableHead>
              <TableHead>{t('colPotential')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.organizations_without_contacts.length === 0 ? (
              <TableRow>
                <TableCell colSpan={3} className="h-20 text-center text-muted-foreground">
                  {t('noGaps')}
                </TableCell>
              </TableRow>
            ) : (
              data.organizations_without_contacts.map((o) => (
                <TableRow
                  key={o.id}
                  className="cursor-pointer"
                  onClick={() => router.push(`/organizations/${o.id}`)}
                >
                  <TableCell className="font-medium">{o.name}</TableCell>
                  <TableCell>{o.org_type ?? '—'}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{o.potential}</Badge>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex items-center gap-2 pt-2">
        <UserX className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold">{t('decisorsMissingChannelTitle')}</h2>
      </div>
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('colContact')}</TableHead>
              <TableHead>{t('colOrganization')}</TableHead>
              <TableHead>{t('colDecisionLevel')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.decisors_missing_channel.length === 0 ? (
              <TableRow>
                <TableCell colSpan={3} className="h-20 text-center text-muted-foreground">
                  {t('noDecisorsMissingChannel')}
                </TableCell>
              </TableRow>
            ) : (
              data.decisors_missing_channel.map((oc) => (
                <TableRow
                  key={oc.id}
                  className="cursor-pointer"
                  onClick={() => router.push(`/organizations/${oc.organization_id}`)}
                >
                  <TableCell className="font-medium">
                    {oc.contact?.name ?? '—'}
                    {oc.cargo ? ` — ${oc.cargo}` : ''}
                  </TableCell>
                  <TableCell>{oc.organization?.name ?? '—'}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{oc.decision_level}</Badge>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
