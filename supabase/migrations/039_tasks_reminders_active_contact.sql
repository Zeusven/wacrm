-- ============================================================
-- 039_tasks_reminders_active_contact.sql — makes Contact the real
-- central entity: a task/reminder/meeting can all point at the same
-- contact_id, and a WhatsApp "notes to self" conversation can track
-- which contact it's currently talking about across several messages
-- (so "email" then "cargo" in two separate texts land on one row
-- instead of two half-built ones).
--
-- Additive only — no existing table/column is dropped or renamed.
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'task_status_enum') THEN
    CREATE TYPE task_status_enum AS ENUM ('PENDIENTE', 'HECHA', 'CANCELADA');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'reminder_status_enum') THEN
    CREATE TYPE reminder_status_enum AS ENUM ('PENDIENTE', 'ENVIADO', 'CANCELADO', 'FALLIDO');
  END IF;
END $$;

-- ============================================================
-- TASKS — checklist items, optionally linked to a contact/
-- organization/meeting. Unlike `meetings`, no subject is required:
-- a plain "acordarme de mandar el catálogo" todo with nobody named
-- yet is still a valid task.
-- ============================================================
CREATE TABLE IF NOT EXISTS tasks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL,
  meeting_id UUID REFERENCES meetings(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  description TEXT,
  due_date DATE,
  status task_status_enum NOT NULL DEFAULT 'PENDIENTE',
  completed_at TIMESTAMPTZ,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tasks_account ON tasks(account_id);
CREATE INDEX IF NOT EXISTS idx_tasks_contact ON tasks(contact_id);
CREATE INDEX IF NOT EXISTS idx_tasks_organization ON tasks(organization_id);
CREATE INDEX IF NOT EXISTS idx_tasks_due_date ON tasks(due_date);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);

ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tasks_select ON tasks;
DROP POLICY IF EXISTS tasks_insert ON tasks;
DROP POLICY IF EXISTS tasks_update ON tasks;
DROP POLICY IF EXISTS tasks_delete ON tasks;
CREATE POLICY tasks_select ON tasks FOR SELECT USING (is_account_member(account_id));
CREATE POLICY tasks_insert ON tasks FOR INSERT WITH CHECK (is_account_member(account_id, 'agent'));
CREATE POLICY tasks_update ON tasks FOR UPDATE USING (is_account_member(account_id, 'agent'));
CREATE POLICY tasks_delete ON tasks FOR DELETE USING (is_account_member(account_id, 'agent'));

DROP TRIGGER IF EXISTS set_updated_at ON tasks;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON tasks
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- REMINDERS — scheduled WhatsApp nudges. `remind_at` is checked by
-- a cron sweep (see /api/reminders/cron); on fire, a WhatsApp text
-- is sent to the account owner's own number (the same "notes to
-- self" thread the voice-note automation uses) and the row moves to
-- ENVIADO. Linked to contact/organization/meeting/task so "recordame
-- mandarle la propuesta a Nicolas" keeps the same contact_id thread
-- as the task/meeting it came from.
-- ============================================================
CREATE TABLE IF NOT EXISTS reminders (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL,
  meeting_id UUID REFERENCES meetings(id) ON DELETE SET NULL,
  task_id UUID REFERENCES tasks(id) ON DELETE SET NULL,
  message TEXT NOT NULL,
  channel TEXT NOT NULL DEFAULT 'whatsapp',
  remind_at TIMESTAMPTZ NOT NULL,
  status reminder_status_enum NOT NULL DEFAULT 'PENDIENTE',
  sent_at TIMESTAMPTZ,
  error TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reminders_account ON reminders(account_id);
CREATE INDEX IF NOT EXISTS idx_reminders_contact ON reminders(contact_id);
CREATE INDEX IF NOT EXISTS idx_reminders_organization ON reminders(organization_id);
-- Cron sweep query: WHERE status = 'PENDIENTE' AND remind_at <= now().
CREATE INDEX IF NOT EXISTS idx_reminders_due ON reminders(status, remind_at);

ALTER TABLE reminders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS reminders_select ON reminders;
DROP POLICY IF EXISTS reminders_insert ON reminders;
DROP POLICY IF EXISTS reminders_update ON reminders;
DROP POLICY IF EXISTS reminders_delete ON reminders;
CREATE POLICY reminders_select ON reminders FOR SELECT USING (is_account_member(account_id));
CREATE POLICY reminders_insert ON reminders FOR INSERT WITH CHECK (is_account_member(account_id, 'agent'));
CREATE POLICY reminders_update ON reminders FOR UPDATE USING (is_account_member(account_id, 'agent'));
CREATE POLICY reminders_delete ON reminders FOR DELETE USING (is_account_member(account_id, 'agent'));

DROP TRIGGER IF EXISTS set_updated_at ON reminders;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON reminders
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- CONVERSATIONS — session continuity for the "notes to self"
-- voice-note automation. `active_contact_id` is the contact the last
-- message in this conversation resolved to (created or matched);
-- `active_contact_set_at` lets the workflow decide whether it's still
-- "fresh" enough to reuse (e.g. within 45 minutes) before falling
-- back to it when a follow-up message ("el telefono es 341...")
-- names nobody new. Nullable, additive — every existing conversation
-- keeps working with both columns NULL.
-- ============================================================
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS active_contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS active_contact_set_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_conversations_active_contact ON conversations(active_contact_id);
