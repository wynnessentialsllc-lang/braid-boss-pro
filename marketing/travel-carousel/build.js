// Generates 9 TikTok carousel slides (3:4) for Braid Boss Pro —
// "Traveling / mobile braid services". Writes one HTML file per slide;
// a companion shell loop renders each to PNG via headless Chromium.
const fs = require("fs");
const path = require("path");

const DIR = __dirname;
const FONTS = path.join(DIR, "fonts");
const b64 = (f) => fs.readFileSync(path.join(FONTS, f)).toString("base64");
const face = (w, file) => `@font-face{font-family:'Poppins';font-style:normal;font-weight:${w};src:url(data:font/ttf;base64,${b64(file)}) format('truetype');}`;

const FONT_CSS = [
  face(400, "Poppins-400.ttf"),
  face(600, "Poppins-600.ttf"),
  face(700, "Poppins-700.ttf"),
  face(800, "Poppins-800.ttf"),
  face(900, "Poppins-900.ttf"),
].join("\n");

// Brand palette pulled from the app (app/page.tsx).
const C = {
  ink: "#15111A",
  ink2: "#1E1726",
  purple: "#7C3AED",
  purpleDeep: "#5B21B6",
  coral: "#FF4D6D",
  pink: "#FF6B9D",
  green: "#22C55E",
  gold: "#F5B301",
  cream: "#F6F2FF",
  mute: "#B9AEC7",
};

const BASE = `
*{margin:0;padding:0;box-sizing:border-box;-webkit-font-smoothing:antialiased;}
${FONT_CSS}
html,body{width:1080px;height:1440px;}
.slide{position:relative;width:1080px;height:1440px;overflow:hidden;
  font-family:'Poppins',sans-serif;color:#fff;
  background:radial-gradient(120% 90% at 78% -8%, ${C.purpleDeep} 0%, ${C.ink2} 46%, ${C.ink} 100%);
  padding:96px 88px;display:flex;flex-direction:column;}
.blob{position:absolute;border-radius:50%;filter:blur(4px);opacity:.5;}
.b1{width:520px;height:520px;top:-180px;right:-160px;background:radial-gradient(circle,${C.purple},transparent 68%);opacity:.55;}
.b2{width:460px;height:460px;bottom:-190px;left:-150px;background:radial-gradient(circle,${C.coral},transparent 68%);opacity:.4;}
.kicker{display:inline-flex;align-items:center;gap:14px;font-weight:800;letter-spacing:.32em;
  font-size:24px;text-transform:uppercase;color:${C.pink};}
.dot{width:14px;height:14px;border-radius:50%;background:${C.coral};box-shadow:0 0 20px ${C.coral};}
h1{font-weight:900;line-height:1.02;letter-spacing:-.015em;}
h2{font-weight:900;line-height:1.05;letter-spacing:-.01em;}
.accent{color:${C.pink};}
.accent-g{color:${C.green};}
.accent-y{color:${C.gold};}
.list{list-style:none;display:flex;flex-direction:column;gap:26px;margin-top:8px;}
.li{display:flex;gap:26px;align-items:flex-start;}
.num{flex:0 0 66px;height:66px;border-radius:20px;display:flex;align-items:center;justify-content:center;
  font-weight:900;font-size:30px;color:#fff;background:linear-gradient(140deg,${C.purple},${C.coral});
  box-shadow:0 12px 30px rgba(124,58,237,.45);}
.chk{flex:0 0 60px;height:60px;border-radius:50%;display:flex;align-items:center;justify-content:center;
  font-size:32px;background:rgba(34,197,94,.16);border:2px solid ${C.green};}
.txt-h{font-weight:800;font-size:34px;line-height:1.18;}
.txt-b{font-weight:400;font-size:27px;line-height:1.32;color:${C.mute};margin-top:4px;}
.card{background:rgba(255,255,255,.055);border:1px solid rgba(255,255,255,.10);border-radius:34px;
  padding:44px 46px;backdrop-filter:blur(4px);}
.foot{margin-top:auto;display:flex;align-items:center;justify-content:space-between;
  font-weight:600;font-size:22px;color:${C.mute};padding-top:34px;}
.pill{font-weight:700;font-size:22px;color:${C.cream};background:rgba(255,255,255,.09);
  border:1px solid rgba(255,255,255,.14);padding:12px 24px;border-radius:999px;}
.swipe{display:inline-flex;align-items:center;gap:12px;color:${C.pink};font-weight:800;font-size:26px;}
.src{font-weight:500;font-size:19px;color:#8B8095;line-height:1.4;}
.logo{display:inline-flex;align-items:center;gap:16px;font-weight:900;font-size:26px;letter-spacing:-.01em;}
.mark{width:52px;height:52px;border-radius:15px;background:linear-gradient(140deg,${C.purple},${C.coral});
  display:flex;align-items:center;justify-content:center;font-size:28px;box-shadow:0 8px 22px rgba(124,58,237,.5);}
.page{position:absolute;top:78px;right:88px;font-weight:800;font-size:22px;color:rgba(255,255,255,.4);letter-spacing:.05em;}
.tag{display:inline-block;font-weight:800;font-size:23px;color:${C.ink};background:${C.gold};
  padding:10px 22px;border-radius:999px;letter-spacing:.02em;}
.stat{font-weight:900;font-size:120px;line-height:.92;letter-spacing:-.03em;
  background:linear-gradient(120deg,${C.pink},${C.gold});-webkit-background-clip:text;background-clip:text;color:transparent;}
`;

