-- ============================================================
-- 038_commercial_crm_institutions.sql — evolve WACRM from a flat
-- contact list into an institutional B2B prospecting CRM.
--
-- Additive only. Nothing existing is dropped, renamed, or made
-- NOT NULL. `contacts.phone`/`email` keep their current semantics
-- untouched — the new `contact_phones`/`contact_emails` tables are
-- an *extension* for multiplicity + manual-verification tracking,
-- not a replacement.
--
-- What this adds:
--   1. organizations            — institutions (Hospital Español, etc.)
--   2. organization_contacts    — contact <-> institution relation,
--                                 with cargo/area/decision level
--   3. contact_phones / contact_emails — multiplicity + OCR/manual
--                                 verification trail (original value
--                                 is never overwritten)
--   4. contacts additive columns — profession, linkedin_url,
--      contact_type, referred_by_contact_id, relationship_strength,
--      relationship_notes, origen, priority_score, verified_by/at
--   5. meetings                 — activities/reuniones (presencial/
--                                 telefonica/videollamada), linked to
--                                 contact/organization/deal
--   6. filter_contacts_advanced — extended with an optional
--      p_tag_mode ('or' default | 'and'), old callers unaffected
--   7. Data seed (idempotent, per existing account): a commercial
--      tag taxonomy (4 categories) + a default "HealthOS
--      Instituciones" pipeline with the requested stage sequence
--
-- RLS follows the exact is_account_member() pattern from 017 for
-- every new table. Idempotent — safe to run multiple times.
-- ============================================================

-- ============================================================
-- ENUM TYPES
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'decision_level_enum') THEN
    CREATE TYPE decision_level_enum AS ENUM (
      'NO_DETERMINADO', 'INFLUENCIADOR', 'REFERENTE', 'DECISOR',
      'DECISOR_FINAL', 'SOCIO_PROPIETARIO', 'DIRECCION', 'COMPRAS',
      'IT_DECISOR', 'IT_INFLUENCIADOR'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'relationship_type_enum') THEN
    CREATE TYPE relationship_type_enum AS ENUM (
      'MEDICO_STAFF', 'DIRECTOR', 'GERENTE', 'ADMINISTRATIVO',
      'SISTEMAS_IT', 'COMPRAS', 'OPERACIONES', 'DIRECCION_MEDICA',
      'SOCIO', 'DUENO', 'REFERENTE', 'PROVEEDOR', 'EX_EMPLEADO', 'OTRO'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'phone_type_enum') THEN
    CREATE TYPE phone_type_enum AS ENUM ('CELULAR', 'FIJO', 'DESCONOCIDO');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'confidence_enum') THEN
    CREATE TYPE confidence_enum AS ENUM (
      'ALTA', 'MEDIA', 'BAJA', 'REQUIERE_REVISION_MANUAL'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'meeting_type_enum') THEN
    CREATE TYPE meeting_type_enum AS ENUM ('PRESENCIAL', 'TELEFONICA', 'VIDEOLLAMADA');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'meeting_status_enum') THEN
    CREATE TYPE meeting_status_enum AS ENUM ('PROPUESTA', 'AGENDADA', 'REALIZADA', 'CANCELADA');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'potential_enum') THEN
    CREATE TYPE potential_enum AS ENUM ('NO_DETERMINADO', 'BAJO', 'MEDIO', 'ALTO');
  END IF;
END $$;

-- ============================================================
-- ORGANIZATIONS (instituciones)
-- ============================================================
CREATE TABLE IF NOT EXISTS organizations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  org_type TEXT, -- sanatorio | hospital | clinica | consultorio | otro (free text, not an enum: institution taxonomy varies too much to lock down)
  locality TEXT,
  province TEXT,
  address TEXT,
  website TEXT,
  size_estimate TEXT,
  specialties TEXT[],
  potential potential_enum NOT NULL DEFAULT 'NO_DETERMINADO',
  commercial_status TEXT NOT NULL DEFAULT 'NUEVO',
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_organizations_account ON organizations(account_id);

ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS organizations_select ON organizations;
DROP POLICY IF EXISTS organizations_insert ON organizations;
DROP POLICY IF EXISTS organizations_update ON organizations;
DROP POLICY IF EXISTS organizations_delete ON organizations;
CREATE POLICY organizations_select ON organizations FOR SELECT USING (is_account_member(account_id));
CREATE POLICY organizations_insert ON organizations FOR INSERT WITH CHECK (is_account_member(account_id, 'agent'));
CREATE POLICY organizations_update ON organizations FOR UPDATE USING (is_account_member(account_id, 'agent'));
CREATE POLICY organizations_delete ON organizations FOR DELETE USING (is_account_member(account_id, 'admin'));

