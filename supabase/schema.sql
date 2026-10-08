-- ==============================================================================
-- ShelfScanner: Supabase PostgreSQL Schema with Row Level Security (RLS)
-- ==============================================================================

-- 1. Enable UUID Extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 2. Profiles Table (Automatically mirrored from auth.users)
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT,
    full_name TEXT,
    tier TEXT DEFAULT 'free' CHECK (tier IN ('free', 'pro', 'enterprise')),
    max_shelves INT DEFAULT 10,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Trigger to create public.profiles upon auth.users signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.profiles (id, email, full_name)
    VALUES (NEW.id, NEW.email, NEW.raw_user_meta_data->>'full_name');
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 3. Shelves Table
CREATE TABLE IF NOT EXISTS public.shelves (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    room TEXT DEFAULT 'General',
    image_path TEXT NOT NULL,
    image_url TEXT,
    web_image_url TEXT,
    total_books INT DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_shelves_user_id ON public.shelves(user_id);

-- 4. Books Table
CREATE TABLE IF NOT EXISTS public.books (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    shelf_id UUID NOT NULL REFERENCES public.shelves(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    book_index INT NOT NULL,
    polygon_coords JSONB DEFAULT '[]'::jsonb,
    title TEXT,
    ol_title TEXT,
    authors TEXT,
    ol_authors TEXT,
    publication TEXT,
    ol_publisher TEXT,
    pub_year INT,
    isbn_primary TEXT,
    isbns JSONB DEFAULT '[]'::jsonb,
    subjects TEXT,
    misc TEXT,
    raw_text TEXT,
    user_notes TEXT,
    is_ignored BOOLEAN DEFAULT FALSE,
    enrichment_status TEXT DEFAULT 'pending' CHECK (enrichment_status IN ('pending', 'matched', 'not_found', 'manual')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_books_shelf_id ON public.books(shelf_id);
CREATE INDEX IF NOT EXISTS idx_books_user_id ON public.books(user_id);
CREATE INDEX IF NOT EXISTS idx_books_isbn_primary ON public.books(isbn_primary);

-- 5. Pipeline Jobs (Asynchronous Task Queue)
CREATE TABLE IF NOT EXISTS public.pipeline_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    shelf_id UUID REFERENCES public.shelves(id) ON DELETE CASCADE,
    shelf_name TEXT NOT NULL,
    room TEXT DEFAULT 'General',
    image_path TEXT NOT NULL,
    status TEXT DEFAULT 'queued' CHECK (status IN ('queued', 'processing', 'completed', 'failed')),
    current_step INT DEFAULT 1,
    step_details TEXT DEFAULT 'Waiting in queue...',
    logs JSONB DEFAULT '[]'::jsonb,
    error_message TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pipeline_jobs_status ON public.pipeline_jobs(status, created_at);
CREATE INDEX IF NOT EXISTS idx_pipeline_jobs_user_id ON public.pipeline_jobs(user_id);

-- ==============================================================================
-- 6. Row Level Security (RLS) Policies
-- ==============================================================================

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shelves ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.books ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pipeline_jobs ENABLE ROW LEVEL SECURITY;

-- Profiles: Users can view and update their own profile
CREATE POLICY "Users can view own profile"
    ON public.profiles FOR SELECT
    USING (auth.uid() = id);

CREATE POLICY "Users can update own profile"
    ON public.profiles FOR UPDATE
    USING (auth.uid() = id);

-- Shelves: Users can only CRUD their own shelves
CREATE POLICY "Users can view own shelves"
    ON public.shelves FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own shelves"
    ON public.shelves FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own shelves"
    ON public.shelves FOR UPDATE
    USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own shelves"
    ON public.shelves FOR DELETE
    USING (auth.uid() = user_id);

-- Books: Users can only CRUD their own books
CREATE POLICY "Users can view own books"
    ON public.books FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own books"
    ON public.books FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own books"
    ON public.books FOR UPDATE
    USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own books"
    ON public.books FOR DELETE
    USING (auth.uid() = user_id);

-- Pipeline Jobs: Users can view and enqueue their own jobs
CREATE POLICY "Users can view own jobs"
    ON public.pipeline_jobs FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own jobs"
    ON public.pipeline_jobs FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own jobs"
    ON public.pipeline_jobs FOR UPDATE
    USING (auth.uid() = user_id);

-- ==============================================================================
-- 7. Supabase Storage Bucket Configuration
-- ==============================================================================
-- Create the 'shelf-images' bucket if it doesn't already exist
INSERT INTO storage.buckets (id, name, public)
VALUES ('shelf-images', 'shelf-images', true)
ON CONFLICT (id) DO NOTHING;

-- Storage RLS: Users can upload and access images in their own user_id directory
CREATE POLICY "Users can upload shelf images into own folder"
    ON storage.objects FOR INSERT
    TO authenticated
    WITH CHECK (bucket_id = 'shelf-images' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "Users can read own shelf images"
    ON storage.objects FOR SELECT
    TO authenticated
    USING (bucket_id = 'shelf-images' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "Public read for shelf images"
    ON storage.objects FOR SELECT
    TO public
    USING (bucket_id = 'shelf-images');
