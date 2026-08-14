'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  isToday,
  startOfMonth,
  startOfWeek,
} from 'date-fns';
import { es } from 'date-fns/locale';

import type { Meeting, Task, Reminder } from '@/types';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Users,
  ListChecks,
  BellRing,
} from 'lucide-react';

// A calendar cell mixes three different tables into one shape so the
// month grid doesn't need to know about meetings/tasks/reminders as
// distinct concepts — they're just "things that happen on a date",
// all optionally pointing at the same contact_id per migration 039.
interface CalendarItem {
  id: string;
  kind: 'meeting' | 'task' | 'reminder';
  date: string; // YYYY-MM-DD, local to whatever the source timestamp says
  title: string;
  contactId: string | null;
  organizationId: string | null;
  status: string;
}

const KIND_STYLES: Record<CalendarItem['kind'], { icon: typeof Users; className: string }> = {
  meeting: { icon: Users, className: 'bg-primary/15 text-primary' },
  task: { icon: ListChecks, className: 'bg-amber-500/15 text-amber-500' },
  reminder: { icon: BellRing, className: 'bg-violet-500/15 text-violet-400' },
};

function toDateKey(iso: string): string {
  // Meetings/tasks/reminders mix DATE-only columns (due_date,
  // next_action_date) with TIMESTAMPTZ ones (scheduled_at, remind_at).
  // Slicing the first 10 chars works for both: a bare 'YYYY-MM-DD'
  // already IS its own key, and an ISO timestamp's date prefix is the
  // *UTC* calendar day — close enough for a solo-operator's own
  // timezone-agnostic agenda, and avoids a timezone dependency here.
  return iso.slice(0, 10);
}

