-- Collection Discovery (Phase 3): FTS stack + denormalised follower_count
-- + trailing-window trending indexes. Mirrors the document FTS stack
-- (migrations 20260520160000 / 170000) for study_collections.

-- ─── Columns ──────────────────────────────────────────────────────
ALTER TABLE "study_collections" ADD COLUMN "search_text" TEXT;
ALTER TABLE "study_collections" ADD COLUMN "follower_count" INTEGER NOT NULL DEFAULT 0;

-- Generated tsvector + GIN index (english config, matches read-time tsquery).
ALTER TABLE "study_collections"
  ADD COLUMN "search_vector" tsvector
  GENERATED ALWAYS AS (to_tsvector('english', coalesce("search_text", ''))) STORED;
CREATE INDEX IF NOT EXISTS "study_collections_search_vector_gin_idx"
  ON "study_collections" USING gin ("search_vector");

-- ─── Haystack aggregator ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION kb_compute_collection_search_text(p_id uuid)
RETURNS text LANGUAGE sql STABLE AS $fn$
  SELECT
    coalesce(sc.title, '') || ' ' ||
    coalesce(sc.description, '') || ' ' ||
    coalesce(sc.exam_name, '') || ' ' ||
    coalesce(co.code, '') || ' ' ||
    coalesce(co.title, '') || ' ' ||
    coalesce(co.lecturer_name, '') || ' ' ||
    coalesce(cat.name, '') || ' ' ||
    coalesce((
      SELECT string_agg(t.name, ' ')
      FROM study_collection_tags sct
      JOIN tags t ON t.id = sct.tag_id
      WHERE sct.collection_id = sc.id
    ), '') || ' ' ||
    coalesce(u.display_name, '')
  FROM study_collections sc
  LEFT JOIN courses co ON co.id = sc.course_id
  LEFT JOIN categories cat ON cat.id = sc.category_id
  LEFT JOIN users u ON u.id = sc.owner_id
  WHERE sc.id = p_id;
$fn$;

CREATE OR REPLACE FUNCTION kb_refresh_collection_search_text(p_id uuid)
RETURNS void LANGUAGE sql AS $fn$
  UPDATE study_collections
  SET search_text = kb_compute_collection_search_text(p_id)
  WHERE id = p_id;
$fn$;

-- ─── BEFORE INSERT/UPDATE on study_collections ────────────────────
CREATE OR REPLACE FUNCTION kb_collections_search_text_biut()
RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  NEW.search_text :=
    coalesce(NEW.title, '') || ' ' ||
    coalesce(NEW.description, '') || ' ' ||
    coalesce(NEW.exam_name, '') || ' ' ||
    coalesce((
      SELECT coalesce(co.code, '') || ' ' || coalesce(co.title, '') || ' ' ||
             coalesce(co.lecturer_name, '')
      FROM courses co WHERE co.id = NEW.course_id
    ), '') || ' ' ||
    coalesce((SELECT cat.name FROM categories cat WHERE cat.id = NEW.category_id), '') || ' ' ||
    coalesce((
      SELECT string_agg(t.name, ' ')
      FROM study_collection_tags sct
      JOIN tags t ON t.id = sct.tag_id
      WHERE sct.collection_id = NEW.id
    ), '') || ' ' ||
    coalesce((SELECT u.display_name FROM users u WHERE u.id = NEW.owner_id), '');
  RETURN NEW;
END;
$fn$;

CREATE TRIGGER collections_search_text_biut
  BEFORE INSERT OR UPDATE OF title, description, exam_name, course_id, category_id, owner_id
  ON study_collections
  FOR EACH ROW EXECUTE FUNCTION kb_collections_search_text_biut();

