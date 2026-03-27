-- ============================================================
--  NimeStream — Supabase Schema FINAL
--  Jalankan SELURUH file ini di:
--  Supabase Dashboard → SQL Editor → New Query → Paste → Run
-- ============================================================

-- ── EXTENSIONS ───────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";  -- Full-text search username

-- ── PROFILES ─────────────────────────────────────────────────
-- Dibuat otomatis saat user register (via trigger di bawah)
CREATE TABLE IF NOT EXISTS public.profiles (
  id           UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  username     TEXT UNIQUE NOT NULL,
  avatar_url   TEXT        DEFAULT '',
  telegram_id  BIGINT      UNIQUE,
  level        INTEGER     DEFAULT 1,
  total_watch  INTEGER     DEFAULT 0,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "profiles_select_all"
  ON public.profiles FOR SELECT USING (true);

CREATE POLICY "profiles_update_own"
  ON public.profiles FOR UPDATE USING (auth.uid() = id);

-- Index untuk pencarian username
CREATE INDEX IF NOT EXISTS idx_profiles_username ON public.profiles USING gin(username gin_trgm_ops);

-- ── WATCH HISTORY ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.watch_history (
  id            UUID        DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id       UUID        REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  episode_url   TEXT        NOT NULL,
  anime_url     TEXT        NOT NULL DEFAULT '',
  anime_title   TEXT        NOT NULL DEFAULT '',
  episode_title TEXT                 DEFAULT '',
  episode_num   TEXT                 DEFAULT '',
  image_url     TEXT                 DEFAULT '',
  watched_secs  INTEGER              DEFAULT 0,
  total_secs    INTEGER              DEFAULT 1420,
  last_watched  TIMESTAMPTZ          DEFAULT NOW(),
  UNIQUE(user_id, episode_url)
);

ALTER TABLE public.watch_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "history_all_own"
  ON public.watch_history FOR ALL USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_history_user    ON public.watch_history(user_id);
CREATE INDEX IF NOT EXISTS idx_history_last    ON public.watch_history(last_watched DESC);
CREATE INDEX IF NOT EXISTS idx_history_anime   ON public.watch_history(anime_url);

-- ── FAVORITES ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.favorites (
  id         UUID        DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id    UUID        REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  anime_url  TEXT        NOT NULL,
  title      TEXT                 DEFAULT '',
  image_url  TEXT                 DEFAULT '',
  score      TEXT                 DEFAULT '',
  created_at TIMESTAMPTZ          DEFAULT NOW(),
  UNIQUE(user_id, anime_url)
);

ALTER TABLE public.favorites ENABLE ROW LEVEL SECURITY;

CREATE POLICY "favorites_all_own"
  ON public.favorites FOR ALL USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_fav_user    ON public.favorites(user_id);
CREATE INDEX IF NOT EXISTS idx_fav_created ON public.favorites(created_at DESC);

-- ── COMMENTS ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.comments (
  id          UUID        DEFAULT uuid_generate_v4() PRIMARY KEY,
  episode_key TEXT        NOT NULL,              -- slugified episode URL
  user_id     UUID        REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  username    TEXT        NOT NULL,
  avatar_url  TEXT                 DEFAULT '',
  text        TEXT        NOT NULL CHECK (char_length(text) BETWEEN 1 AND 1000),
  likes       INTEGER              DEFAULT 0,
  created_at  TIMESTAMPTZ          DEFAULT NOW()
);

ALTER TABLE public.comments ENABLE ROW LEVEL SECURITY;

-- Siapapun bisa baca komentar
CREATE POLICY "comments_select_all"
  ON public.comments FOR SELECT USING (true);

-- Hanya user yang login bisa insert, dan user_id harus milik sendiri
CREATE POLICY "comments_insert_own"
  ON public.comments FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Hanya pemilik komentar yang bisa hapus
CREATE POLICY "comments_delete_own"
  ON public.comments FOR DELETE USING (auth.uid() = user_id);

-- Like bisa diupdate oleh siapapun (no auth required for likes)
CREATE POLICY "comments_update_likes"
  ON public.comments FOR UPDATE USING (true)
  WITH CHECK (
    -- Hanya kolom 'likes' yang boleh diubah oleh orang lain
    auth.uid() = user_id OR (auth.uid() IS NOT NULL)
  );

CREATE INDEX IF NOT EXISTS idx_comments_ep   ON public.comments(episode_key);
CREATE INDEX IF NOT EXISTS idx_comments_time ON public.comments(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_comments_user ON public.comments(user_id);

-- ── FUNCTIONS ─────────────────────────────────────────────────

-- Auto-create profile saat user register
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, username, avatar_url)
  VALUES (
    NEW.id,
    COALESCE(
      NEW.raw_user_meta_data->>'username',
      split_part(NEW.email, '@', 1)
    ),
    COALESCE(NEW.raw_user_meta_data->>'avatar_url', '')
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Increment total_watch di profile saat history diinsert
CREATE OR REPLACE FUNCTION public.increment_watch_count()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.profiles
    SET total_watch = total_watch + 1,
        level = GREATEST(1, FLOOR((total_watch + 1) / 10)),
        updated_at = NOW()
  WHERE id = NEW.user_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_watch_history_insert ON public.watch_history;
CREATE TRIGGER on_watch_history_insert
  AFTER INSERT ON public.watch_history
  FOR EACH ROW EXECUTE FUNCTION public.increment_watch_count();

-- ── REALTIME ──────────────────────────────────────────────────
-- Aktifkan realtime untuk tabel comments supaya komentar baru
-- langsung muncul tanpa refresh
ALTER PUBLICATION supabase_realtime ADD TABLE public.comments;

-- ── VIEWS ─────────────────────────────────────────────────────

-- Leaderboard: top users berdasarkan total_watch
CREATE OR REPLACE VIEW public.leaderboard AS
  SELECT
    p.username,
    p.avatar_url,
    p.level,
    p.total_watch,
    p.created_at
  FROM public.profiles p
  ORDER BY p.total_watch DESC
  LIMIT 100;

-- ── DONE ──────────────────────────────────────────────────────
-- Verifikasi:
--   SELECT table_name FROM information_schema.tables WHERE table_schema = 'public';
--   SELECT * FROM public.profiles LIMIT 5;
-- ============================================================
