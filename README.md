# bitsNparts

Mobile-first workshop PWA and Gemini Vision scanner for identifying drill bits, masonry bits, wood bits, hole saws, step drills, and screwdriver/driver bits — backed by SQLite in Docker.

## Features

- **Phone Camera & Photo Scan (Single or Batch)**: Works with live rear camera (`getUserMedia` + flashlight torch toggle over HTTPS) and direct phone camera/gallery upload (`<input capture="environment">`) over LAN HTTP.
- **Gemini Vision Identification (`gemini-3.8-flash` via `@google/genai` Interactions API)**:
  - **Size**: Reads stamped/etched markings or estimates diameter via scale references (printable mat, US Quarter, credit card, `1/4"` hex shank, or interactive photo caliper).
  - **Type & Subtype**: Masonry, Wood (brad point, spade, auger, Forstner), All-Purpose / Metal (HSS, TiN, Cobalt), Hole Saw, Screwdriver / Driver (PH, Torx, Square, Nut), Step / Countersink.
  - **Manufacturer & Model Line**: Extracts legible brands and distinctive color bands without guessing.
  - **Shank, Material/Coating & Wear**: Inspects shank geometry, alloy/coating, and edge wear/damage.
  - **Workshop Usage Guidance**: Recommended materials, pilot hole / fastener matches, and speed/RPM tips.
- **Interactive Photo Caliper**: Tap across a reference object (`24.26mm` US Quarter, `85.6mm` credit card, `100mm` mat, `6.35mm` hex shank) and the bit diameter to snap to standard imperial fractional (`1/64"` steps) and `0.5mm` metric sizes.
- **Printable 1:1 Calibration Mat**: Open `/calibration-mat.html` and print at 100% scale for high-contrast scanning of dark or shiny unmarked bits.
- **SQLite Toolbox Inventory & Missing-Size Audit**: Built-in `node:sqlite` (`WAL` mode) database tracking drawer/case locations, quantities, wear status, CSV/JSON export, and missing-size audits against 29-pc/15-pc fractional, 25-pc metric, masonry, and driver sets.

---

## Local Development Quick Start

Requires **Node.js >= 24.0.0** (for built-in `node:sqlite`).

```bash
npm install
cp .env.example .env
# Add your GEMINI_API_KEY in .env
npm start
```

Open `http://localhost:8090` (runs on `localhost` with live camera enabled).

Run syntax checks and automated tests:

```bash
npm run check
npm test
```

---

## Deploying to HX90 with Docker + SQLite

Everything persists in `./data` on HX90 (`./data/bitsnparts.db` + `./data/uploads/`) mounted to `/app/data` in the container.

1. SSH to HX90 and clone/pull into `/home/peeps/workspace/bitsNparts`:

   ```bash
   ssh hx90
   cd /home/peeps/workspace
   git clone https://github.com/hwwallace12/bitsNparts.git
   cd bitsNparts
   ```

   *(If already cloned: `cd /home/peeps/workspace/bitsNparts && git pull`)*

2. Create `.env` with your Gemini API key:

   ```bash
   cp .env.example .env
   nano .env
   # Set GEMINI_API_KEY=your_key_here
   ```

3. Build and start the container on port `8090`:

   ```bash
   docker compose up -d --build
   ```

4. Verify SQLite and server health:

   ```bash
   curl http://192.168.68.40:8090/api/health
   ```

   From your phone on home Wi-Fi, open `http://192.168.68.40:8090` and use **Take Photo** (native phone camera capture works over HTTP).

---

## Phone HTTPS Access (for Live Viewfinder & PWA Install)

Browsers require a secure HTTPS origin for live in-browser `getUserMedia` camera preview and full PWA installation. Choose either option on HX90:

### Option A: Tailscale Serve (Private Tailnet TLS, Recommended)

Expose port `8090` privately over Tailscale HTTPS on port `8443` (leaving `5006` on default `443` untouched):

```bash
ssh hx90 "sudo tailscale serve --bg --https=8443 http://localhost:8090"
```

Open `https://hx90.tail24a6db.ts.net:8443` on your phone when connected to Tailscale, then tap **Add to Home Screen**.

### Option B: Cloudflare Tunnel (Quick Tunnel / Public Hostname)

Matching the `BingePick` setup on HX90, start the optional `cloudflared` profile:

```bash
ssh hx90 "cd /home/peeps/workspace/bitsNparts && docker compose --profile tunnel up -d"
ssh hx90 "docker logs bitsnparts-tunnel"
```

*(For a permanent hostname with Zero Trust Access protection, point a named Cloudflare Tunnel to `http://localhost:8090`.)*

---

## SQLite Backup & Restore

Stop the container (or ensure quiet writes), then copy the `data/` folder:

```bash
# Backup on HX90
ssh hx90 "cd /home/peeps/workspace/bitsNparts && tar -czf ~/bitsnparts-backup-\$(date +%F).tar.gz data/"

# Restore on HX90
ssh hx90 "cd /home/peeps/workspace/bitsNparts && docker compose down && tar -xzf ~/bitsnparts-backup-YYYY-MM-DD.tar.gz && docker compose up -d"
```
