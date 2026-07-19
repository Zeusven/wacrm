-- ============================================================
-- 037_filter_contacts_by_custom_fields.sql — filter contacts by
-- custom field values (e.g. "Especialidad", "Consultorio"), on
-- their own or combined with the existing tag filter.
--
-- Why a new RPC instead of extending filter_contacts_by_tags
--
--   Same pagination/count problem migration 025 solved for tags
--   applies here: resolving "contacts whose custom field X is one
--   of these values" client-side (select contact_custom_values,
--   then .in('id', ids) on contacts) hits the same PostgREST row
--   caps and IN-clause bloat for a field value shared by many
--   contacts. This does the join + windowed count + pagination
--   in one query, same as 025.
--
--   filter_contacts_by_tags (025) is left untouched — this is an
--   additive function, not a replacement, so nothing that already
--   calls it can regress.
--
-- Filter semantics
--
--   p_tag_ids: contact must have ANY of these tags (OR) — same as 025.
--   p_custom_filters: JSONB array of {"field_id": uuid, "values": [text, ...]}.
--     Contact must match ALL filter groups (AND across fields — e.g.
--     Especialidad=Cardiología AND Consultorio=Rosario), and within a
--     group match ANY of its values (OR — e.g. Especialidad IN
--     (Cardiología, Neurología)). Matching is exact string equality
--     against contact_custom_values.value (no case-folding): these
--     values come from free-text CSV import, not a fixed picklist,
--     so the caller is expected to build the value list from the
--     DISTINCT values actually present (see get_custom_field_values
--     below) rather than from user-typed text.
--   Both filters combine with AND, and with p_search (name/phone/
--   email ILIKE) same as before.
--   An empty/null p_tag_ids and an empty/null p_custom_filters means
--   "no filter on that dimension" — matches everything on that axis.
--
-- Security: SECURITY INVOKER (default) — runs as the caller, so the
-- existing RLS on contacts/contact_tags/contact_custom_values scopes
-- the result to the caller's account. No privilege bypass.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

CREATE OR REPLACE FUNCTION public.filter_contacts_advanced(
  p_tag_ids UUID[] DEFAULT NULL,
  p_custom_filters JSONB DEFAULT NULL,
  p_search TEXT DEFAULT NULL,
  p_limit INT DEFAULT 25,
  p_offset INT DEFAULT 0
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
      OR EXISTS (
        SELECT 1 FROM contact_tags ct
        WHERE ct.contact_id = c.id AND ct.tag_id = ANY(p_tag_ids)
      )
    )
    AND (
      p_custom_filters IS NULL
      OR jsonb_array_length(p_custom_filters) = 0
      -- Universal quantification over filter groups: no group is
      -- allowed to be unmatched (i.e. every group has at least one
      -- matching contact_custom_values row for this contact).
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

ALTER FUNCTION public.filter_contacts_advanced(UUID[], JSONB, TEXT, INT, INT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.filter_contacts_advanced(UUID[], JSONB, TEXT, INT, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.filter_contacts_advanced(UUID[], JSONB, TEXT, INT, INT) TO authenticated;

-- ============================================================
-- get_custom_field_values — distinct values in use for a custom
-- field, to populate the filter dropdown (so it only offers values
-- that actually exist instead of free text, since matching above is
-- exact-equality on free-text CSV-imported strings).
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_custom_field_values(p_field_id UUID)
RETURNS TABLE (value TEXT)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT DISTINCT ccv.value
  FROM contact_custom_values ccv
  JOIN contacts c ON c.id = ccv.contact_id
  WHERE ccv.custom_field_id = p_field_id
    AND ccv.value IS NOT NULL
    AND ccv.value <> ''
  ORDER BY ccv.value;
$$;

ALTER FUNCTION public.get_custom_field_values(UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_custom_field_values(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_custom_field_values(UUID) TO authenticated;