-- ─── study_collection_tags (INSERT/DELETE/UPDATE) ─────────────────
CREATE OR REPLACE FUNCTION kb_collection_tags_search_text_aiud()
RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM kb_refresh_collection_search_text(OLD.collection_id);
    RETURN OLD;
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.collection_id IS DISTINCT FROM NEW.collection_id THEN
      PERFORM kb_refresh_collection_search_text(OLD.collection_id);
    END IF;
    PERFORM kb_refresh_collection_search_text(NEW.collection_id);
    RETURN NEW;
  ELSE
    PERFORM kb_refresh_collection_search_text(NEW.collection_id);
    RETURN NEW;
  END IF;
END;
$fn$;

CREATE TRIGGER collection_tags_search_text_ai
  AFTER INSERT ON study_collection_tags
  FOR EACH ROW EXECUTE FUNCTION kb_collection_tags_search_text_aiud();
CREATE TRIGGER collection_tags_search_text_au
  AFTER UPDATE ON study_collection_tags
  FOR EACH ROW EXECUTE FUNCTION kb_collection_tags_search_text_aiud();
CREATE TRIGGER collection_tags_search_text_ad
  AFTER DELETE ON study_collection_tags
  FOR EACH ROW EXECUTE FUNCTION kb_collection_tags_search_text_aiud();

-- ─── tags / courses / categories / users name propagation ─────────
CREATE OR REPLACE FUNCTION kb_collections_search_text_on_tag_name()
RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  UPDATE study_collections sc
  SET search_text = kb_compute_collection_search_text(sc.id)
  WHERE EXISTS (
    SELECT 1 FROM study_collection_tags sct
    WHERE sct.collection_id = sc.id AND sct.tag_id = NEW.id
  );
  RETURN NEW;
END;
$fn$;
CREATE TRIGGER tags_collections_search_text_au
  AFTER UPDATE OF name ON tags
  FOR EACH ROW EXECUTE FUNCTION kb_collections_search_text_on_tag_name();

CREATE OR REPLACE FUNCTION kb_collections_search_text_on_course()
RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  UPDATE study_collections sc
  SET search_text = kb_compute_collection_search_text(sc.id)
  WHERE sc.course_id = NEW.id;
  RETURN NEW;
END;
$fn$;
CREATE TRIGGER courses_collections_search_text_au
  AFTER UPDATE OF code, title, lecturer_name ON courses
  FOR EACH ROW EXECUTE FUNCTION kb_collections_search_text_on_course();

CREATE OR REPLACE FUNCTION kb_collections_search_text_on_category()
RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  UPDATE study_collections sc
  SET search_text = kb_compute_collection_search_text(sc.id)
  WHERE sc.category_id = NEW.id;
  RETURN NEW;
END;
$fn$;
CREATE TRIGGER categories_collections_search_text_au
  AFTER UPDATE OF name ON categories
  FOR EACH ROW EXECUTE FUNCTION kb_collections_search_text_on_category();

CREATE OR REPLACE FUNCTION kb_collections_search_text_on_owner()
RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  UPDATE study_collections sc
  SET search_text = kb_compute_collection_search_text(sc.id)
  WHERE sc.owner_id = NEW.id;
  RETURN NEW;
END;
$fn$;
CREATE TRIGGER users_collections_search_text_au
  AFTER UPDATE OF display_name ON users
  FOR EACH ROW EXECUTE FUNCTION kb_collections_search_text_on_owner();

-- ─── Backfills ────────────────────────────────────────────────────
UPDATE study_collections SET search_text = kb_compute_collection_search_text(id);
UPDATE study_collections sc
SET follower_count = (
  SELECT count(*) FROM study_collection_followers f WHERE f.collection_id = sc.id
);

-- ─── Trailing-window trending indexes ─────────────────────────────
CREATE INDEX IF NOT EXISTS "study_collection_likes_created_idx"
  ON "study_collection_likes" ("created_at");
CREATE INDEX IF NOT EXISTS "study_collection_followers_created_idx"
  ON "study_collection_followers" ("created_at");
CREATE INDEX IF NOT EXISTS "study_collection_views_viewed_idx"
  ON "study_collection_views" ("viewed_at");
CREATE INDEX IF NOT EXISTS "study_collection_comments_created_idx"
  ON "study_collection_comments" ("created_at");
