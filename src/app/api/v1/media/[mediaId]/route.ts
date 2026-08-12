// ============================================================
// GET /api/v1/media/[mediaId] — proxy a Meta media download (scope: messages:read)
//
// Machine-to-machine counterpart of the dashboard's
// /api/whatsapp/media/[mediaId] (which requires a cookie session
// and can't be called from n8n or any other server-to-server
// automation). Same two-step Meta flow (resolve URL, then
// download), same account-scoped `whatsapp_config` lookup — just
// authenticated via API key instead of a logged-in user.
// ============================================================

import { requireApiKey } from '@/lib/auth/api-context';
import { fail, toApiErrorResponse } from '@/lib/api/v1/respond';
import { getMediaUrl, downloadMedia } from '@/lib/whatsapp/meta-api';
import { decrypt } from '@/lib/whatsapp/encryption';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ mediaId: string }> }
) {
  try {
    const ctx = await requireApiKey(request, 'messages:read');
    const { mediaId } = await params;
    if (!mediaId) {
      return fail('bad_request', "'mediaId' is required", 400);
    }

    const { data: config, error: configError } = await ctx.supabase
      .from('whatsapp_config')
      .select('access_token')
      .eq('account_id', ctx.accountId)
      .single();
    if (configError || !config) {
      return fail('bad_request', 'WhatsApp not configured', 400);
    }

    const accessToken = decrypt(config.access_token);
    const mediaInfo = await getMediaUrl({ mediaId, accessToken });
    const { buffer, contentType } = await downloadMedia({
      downloadUrl: mediaInfo.url,
      accessToken,
    });

    return new Response(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type': contentType || mediaInfo.mimeType || 'application/octet-stream',
        'Cache-Control': 'private, max-age=3600',
      },
    });
  } catch (err) {
    console.error('[api/v1/media] error:', err);
    return toApiErrorResponse(err);
  }
}
