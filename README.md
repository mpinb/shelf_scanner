# 📱 ShelfScanner Mobile Web Application

Commercial-ready, multi-user bookshelf visualizer and spine cataloging platform. Designed specifically for smartphones with direct camera capture, Supabase Authentication & PostgreSQL, Supabase Storage, and an asynchronous Task Queue for AI Vision model inference (configured via `.env` to use Google Gemini or OpenAI).

---

## 🌟 Architecture & Features

- **Mobile-First PWA**: Native camera shutter button (`capture="environment"`), pinch-to-zoom SVG spine overlays, and a swipe-up Bottom Sheet drawer for book editing.
- **Supabase Authentication**: Secure user isolation with Row Level Security (RLS). Users only see and manage their own bookshelf collections.
- **Supabase Storage**: Direct cloud object storage in the `shelf-images` bucket with user-isolated folder policies.
- **Asynchronous Task Queue**: Background processing queue (`pipeline_jobs`) running vision segmentation, structured OCR, fore-edge filtering, and Open Library canonical enrichment (3 req/s). Vision engine is controlled strictly via the `MODEL_NAME` switch in `.env` (`gemini-3.8-flash` by default, or OpenAI models like `gpt-6.1-sol` / `gpt-4o`).
- **One-Click Excel Export**: Generates professional, styled `.xlsx` spreadsheets with auto-fitted columns, frozen headers, and text-safe ISBNs.
- **Render Ready**: Complete `render.yaml` and `Procfile` configured for deployment on Render's free tier.

---

## 🚀 Quick Setup & Deployment

### Step 1: Initialize Database in Supabase

1. Open your Supabase Dashboard: [https://supabase.com/dashboard](https://supabase.com/dashboard)
2. Go to **SQL Editor** $\rightarrow$ **New Query**.
3. Copy and paste the contents of `supabase/schema.sql` and click **Run**.
4. Go to **Storage**: Ensure the bucket `shelf-images` is created and set to public read.

### Step 2: Configure Environment Variables

Create `.env` in `shelf_scanner_app/`:

```env
SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_ANON_KEY=your-supabase-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-supabase-service-role-key
GEMINI_API_KEY=your-gemini-api-key
MODEL_NAME=gemini-3.8-flash
# Optional if using OpenAI models (e.g. gpt-6.1-sol, gpt-4o):
OPENAI_API_KEY=sk-proj-...
PORT=8000
```

### Step 3: Run Locally

```bash
# Install dependencies
pip install -r requirements.txt

# Start the FastAPI server with in-process worker
uvicorn backend.main:app --host 0.0.0.0 --port 8000 --reload
```

Open `http://localhost:8000` in your browser (or your phone's browser connected to the same local Wi-Fi).

---

## ☁️ Deploy to Render in 3 Minutes

1. Push this repository to your GitHub account:
   ```bash
   git add shelf_scanner_app/
   git commit -m "Add ShelfScanner mobile app"
   git push origin main
   ```
2. Log in to [Render](https://render.com).
3. Click **New +** $\rightarrow$ **Blueprint** (or **Web Service**).
4. Connect your GitHub repository. Render will automatically detect `render.yaml` or `Procfile`.
5. Under **Environment Variables**, add:
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `GEMINI_API_KEY`
   - `MODEL_NAME` (default: `gemini-3.8-flash`)
   - `OPENAI_API_KEY` (optional, only needed if switching `MODEL_NAME` to an OpenAI model)
6. Click **Create Web Service**. Your live mobile app URL will be available at `https://shelf-scanner-mobile.onrender.com`!

---

## 📂 Project Structure

```
shelf_scanner_app/
├── backend/
│   ├── main.py          # FastAPI server, auth verification, and API routes
│   ├── worker.py        # Asynchronous task queue worker
│   ├── pipeline.py      # Vision model & Open Library enrichment pipeline
│   └── exporter.py      # Styled OpenPyXL XLSX spreadsheet generator
├── frontend/
│   ├── index.html       # Mobile-first PWA interface
│   ├── styles.css       # Touch-optimized dark theme styling
│   └── app.js           # Supabase Auth, camera shutter, and drawer interactions
├── supabase/
│   └── schema.sql       # PostgreSQL schema, RLS policies, and storage setup
├── render.yaml          # Render Blueprint deployment config
├── Procfile             # Process definitions for cloud hosting
├── requirements.txt     # Python dependencies
└── .env                 # Secret environment variables (ignored by git)
```
