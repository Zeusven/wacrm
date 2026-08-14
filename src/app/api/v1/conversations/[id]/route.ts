// ============================================================
// GET   /api/v1/conversations/{id} — read one conversation
//       (scope: conversations:read). Account-scoped: a foreign id → 404.
// PATCH /api/v1/conversations/{id} — set which contact this thread is
//       "currently about" (scope: conversations:write). Migration 039.
//       Used by the voice-note automation so a short follow-up message
//       ("el telefono es 341...") can be attached to the same contact
//       as the note before it, instead of creating a new one.
// ============================================================

import { requireApiKey } from '@/lib/auth/api-context';
import { ok, fail, toApiErrorResponse } from '@/lib/api/v1/respond';
import {
  CONVERSATION_SELECT,
  normalizeConversation,
} from '@/lib/inbox/conversations';
import { serializeConversation } from '@/lib/api/v1/conversations';
import type { Conversation } from '@/types';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireApiKey(request, 'conversations:read');
    const { id } = await params;

    const { data, error } = await ctx.supabase
      .from('conversations')
      .select(CONVERSATION_SELECT)
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .maybeSingle();

    if (error) {
      console.error('[api/v1/conversations] read error:', error);
      return fail('internal', 'Failed to read conversation', 500);
    }
    if (!data) return fail('not_found', 'Conversation not found', 404);

    return ok(serializeConversation(normalizeConversation(data as Conversation)));
  } catch (err) {
    return toApiErrorResponse(err);
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireApiKey(request, 'conversations:write');
    const { id } = await params;

    const body = (await request.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    if (!body || typeof body !== 'object' || !('active_contact_id' in body)) {
      return fail('bad_request', "'active_contact_id' is required (string or null)", 400);
    }

    const activeContactId = body.active_contact_id;
    if (activeContactId !== null && typeof activeContactId !== 'string') {
      return fail('bad_request', "'active_contact_id' must be a string or null", 400);
    }

    const { data, error } = await ctx.supabase
      .from('conversations')
      .update({
        active_contact_id: activeContactId,
        active_contact_set_at: activeContactId ? new Date().toISOString() : null,
      })
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .select(CONVERSATION_SELECT)
      .maybeSingle();

    if (error) {
      console.error('[api/v1/conversations] update error:', error);
      return fail('internal', 'Failed to update conversation', 500);
    }
    if (!data) return fail('not_found', 'Conversation not found', 404);

    return ok(serializeConversation(normalizeConversation(data as Conversation)));
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