const wrap = (page, inner, extra = "") =>
`<!doctype html><html><head><meta charset="utf-8"><style>${BASE}${extra}</style></head>
<body><div class="slide"><div class="blob b1"></div><div class="blob b2"></div>
${page ? `<div class="page">${page}</div>` : ""}${inner}</div></body></html>`;

const logo = `<div class="logo"><span class="mark">💇🏾‍♀️</span>Braid Boss Pro</div>`;

// ---- Slides ----
const slides = [];

// 1 — Cover
slides.push(wrap("", `
  <div class="kicker"><span class="dot"></span>Braid Boss Pro</div>
  <h1 style="font-size:118px;margin-top:54px;">Bring the<br>braids to<br><span class="accent">THEM</span> 🚗</h1>
  <p style="font-weight:600;font-size:38px;line-height:1.3;color:${C.cream};margin-top:44px;max-width:760px;">
    Why <b>traveling braid services</b> — you go to the client — could be your biggest money move this year.</p>
  <div class="foot">
    <div class="swipe">Swipe <span style="font-size:34px;">→</span></div>
    <div class="pill">Mobile braiding, unpacked</div>
  </div>`));

// 2 — Benefits
slides.push(wrap("01 / 09", `
  <div class="kicker"><span class="dot"></span>The upside</div>
  <h2 style="font-size:70px;margin-top:30px;">Why add <span class="accent">travel</span> service?</h2>
  <ul class="list" style="margin-top:52px;">
    ${[
      ["💸","Clients pay for convenience","No salon, no traffic — you show up, they relax at home."],
      ["🎯","You stand out","Most braiders don't travel. Offering it wins the booking."],
      ["👵🏾","Reach more people","Busy moms, elders & clients with limited mobility."],
      ["📅","Fewer no-shows","They're already home — nowhere to flake to."],
    ].map(([e,h,b])=>`<li class="li"><div class="chk">${e}</div><div><div class="txt-h">${h}</div><div class="txt-b">${b}</div></div></li>`).join("")}
  </ul>
  <div class="foot"><span class="src">Sources: Un-ruly · Dash Stylists</span><span class="swipe">→</span></div>`));

