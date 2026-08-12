'use client';

import { useState, useEffect, useCallback, use } from 'react';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';

import { createClient } from '@/lib/supabase/client';
import type {
  Organization,
  OrganizationDecisionMapRow,
  Meeting,
  DecisionLevel,
  RelationshipType,
  MeetingType,
} from '@/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Building2, Plus, Loader2, Users, CalendarClock, Target } from 'lucide-react';
import { useCan } from '@/hooks/use-can';
import { GatedButton } from '@/components/ui/gated-button';

const DECISION_LEVELS: DecisionLevel[] = [
  'NO_DETERMINADO', 'INFLUENCIADOR', 'REFERENTE', 'DECISOR', 'DECISOR_FINAL',
  'SOCIO_PROPIETARIO', 'DIRECCION', 'COMPRAS', 'IT_DECISOR', 'IT_INFLUENCIADOR',
];
const RELATIONSHIP_TYPES: RelationshipType[] = [
  'MEDICO_STAFF', 'DIRECTOR', 'GERENTE', 'ADMINISTRATIVO', 'SISTEMAS_IT',
  'COMPRAS', 'OPERACIONES', 'DIRECCION_MEDICA', 'SOCIO', 'DUENO',
  'REFERENTE', 'PROVEEDOR', 'EX_EMPLEADO', 'OTRO',
];
const MEETING_TYPES: MeetingType[] = ['PRESENCIAL', 'TELEFONICA', 'VIDEOLLAMADA'];

// Rank used to pick the "most senior" mapped decisor and to flag
// which decision-level contacts still need a direct channel found —
// deliberately deterministic (no AI), same criteria the /today
// cockpit uses, so a briefing never contradicts the daily view.
const DECISION_RANK: Record<DecisionLevel, number> = {
  DECISOR_FINAL: 0,
  SOCIO_PROPIETARIO: 1,
  DECISOR: 2,
  DIRECCION: 3,
  IT_DECISOR: 4,
  COMPRAS: 5,
  INFLUENCIADOR: 6,
  IT_INFLUENCIADOR: 7,
  REFERENTE: 8,
  NO_DETERMINADO: 9,
};
const HIGH_DECISION_LEVELS: DecisionLevel[] = [
  'DECISOR', 'DECISOR_FINAL', 'SOCIO_PROPIETARIO', 'IT_DECISOR',
];

interface Briefing {
  topContact: OrganizationDecisionMapRow | null;
  hasHighLevelDecisor: boolean;
  decisorsMissingChannel: OrganizationDecisionMapRow[];
  nextMeeting: Meeting | null;
  meetingCount: number;
}

function computeBriefing(
  decisionMap: OrganizationDecisionMapRow[],
  meetings: Meeting[]
): Briefing {
  const sorted = [...decisionMap].sort(
    (a, b) => DECISION_RANK[a.decision_level] - DECISION_RANK[b.decision_level]
  );
  const decisorsMissingChannel = decisionMap.filter(
    (row) =>
      HIGH_DECISION_LEVELS.includes(row.decision_level) &&
      !row.contact_phone &&
      !row.contact_email
  );
  const upcoming = meetings
    .filter((m) => m.next_action_date && m.status !== 'CANCELADA')
    .sort((a, b) => (a.next_action_date! < b.next_action_date! ? -1 : 1));

  return {
    topContact: sorted[0] ?? null,
    hasHighLevelDecisor: decisionMap.some((row) => HIGH_DECISION_LEVELS.includes(row.decision_level)),
    decisorsMissingChannel,
    nextMeeting: upcoming[0] ?? null,
    meetingCount: meetings.length,
  };
}

interface ContactOption {
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
}

