# Select venues for a city

Use this with `.cursor/rules/city-research.mdc`. That brief is the contract. Run `node scripts/select-venues.mjs` before `node scripts/merge-cities.mjs`.

The city file is `data/cities/<slug>.json` after a passing merge. There is no `data/cities.json` index. `id` is `<slug>-<name-slug>`.

## Scan

Search the venue name in English and in the city's language. Log which language each query used. São Paulo and any city string that names Brazil use Portuguese. Madrid uses Spanish.

Read sources in this order:

1. The venue's own website.
2. The venue's official Instagram.
3. The city's official tourism page.
4. Another page that is clearly about that venue, when the three above do not print the street.

Hours are read only from the first two. The other pages can supply the address and nothing else.

## Select

Keep a venue when a real page names it and gives one street address. That page can be the venue's own site, its official Instagram, the city's tourism page, or another page that is clearly about that venue. Drop it when two of those pages disagree on the address, or when a page says it has closed. Guides can place a venue. They cannot verify hours.

Do not stop after the first few official sites. A live city needs four lanes before the list is done:

1. Saturday clubs. A disco or Saturday dance club is stored as `bar`.
2. Neighborhood bars, also `bar`.
3. Saunas, stored as `sauna`.
4. Cruise bars and sex clubs, stored as `cruise` or `sex`.

Floor for a major city: at least 4 Saturday clubs, at least 6 bars and saunas beyond that first handful, and more than one cruise or sex venue. A short list with no clubs is a failed pass. Do not invent a name to hit the floor. If a real page is missing, leave that venue out and say so.

Neighborhood is the one the venue's own page names. If that page does not name one, use the Nominatim suburb.

Coordinates come from Nominatim for that street address, one request at a time, with a User-Agent. If the hit is another town, search again with the postal code. Never type a latitude or longitude by hand. Never store a phone number.

`review_features` are short phrases from the page that justified the venue.

## Hours

`hours_verified` is true only when the venue's own site, official Instagram, or own Facebook page states a full open and a full close for each open day. Store that window. `source_url` is required in that case.

A tourism page, a guide, or an open time with no close does not verify hours. Set `hours` to `"no recent data"` and `hours_verified` to false. Do not store `{}` or a phone number.

`00:00` as an end means midnight. An end earlier than the start crosses midnight. A window that starts at `00:00` is stored as written.

The only names shown are Dance and drinks, Saunas, Cruisy, and Events. Events is the dated-events chip, not a stored category. Stored `category`: `bar` and `club` are Dance and drinks, `sauna` is Saunas, `cruise` and `sex` are Cruisy.

## Events

Pride dates live on the city as `events`: `{name, type: "pride", start, end, source}`. `source` is the organizer page. The page reads these per-city arrays in `data/cities/`. There is no `data/pride-events.json`. A one-day event sets `end` equal to `start`. Do not copy last year's dates forward. An empty array is honest.

## Ids

`id` is `<slug>-<name-slug>` and must be unique. The slug is `meta.slug` and the filename.
