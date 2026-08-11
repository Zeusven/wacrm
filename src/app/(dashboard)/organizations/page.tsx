'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';

import type { Organization, Potential } from '@/types';
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
import { Building2, Plus, Search, Loader2 } from 'lucide-react';
import { useCan } from '@/hooks/use-can';
import { GatedButton } from '@/components/ui/gated-button';

const POTENTIAL_OPTIONS: Potential[] = ['NO_DETERMINADO', 'BAJO', 'MEDIO', 'ALTO'];

function potentialColor(p: Potential): string {
  switch (p) {
    case 'ALTO':
      return 'bg-green-500/15 text-green-600 dark:text-green-400';
    case 'MEDIO':
      return 'bg-yellow-500/15 text-yellow-600 dark:text-yellow-400';
    case 'BAJO':
      return 'bg-slate-500/15 text-slate-600 dark:text-slate-400';
    default:
      return 'bg-muted text-muted-foreground';
  }
}

export default function OrganizationsPage() {
  const t = useTranslations('Organizations');
  const router = useRouter();
  const canCreate = useCan('send-messages');

  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: '',
    org_type: '',
    locality: '',
    province: '',
    potential: 'NO_DETERMINADO' as Potential,
    notes: '',
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      const res = await fetch(`/api/organizations?${params.toString()}`);
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? t('loadError'));
      setOrganizations(body.organizations ?? []);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('loadError'));
    } finally {
      setLoading(false);
    }
  }, [search, t]);

  useEffect(() => {
    const timeout = setTimeout(load, 250);
    return () => clearTimeout(timeout);
  }, [load]);

  async function handleCreate() {
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      const res = await fetch('/api/organizations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? t('saveError'));
      toast.success(t('createSuccess'));
      setCreateOpen(false);
      setForm({
        name: '',
        org_type: '',
        locality: '',
        province: '',
        potential: 'NO_DETERMINADO',
        notes: '',
      });
      await load();
      router.push(`/organizations/${body.organization.id}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('saveError'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-1 flex-col gap-4 p-4 md:p-6">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <Building2 className="h-5 w-5 text-muted-foreground" />
          <h1 className="text-xl font-semibold">{t('title')}</h1>
        </div>
        <GatedButton
          canAct={canCreate}
          gateReason="create institutions"
          onClick={() => setCreateOpen(true)}
        >
          <Plus className="mr-2 h-4 w-4" />
          {t('newOrganization')}
        </GatedButton>
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input
          className="pl-8"
          placeholder={t('searchPlaceholder')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('name')}</TableHead>
              <TableHead>{t('orgType')}</TableHead>
              <TableHead>{t('locality')}</TableHead>
              <TableHead>{t('potential')}</TableHead>
              <TableHead>{t('commercialStatus')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={5} className="h-24 text-center">
                  <Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" />
                </TableCell>
              </TableRow>
            ) : organizations.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">
                  {t('noOrganizations')}
                </TableCell>
              </TableRow>
            ) : (
              organizations.map((org) => (
                <TableRow
                  key={org.id}
                  className="cursor-pointer"
                  onClick={() => router.push(`/organizations/${org.id}`)}
                >
                  <TableCell className="font-medium">{org.name}</TableCell>
                  <TableCell>{org.org_type ?? '—'}</TableCell>
                  <TableCell>{org.locality ?? '—'}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className={potentialColor(org.potential)}>
                      {t(`potential${toPascal(org.potential)}` as never)}
                    </Badge>
                  </TableCell>
                  <TableCell>{org.commercial_status}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('newOrganization')}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <div className="grid gap-1.5">
              <Label htmlFor="org-name">{t('name')}</Label>
              <Input
                id="org-name"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="org-type">{t('orgType')}</Label>
                <Input
                  id="org-type"
                  value={form.org_type}
                  onChange={(e) => setForm((f) => ({ ...f, org_type: e.target.value }))}
                />
              </div>
              <div className="grid gap-1.5">
                <Label>{t('potential')}</Label>
                <Select
                  value={form.potential}
                  onValueChange={(v) => setForm((f) => ({ ...f, potential: v as Potential }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {POTENTIAL_OPTIONS.map((p) => (
                      <SelectItem key={p} value={p}>
                        {t(`potential${toPascal(p)}` as never)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="org-locality">{t('locality')}</Label>
                <Input
                  id="org-locality"
                  value={form.locality}
                  onChange={(e) => setForm((f) => ({ ...f, locality: e.target.value }))}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="org-province">{t('province')}</Label>
                <Input
                  id="org-province"
                  value={form.province}
                  onChange={(e) => setForm((f) => ({ ...f, province: e.target.value }))}
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              {t('cancel')}
            </Button>
            <Button onClick={handleCreate} disabled={saving || !form.name.trim()}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : t('save')}
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