// 3 — Professional
slides.push(wrap("02 / 09", `
  <div class="kicker"><span class="dot"></span>Stay pro</div>
  <h2 style="font-size:66px;margin-top:30px;">Look pro on<br>the road 💼</h2>
  <ul class="list" style="margin-top:46px;">
    ${[
      ["Lock the details","Confirm address, parking & entry the day before."],
      ["Deposit + contract first","Send a digital contract and take a deposit before you drive."],
      ["Arrive on time, on brand","Branded tee, name tag, a calm playlist — not their TV."],
      ["Bring a set menu","Printed prices = no on-the-spot haggling at the door."],
    ].map(([h,b],i)=>`<li class="li"><div class="num">${i+1}</div><div><div class="txt-h">${h}</div><div class="txt-b">${b}</div></div></li>`).join("")}
  </ul>
  <div class="foot"><span class="src">Source: GlossGenius</span><span class="swipe">→</span></div>`));

// 4 — Clean & tidy
slides.push(wrap("03 / 09", `
  <div class="kicker"><span class="dot"></span>Clean & tidy</div>
  <h2 style="font-size:66px;margin-top:30px;">Leave it better<br>than you found it 🧼</h2>
  <ul class="list" style="margin-top:46px;">
    ${[
      ["Pack a portable station","Own chair, mirror, ring light & a tool caddy."],
      ["Catch every hair","Lay a drop cloth or sheet under the chair."],
      ["Sanitize between clients","EPA wipes on combs, clips & edge tools."],
      ["Reset the room","Lint-roll & vacuum before you walk out."],
    ].map(([h,b],i)=>`<li class="li"><div class="num">${i+1}</div><div><div class="txt-h">${h}</div><div class="txt-b">${b}</div></div></li>`).join("")}
  </ul>
  <div class="foot"><span class="src">Source: Dash Stylists (COVID safety & gear)</span><span class="swipe">→</span></div>`));

// 5 — Pricing
slides.push(wrap("04 / 09", `
  <div class="kicker"><span class="dot"></span>Pricing</div>
  <h2 style="font-size:66px;margin-top:30px;">Charge for the<br><span class="accent">drive</span> 🚙💨</h2>
  <p style="font-weight:600;font-size:28px;color:${C.cream};margin-top:30px;">
    Keep your normal install price — then <b>add a travel fee</b>. 4 models that work:</p>
  <ul class="list" style="margin-top:36px;gap:22px;">
    ${[
      ["Flat fee","One clean number — most charge <b>$25–$75</b> extra."],
      ["Per-mile","IRS 2025 rate is <b>70¢/mi</b> — charge more for your time."],
      ["Hybrid","First few miles free, then per-mile after that."],
      ["Tiered","Set fee bands by distance (0–10mi, 10–20mi…)."],
    ].map(([h,b])=>`<li class="li"><div class="chk" style="border-color:${C.gold};background:rgba(245,179,1,.15);">💵</div><div><div class="txt-h">${h}</div><div class="txt-b">${b}</div></div></li>`).join("")}
  </ul>
  <div class="foot"><span class="src">Sources: Home Business Hub · Bridal Babes · IRS</span><span class="swipe">→</span></div>`));

// 6 — Income
slides.push(wrap("05 / 09", `
  <div class="kicker"><span class="dot"></span>The money</div>
  <h2 style="font-size:62px;margin-top:26px;">How much <span class="accent-y">more?</span></h2>
  <div class="card" style="margin-top:40px;text-align:center;">
    <div style="font-weight:600;font-size:26px;color:${C.mute};">3 mobile clients / week × $40 travel fee</div>
    <div class="stat" style="margin:14px 0 6px;">+$5,760</div>
    <div style="font-weight:700;font-size:30px;color:${C.cream};">extra per year — <span class="accent-g">just in travel fees</span></div>
  </div>
  <ul class="list" style="margin-top:40px;gap:22px;">
    ${[
      ["$220 install + $40 travel = <b>$260</b> a head","Premium clients gladly pay for privacy & convenience."],
      ["Set aside <b>8–12%</b> for gas & supplies","So your travel fee stays real profit, not overhead."],
    ].map(([h,b])=>`<li class="li"><div class="chk">📈</div><div><div class="txt-h">${h}</div><div class="txt-b">${b}</div></div></li>`).join("")}
  </ul>
  <div class="foot"><span class="src">Illustrative math · Home Business Hub pricing data</span><span class="swipe">→</span></div>`));

