-- ============================================================
-- NimeStream Supabase Schema
-- Jalankan di: Supabase Dashboard -> SQL Editor
-- ============================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- PROFILES (auto-dibuat saat user register)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  avatar_url TEXT,
  telegram_id BIGINT UNIQUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "profiles_select" ON public.profiles FOR SELECT USING (true);
CREATE POLICY "profiles_update" ON public.profiles FOR UPDATE USING (auth.uid() = id);

-- ============================================================
-- WATCH HISTORY
-- ============================================================
CREATE TABLE IF NOT EXISTS public.watch_history (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  episode_url TEXT NOT NULL,
  anime_url TEXT NOT NULL DEFAULT '',
  anime_title TEXT NOT NULL DEFAULT '',
  episode_title TEXT DEFAULT '',
  episode_num TEXT DEFAULT '',
  image_url TEXT DEFAULT '',
  watched_secs INTEGER DEFAULT 0,
  total_secs INTEGER DEFAULT 1420,
  last_watched TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, episode_url)
);
ALTER TABLE public.watch_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "history_all" ON public.watch_history FOR ALL USING (auth.uid() = user_id);
CREATE INDEX idx_history_user ON public.watch_history(user_id);
CREATE INDEX idx_history_last ON public.watch_history(last_watched DESC);

-- ============================================================
-- FAVORITES
-- ============================================================
CREATE TABLE IF NOT EXISTS public.favorites (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  anime_url TEXT NOT NULL,
  title TEXT DEFAULT '',
  image_url TEXT DEFAULT '',
  score TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, anime_url)
);
ALTER TABLE public.favorites ENABLE ROW LEVEL SECURITY;
CREATE POLICY "favorites_all" ON public.favorites FOR ALL USING (auth.uid() = user_id);
CREATE INDEX idx_fav_user ON public.favorites(user_id);

-- ============================================================
-- COMMENTS
-- ============================================================
CREATE TABLE IF NOT EXISTS public.comments (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  episode_key TEXT NOT NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  username TEXT NOT NULL,
  avatar_url TEXT DEFAULT '',
  text TEXT NOT NULL,
  likes INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE public.comments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "comments_select" ON public.comments FOR SELECT USING (true);
CREATE POLICY "comments_insert" ON public.comments FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "comments_delete" ON public.comments FOR DELETE USING (auth.uid() = user_id);
CREATE INDEX idx_comments_ep ON public.comments(episode_key);
CREATE INDEX idx_comments_time ON public.comments(created_at DESC);

-- ============================================================
-- AUTO-CREATE PROFILE SAAT USER DAFTAR
-- ============================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO public.profiles (id, username)
  VALUES (
    NEW.id,
    COALESCE(
      NEW.raw_user_meta_data->>'username',
      split_part(NEW.email, '@', 1)
    )
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============================================================
-- REALTIME (aktifkan untuk comments)
-- ============================================================
ALTER PUBLICATION supabase_realtime ADD TABLE public.comments;

-- ============================================================
-- DONE - Cek hasil:
-- SELECT * FROM public.profiles LIMIT 5;
-- SELECT * FROM public.watch_history LIMIT 5;
-- ============================================================
