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

/** Minimal chainable stand-in for the supabase-js query builder. Every
 *  method returns `this` except the terminal ones used by the routes
 *  under test (`.single()` here isn't used by GET, only by POST). */
function makeSupabaseStub(finalResult: { data: unknown; error: unknown }) {
  const chain: Record<string, unknown> = {};
  const methods = ['from', 'select', 'order', 'ilike', 'eq', 'insert'];
  for (const m of methods) {
    chain[m] = vi.fn(() => chain);
  }
  chain.single = vi.fn(async () => finalResult);
  // `select`/`order`/`ilike` chains resolve when awaited directly (no
  // `.single()` call) — mimic PostgrestFilterBuilder's thenable shape.
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

describe('GET /api/organizations', () => {
  it('lists organizations scoped to the caller account via RLS', async () => {
    const orgs = [{ id: 'org-1', name: 'Hospital Español' }];
    context.supabase = makeSupabaseStub({ data: orgs, error: null });
    mocks.requireRole.mockResolvedValue(context);

    const response = await GET(new Request('http://localhost/api/organizations'));
    const body = await response.json();

    expect(mocks.requireRole).toHaveBeenCalledWith('viewer');
    expect(response.status).toBe(200);
    expect(body.organizations).toEqual(orgs);
  });

  it('propagates a query error as a 500', async () => {
    context.supabase = makeSupabaseStub({ data: null, error: { message: 'boom' } });
    mocks.requireRole.mockResolvedValue(context);

    const response = await GET(new Request('http://localhost/api/organizations'));
    expect(response.status).toBe(500);
  });
});

describe('POST /api/organizations', () => {
  it('rejects a missing name before writing', async () => {
    context.supabase = makeSupabaseStub({ data: null, error: null });
    mocks.requireRole.mockResolvedValue(context);

    const response = await POST(
      new Request('http://localhost/api/organizations', {
        method: 'POST',
        body: JSON.stringify({}),
      })
    );
    expect(response.status).toBe(400);
  });

  it('creates an organization scoped to the caller account', async () => {
    const created = { id: 'org-1', name: 'Hospital Español', account_id: 'account-1' };
    context.supabase = makeSupabaseStub({ data: created, error: null });
    mocks.requireRole.mockResolvedValue(context);

    const response = await POST(
      new Request('http://localhost/api/organizations', {
        method: 'POST',
        body: JSON.stringify({ name: 'Hospital Español' }),
      })
    );
    const body = await response.json();

    expect(mocks.requireRole).toHaveBeenCalledWith('agent');
    expect(response.status).toBe(201);
    expect(body.organization).toEqual(created);
  });
});
