'use client';

import { useState, useEffect, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import { addContactTag, deleteContactTag } from '@/lib/contacts/tag-api';
import { useAuth } from '@/hooks/use-auth';
import { formatCurrency } from '@/lib/currency';
import { toast } from 'sonner';
import type { Contact, Tag, ContactTag, ContactNote, CustomField, ContactCustomValue, Deal, MessageTemplate, OrganizationContact, DecisionLevel, Task, Reminder, Meeting } from '@/types';
import {
  TemplatePicker,
  type TemplateSendValues,
} from '@/components/inbox/template-picker';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Phone,
  Mail,
  Building2,
  Copy,
  Check,
  Loader2,
  Plus,
  Trash2,
  Save,
  X,
  DollarSign,
  LayoutTemplate,
  BellRing,
  CalendarClock,
  CheckCircle2,
  Circle,
} from 'lucide-react';
import { useTranslations } from 'next-intl';

const DECISION_LEVELS: DecisionLevel[] = [
  'NO_DETERMINADO', 'INFLUENCIADOR', 'REFERENTE', 'DECISOR', 'DECISOR_FINAL',
  'SOCIO_PROPIETARIO', 'DIRECCION', 'COMPRAS', 'IT_DECISOR', 'IT_INFLUENCIADOR',
];

interface ContactDetailViewProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contactId: string | null;
  onUpdated: () => void;
}

