# DM3A Grader — Handoff

## URLs & Passwords
- **Frontend**: https://dm3a-grader.vercel.app (Vercel, auto-deploys on `vercel --prod`)
- **Backend**: https://dm3a-grader-server.onrender.com (Render, auto-deploys on `git push`)
- **GitHub**: https://github.com/rminaya-ios/dm3a-grader
- **App password**: `dmgof50c`

## Architecture
```
Browser (Vite/React)  →  Express server (Render)  →  Anthropic API (claude-sonnet-4-6)
     src/App.jsx              server/index.js
```
- `/upload-pdf` — pass-through: receives `{ base64, mediaType }`, returns `{ file_id: base64 }` (no Anthropic Files API)
- `/grade` — receives `{ contentBlocks, systemPrompt, userPrompt }`, appends userPrompt as text block, calls Claude with `max_tokens: 16000`, returns `{ result: text }`

## Grading Pipeline
1. User selects subject + uploads PDFs/images
2. **All PDFs** → `pdfToImages()` (pdf.js CDN, max 8 pages, 1200px, 0.75 quality) — no raw PDF base64 ever sent
3. `fileToImageBlocks(file)` helper unifies PDF and image handling
4. `sharedBlocks` = assignment prompt + answer key (also images only)
5. `fetchGradeResult()` POSTs to `/grade`; reads `response.text()` then JSON-parses with fallback (never `response.json()`)
6. Results normalised to `{ studentName, overallTier, dimensions: {…}, problems, feedback }`

## Batch Modes
- **Single student**: individual files loop, one call per file
- **Fixed pages**: splits batch PDF into N-page chunks, one API call per student
- **Auto-detect**: all pages sent in one call; `batchSystemPrompt` instructs Claude to find name boundaries; response extracted with `raw.slice(indexOf("["), lastIndexOf("]")+1)`

## Deploy Commands
```bash
git add -A && git commit -m "…" && git push   # pushes to GitHub → Render auto-deploys backend
vercel --prod                                  # deploys frontend to Vercel
```

## Phase 1 Development Plan

**Differentiator:** "DM3A Grader was built for real classrooms — not perfect submissions"

### PDF Stress-Test Pipeline
Upload → Size Check → Page Count → Page Preview → Readability Score → Auto-Compress → Grade

### File Size Targets
| Tier | Limit | Status |
|---|---|---|
| Current | ~4 MB | Live |
| MVP | 25 MB | Phase 1 goal |
| Competitive | 50 MB | Phase 2 |
| Long-term | 100 MB | Matches Gradescope/Canvas |

### Competitor Limits
| Tool | Limit |
|---|---|
| Crowdmark | 25 MB |
| Möbius | 10 MB |
| Gradescope | 100 MB |
| Canvas | 100 MB preview |

### Test File Targets (one batch per course: Statistics, Precalculus, Intermediate Algebra)
| Batch | Students | File Size |
|---|---|---|
| Small | 5 | < 5 MB |
| Medium | 15 | 5–25 MB |
| Large | 25–30 | 25–50 MB |

## Known Issues / Watch Out For
- Render free tier spins down after inactivity — first request after idle takes ~15s
- `pdfToImages` uses a CDN import; if the CDN is down, PDF conversion silently fails (error shown in feedback field)
- Auto-detect works best with ≤16 pages; larger batches may truncate even at 16k tokens
- `max_tokens: 16000` is set in `server/index.js` — raise if large batches still truncate
