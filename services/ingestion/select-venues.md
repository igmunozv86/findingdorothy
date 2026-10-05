# Select venues for a city

Use this whenever a city is added or its venue list changes. Do not ask for the rules again. Run `node scripts/select-venues.mjs` before `node scripts/build-web.mjs`.

The city `name` in `data/cities.json` is the only value allowed in `venue.city`. Set `live` to true only after this pass. Card rules, sections, hours, and ranking already apply to every live city.

## Scan

Search the venue name in English and in the city's language. Log which language each query used. São Paulo and any city string that names Brazil use Portuguese. Madrid uses Spanish.

Read sources in this order:

1. The venue's own website.
2. The venue's official Instagram.
3. The city's official tourism page.

Guides, Google hours, and GayCities, Travel Gay, or Misterb&b do not select a venue and do not verify hours.

## Select

Keep a venue only when one of those three sources names it and gives one street address. Drop it when two of those sources disagree on the address, or when a page says it has closed. Do not add a place to fill a section. A section can be one card.

Neighborhood is the one the venue's own page names. If that page does not name one, use the Nominatim suburb.

Coordinates come from Nominatim for that street address, one request at a time, with a User-Agent. If the hit is another town, search again with the postal code. Never type a latitude or longitude by hand. Never store a phone number.

`review_features` are short phrases from the page that justified the venue.

## Hours

`hours_verified` is true only when the venue's own site or official Instagram states a full open and a full close for each open day. Store that window. `source_url` is required in that case.

A tourism page, a guide, or an open time with no close does not verify hours. Leave `hours` null and explain the gap in `hours_note`. Do not store `{}`.

`00:00` as an end means midnight. An end earlier than the start crosses midnight. A window that starts at `00:00` is stored as written.

Categories: `bar` is Drinks and Dance, `sauna` is Saunas and Bathhouses, `cruise` and `sex` are Fun Fun.

## Ids

`id` is `{city-id}-{short-name}` and must be unique. `city-id` is the `id` in `data/cities.json`, such as `mad-delirio`.
