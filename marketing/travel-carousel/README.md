# TikTok Carousel — Traveling / Mobile Braid Services

A 9-slide TikTok carousel for **Braid Boss Pro** on offering *travel
services* (the braider goes to the client). Covers the benefits,
step-by-step professionalism & cleanliness, pricing, income upside, the
cons, and the app's built-in mobile-service travel-fee feature.

## Specs
- **Slides:** 9 (`slide-01.png` … `slide-09.png`)
- **Size:** 1080 × 1440 px — **3:4** aspect ratio
- **Format:** PNG

## Slide order
1. Cover — "Bring the braids to THEM"
2. Why add travel service (benefits)
3. Stay professional on the road (steps)
4. Keep it clean & tidy (steps)
5. How to price it — 4 travel-fee models
6. How much more you could earn
7. The cons, kept 100
8. Braid Boss Pro's built-in travel-fee feature
9. CTA + sources

## Rebuild
```bash
node build.js   # regenerates slide-*.html
# then render each with headless Chromium at 1080x1440:
for f in slide-*.html; do \
  chrome --headless=new --disable-gpu --no-sandbox --hide-scrollbars \
    --window-size=1080,1440 --screenshot="${f%.html}.png" "$f"; done
```
Fonts: Poppins (bundled in `fonts/`, embedded as base64 by `build.js`).

## Sources
Un-ruly · Dash Stylists · Home Business Hub (2026 braiding pricing guide) ·
GlossGenius · Bridal Babes Society · Noona HQ · Scissors & Scotch ·
needahairmakeover.blog · IRS 2025 standard mileage rate.