export default function CalendarPage() {
  const t = useTranslations('Calendar');
  const router = useRouter();

  const [cursor, setCursor] = useState(() => new Date());
  const [items, setItems] = useState<CalendarItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [meetingsRes, tasksRes, remindersRes] = await Promise.all([
        fetch('/api/meetings'),
        fetch('/api/tasks'),
        fetch('/api/reminders'),
      ]);
      const [meetingsBody, tasksBody, remindersBody] = await Promise.all([
        meetingsRes.json(),
        tasksRes.json(),
        remindersRes.json(),
      ]);
      if (!meetingsRes.ok) throw new Error(meetingsBody.error ?? t('loadError'));
      if (!tasksRes.ok) throw new Error(tasksBody.error ?? t('loadError'));
      if (!remindersRes.ok) throw new Error(remindersBody.error ?? t('loadError'));

      const meetingItems: CalendarItem[] = ((meetingsBody.meetings ?? []) as Meeting[])
        .filter((m) => m.scheduled_at || m.next_action_date)
        .map((m) => ({
          id: m.id,
          kind: 'meeting' as const,
          date: toDateKey((m.scheduled_at || m.next_action_date) as string),
          title:
            m.objective ||
            m.contact?.name ||
            m.organization?.name ||
            t('untitledMeeting'),
          contactId: m.contact_id ?? null,
          organizationId: m.organization_id ?? null,
          status: m.status,
        }));

      const taskItems: CalendarItem[] = ((tasksBody.tasks ?? []) as Task[])
        .filter((tk) => tk.due_date)
        .map((tk) => ({
          id: tk.id,
          kind: 'task' as const,
          date: toDateKey(tk.due_date as string),
          title: tk.title,
          contactId: tk.contact_id ?? null,
          organizationId: tk.organization_id ?? null,
          status: tk.status,
        }));

      const reminderItems: CalendarItem[] = ((remindersBody.reminders ?? []) as Reminder[]).map(
        (r) => ({
          id: r.id,
          kind: 'reminder' as const,
          date: toDateKey(r.remind_at),
          title: r.message,
          contactId: r.contact_id ?? null,
          organizationId: r.organization_id ?? null,
          status: r.status,
        })
      );

      setItems([...meetingItems, ...taskItems, ...reminderItems]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('loadError'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    load();
  }, [load]);

  const days = useMemo(() => {
    const monthStart = startOfMonth(cursor);
    const monthEnd = endOfMonth(cursor);
    const gridStart = startOfWeek(monthStart, { weekStartsOn: 1 });
    const gridEnd = endOfWeek(monthEnd, { weekStartsOn: 1 });
    return eachDayOfInterval({ start: gridStart, end: gridEnd });
  }, [cursor]);

  const itemsByDate = useMemo(() => {
    const map: Record<string, CalendarItem[]> = {};
    for (const item of items) {
      (map[item.date] ??= []).push(item);
    }
    return map;
  }, [items]);

  function openItem(item: CalendarItem) {
    if (item.contactId) {
      router.push(`/contacts?open=${item.contactId}`);
    } else if (item.organizationId) {
      router.push(`/organizations/${item.organizationId}`);
    }
  }

  const selectedItems = selectedDate ? (itemsByDate[selectedDate] ?? []) : [];

  return (
    <div className="flex flex-1 flex-col gap-4 p-4 md:p-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <CalendarDays className="h-5 w-5 text-muted-foreground" />
          <h1 className="text-xl font-semibold capitalize">
            {format(cursor, 'MMMM yyyy', { locale: es })}
          </h1>
        </div>
        <div className="flex items-center gap-1.5">
          <Button variant="outline" size="sm" onClick={() => setCursor(new Date())}>
            {t('today')}
          </Button>
          <Button
            variant="outline"
            size="icon"
            onClick={() => setCursor((d) => addMonths(d, -1))}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="icon" onClick={() => setCursor((d) => addMonths(d, 1))}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="flex flex-1 items-center justify-center p-6">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_280px]">
          <div className="rounded-md border overflow-hidden">
            <div className="grid grid-cols-7 border-b bg-muted/50 text-center text-xs font-semibold uppercase text-muted-foreground">
              {['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'].map((d) => (
                <div key={d} className="py-2">
                  {d}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-7">
              {days.map((day) => {
                const key = format(day, 'yyyy-MM-dd');
                const dayItems = itemsByDate[key] ?? [];
                const inMonth = isSameMonth(day, cursor);
                const selected = selectedDate === key;
                return (
                  <button
                    key={key}
                    onClick={() => setSelectedDate(key)}
                    className={`flex min-h-24 flex-col items-start gap-1 border-b border-r p-1.5 text-left transition-colors last:border-r-0 hover:bg-muted/40 ${
                      inMonth ? '' : 'bg-muted/20 text-muted-foreground/50'
                    } ${selected ? 'ring-1 ring-inset ring-primary' : ''}`}
                  >
                    <span
                      className={`text-xs font-medium ${
                        isToday(day)
                          ? 'flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground'
                          : ''
                      }`}
                    >
                      {format(day, 'd')}
                    </span>
                    <div className="flex w-full flex-col gap-0.5">
                      {dayItems.slice(0, 3).map((item) => {
                        const style = KIND_STYLES[item.kind];
                        return (
                          <span
                            key={item.id}
                            className={`truncate rounded px-1 py-0.5 text-[10px] font-medium ${style.className}`}
                            title={item.title}
                          >
                            {item.title}
                          </span>
                        );
                      })}
                      {dayItems.length > 3 && (
                        <span className="text-[10px] text-muted-foreground">
                          +{dayItems.length - 3} {t('more')}
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="rounded-md border p-3">
            <h2 className="mb-2 text-sm font-semibold">
              {selectedDate
                ? format(new Date(selectedDate + 'T00:00:00'), "d 'de' MMMM", { locale: es })
                : t('pickDay')}
            </h2>
            {!selectedDate ? (
              <p className="text-xs text-muted-foreground">{t('pickDayHint')}</p>
            ) : selectedItems.length === 0 ? (
              <p className="text-xs text-muted-foreground">{t('noItemsThisDay')}</p>
            ) : (
              <div className="flex flex-col gap-2">
                {selectedItems.map((item) => {
                  const style = KIND_STYLES[item.kind];
                  const Icon = style.icon;
                  return (
                    <button
                      key={item.id}
                      onClick={() => openItem(item)}
                      disabled={!item.contactId && !item.organizationId}
                      className="flex items-start gap-2 rounded-md border p-2 text-left hover:bg-muted/50 disabled:cursor-default disabled:hover:bg-transparent"
                    >
                      <span className={`mt-0.5 rounded p-1 ${style.className}`}>
                        <Icon className="h-3 w-3" />
                      </span>
                      <span className="flex-1 min-w-0">
                        <span className="block truncate text-sm">{item.title}</span>
                        <Badge variant="outline" className="mt-1 text-[10px]">
                          {item.status}
                        </Badge>
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