DROP TRIGGER IF EXISTS set_updated_at ON organizations;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON organizations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- ORGANIZATION_CONTACTS (contacto <-> institución, con rol)
-- ============================================================
CREATE TABLE IF NOT EXISTS organization_contacts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  cargo TEXT,
  area TEXT,
  decision_level decision_level_enum NOT NULL DEFAULT 'NO_DETERMINADO',
  relationship_type relationship_type_enum,
  is_primary BOOLEAN NOT NULL DEFAULT false,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(organization_id, contact_id)
);

CREATE INDEX IF NOT EXISTS idx_org_contacts_org ON organization_contacts(organization_id);
CREATE INDEX IF NOT EXISTS idx_org_contacts_contact ON organization_contacts(contact_id);
CREATE INDEX IF NOT EXISTS idx_org_contacts_decision_level ON organization_contacts(decision_level);

ALTER TABLE organization_contacts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS organization_contacts_select ON organization_contacts;
DROP POLICY IF EXISTS organization_contacts_insert ON organization_contacts;
DROP POLICY IF EXISTS organization_contacts_update ON organization_contacts;
DROP POLICY IF EXISTS organization_contacts_delete ON organization_contacts;
CREATE POLICY organization_contacts_select ON organization_contacts FOR SELECT USING (
  EXISTS (SELECT 1 FROM organizations o WHERE o.id = organization_contacts.organization_id AND is_account_member(o.account_id))
);
CREATE POLICY organization_contacts_insert ON organization_contacts FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM organizations o WHERE o.id = organization_contacts.organization_id AND is_account_member(o.account_id, 'agent'))
  AND EXISTS (SELECT 1 FROM contacts c WHERE c.id = organization_contacts.contact_id AND is_account_member(c.account_id, 'agent'))
);
CREATE POLICY organization_contacts_update ON organization_contacts FOR UPDATE USING (
  EXISTS (SELECT 1 FROM organizations o WHERE o.id = organization_contacts.organization_id AND is_account_member(o.account_id, 'agent'))
);
CREATE POLICY organization_contacts_delete ON organization_contacts FOR DELETE USING (
  EXISTS (SELECT 1 FROM organizations o WHERE o.id = organization_contacts.organization_id AND is_account_member(o.account_id, 'agent'))
);

DROP TRIGGER IF EXISTS set_updated_at ON organization_contacts;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON organization_contacts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- CONTACT_PHONES — multiplicidad + trazabilidad OCR/manual.
-- `phone_original` NUNCA se sobreescribe. contacts.phone (legacy,
-- single) queda intacto y sigue siendo la fuente para envío/
-- dedupe existente — esta tabla es una extensión, no un reemplazo.
-- ============================================================
CREATE TABLE IF NOT EXISTS contact_phones (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  phone_original TEXT NOT NULL,
  phone_digits_only TEXT,
  phone_e164 TEXT,
  area_code_original TEXT,
  locality TEXT,
  province TEXT,
  phone_type phone_type_enum NOT NULL DEFAULT 'DESCONOCIDO',
  is_primary BOOLEAN NOT NULL DEFAULT false,
  verified_manually BOOLEAN NOT NULL DEFAULT false,
  verified_at TIMESTAMPTZ,
  verified_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  verification_source TEXT,
  confidence confidence_enum NOT NULL DEFAULT 'REQUIERE_REVISION_MANUAL',
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_contact_phones_contact ON contact_phones(contact_id);

ALTER TABLE contact_phones ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS contact_phones_select ON contact_phones;
DROP POLICY IF EXISTS contact_phones_insert ON contact_phones;
DROP POLICY IF EXISTS contact_phones_update ON contact_phones;
DROP POLICY IF EXISTS contact_phones_delete ON contact_phones;
CREATE POLICY contact_phones_select ON contact_phones FOR SELECT USING (
  EXISTS (SELECT 1 FROM contacts c WHERE c.id = contact_phones.contact_id AND is_account_member(c.account_id))
);
CREATE POLICY contact_phones_insert ON contact_phones FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM contacts c WHERE c.id = contact_phones.contact_id AND is_account_member(c.account_id, 'agent'))
);
CREATE POLICY contact_phones_update ON contact_phones FOR UPDATE USING (
  EXISTS (SELECT 1 FROM contacts c WHERE c.id = contact_phones.contact_id AND is_account_member(c.account_id, 'agent'))
);
CREATE POLICY contact_phones_delete ON contact_phones FOR DELETE USING (
  EXISTS (SELECT 1 FROM contacts c WHERE c.id = contact_phones.contact_id AND is_account_member(c.account_id, 'agent'))
);

