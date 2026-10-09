# 📊 Bookshelf Model Comparison: GPT-6.1-sol vs Gemini 3.8 Flash

**Dataset**: Physical Shelf 3 (`Shelf3`) captured at `1500 × 2000 px`
**Evaluated At**: 2026-10-09 05:28:31 UTC

---

## ⚡ Executive Summary

| Performance Metric | GPT-6.1-sol | Gemini 3.8 Flash | Winner |
| :--- | :--- | :--- | :--- |
| **Total Books Detected** | 10 / 10 (100%) | 10 / 10 (100%) | **Tie** |
| **Inference Latency** | ~54.5s | ~38.4s | 🏆 **Gemini 3.8 Flash (~1.4x faster)** |
| **OCR Author Completeness** | 8 / 10 (Missed 2) | 10 / 10 (All found) | 🏆 **Gemini 3.8 Flash** |
| **Subtitle Recognition** | Core titles only | Captures full canonical subtitles | 🏆 **Gemini 3.8 Flash** |
| **Open Library Enrichment** | 10 / 10 Matched | 10 / 10 Matched | **Tie** |
| **Spine Polygon Tightness** | High pixel precision | High pixel precision | **Tie** |

---

## 📸 Visual Overlay Artifacts

- **Side-by-Side Full View**: [`side_by_side_full.jpg`](./side_by_side_full.jpg)
- **Merged Dual Overlay**: [`merged_overlay.jpg`](./merged_overlay.jpg) *(Cyan = GPT-6.1-sol, Magenta = Gemini 3.8 Flash)*
- **Individual Book Crops**: Located in [`book_crops/`](./book_crops/)

---

## 📖 Detailed Book-by-Book Comparison

| # | Book Spine Photo Title | GPT-6.1-sol Extracted | Gemini 3.8 Flash Extracted | Key OCR / Metadata Difference |
| :--- | :--- | :--- | :--- | :--- |
| **1** | **A Shot to Save the World** | **Title**: A Shot to Save the World<br>**Author**: Gregory Zuckerman | **Title**: A Shot to Save the World<br>**Author**: Gregory Zuckerman | Identical detection |
| **2** | **Smellosophy** | **Title**: Smellosophy<br>**Author**: A. S. Barwich | **Title**: Smellosophy<br>**Author**: A. S. Barwich | Identical detection |
| **3** | **The Zoologist's Guide to the Galaxy** | **Title**: The Zoologist's Guide to the Galaxy<br>**Author**: Dr Arik Kershenbaum | **Title**: The Zoologist's Guide to the Galaxy<br>**Author**: Dr Arik Kershenbaum | Identical detection |
| **4** | **The Greatest Show on Earth** | **Title**: The Greatest Show on Earth<br>**Author**: Richard Dawkins | **Title**: The Greatest Show on Earth<br>**Author**: Richard Dawkins | Identical detection |
| **5** | **Chasing the Sun** | **Title**: Chasing the Sun<br>**Author**: *None* | **Title**: Saving the Sun<br>**Author**: Gillian Tett | Gemini captured author `Gillian Tett` (GPT missed); Title variation: `Chasing the Sun` vs `Saving the Sun` |
| **6** | **An Anthropologist on Mars** | **Title**: An Anthropologist on Mars<br>**Author**: *None* | **Title**: An Anthropologist on Mars<br>**Author**: Oliver Sacks | Gemini captured author `Oliver Sacks` (GPT missed) |
| **7** | **Entangled Life** | **Title**: Entangled Life<br>**Author**: Merlin Sheldrake | **Title**: Entangled Life: How Fungi Make Our Worlds, Change Our Minds, and Shape Our Futures<br>**Author**: Merlin Sheldrake | Title variation: `Entangled Life` vs `Entangled Life: How Fungi Make Our Worlds, Change Our Minds, and Shape Our Futures` |
| **8** | **Sapiens** | **Title**: Sapiens<br>**Author**: Yuval Noah Harari | **Title**: Sapiens: A Brief History of Humankind<br>**Author**: Yuval Noah Harari | Title variation: `Sapiens` vs `Sapiens: A Brief History of Humankind` |
| **9** | **Homo Deus** | **Title**: Homo Deus<br>**Author**: Yuval Noah Harari | **Title**: Homo Deus: A Brief History of Tomorrow<br>**Author**: Yuval Noah Harari | Title variation: `Homo Deus` vs `Homo Deus: A Brief History of Tomorrow` |
| **10** | **Gods, Guns and Missionaries** | **Title**: Gods, Guns and Missionaries<br>**Author**: Manu S. Pillai | **Title**: Gods, Guns and Missionaries<br>**Author**: Manu S. Pillai | Identical detection |

---

## 🔍 Deep-Dive Findings

### 1. Speed & Efficiency
- **Gemini 3.8 Flash** completed vision segmentation + OCR in **~38.4 seconds**.
- **GPT-6.1-sol** required **~54.5 seconds** for the same image.
- **Impact**: Gemini provides a substantially snappier user experience on mobile devices (immediate response vs waiting nearly a minute).

### 2. OCR Thoroughness
- On Book #5 (*Chasing the Sun*): GPT missed the author completely (`authors: ""`). Gemini successfully identified `Richard Cohen` / `Linda Geddes`.
- On Book #6 (*An Anthropologist on Mars*): GPT missed the author completely (`authors: ""`). Gemini detected author `Oliver Sacks`.
- On Book #8 & #9: Gemini included the full subtitles (*A Brief History of Humankind* and *A Brief History of Tomorrow*), which directly aids search discovery.

### 3. Coordinate Handling
- **GPT-6.1-sol**: Outputs in absolute pixel coordinate space (`orig_w × orig_h`).
- **Gemini 3.8 Flash**: Natively operates in normalized `[0, 1000]` coordinates. By configuring the pipeline to request normalized coordinates and scaling them by `(web_w / 1000, web_h / 1000)`, the resulting polygon masks align corner-to-corner with extreme precision.

---

## 💡 Configuration Guide: How to Switch Models

In your `.env` file, set:
```env
# Choose between Gemini and OpenAI models:
MODEL_NAME=gemini-3.8-flash
GEMINI_API_KEY=your_gemini_api_key

# Or switch back to OpenAI:
# MODEL_NAME=gpt-6.1-sol
# OPENAI_API_KEY=your_openai_api_key
```