// 7 — Cons
slides.push(wrap("06 / 09", `
  <div class="kicker"><span class="dot"></span>Keep it 💯</div>
  <h2 style="font-size:66px;margin-top:30px;">The cons,<br>for real ⚠️</h2>
  <ul class="list" style="margin-top:46px;">
    ${[
      ["🕒","Travel = fewer heads/day","Windshield time is unpaid time. Batch nearby bookings."],
      ["⛽","Gas & wear add up","Vehicle upkeep is on you — price it in."],
      ["🔒","Your safety first","Vet new clients & share your live location with someone."],
      ["📄","More insurance","Liability + commercial auto if you work from your car."],
    ].map(([e,h,b])=>`<li class="li"><div class="chk" style="border-color:${C.coral};background:rgba(255,77,109,.14);">${e}</div><div><div class="txt-h">${h}</div><div class="txt-b">${b}</div></div></li>`).join("")}
  </ul>
  <div class="foot"><span class="src">Sources: Noona HQ · Scissors & Scotch · needahairmakeover</span><span class="swipe">→</span></div>`));

// 8 — Braid Boss Pro feature
slides.push(wrap("07 / 09", `
  <div class="kicker"><span class="dot"></span>Built-in tool</div>
  <h2 style="font-size:60px;margin-top:26px;">Braid Boss Pro does<br>the math for you 🤝</h2>
  <span class="tag" style="margin-top:30px;">Customize booking page → Mobile services</span>
  <ul class="list" style="margin-top:40px;gap:24px;">
    ${[
      ["Set your base + radius","Say how far you'll travel — 15 mi, 30 mi, your call."],
      ["Flip mobile ON per service","Only the styles you'll do on the road."],
      ["Pick your fee model","Flat, per-mile, hybrid or tiered — same 4 models."],
      ["Auto-priced at checkout","App measures distance from the client's address & adds the fee."],
      ["Out of range? Hidden.","Clients past your radius never see the option."],
    ].map(([h,b],i)=>`<li class="li"><div class="num">${i+1}</div><div><div class="txt-h">${h}</div><div class="txt-b">${b}</div></div></li>`).join("")}
  </ul>
  <div class="foot">${logo}<span class="swipe">→</span></div>`));

// 9 — CTA
slides.push(wrap("08 / 09", `
  <div class="kicker"><span class="dot"></span>Your move</div>
  <h1 style="font-size:92px;margin-top:40px;">Ready to<br>hit the<br><span class="accent">road?</span> 🚗💨</h1>
  <p style="font-weight:600;font-size:32px;line-height:1.32;color:${C.cream};margin-top:38px;max-width:780px;">
    Turn on <b>travel service</b> in Braid Boss Pro and let the app price every mile for you.</p>
  <div style="display:flex;gap:18px;margin-top:40px;flex-wrap:wrap;">
    <span class="pill">📌 Save this</span><span class="pill">➡️ Share it</span><span class="pill">➕ Follow for braid-biz tips</span>
  </div>
  <div style="margin-top:52px;">${logo}
    <div style="font-weight:700;font-size:26px;color:${C.pink};margin-top:16px;">braidbosspro.app · @braidbosspro</div>
  </div>
  <div class="foot" style="align-items:flex-end;">
    <span class="src" style="max-width:900px;">Sources: Un-ruly; Dash Stylists; Home Business Hub (2026 braiding pricing guide);
    GlossGenius; Bridal Babes Society; Noona HQ; Scissors &amp; Scotch; needahairmakeover.blog; IRS 2025 mileage rate.</span>
  </div>`));

slides.forEach((html, i) => {
  const p = path.join(DIR, `slide-${String(i + 1).padStart(2, "0")}.html`);
  fs.writeFileSync(p, html);
});
console.log(`Wrote ${slides.length} slide HTML files.`);