DROP TRIGGER IF EXISTS set_updated_at ON contact_phones;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON contact_phones
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- CONTACT_EMAILS — multiplicidad, mismo criterio que phones.
-- ============================================================
CREATE TABLE IF NOT EXISTS contact_emails (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  email_original TEXT NOT NULL,
  email_corrected TEXT,
  is_primary BOOLEAN NOT NULL DEFAULT false,
  verified_manually BOOLEAN NOT NULL DEFAULT false,
  verified_at TIMESTAMPTZ,
  verified_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_contact_emails_contact ON contact_emails(contact_id);

ALTER TABLE contact_emails ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS contact_emails_select ON contact_emails;
DROP POLICY IF EXISTS contact_emails_insert ON contact_emails;
DROP POLICY IF EXISTS contact_emails_update ON contact_emails;
DROP POLICY IF EXISTS contact_emails_delete ON contact_emails;
CREATE POLICY contact_emails_select ON contact_emails FOR SELECT USING (
  EXISTS (SELECT 1 FROM contacts c WHERE c.id = contact_emails.contact_id AND is_account_member(c.account_id))
);
CREATE POLICY contact_emails_insert ON contact_emails FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM contacts c WHERE c.id = contact_emails.contact_id AND is_account_member(c.account_id, 'agent'))
);
CREATE POLICY contact_emails_update ON contact_emails FOR UPDATE USING (
  EXISTS (SELECT 1 FROM contacts c WHERE c.id = contact_emails.contact_id AND is_account_member(c.account_id, 'agent'))
);
CREATE POLICY contact_emails_delete ON contact_emails FOR DELETE USING (
  EXISTS (SELECT 1 FROM contacts c WHERE c.id = contact_emails.contact_id AND is_account_member(c.account_id, 'agent'))
);

DROP TRIGGER IF EXISTS set_updated_at ON contact_emails;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON contact_emails
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- CONTACTS — columnas aditivas (todas NULL-able, ningún default
-- rompe filas existentes, ningún contacto se vuelve inválido).
-- ============================================================
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS profession TEXT,
  ADD COLUMN IF NOT EXISTS linkedin_url TEXT,
  ADD COLUMN IF NOT EXISTS contact_type TEXT,
  ADD COLUMN IF NOT EXISTS referred_by_contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS relationship_strength TEXT,
  ADD COLUMN IF NOT EXISTS relationship_notes TEXT,
  ADD COLUMN IF NOT EXISTS origen TEXT,
  ADD COLUMN IF NOT EXISTS priority_score NUMERIC,
  ADD COLUMN IF NOT EXISTS verified_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_contacts_referred_by ON contacts(referred_by_contact_id);
CREATE INDEX IF NOT EXISTS idx_contacts_contact_type ON contacts(contact_type);

-- `phone` sigue NOT NULL desde 001 — eso ya rompería la premisa de
-- "un contacto puede existir solo con email". Se relaja acá porque
-- es exactamente el pedido explícito (perfiles de sistemas/gerencia
-- sin teléfono deben poder crearse) y es 100% aditivo: ninguna fila
-- existente tiene phone NULL, así que no hay dato que perder.
ALTER TABLE contacts ALTER COLUMN phone DROP NOT NULL;