export default function OrganizationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const t = useTranslations('Organizations');
  const canEdit = useCan('send-messages');
  const supabase = createClient();

  const [organization, setOrganization] = useState<Organization | null>(null);
  const [decisionMap, setDecisionMap] = useState<OrganizationDecisionMapRow[]>([]);
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [loading, setLoading] = useState(true);

  const [linkOpen, setLinkOpen] = useState(false);
  const [contactQuery, setContactQuery] = useState('');
  const [contactOptions, setContactOptions] = useState<ContactOption[]>([]);
  const [linkForm, setLinkForm] = useState({
    contact_id: '',
    cargo: '',
    area: '',
    decision_level: 'NO_DETERMINADO' as DecisionLevel,
    relationship_type: '' as RelationshipType | '',
  });
  const [linking, setLinking] = useState(false);

  const [meetingOpen, setMeetingOpen] = useState(false);
  const [meetingForm, setMeetingForm] = useState({
    contact_id: '',
    meeting_type: 'PRESENCIAL' as MeetingType,
    objective: '',
    channel: '',
    next_action: '',
    next_action_date: '',
  });
  const [savingMeeting, setSavingMeeting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [orgRes, meetingsRes] = await Promise.all([
        fetch(`/api/organizations/${id}`),
        fetch(`/api/meetings?organization_id=${id}`),
      ]);
      const orgBody = await orgRes.json();
      if (!orgRes.ok) throw new Error(orgBody.error ?? t('loadError'));
      const meetingsBody = await meetingsRes.json();

      setOrganization(orgBody.organization);
      setDecisionMap(orgBody.decision_map ?? []);
      setMeetings(meetingsBody.meetings ?? []);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('loadError'));
    } finally {
      setLoading(false);
    }
  }, [id, t]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!linkOpen) return;
    const timeout = setTimeout(async () => {
      const query = supabase
        .from('contacts')
        .select('id, name, phone, email')
        .order('name', { ascending: true })
        .limit(10);
      const { data } = contactQuery
        ? await query.ilike('name', `%${contactQuery}%`)
        : await query;
      setContactOptions((data ?? []) as ContactOption[]);
    }, 200);
    return () => clearTimeout(timeout);
  }, [contactQuery, linkOpen, supabase]);

  async function handleLinkContact() {
    if (!linkForm.contact_id) return;
    setLinking(true);
    try {
      const res = await fetch(`/api/organizations/${id}/contacts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...linkForm,
          relationship_type: linkForm.relationship_type || null,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? t('saveError'));
      toast.success(t('linkContactSuccess'));
      setLinkOpen(false);
      setLinkForm({
        contact_id: '', cargo: '', area: '',
        decision_level: 'NO_DETERMINADO', relationship_type: '',
      });
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('saveError'));
    } finally {
      setLinking(false);
    }
  }

  async function handleCreateMeeting() {
    setSavingMeeting(true);
    try {
      const res = await fetch('/api/meetings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...meetingForm,
          organization_id: id,
          contact_id: meetingForm.contact_id || null,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? t('saveError'));
      setMeetingOpen(false);
      setMeetingForm({
        contact_id: '', meeting_type: 'PRESENCIAL', objective: '',
        channel: '', next_action: '', next_action_date: '',
      });
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('saveError'));
    } finally {
      setSavingMeeting(false);
    }
  }

  if (loading || !organization) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const briefing = computeBriefing(decisionMap, meetings);

  return (
    <div className="flex flex-1 flex-col gap-4 p-4 md:p-6">
      <div className="flex items-center gap-2">
        <Building2 className="h-5 w-5 text-muted-foreground" />
        <h1 className="text-xl font-semibold">{organization.name}</h1>
        <Badge variant="outline">{organization.commercial_status}</Badge>
      </div>
      <div className="text-sm text-muted-foreground">
        {[organization.org_type, organization.locality, organization.province]
          .filter(Boolean)
          .join(' · ') || '—'}
      </div>

      <div className="rounded-md border bg-muted/30 p-4">
        <div className="mb-2 flex items-center gap-2 text-sm font-medium">
          <Target className="h-4 w-4 text-muted-foreground" />
          {t('briefingTitle')}
        </div>
        <div className="grid gap-2 text-sm md:grid-cols-2">
          <div>
            <span className="text-muted-foreground">{t('briefingNextAction')}: </span>
            {briefing.nextMeeting ? (
              <span className="font-medium">
                {briefing.nextMeeting.next_action ?? t('briefingFollowUp')}
                {briefing.nextMeeting.next_action_date &&
                  ` (${briefing.nextMeeting.next_action_date})`}
              </span>
            ) : (
              <span className="text-muted-foreground">{t('briefingNoNextAction')}</span>
            )}
          </div>
          <div>
            <span className="text-muted-foreground">{t('briefingTopContact')}: </span>
            {briefing.topContact ? (
              <span className="font-medium">
                {briefing.topContact.contact_name ?? briefing.topContact.contact_phone} (
                {briefing.topContact.decision_level})
              </span>
            ) : (
              <span className="text-muted-foreground">{t('briefingNoContacts')}</span>
            )}
          </div>
          <div>
            <span className="text-muted-foreground">{t('briefingKnown')}: </span>
            {decisionMap.length} {t('briefingPeopleMapped')}
            {briefing.hasHighLevelDecisor
              ? `, ${t('briefingHasDecisor')}`
              : `, ${t('briefingNoDecisor')}`}
            {briefing.meetingCount > 0
              ? `, ${briefing.meetingCount} ${t('briefingMeetingsLogged')}`
              : ''}
          </div>
          <div>
            <span className="text-muted-foreground">{t('briefingMissing')}: </span>
            {briefing.decisorsMissingChannel.length > 0 ? (
              <span className="font-medium text-amber-600 dark:text-amber-400">
                {briefing.decisorsMissingChannel.length} {t('briefingDecisorsNoChannel')}
              </span>
            ) : briefing.meetingCount === 0 ? (
              <span className="text-muted-foreground">{t('briefingNoMeetingsYet')}</span>
            ) : (
              <span className="text-muted-foreground">—</span>
            )}
          </div>
        </div>
      </div>

      <Tabs defaultValue="decisionMap">
        <TabsList>
          <TabsTrigger value="decisionMap">
            <Users className="mr-1.5 h-4 w-4" />
            {t('decisionMap')}
          </TabsTrigger>
          <TabsTrigger value="meetings">
            <CalendarClock className="mr-1.5 h-4 w-4" />
            {t('meetings')}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="decisionMap" className="space-y-3">
          <div className="flex justify-end">
            <GatedButton canAct={canEdit} gateReason="link contacts" onClick={() => setLinkOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              {t('addContact')}
            </GatedButton>
          </div>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('name')}</TableHead>
                  <TableHead>{t('cargo')}</TableHead>
                  <TableHead>{t('area')}</TableHead>
                  <TableHead>{t('decisionLevel')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {decisionMap.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="h-24 text-center text-muted-foreground">
                      {t('noContactsLinked')}
                    </TableCell>
                  </TableRow>
                ) : (
                  decisionMap.map((row) => (
                    <TableRow key={row.contact_id}>
                      <TableCell className="font-medium">
                        {row.contact_name ?? row.contact_phone ?? row.contact_email}
                      </TableCell>
                      <TableCell>{row.cargo ?? '—'}</TableCell>
                      <TableCell>{row.area ?? '—'}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{row.decision_level}</Badge>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        <TabsContent value="meetings" className="space-y-3">
          <div className="flex justify-end">
            <GatedButton canAct={canEdit} gateReason="log meetings" onClick={() => setMeetingOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              {t('newMeeting')}
            </GatedButton>
          </div>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('meetingType')}</TableHead>
                  <TableHead>{t('objective')}</TableHead>
                  <TableHead>{t('status')}</TableHead>
                  <TableHead>{t('nextAction')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {meetings.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="h-24 text-center text-muted-foreground">
                      {t('noMeetings')}
                    </TableCell>
                  </TableRow>
                ) : (
                  meetings.map((m) => (
                    <TableRow key={m.id}>
                      <TableCell>
                        {t(`meetingType${toPascal(m.meeting_type)}` as never)}
                      </TableCell>
                      <TableCell>{m.objective ?? '—'}</TableCell>
                      <TableCell>
                        <Badge variant="outline">
                          {t(`status${toPascal(m.status)}` as never)}
                        </Badge>
                      </TableCell>
                      <TableCell>{m.next_action ?? '—'}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </TabsContent>
      </Tabs>

      {/* Link contact dialog */}
      <Dialog open={linkOpen} onOpenChange={setLinkOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('addContact')}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <div className="grid gap-1.5">
              <Label>{t('name')}</Label>
              <Input
                placeholder={t('searchPlaceholder')}
                value={contactQuery}
                onChange={(e) => setContactQuery(e.target.value)}
              />
              <Select
                value={linkForm.contact_id}
                onValueChange={(v) => setLinkForm((f) => ({ ...f, contact_id: v ?? '' }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder={t('searchPlaceholder')} />
                </SelectTrigger>
                <SelectContent>
                  {contactOptions.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name ?? c.phone ?? c.email ?? c.id}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label>{t('cargo')}</Label>
                <Input
                  value={linkForm.cargo}
                  onChange={(e) => setLinkForm((f) => ({ ...f, cargo: e.target.value }))}
                />
              </div>
              <div className="grid gap-1.5">
                <Label>{t('area')}</Label>
                <Input
                  value={linkForm.area}
                  onChange={(e) => setLinkForm((f) => ({ ...f, area: e.target.value }))}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label>{t('decisionLevel')}</Label>
                <Select
                  value={linkForm.decision_level}
                  onValueChange={(v) =>
                    setLinkForm((f) => ({ ...f, decision_level: v as DecisionLevel }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DECISION_LEVELS.map((d) => (
                      <SelectItem key={d} value={d}>
                        {d}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label>{t('relationshipType')}</Label>
                <Select
                  value={linkForm.relationship_type}
                  onValueChange={(v) =>
                    setLinkForm((f) => ({ ...f, relationship_type: v as RelationshipType }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {RELATIONSHIP_TYPES.map((r) => (
                      <SelectItem key={r} value={r}>
                        {r}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLinkOpen(false)}>
              {t('cancel')}
            </Button>
            <Button onClick={handleLinkContact} disabled={linking || !linkForm.contact_id}>
              {linking ? <Loader2 className="h-4 w-4 animate-spin" /> : t('save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* New meeting dialog */}
      <Dialog open={meetingOpen} onOpenChange={setMeetingOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('newMeeting')}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <div className="grid gap-1.5">
              <Label>{t('meetingType')}</Label>
              <Select
                value={meetingForm.meeting_type}
                onValueChange={(v) =>
                  setMeetingForm((f) => ({ ...f, meeting_type: v as MeetingType }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MEETING_TYPES.map((mt) => (
                    <SelectItem key={mt} value={mt}>
                      {t(`meetingType${toPascal(mt)}` as never)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label>{t('objective')}</Label>
              <Input
                value={meetingForm.objective}
                onChange={(e) => setMeetingForm((f) => ({ ...f, objective: e.target.value }))}
                placeholder="CONSEGUIR_REUNION"
              />
            </div>
            <div className="grid gap-1.5">
              <Label>{t('nextAction')}</Label>
              <Input
                value={meetingForm.next_action}
                onChange={(e) => setMeetingForm((f) => ({ ...f, next_action: e.target.value }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMeetingOpen(false)}>
              {t('cancel')}
            </Button>
            <Button onClick={handleCreateMeeting} disabled={savingMeeting}>
              {savingMeeting ? <Loader2 className="h-4 w-4 animate-spin" /> : t('save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function toPascal(value: string): string {
  return value
    .toLowerCase()
    .split('_')
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join('');
}
