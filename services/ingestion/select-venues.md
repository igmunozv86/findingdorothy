# Select venues for a city

Use this whenever a city is added or its venue list changes. Do not ask for the rules again. Run `node scripts/select-venues.mjs` before `node scripts/build-web.mjs`.

The city `name` in `data/cities.json` is the only value allowed in `venue.city`. Set `live` to true only after this pass. Card rules, sections, hours, and ranking already apply to every live city.

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

`hours_verified` is true only when the venue's own site or official Instagram states a full open and a full close for each open day. Store that window. `source_url` is required in that case.

A tourism page, a guide, or an open time with no close does not verify hours. Leave `hours` null and explain the gap in `hours_note`. Do not store `{}`.

`00:00` as an end means midnight. An end earlier than the start crosses midnight. A window that starts at `00:00` is stored as written.

Categories: `bar` is Drinks and Dance, `sauna` is Saunas and Bathhouses, `cruise` and `sex` are Fun Fun.

## Pride date

Adding a city includes its pride date. Read the organizer's own page, or the city's official tourism page when that page states the dates. Write the row in `data/pride-events.json`. `city_id` matches the city `id`. Required fields are `start`, `end`, `source_url`, `source_name`, and `retrieved_at`. A one-day march sets `end` equal to `start`. A march inside a published week is a second row with `parent_id` and its own source.

If that year's date is not on the page, add no row. Do not copy last year's dates forward from a habit such as "the last weekend in June."

The city page uses the same frame for every live city, and it shows the pride notice only while those dates are underway. The Pride Calendar lists the row under that year and month. Search on that page is by city and by year.

## Ids

`id` is `{city-id}-{short-name}` and must be unique. `city-id` is the `id` in `data/cities.json`, such as `mad-delirio`.