export function ContactDetailView({
  open,
  onOpenChange,
  contactId,
  onUpdated,
}: ContactDetailViewProps) {
  const t = useTranslations('Contacts.detailView');
  const supabase = createClient();
  const { accountId, defaultCurrency } = useAuth();

  const [contact, setContact] = useState<Contact | null>(null);
  const [loading, setLoading] = useState(false);
  const [copiedPhone, setCopiedPhone] = useState(false);

  // Send template — lets the business initiate (or re-open) a conversation
  // with this contact by sending an approved template. The send route
  // find-or-creates the conversation, so no inbound message is required.
  const [templatePickerOpen, setTemplatePickerOpen] = useState(false);
  const [sendingTemplate, setSendingTemplate] = useState(false);

  // Details tab
  const [editName, setEditName] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editCompany, setEditCompany] = useState('');
  const [savingDetails, setSavingDetails] = useState(false);

  // Tags tab
  const [allTags, setAllTags] = useState<Tag[]>([]);
  const [contactTagIds, setContactTagIds] = useState<string[]>([]);
  const [savingTags, setSavingTags] = useState(false);

  // Notes tab
  const [notes, setNotes] = useState<ContactNote[]>([]);
  const [newNote, setNewNote] = useState('');
  const [savingNote, setSavingNote] = useState(false);
  const [loadingNotes, setLoadingNotes] = useState(false);

  // Custom fields tab
  const [customFields, setCustomFields] = useState<CustomField[]>([]);
  const [customValues, setCustomValues] = useState<Record<string, string>>({});
  const [savingCustom, setSavingCustom] = useState(false);
  const [loadingCustom, setLoadingCustom] = useState(false);

  // Deals tab
  const [deals, setDeals] = useState<Deal[]>([]);
  const [loadingDeals, setLoadingDeals] = useState(false);

  // Institución tab (migration 038) — link this contact to an
  // organization with cargo/área/nivel de decisión. Closes the "estoy
  // en la calle, cargo la tarjeta" loop in one screen instead of
  // requiring a trip through /organizations/[id] first.
  const [orgLinks, setOrgLinks] = useState<OrganizationContact[]>([]);
  const [loadingOrgLinks, setLoadingOrgLinks] = useState(false);
  const [orgQuery, setOrgQuery] = useState('');
  const [orgOptions, setOrgOptions] = useState<{ id: string; name: string }[]>([]);
  const [selectedOrgId, setSelectedOrgId] = useState('');
  const [linkCargo, setLinkCargo] = useState('');
  const [linkArea, setLinkArea] = useState('');
  const [linkDecisionLevel, setLinkDecisionLevel] = useState<DecisionLevel>('NO_DETERMINADO');
  const [savingOrgLink, setSavingOrgLink] = useState(false);

  // Tasks tab (migration 039) — the checklist for this contact. This
  // (plus Reminders/Meetings below) is what makes the contact card the
  // one place a "próximo movimiento" actually lives, instead of being
  // scattered across /today and free text.
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loadingTasks, setLoadingTasks] = useState(false);
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [newTaskDueDate, setNewTaskDueDate] = useState('');
  const [savingTask, setSavingTask] = useState(false);

  // Reminders tab (migration 039) — scheduled WhatsApp nudges sent by
  // /api/reminders/cron.
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [loadingReminders, setLoadingReminders] = useState(false);
  const [newReminderMessage, setNewReminderMessage] = useState('');
  const [newReminderAt, setNewReminderAt] = useState('');
  const [savingReminder, setSavingReminder] = useState(false);

  // Meetings tab — activities/reuniones tied to this contact.
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [loadingMeetings, setLoadingMeetings] = useState(false);

  const fetchContact = useCallback(async () => {
    if (!contactId) return;
    setLoading(true);

    const { data } = await supabase
      .from('contacts')
      .select('*')
      .eq('id', contactId)
      .single();

    if (data) {
      setContact(data);
      setEditName(data.name ?? '');
      setEditPhone(data.phone ?? '');
      setEditEmail(data.email ?? '');
      setEditCompany(data.company ?? '');
    }
    setLoading(false);
  }, [contactId, supabase]);

  const fetchTags = useCallback(async () => {
    if (!contactId) return;

    const [tagsRes, contactTagsRes] = await Promise.all([
      supabase.from('tags').select('*').order('name'),
      supabase.from('contact_tags').select('tag_id').eq('contact_id', contactId),
    ]);

    if (tagsRes.data) setAllTags(tagsRes.data);
    if (contactTagsRes.data) {
      setContactTagIds(contactTagsRes.data.map((ct) => ct.tag_id));
    }
  }, [contactId, supabase]);

  const fetchNotes = useCallback(async () => {
    if (!contactId) return;
    setLoadingNotes(true);

    const { data } = await supabase
      .from('contact_notes')
      .select('*')
      .eq('contact_id', contactId)
      .order('created_at', { ascending: false });

    if (data) setNotes(data);
    setLoadingNotes(false);
  }, [contactId, supabase]);

  const fetchCustomFields = useCallback(async () => {
    if (!contactId) return;
    setLoadingCustom(true);

    const [fieldsRes, valuesRes] = await Promise.all([
      supabase.from('custom_fields').select('*').order('field_name'),
      supabase
        .from('contact_custom_values')
        .select('*')
        .eq('contact_id', contactId),
    ]);

    if (fieldsRes.data) setCustomFields(fieldsRes.data);
    if (valuesRes.data) {
      const map: Record<string, string> = {};
      valuesRes.data.forEach((v) => {
        map[v.custom_field_id] = v.value ?? '';
      });
      setCustomValues(map);
    }
    setLoadingCustom(false);
  }, [contactId, supabase]);

  const fetchDeals = useCallback(async () => {
    if (!contactId) return;
    setLoadingDeals(true);
    const { data } = await supabase
      .from('deals')
      .select('*, stage:pipeline_stages(*)')
      .eq('contact_id', contactId)
      .order('created_at', { ascending: false });
    setDeals((data ?? []) as Deal[]);
    setLoadingDeals(false);
  }, [contactId, supabase]);

  const fetchOrgLinks = useCallback(async () => {
    if (!contactId) return;
    setLoadingOrgLinks(true);
    const { data } = await supabase
      .from('organization_contacts')
      .select('*, organization:organizations(*)')
      .eq('contact_id', contactId)
      .order('created_at', { ascending: false });
    setOrgLinks((data ?? []) as OrganizationContact[]);
    setLoadingOrgLinks(false);
  }, [contactId, supabase]);

  const fetchTasks = useCallback(async () => {
    if (!contactId) return;
    setLoadingTasks(true);
    const res = await fetch(`/api/tasks?contact_id=${contactId}`);
    const body = await res.json().catch(() => ({}));
    setTasks(res.ok ? ((body.tasks ?? []) as Task[]) : []);
    setLoadingTasks(false);
  }, [contactId]);

  const fetchReminders = useCallback(async () => {
    if (!contactId) return;
    setLoadingReminders(true);
    const res = await fetch(`/api/reminders?contact_id=${contactId}`);
    const body = await res.json().catch(() => ({}));
    setReminders(res.ok ? ((body.reminders ?? []) as Reminder[]) : []);
    setLoadingReminders(false);
  }, [contactId]);

  const fetchMeetings = useCallback(async () => {
    if (!contactId) return;
    setLoadingMeetings(true);
    const res = await fetch(`/api/meetings?contact_id=${contactId}`);
    const body = await res.json().catch(() => ({}));
    setMeetings(res.ok ? ((body.meetings ?? []) as Meeting[]) : []);
    setLoadingMeetings(false);
  }, [contactId]);

  async function addTask() {
    if (!contactId || !newTaskTitle.trim()) return;
    setSavingTask(true);
    try {
      const res = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contact_id: contactId,
          title: newTaskTitle.trim(),
          due_date: newTaskDueDate || null,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? 'Error');
      setNewTaskTitle('');
      setNewTaskDueDate('');
      await fetchTasks();
      toast.success(t('tasksTab.added', { fallback: 'Tarea agregada' }));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Error');
    } finally {
      setSavingTask(false);
    }
  }

  async function toggleTaskDone(task: Task) {
    const nextStatus = task.status === 'HECHA' ? 'PENDIENTE' : 'HECHA';
    setTasks((prev) =>
      prev.map((t2) => (t2.id === task.id ? { ...t2, status: nextStatus } : t2))
    );
    try {
      const res = await fetch(`/api/tasks/${task.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: nextStatus }),
      });
      if (!res.ok) throw new Error();
    } catch {
      toast.error(t('toastUpdateFailed'));
      await fetchTasks();
    }
  }

  async function deleteTask(taskId: string) {
    await fetch(`/api/tasks/${taskId}`, { method: 'DELETE' });
    setTasks((prev) => prev.filter((t2) => t2.id !== taskId));
  }

  async function addReminder() {
    if (!contactId || !newReminderMessage.trim() || !newReminderAt) return;
    setSavingReminder(true);
    try {
      const res = await fetch('/api/reminders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contact_id: contactId,
          message: newReminderMessage.trim(),
          remind_at: new Date(newReminderAt).toISOString(),
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? 'Error');
      setNewReminderMessage('');
      setNewReminderAt('');
      await fetchReminders();
      toast.success(t('remindersTab.added', { fallback: 'Recordatorio programado' }));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Error');
    } finally {
      setSavingReminder(false);
    }
  }

  async function cancelReminder(reminderId: string) {
    await fetch(`/api/reminders/${reminderId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'CANCELADO' }),
    });
    setReminders((prev) =>
      prev.map((r) => (r.id === reminderId ? { ...r, status: 'CANCELADO' } : r))
    );
  }

  useEffect(() => {
    const timeout = setTimeout(async () => {
      if (!orgQuery.trim()) {
        setOrgOptions([]);
        return;
      }
      const { data } = await supabase
        .from('organizations')
        .select('id, name')
        .ilike('name', `%${orgQuery}%`)
        .order('name', { ascending: true })
        .limit(10);
      setOrgOptions((data ?? []) as { id: string; name: string }[]);
    }, 200);
    return () => clearTimeout(timeout);
  }, [orgQuery, supabase]);

  async function handleLinkOrganization() {
    if (!contactId) return;
    const name = orgQuery.trim();
    if (!selectedOrgId && !name) return;
    setSavingOrgLink(true);
    try {
      let organizationId = selectedOrgId;
      if (!organizationId) {
        const createRes = await fetch('/api/organizations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name }),
        });
        const createBody = await createRes.json();
        if (!createRes.ok) throw new Error(createBody.error ?? 'Error');
        organizationId = createBody.organization.id;
      }
      const linkRes = await fetch(`/api/organizations/${organizationId}/contacts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contact_id: contactId,
          cargo: linkCargo || null,
          area: linkArea || null,
          decision_level: linkDecisionLevel,
        }),
      });
      const linkBody = await linkRes.json();
      if (!linkRes.ok) throw new Error(linkBody.error ?? 'Error');
      toast.success(t('orgTab.linkSuccess', { fallback: 'Institución vinculada' }));
      setOrgQuery('');
      setSelectedOrgId('');
      setLinkCargo('');
      setLinkArea('');
      setLinkDecisionLevel('NO_DETERMINADO');
      await fetchOrgLinks();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Error');
    } finally {
      setSavingOrgLink(false);
    }
  }

  useEffect(() => {
    if (open && contactId) {
      fetchContact();
      fetchTags();
      fetchNotes();
      fetchCustomFields();
      fetchDeals();
      fetchOrgLinks();
      fetchTasks();
      fetchReminders();
      fetchMeetings();
    }
  }, [
    open,
    contactId,
    fetchContact,
    fetchTags,
    fetchNotes,
    fetchCustomFields,
    fetchDeals,
    fetchOrgLinks,
    fetchTasks,
    fetchReminders,
    fetchMeetings,
  ]);

  async function copyPhone() {
    if (!contact) return;
    await navigator.clipboard.writeText(contact.phone ?? "");
    setCopiedPhone(true);
    setTimeout(() => setCopiedPhone(false), 2000);
  }

  async function saveDetails() {
    if (!contactId) return;
    // Migration 038: phone is optional — a contact known only by
    // email (a Sistemas/IT decisor before their WhatsApp is on hand)
    // must still be editable. Require *one* of phone/email, same
    // check as the create form (contact-form.tsx), not phone alone.
    if (!editPhone.trim() && !editEmail.trim()) {
      toast.error(t('toastPhoneOrEmailRequired', { fallback: 'Cargá teléfono o email' }));
      return;
    }

    setSavingDetails(true);
    const { error } = await supabase
      .from('contacts')
      .update({
        name: editName.trim() || null,
        phone: editPhone.trim() || null,
        email: editEmail.trim() || null,
        company: editCompany.trim() || null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', contactId);

    if (error) {
      toast.error(t('toastUpdateFailed'));
    } else {
      toast.success(t('toastUpdated'));
      fetchContact();
      onUpdated();
    }
    setSavingDetails(false);
  }

  async function toggleTag(tagId: string) {
    if (!contactId) return;
    setSavingTags(true);

    const isSelected = contactTagIds.includes(tagId);

    try {
      if (isSelected) {
        await deleteContactTag(contactId, tagId);
        setContactTagIds((prev) => prev.filter((id) => id !== tagId));
      } else {
        await addContactTag(contactId, tagId);
        setContactTagIds((prev) => [...prev, tagId]);
      }
      onUpdated();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('toastUpdateFailed'));
    }
    setSavingTags(false);
  }

  async function addNote() {
    if (!contactId || !newNote.trim()) return;
    setSavingNote(true);

    const {
      data: { session },
    } = await supabase.auth.getSession();
    const user = session?.user;
    if (!user || !accountId) {
      toast.error(t('toastNotAuthenticated'));
      setSavingNote(false);
      return;
    }

    const { error } = await supabase.from('contact_notes').insert({
      contact_id: contactId,
      account_id: accountId,
      user_id: user.id,
      note_text: newNote.trim(),
    });

    if (error) {
      toast.error(t('toastNoteAddFailed'));
    } else {
      setNewNote('');
      fetchNotes();
      toast.success(t('toastNoteAdded'));
    }
    setSavingNote(false);
  }

  async function deleteNote(noteId: string) {
    const { error } = await supabase
      .from('contact_notes')
      .delete()
      .eq('id', noteId);

    if (error) {
      toast.error(t('toastNoteDeleteFailed'));
    } else {
      setNotes((prev) => prev.filter((n) => n.id !== noteId));
      toast.success(t('toastNoteDeleted'));
    }
  }

  async function saveCustomFields() {
    if (!contactId) return;
    setSavingCustom(true);

    try {
      // Delete existing values and re-insert
      await supabase
        .from('contact_custom_values')
        .delete()
        .eq('contact_id', contactId);

      const rows = Object.entries(customValues)
        .filter(([, val]) => val.trim())
        .map(([fieldId, val]) => ({
          contact_id: contactId,
          custom_field_id: fieldId,
          value: val.trim(),
        }));

      if (rows.length > 0) {
        const { error } = await supabase
          .from('contact_custom_values')
          .insert(rows);
        if (error) throw error;
      }

      toast.success(t('toastCustomFieldsSaved'));
    } catch {
      toast.error(t('toastCustomFieldsFailed'));
    }
    setSavingCustom(false);
  }

  async function handleSendTemplate(
    template: MessageTemplate,
    values: TemplateSendValues,
  ) {
    if (!contactId) return;
    setSendingTemplate(true);
    try {
      const res = await fetch('/api/whatsapp/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          // No conversation_id — the route find-or-creates one for this
          // contact, mirroring the inbox template-send payload otherwise.
          contact_id: contactId,
          message_type: 'template',
          template_name: template.name,
          template_language: template.language,
          template_message_params: {
            body: values.body,
            headerText: values.headerText,
            buttonParams: values.buttonParams,
          },
          template_params: values.body,
        }),
      });

      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        const reason = payload?.error || `HTTP ${res.status}`;
        toast.error(t('toastTemplateFailed', { reason }));
        return;
      }

      toast.success(t('toastTemplateSent', { name: template.name }));
    } catch (err) {
      const reason = err instanceof Error ? err.message : 'network error';
      toast.error(`Failed to send template: ${reason}`);
    } finally {
      setSendingTemplate(false);
    }
  }

  function getInitials(name?: string | null) {
    if (!name) return '?';
    return name
      .split(' ')
      .map((w) => w[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  }

  return (
    <>
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="bg-popover border-border text-popover-foreground sm:max-w-lg w-full p-0"
      >
        {loading || !contact ? (
          <div className="flex items-center justify-center h-full">
            <Loader2 className="size-6 animate-spin text-primary" />
          </div>
        ) : (
          <div className="flex flex-col h-full">
            {/* Header */}
            <SheetHeader className="p-4 border-b border-border/50">
              <div className="flex items-center gap-3">
                <Avatar className="size-12 bg-muted border border-border">
                  <AvatarFallback className="bg-primary/10 text-primary text-sm font-medium">
                    {getInitials(contact.name)}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <SheetTitle className="text-popover-foreground truncate">
                    {contact.name || t('unnamed')}
                  </SheetTitle>
                  <SheetDescription className="text-muted-foreground text-xs mt-0.5">
                    {t('contactDetailsDesc')}
                  </SheetDescription>
                  <div className="flex flex-wrap items-center gap-3 mt-1.5 text-xs text-muted-foreground">
                    {contact.phone ? (
                      <button
                        onClick={copyPhone}
                        className="flex items-center gap-1 hover:text-primary transition-colors cursor-pointer"
                      >
                        <Phone className="size-3" />
                        {contact.phone}
                        {copiedPhone ? (
                          <Check className="size-3 text-primary" />
                        ) : (
                          <Copy className="size-3" />
                        )}
                      </button>
                    ) : (
                      <span className="flex items-center gap-1 italic">
                        <Phone className="size-3" />
                        {t('noPhone', { fallback: 'Sin teléfono' })}
                      </span>
                    )}
                    {contact.email && (
                      <span className="flex items-center gap-1">
                        <Mail className="size-3" />
                        {contact.email}
                      </span>
                    )}
                    {contact.company && (
                      <span className="flex items-center gap-1">
                        <Building2 className="size-3" />
                        {contact.company}
                      </span>
                    )}
                  </div>
                </div>
              </div>
              <div className="mt-3">
                <Button
                  size="sm"
                  onClick={() => setTemplatePickerOpen(true)}
                  disabled={sendingTemplate}
                  className="bg-primary text-primary-foreground hover:bg-primary/90"
                >
                  {sendingTemplate ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <LayoutTemplate className="size-4" />
                  )}
                  {t('sendTemplateBtn')}
                </Button>
              </div>
            </SheetHeader>

            {/* Tabs */}
            <Tabs defaultValue="details" className="flex-1 flex flex-col min-h-0">
              <TabsList className="bg-muted/50 border-b border-border mx-4 mt-3">
                <TabsTrigger
                  value="details"
                  className="data-active:bg-muted data-active:text-primary text-muted-foreground"
                >
                  {t('tabs.details')}
                </TabsTrigger>
                <TabsTrigger
                  value="tags"
                  className="data-active:bg-muted data-active:text-primary text-muted-foreground"
                >
                  {t('tabs.tags', { fallback: 'Tags' })}
                </TabsTrigger>
                <TabsTrigger
                  value="notes"
                  className="data-active:bg-muted data-active:text-primary text-muted-foreground"
                >
                  {t('tabs.notes')}
                </TabsTrigger>
                <TabsTrigger
                  value="custom"
                  className="data-active:bg-muted data-active:text-primary text-muted-foreground"
                >
                  {t('tabs.custom')}
                </TabsTrigger>
                <TabsTrigger
                  value="deals"
                  className="data-active:bg-muted data-active:text-primary text-muted-foreground"
                >
                  {t('tabs.deals')}
                </TabsTrigger>
                <TabsTrigger
                  value="organization"
                  className="data-active:bg-muted data-active:text-primary text-muted-foreground"
                >
                  {t('tabs.organization', { fallback: 'Institución' })}
                </TabsTrigger>
                <TabsTrigger
                  value="tasks"
                  className="data-active:bg-muted data-active:text-primary text-muted-foreground"
                >
                  {t('tabs.tasks', { fallback: 'Tareas' })}
                </TabsTrigger>
                <TabsTrigger
                  value="reminders"
                  className="data-active:bg-muted data-active:text-primary text-muted-foreground"
                >
                  {t('tabs.reminders', { fallback: 'Recordatorios' })}
                </TabsTrigger>
                <TabsTrigger
                  value="meetings"
                  className="data-active:bg-muted data-active:text-primary text-muted-foreground"
                >
                  {t('tabs.meetings', { fallback: 'Reuniones' })}
                </TabsTrigger>
              </TabsList>

              {/* Details Tab */}
              <TabsContent value="details" className="flex-1 overflow-y-auto px-4 py-3">
                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <Label className="text-muted-foreground text-xs">{t('name', { fallback: 'Nombre' })}</Label>
                    <Input
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      className="bg-muted border-border text-foreground h-8 text-sm"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-muted-foreground text-xs">
                      {t('phone')}
                    </Label>
                    <Input
                      value={editPhone}
                      onChange={(e) => setEditPhone(e.target.value)}
                      className="bg-muted border-border text-foreground h-8 text-sm"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-muted-foreground text-xs">{t('email')}</Label>
                    <Input
                      value={editEmail}
                      onChange={(e) => setEditEmail(e.target.value)}
                      className="bg-muted border-border text-foreground h-8 text-sm"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-muted-foreground text-xs">{t('company')}</Label>
                    <Input
                      value={editCompany}
                      onChange={(e) => setEditCompany(e.target.value)}
                      className="bg-muted border-border text-foreground h-8 text-sm"
                    />
                  </div>
                  <Button
                    onClick={saveDetails}
                    disabled={savingDetails}
                    className="bg-primary hover:bg-primary/90 text-primary-foreground w-full"
                    size="sm"
                  >
                    {savingDetails ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <Save className="size-3.5" />
                    )}
                    {t('saveChangesBtn')}
                  </Button>
                </div>
              </TabsContent>

              {/* Tags Tab */}
              <TabsContent value="tags" className="flex-1 overflow-y-auto px-4 py-3">
                <div className="space-y-3">
                  <p className="text-xs text-muted-foreground">
                    {t('tagsTab.clickTagDesc')}
                  </p>
                  {allTags.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      {t('tagsTab.noTagsAvailable')}
                    </p>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {allTags.map((tag) => {
                        const selected = contactTagIds.includes(tag.id);
                        return (
                          <button
                            key={tag.id}
                            onClick={() => toggleTag(tag.id)}
                            disabled={savingTags}
                            className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium transition-all cursor-pointer ${
                              selected
                                ? 'ring-2 ring-primary ring-offset-1 ring-offset-border'
                                : 'opacity-50 hover:opacity-80'
                            }`}
                            style={{
                              backgroundColor: tag.color + '20',
                              color: tag.color,
                            }}
                          >
                            {selected && <Check className="size-3 mr-1" />}
                            {tag.name}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </TabsContent>

              {/* Notes Tab */}
              <TabsContent value="notes" className="flex-1 flex flex-col min-h-0 px-4 py-3">
                <div className="space-y-2 mb-3">
                  <Textarea
                    value={newNote}
                    onChange={(e) => setNewNote(e.target.value)}
                    placeholder={t('notesTab.placeholder')}
                    className="bg-muted border-border text-foreground placeholder:text-muted-foreground min-h-[60px] text-sm resize-none"
                  />
                  <Button
                    onClick={addNote}
                    disabled={!newNote.trim() || savingNote}
                    className="bg-primary hover:bg-primary/90 text-primary-foreground"
                    size="sm"
                  >
                    {savingNote ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <Plus className="size-3.5" />
                    )}
                    {t('notesTab.save')}
                  </Button>
                </div>

                <div className="flex-1 overflow-y-auto space-y-2">
                  {loadingNotes ? (
                    <div className="flex items-center justify-center py-8">
                      <Loader2 className="size-5 animate-spin text-muted-foreground" />
                    </div>
                  ) : notes.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-8">
                      {t('notesTab.noNotes')}
                    </p>
                  ) : (
                    notes.map((note) => (
                      <div
                        key={note.id}
                        className="rounded-lg bg-muted/50 border border-border/50 p-3 group"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-sm text-muted-foreground whitespace-pre-wrap flex-1">
                            {note.note_text}
                          </p>
                          <button
                            onClick={() => deleteNote(note.id)}
                            className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-red-400 transition-all cursor-pointer shrink-0"
                          >
                            <Trash2 className="size-3.5" />
                          </button>
                        </div>
                        <p className="text-xs text-muted-foreground mt-1.5">
                          {new Date(note.created_at).toLocaleDateString('en-US', {
                            month: 'short',
                            day: 'numeric',
                            year: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </p>
                      </div>
                    ))
                  )}
                </div>
              </TabsContent>

              {/* Custom Fields Tab */}
              <TabsContent value="custom" className="flex-1 overflow-y-auto px-4 py-3">
                {loadingCustom ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="size-5 animate-spin text-muted-foreground" />
                  </div>
                ) : customFields.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-8">
                    {t('noCustomFields')}
                  </p>
                ) : (
                  <div className="space-y-3">
                    {customFields.map((field) => (
                      <div key={field.id} className="space-y-1.5">
                        <Label className="text-muted-foreground text-xs capitalize">
                          {field.field_name}
                        </Label>
                        <Input
                          value={customValues[field.id] ?? ''}
                          onChange={(e) =>
                            setCustomValues((prev) => ({
                              ...prev,
                              [field.id]: e.target.value,
                            }))
                          }
                          placeholder={t('enterCustomField', { name: field.field_name })}
                          className="bg-muted border-border text-foreground h-8 text-sm placeholder:text-muted-foreground"
                        />
                      </div>
                    ))}
                    <Button
                      onClick={saveCustomFields}
                      disabled={savingCustom}
                      className="bg-primary hover:bg-primary/90 text-primary-foreground w-full"
                      size="sm"
                    >
                      {savingCustom ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : (
                        <Save className="size-3.5" />
                      )}
                      {t('saveCustomFieldsBtn')}
                    </Button>
                  </div>
                )}
              </TabsContent>

              {/* Deals Tab */}
              <TabsContent value="deals" className="flex-1 overflow-y-auto px-4 py-3">
                {loadingDeals ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="size-5 animate-spin text-primary" />
                  </div>
                ) : deals.length === 0 ? (
                  <p className="text-xs text-muted-foreground">{t('dealsTab.noDeals')}</p>
                ) : (
                  <div className="space-y-2">
                    {deals.map((deal) => (
                      <div
                        key={deal.id}
                        className="rounded-lg border border-border bg-muted/50 p-3"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-sm font-medium text-foreground">
                            {deal.title}
                          </p>
                          {deal.stage && (
                            <span
                              className="shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium"
                              style={{
                                backgroundColor: `${deal.stage.color}20`,
                                color: deal.stage.color,
                              }}
                            >
                              {deal.stage.name}
                            </span>
                          )}
                        </div>
                        <div className="mt-1.5 flex items-center justify-between text-xs text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <DollarSign className="size-3" />
                            {formatCurrency(
                              deal.value ?? 0,
                              deal.currency || defaultCurrency,
                            )}
                          </span>
                          {deal.status && deal.status !== 'open' && (
                            <span
                              className={
                                deal.status === 'won'
                                  ? 'text-primary'
                                  : 'text-red-400'
                              }
                            >
                              {deal.status}
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </TabsContent>

              {/* Institución Tab (migration 038) */}
              <TabsContent value="organization" className="flex-1 overflow-y-auto px-4 py-3">
                <div className="space-y-4">
                  {loadingOrgLinks ? (
                    <div className="flex items-center justify-center py-8">
                      <Loader2 className="size-5 animate-spin text-primary" />
                    </div>
                  ) : orgLinks.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      {t('orgTab.noOrganizations', { fallback: 'Sin institución vinculada' })}
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {orgLinks.map((link) => (
                        <div
                          key={link.id}
                          className="rounded-lg border border-border bg-muted/50 p-3"
                        >
                          <div className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                            <Building2 className="size-3.5 text-muted-foreground" />
                            {link.organization?.name}
                          </div>
                          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                            {link.cargo && <span>{link.cargo}</span>}
                            {link.area && <span>{link.area}</span>}
                            <span>{link.decision_level}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="space-y-2 border-t border-border pt-3">
                    <Label className="text-muted-foreground text-xs">
                      {t('orgTab.addOrganization', { fallback: 'Vincular institución' })}
                    </Label>
                    <Input
                      placeholder={t('orgTab.searchPlaceholder', {
                        fallback: 'Buscar o crear institución...',
                      })}
                      value={orgQuery}
                      onChange={(e) => {
                        setOrgQuery(e.target.value);
                        setSelectedOrgId('');
                      }}
                      className="bg-muted border-border text-foreground h-8 text-sm"
                    />
                    {orgOptions.length > 0 && !selectedOrgId && (
                      <div className="rounded-md border border-border bg-popover">
                        {orgOptions.map((opt) => (
                          <button
                            key={opt.id}
                            type="button"
                            onClick={() => {
                              setSelectedOrgId(opt.id);
                              setOrgQuery(opt.name);
                              setOrgOptions([]);
                            }}
                            className="block w-full px-2.5 py-1.5 text-left text-xs text-popover-foreground hover:bg-muted"
                          >
                            {opt.name}
                          </button>
                        ))}
                      </div>
                    )}
                    <div className="grid grid-cols-2 gap-2">
                      <Input
                        placeholder={t('orgTab.cargo', { fallback: 'Cargo' })}
                        value={linkCargo}
                        onChange={(e) => setLinkCargo(e.target.value)}
                        className="bg-muted border-border text-foreground h-8 text-sm"
                      />
                      <Input
                        placeholder={t('orgTab.area', { fallback: 'Área' })}
                        value={linkArea}
                        onChange={(e) => setLinkArea(e.target.value)}
                        className="bg-muted border-border text-foreground h-8 text-sm"
                      />
                    </div>
                    <Select
                      value={linkDecisionLevel}
                      onValueChange={(v) => setLinkDecisionLevel((v ?? 'NO_DETERMINADO') as DecisionLevel)}
                    >
                      <SelectTrigger className="h-8 text-sm">
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
                    <Button
                      size="sm"
                      className="w-full"
                      disabled={savingOrgLink || (!selectedOrgId && !orgQuery.trim())}
                      onClick={handleLinkOrganization}
                    >
                      {savingOrgLink ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        t('orgTab.link', { fallback: 'Vincular' })
                      )}
                    </Button>
                  </div>
                </div>
              </TabsContent>

              {/* Tasks Tab (migration 039) */}
              <TabsContent value="tasks" className="flex-1 overflow-y-auto px-4 py-3">
                <div className="space-y-3">
                  <div className="flex gap-2">
                    <Input
                      placeholder={t('tasksTab.placeholder', { fallback: 'Nueva tarea…' })}
                      value={newTaskTitle}
                      onChange={(e) => setNewTaskTitle(e.target.value)}
                      className="bg-muted border-border text-foreground h-8 text-sm flex-1"
                    />
                    <Input
                      type="date"
                      value={newTaskDueDate}
                      onChange={(e) => setNewTaskDueDate(e.target.value)}
                      className="bg-muted border-border text-foreground h-8 text-sm w-36"
                    />
                    <Button
                      size="sm"
                      disabled={!newTaskTitle.trim() || savingTask}
                      onClick={addTask}
                    >
                      {savingTask ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : (
                        <Plus className="size-3.5" />
                      )}
                    </Button>
                  </div>

                  {loadingTasks ? (
                    <div className="flex items-center justify-center py-8">
                      <Loader2 className="size-5 animate-spin text-primary" />
                    </div>
                  ) : tasks.length === 0 ? (
                    <p className="text-xs text-muted-foreground text-center py-8">
                      {t('tasksTab.noTasks', { fallback: 'Sin tareas para este contacto' })}
                    </p>
                  ) : (
                    <div className="space-y-1.5">
                      {tasks.map((task) => (
                        <div
                          key={task.id}
                          className="flex items-start gap-2 rounded-lg border border-border bg-muted/50 p-2.5 group"
                        >
                          <button
                            onClick={() => toggleTaskDone(task)}
                            className="mt-0.5 shrink-0 text-muted-foreground hover:text-primary cursor-pointer"
                          >
                            {task.status === 'HECHA' ? (
                              <CheckCircle2 className="size-4 text-primary" />
                            ) : (
                              <Circle className="size-4" />
                            )}
                          </button>
                          <div className="flex-1 min-w-0">
                            <p
                              className={`text-sm ${task.status === 'HECHA' ? 'line-through text-muted-foreground' : 'text-foreground'}`}
                            >
                              {task.title}
                            </p>
                            {task.due_date && (
                              <p className="text-xs text-muted-foreground mt-0.5">
                                {task.due_date}
                              </p>
                            )}
                          </div>
                          <button
                            onClick={() => deleteTask(task.id)}
                            className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-red-400 transition-all cursor-pointer shrink-0"
                          >
                            <Trash2 className="size-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </TabsContent>

              {/* Reminders Tab (migration 039) */}
              <TabsContent value="reminders" className="flex-1 overflow-y-auto px-4 py-3">
                <div className="space-y-3">
                  <div className="space-y-2 rounded-lg border border-border bg-muted/50 p-2.5">
                    <Textarea
                      placeholder={t('remindersTab.placeholder', { fallback: 'Mensaje del recordatorio…' })}
                      value={newReminderMessage}
                      onChange={(e) => setNewReminderMessage(e.target.value)}
                      className="bg-muted border-border text-foreground placeholder:text-muted-foreground min-h-[50px] text-sm resize-none"
                    />
                    <div className="flex gap-2">
                      <Input
                        type="datetime-local"
                        value={newReminderAt}
                        onChange={(e) => setNewReminderAt(e.target.value)}
                        className="bg-muted border-border text-foreground h-8 text-sm flex-1"
                      />
                      <Button
                        size="sm"
                        disabled={!newReminderMessage.trim() || !newReminderAt || savingReminder}
                        onClick={addReminder}
                      >
                        {savingReminder ? (
                          <Loader2 className="size-3.5 animate-spin" />
                        ) : (
                          <BellRing className="size-3.5" />
                        )}
                        {t('remindersTab.schedule', { fallback: 'Programar' })}
                      </Button>
                    </div>
                  </div>

                  {loadingReminders ? (
                    <div className="flex items-center justify-center py-8">
                      <Loader2 className="size-5 animate-spin text-primary" />
                    </div>
                  ) : reminders.length === 0 ? (
                    <p className="text-xs text-muted-foreground text-center py-8">
                      {t('remindersTab.noReminders', { fallback: 'Sin recordatorios para este contacto' })}
                    </p>
                  ) : (
                    <div className="space-y-1.5">
                      {reminders.map((reminder) => (
                        <div
                          key={reminder.id}
                          className="flex items-start justify-between gap-2 rounded-lg border border-border bg-muted/50 p-2.5"
                        >
                          <div className="min-w-0">
                            <p className="text-sm text-foreground">{reminder.message}</p>
                            <p className="text-xs text-muted-foreground mt-0.5">
                              {new Date(reminder.remind_at).toLocaleString('es-AR', {
                                day: '2-digit',
                                month: '2-digit',
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                            </p>
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0">
                            <Badge variant="outline" className="text-[10px]">
                              {reminder.status}
                            </Badge>
                            {reminder.status === 'PENDIENTE' && (
                              <button
                                onClick={() => cancelReminder(reminder.id)}
                                className="text-muted-foreground hover:text-red-400 transition-all cursor-pointer"
                              >
                                <X className="size-3.5" />
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </TabsContent>

              {/* Meetings Tab */}
              <TabsContent value="meetings" className="flex-1 overflow-y-auto px-4 py-3">
                {loadingMeetings ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="size-5 animate-spin text-primary" />
                  </div>
                ) : meetings.length === 0 ? (
                  <p className="text-xs text-muted-foreground text-center py-8">
                    {t('meetingsTab.noMeetings', { fallback: 'Sin reuniones para este contacto' })}
                  </p>
                ) : (
                  <div className="space-y-2">
                    {meetings.map((meeting) => (
                      <div
                        key={meeting.id}
                        className="rounded-lg border border-border bg-muted/50 p-3"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-sm font-medium text-foreground">
                            {meeting.objective || t('meetingsTab.untitled', { fallback: 'Reunión' })}
                          </p>
                          <Badge variant="outline" className="text-[10px] shrink-0">
                            {meeting.status}
                          </Badge>
                        </div>
                        {(meeting.scheduled_at || meeting.next_action_date) && (
                          <p className="mt-1.5 flex items-center gap-1 text-xs text-muted-foreground">
                            <CalendarClock className="size-3" />
                            {meeting.scheduled_at
                              ? new Date(meeting.scheduled_at).toLocaleString('es-AR')
                              : meeting.next_action_date}
                          </p>
                        )}
                        {meeting.next_action && (
                          <p className="mt-1 text-xs text-muted-foreground">
                            {meeting.next_action}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </TabsContent>
            </Tabs>
          </div>
        )}
      </SheetContent>
    </Sheet>
    <TemplatePicker
      open={templatePickerOpen}
      onOpenChange={setTemplatePickerOpen}
      onSelect={handleSendTemplate}
    />
    </>
  );
}
