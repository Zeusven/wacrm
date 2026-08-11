import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
}));

vi.mock('@/lib/auth/account', () => ({
  requireRole: mocks.requireRole,
  toErrorResponse: vi.fn(() =>
    Response.json({ error: 'auth failed' }, { status: 403 })
  ),
}));

import { GET, POST } from './route';

function makeSupabaseStub(finalResult: { data: unknown; error: unknown }) {
  const chain: Record<string, unknown> = {};
  const methods = ['from', 'select', 'order', 'eq', 'insert'];
  for (const m of methods) {
    chain[m] = vi.fn(() => chain);
  }
  chain.single = vi.fn(async () => finalResult);
  (chain as unknown as { then: unknown }).then = (
    resolve: (v: { data: unknown; error: unknown }) => void
  ) => resolve(finalResult);
  return chain;
}

const context = {
  supabase: null as unknown,
  accountId: 'account-1',
  userId: 'user-1',
  role: 'agent',
  account: { id: 'account-1', name: 'Acme' },
};

beforeEach(() => {
  mocks.requireRole.mockReset();
});

describe('GET /api/meetings', () => {
  it('lists meetings scoped to the caller account', async () => {
    const meetings = [{ id: 'meeting-1', status: 'PROPUESTA' }];
    context.supabase = makeSupabaseStub({ data: meetings, error: null });
    mocks.requireRole.mockResolvedValue(context);

    const response = await GET(new Request('http://localhost/api/meetings'));
    const body = await response.json();

    expect(mocks.requireRole).toHaveBeenCalledWith('viewer');
    expect(response.status).toBe(200);
    expect(body.meetings).toEqual(meetings);
  });
});

describe('POST /api/meetings', () => {
  it('rejects a meeting with neither contact nor organization', async () => {
    context.supabase = makeSupabaseStub({ data: null, error: null });
    mocks.requireRole.mockResolvedValue(context);

    const response = await POST(
      new Request('http://localhost/api/meetings', {
        method: 'POST',
        body: JSON.stringify({ objective: 'CONSEGUIR_REUNION' }),
      })
    );
    expect(response.status).toBe(400);
  });

  it('creates a meeting tied to a contact, stamping created_by from the caller', async () => {
    const created = { id: 'meeting-1', contact_id: 'contact-1', status: 'PROPUESTA' };
    const stub = makeSupabaseStub({ data: created, error: null });
    context.supabase = stub;
    mocks.requireRole.mockResolvedValue(context);

    const response = await POST(
      new Request('http://localhost/api/meetings', {
        method: 'POST',
        body: JSON.stringify({ contact_id: 'contact-1', meeting_type: 'TELEFONICA' }),
      })
    );
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.meeting).toEqual(created);
    expect((stub as { insert: ReturnType<typeof vi.fn> }).insert).toHaveBeenCalledWith(
      expect.objectContaining({ account_id: 'account-1', created_by: 'user-1' })
    );
  });
});
