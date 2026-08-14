import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import {
  serializeContact,
  findOrCreateContact,
  ContactError,
} from './contacts';

describe('serializeContact', () => {
  it('flattens contact_tags(tags(*)) onto a tags array and nulls missing fields', () => {
    const row = {
      id: 'c1',
      phone: '+14155550123',
      name: 'Jane',
      email: null,
      company: 'Acme',
      avatar_url: null,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-02T00:00:00Z',
      contact_tags: [
        { tags: { id: 't1', name: 'vip', color: '#fff' } },
        { tags: null }, // orphaned join — dropped
      ],
    };
    expect(serializeContact(row)).toEqual({
      id: 'c1',
      phone: '+14155550123',
      name: 'Jane',
      email: null,
      company: 'Acme',
      avatar_url: null,
      tags: [{ id: 't1', name: 'vip', color: '#fff' }],
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-02T00:00:00Z',
    });
  });

  it('tolerates a row with no contact_tags key', () => {
    const row = {
      id: 'c2',
      phone: '+1',
      name: null,
      email: null,
      company: null,
      avatar_url: null,
      created_at: 'a',
      updated_at: 'b',
    };
    expect(serializeContact(row).tags).toEqual([]);
  });
});

describe('findOrCreateContact', () => {
  const noopDb = {} as SupabaseClient;

  it('rejects a non-E.164 phone with a 400 ContactError', async () => {
    await expect(
      findOrCreateContact(noopDb, 'acc', 'user', { phone: 'not-a-number' })
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      findOrCreateContact(noopDb, 'acc', 'user', { phone: 'not-a-number' })
    ).rejects.toBeInstanceOf(ContactError);
  });

  it('rejects when neither phone nor email is given', async () => {
    await expect(
      findOrCreateContact(noopDb, 'acc', 'user', {})
    ).rejects.toMatchObject({ status: 400 });
  });

  function fakeEmailDb(options: {
    existing?: { id: string } | null;
    created?: { id: string } | null;
  }): SupabaseClient {
    return {
      from(table: string) {
        const builder = {
          select() {
            return builder;
          },
          insert() {
            return builder;
          },
          eq() {
            return builder;
          },
          ilike() {
            return builder;
          },
          limit() {
            return builder;
          },
          maybeSingle() {
            if (table === 'contacts') {
              return Promise.resolve({
                data: options.existing ?? null,
                error: null,
              });
            }
            return Promise.resolve({ data: null, error: null });
          },
          single() {
            return Promise.resolve({
              data: options.created ?? { id: 'new-contact-1' },
              error: null,
            });
          },
        };
        return builder;
      },
    } as unknown as SupabaseClient;
  }

  it('finds an existing contact by case-insensitive email without touching phone', async () => {
    const db = fakeEmailDb({ existing: { id: 'contact-existing' } });
    const result = await findOrCreateContact(db, 'acc', 'user', {
      email: 'Fcecchi@AMR.org.ar',
      name: 'Facundo Cecchi',
    });
    expect(result).toEqual({ id: 'contact-existing', created: false });
  });

  it('creates a phone-less contact by email when no match exists', async () => {
    const db = fakeEmailDb({ existing: null, created: { id: 'contact-new' } });
    const result = await findOrCreateContact(db, 'acc', 'user', {
      email: 'fcecchi@amr.org.ar',
      name: 'Facundo Cecchi',
    });
    expect(result).toEqual({ id: 'contact-new', created: true });
  });
});
