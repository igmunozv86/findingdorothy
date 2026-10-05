# CLICK BY CLICK — run FindingDorothy on your Mac
*No experience assumed. ~15 minutes.*

## What we're doing
The code lives on my computer right now. We're moving it to YOUR Mac and running the forecast there.

You need 3 things: the code (download below), Cursor (you have it), Node.js (free 3-minute install that lets your Mac run JavaScript).

## Step 1 — Download the code (1 min)
1. Download the zip (link in chat).
2. Double-click the zip → a folder called `findingdorothy` appears. That's the whole project.

## Step 2 — Install Node.js (3 min, skip if you have it)
1. Go to **nodejs.org**.
2. Click the big button that says **LTS** (the stable version).
3. Open the downloaded file → Next → Next → Install. Done.
4. What this is: your Mac can't run JavaScript outside a browser by itself. Node is the free tool that does.

## Step 3 — Open it in Cursor (1 min)
1. Open Cursor.
2. **File → Open Folder…**
3. Pick the `findingdorothy` folder. The file list appears on the left: `apps`, `packages`, `data`, `scripts`…

## Step 4 — Open the terminal (30 sec)
1. In Cursor: **Terminal → New Terminal** (top menu).
2. A panel opens at the bottom with a blinking cursor. That's the terminal — typing commands at your Mac.
3. Type this, hit Enter: `cd ~/Downloads/findingdorothy`
   - `cd` = "change directory" = double-clicking into a folder, but by typing.

## Step 5 — Run the forecast (10 sec)
1. Type exactly: `node scripts/forecast-tonight.mjs` → Enter.
2. The Scene Forecast table prints: 5 SF venues with scores. You just ran the product.

## Step 6 — Break it: the actual lesson (5 min)
1. Left file list: `scripts` → `forecast-tonight.mjs`.
2. Find `weekend: { p: 0.75` (sauna line). Change `0.75` to `0.95`.
3. Save: **Cmd+S**.
4. Terminal: press **↑** (up arrow) — your last command reappears — hit Enter.
5. Steamworks' score jumped. You changed the product's brain and watched it think differently.

## Step 7 — Add a venue (5 min)
1. Open `data/seed-venues.json`.
2. Copy a venue block, paste, change name/details. Save.
3. Terminal: **↑** + Enter. Your venue appears in the forecast.

That's the whole loop forever: change a file → rerun → see what happens.
