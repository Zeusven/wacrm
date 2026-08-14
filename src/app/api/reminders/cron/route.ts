import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';

import { supabaseAdmin } from '@/lib/automations/admin-client';
import { resolveConversationByPhone } from '@/lib/whatsapp/resolve-conversation';
import { sendMessageToConversation, SendMessageError } from '@/lib/whatsapp/send-message';

/**
 * Sweep due `reminders` (status = PENDIENTE, remind_at <= now) and
 * send each as a WhatsApp text to the account's reminder recipient
 * (see `CRM_REMINDER_PHONE` below), then mark it ENVIADO/FALLIDO.
 *
 * Meant to be hit on a schedule — an n8n Schedule Trigger, since this
 * app has no cron runtime of its own (mirrors `/api/automations/cron`
 * and `/api/flows/cron`, which reuse the same `AUTOMATION_CRON_SECRET`
 * so operators provision one secret, not three).
 *
 * Recipient: a reminder isn't a message TO the lead — it's a nudge to
 * whoever runs the account, on the same "notes to self" WhatsApp
 * thread the voice-note automation already uses. `CRM_REMINDER_PHONE`
 * (E.164, no `+`) is that number; single-tenant today, same
 * convention n8n's own "Es Mi Número?" node already hardcodes.
 *
 * Best-effort locking, same caveat as the other two cron endpoints:
 * the claim-then-send isn't inside a single atomic transaction, so a
 * second overlapping invocation could in principle double-send. Not
 * worth a schema change for a single external Schedule Trigger.
 */
export async function GET(request: Request) {
  const expected = process.env.AUTOMATION_CRON_SECRET;
  if (!expected) {
    return NextResponse.json({ error: 'cron not configured' }, { status: 503 });
  }
  const supplied = request.headers.get('x-cron-secret') ?? '';
  const suppliedBuf = Buffer.from(supplied);
  const expectedBuf = Buffer.from(expected);
  if (
    suppliedBuf.length !== expectedBuf.length ||
    !timingSafeEqual(suppliedBuf, expectedBuf)
  ) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const recipientPhone = process.env.CRM_REMINDER_PHONE;
  if (!recipientPhone) {
    return NextResponse.json(
      { error: 'CRM_REMINDER_PHONE not configured' },
      { status: 503 }
    );
  }

  const admin = supabaseAdmin();
  const { data: due, error } = await admin
    .from('reminders')
    .select('id, account_id, message, contact_id, organization_id')
    .eq('status', 'PENDIENTE')
    .lte('remind_at', new Date().toISOString())
    .order('remind_at', { ascending: true })
    .limit(50);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!due || due.length === 0) return NextResponse.json({ sent: 0, failed: 0 });

  let sent = 0;
  let failed = 0;

  for (const reminder of due) {
    try {
      const subject = reminder.contact_id
        ? await admin
            .from('contacts')
            .select('name')
            .eq('id', reminder.contact_id)
            .maybeSingle()
            .then((r) => r.data?.name as string | undefined)
        : undefined;
      const org = reminder.organization_id
        ? await admin
            .from('organizations')
            .select('name')
            .eq('id', reminder.organization_id)
            .maybeSingle()
            .then((r) => r.data?.name as string | undefined)
        : undefined;

      const parts = ['⏰ Recordatorio:', reminder.message as string];
      if (subject) parts.push(`(${subject}${org ? ' — ' + org : ''})`);
      else if (org) parts.push(`(${org})`);

      const { conversationId } = await resolveConversationByPhone(
        admin,
        reminder.account_id as string,
        recipientPhone
      );
      await sendMessageToConversation(admin, reminder.account_id as string, {
        conversationId,
        messageType: 'text',
        contentText: parts.join(' '),
      });

      await admin
        .from('reminders')
        .update({ status: 'ENVIADO', sent_at: new Date().toISOString(), error: null })
        .eq('id', reminder.id)
        .eq('status', 'PENDIENTE');
      sent++;
    } catch (err) {
      const message =
        err instanceof SendMessageError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Unknown error';
      console.error('[reminders/cron] send failed:', reminder.id, message);
      await admin
        .from('reminders')
        .update({ status: 'FALLIDO', error: message })
        .eq('id', reminder.id)
        .eq('status', 'PENDIENTE');
      failed++;
    }
  }

  return NextResponse.json({ sent, failed });
}