-- ============================================================
-- MEETINGS (actividades / reuniones)
-- ============================================================
CREATE TABLE IF NOT EXISTS meetings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL,
  deal_id UUID REFERENCES deals(id) ON DELETE SET NULL,
  meeting_type meeting_type_enum NOT NULL DEFAULT 'PRESENCIAL',
  objective TEXT,
  channel TEXT, -- whatsapp | telefono | email | linkedin | presencial | central_institucional
  status meeting_status_enum NOT NULL DEFAULT 'PROPUESTA',
  scheduled_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  result TEXT,
  next_action TEXT,
  next_action_date DATE,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT meetings_has_subject CHECK (contact_id IS NOT NULL OR organization_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_meetings_account ON meetings(account_id);
CREATE INDEX IF NOT EXISTS idx_meetings_contact ON meetings(contact_id);
CREATE INDEX IF NOT EXISTS idx_meetings_organization ON meetings(organization_id);
CREATE INDEX IF NOT EXISTS idx_meetings_deal ON meetings(deal_id);
CREATE INDEX IF NOT EXISTS idx_meetings_next_action_date ON meetings(next_action_date);

ALTER TABLE meetings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS meetings_select ON meetings;
DROP POLICY IF EXISTS meetings_insert ON meetings;
DROP POLICY IF EXISTS meetings_update ON meetings;
DROP POLICY IF EXISTS meetings_delete ON meetings;
CREATE POLICY meetings_select ON meetings FOR SELECT USING (is_account_member(account_id));
CREATE POLICY meetings_insert ON meetings FOR INSERT WITH CHECK (is_account_member(account_id, 'agent'));
CREATE POLICY meetings_update ON meetings FOR UPDATE USING (is_account_member(account_id, 'agent'));
CREATE POLICY meetings_delete ON meetings FOR DELETE USING (is_account_member(account_id, 'agent'));

DROP TRIGGER IF EXISTS set_updated_at ON meetings;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON meetings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- filter_contacts_advanced — extendida con p_tag_mode ('or'
-- default | 'and'). Compatibilidad total: cualquier caller
-- existente que no pase p_tag_mode sigue con el comportamiento OR
-- de siempre. CREATE OR REPLACE con un parámetro nuevo al final
-- con DEFAULT no rompe llamadas posicionales previas.
-- ============================================================
CREATE OR REPLACE FUNCTION public.filter_contacts_advanced(
  p_tag_ids UUID[] DEFAULT NULL,
  p_custom_filters JSONB DEFAULT NULL,
  p_search TEXT DEFAULT NULL,
  p_limit INT DEFAULT 25,
  p_offset INT DEFAULT 0,
  p_tag_mode TEXT DEFAULT 'or'
)
RETURNS TABLE (contact contacts, total_count BIGINT)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH matched AS (
    SELECT DISTINCT c.id, c.created_at
    FROM contacts c
    WHERE (
      p_search IS NULL
      OR c.name ILIKE '%' || p_search || '%'
      OR c.phone ILIKE '%' || p_search || '%'
      OR c.email ILIKE '%' || p_search || '%'
    )
    AND (
      p_tag_ids IS NULL
      OR array_length(p_tag_ids, 1) IS NULL
      OR (
        p_tag_mode <> 'and'
        AND EXISTS (
          SELECT 1 FROM contact_tags ct
          WHERE ct.contact_id = c.id AND ct.tag_id = ANY(p_tag_ids)
        )
      )
      OR (
        p_tag_mode = 'and'
        AND (
          SELECT COUNT(DISTINCT ct.tag_id) FROM contact_tags ct
          WHERE ct.contact_id = c.id AND ct.tag_id = ANY(p_tag_ids)
        ) = array_length(p_tag_ids, 1)
      )
    )
    AND (
      p_custom_filters IS NULL
      OR jsonb_array_length(p_custom_filters) = 0
      OR NOT EXISTS (
        SELECT 1
        FROM jsonb_array_elements(p_custom_filters) AS grp
        WHERE NOT EXISTS (
          SELECT 1
          FROM contact_custom_values ccv
          WHERE ccv.contact_id = c.id
            AND ccv.custom_field_id = (grp->>'field_id')::uuid
            AND ccv.value IN (
              SELECT jsonb_array_elements_text(grp->'values')
            )
        )
      )
    )
  ),
  page AS (
    SELECT id, count(*) OVER() AS total_count
    FROM matched
    ORDER BY created_at DESC, id
    LIMIT p_limit OFFSET p_offset
  )
  SELECT c AS contact, page.total_count
  FROM page
  JOIN contacts c ON c.id = page.id
  ORDER BY c.created_at DESC, c.id;
$$;

ALTER FUNCTION public.filter_contacts_advanced(UUID[], JSONB, TEXT, INT, INT, TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.filter_contacts_advanced(UUID[], JSONB, TEXT, INT, INT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.filter_contacts_advanced(UUID[], JSONB, TEXT, INT, INT, TEXT) TO authenticated;

-- ============================================================
-- get_organization_decision_map — para responder "¿qué decisores
-- tengo en esta institución?" en una sola llamada.
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_organization_decision_map(p_organization_id UUID)
RETURNS TABLE (
  contact_id UUID,
  contact_name TEXT,
  contact_phone TEXT,
  contact_email TEXT,
  linkedin_url TEXT,
  cargo TEXT,
  area TEXT,
  decision_level decision_level_enum,
  relationship_type relationship_type_enum
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT c.id, c.name, c.phone, c.email, c.linkedin_url,
         oc.cargo, oc.area, oc.decision_level, oc.relationship_type
  FROM organization_contacts oc
  JOIN contacts c ON c.id = oc.contact_id
  WHERE oc.organization_id = p_organization_id
  ORDER BY
    CASE oc.decision_level
      WHEN 'DECISOR_FINAL' THEN 1 WHEN 'SOCIO_PROPIETARIO' THEN 2
      WHEN 'DECISOR' THEN 3 WHEN 'DIRECCION' THEN 4
      WHEN 'IT_DECISOR' THEN 5 WHEN 'COMPRAS' THEN 6
      WHEN 'INFLUENCIADOR' THEN 7 WHEN 'IT_INFLUENCIADOR' THEN 8
      WHEN 'REFERENTE' THEN 9 ELSE 10
    END,
    c.name;
$$;

ALTER FUNCTION public.get_organization_decision_map(UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_organization_decision_map(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_organization_decision_map(UUID) TO authenticated;

-- ============================================================
-- DATA SEED — idempotente, por cada cuenta ya existente.
-- ============================================================

-- Taxonomía de tags comerciales (4 categorías, sin duplicar lo
-- que ya exista con ese nombre en la cuenta).
DO $$
DECLARE
  acc RECORD;
  tag_name TEXT;
  tag_names TEXT[] := ARRAY[
    -- Tipo de contacto
    'MEDICO', 'SISTEMAS', 'IT', 'DIRECCION', 'GERENCIA', 'ADMINISTRACION', 'COMPRAS', 'OPERACIONES',
    -- Relación
    'CONTACTO_PROPIO', 'REFERIDO', 'REFERENTE', 'PUERTA_INSTITUCIONAL', 'EX_CONTACTO',
    -- Potencial
    'ALTO_POTENCIAL', 'MEDIO_POTENCIAL', 'BAJO_POTENCIAL',
    -- Estado comercial
    'NUEVO', 'INVESTIGADO', 'CONTACTAR', 'CONTACTADO', 'RESPONDIO', 'INTERESADO',
    'REUNION_PROPUESTA', 'REUNION_AGENDADA', 'OPORTUNIDAD', 'NO_INTERESADO', 'SEGUIMIENTO'
  ];
BEGIN
  FOR acc IN SELECT id, owner_user_id FROM accounts LOOP
    FOREACH tag_name IN ARRAY tag_names LOOP
      IF NOT EXISTS (
        SELECT 1 FROM tags WHERE account_id = acc.id AND name = tag_name
      ) THEN
        INSERT INTO tags (account_id, user_id, name, color)
        VALUES (acc.id, acc.owner_user_id, tag_name, '#3b82f6');
      END IF;
    END LOOP;
  END LOOP;
END $$;

-- Pipeline "HealthOS Instituciones" con la secuencia de etapas
-- pedida — solo se crea si la cuenta no tiene ya un pipeline con
-- ese nombre exacto.
DO $$
DECLARE
  acc RECORD;
  new_pipeline_id UUID;
  stage_name TEXT;
  stage_pos INT;
  stage_names TEXT[] := ARRAY[
    'IDENTIFICADO', 'VALIDAR_DATOS', 'CONTACTO_PREPARADO', 'PRIMER_CONTACTO',
    'CONTACTADO', 'RESPONDIO', 'INTERESADO', 'REUNION_PROPUESTA',
    'REUNION_AGENDADA', 'REUNION_REALIZADA', 'SEGUIMIENTO', 'OPORTUNIDAD',
    'DESCARTADO', 'SIN_RESPUESTA'
  ];
BEGIN
  FOR acc IN SELECT id, owner_user_id FROM accounts LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pipelines WHERE account_id = acc.id AND name = 'HealthOS Instituciones'
    ) THEN
      INSERT INTO pipelines (account_id, user_id, name)
      VALUES (acc.id, acc.owner_user_id, 'HealthOS Instituciones')
      RETURNING id INTO new_pipeline_id;

      stage_pos := 0;
      FOREACH stage_name IN ARRAY stage_names LOOP
        INSERT INTO pipeline_stages (pipeline_id, name, position)
        VALUES (new_pipeline_id, stage_name, stage_pos);
        stage_pos := stage_pos + 1;
      END LOOP;
    END IF;
  END LOOP;
END $$;
