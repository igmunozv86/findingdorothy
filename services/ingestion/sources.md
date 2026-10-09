# Venue sources

Official APIs come first. A page fetch is only allowed after a ToS review, and only when `SOURCES_TOS_CHECK=1`. GayCities, Travel Gay, and Misterb&b break a tie when mainstream sources disagree that a place is a gay venue. Their claims still need `source_url` and `retrieved_at`.

Nothing here invents a fact. An empty response is logged as `no recent data` and the venue keeps what it already has.

The client sends one request at a time, waits 1 second between calls, and stops the run on HTTP 429. Overpass is never parallelized, and a repeated Overpass or Nominatim query is served from the in-memory cache.

Run order: OpenStreetMap Overpass, Wikidata, Yelp, Foursquare, Google Places, Eventbrite, Reddit, Songkick, Ticketmaster, Bandsintown, then GayCities, Travel Gay, and Misterb&b. Resident Advisor, Scruff, Grindr, TripAdvisor, and Instagram are manual. Forums stay without a universal API.

A venue whose city is São Paulo, or any city string that names Brazil, is searched in English and in Portuguese. Each request records `query_language`.

A stored signal matches `signals` in `infra/schema.sql` and also carries `source_url` and `retrieved_at` (those two columns live on `sources`). A record with no `source_url` is dropped.

Aspects the table allows: `cleanliness`, `safety`, `crowd`, `facilities`, `staff`, `value`. `sentiment` is a number from -1 to 1. Hours, price, and a star rating are not stored as a signal until they can be tied to one of those aspects without a guess.

## OpenStreetMap / Overpass

- Docs: https://wiki.openstreetmap.org/wiki/Overpass_API and https://operations.osmfoundation.org/policies/nominatim/
- Extract: `opening_hours`, address tags, coordinates from the element, and any `lgbtq` or `gay` tags. Those facts are not aspects, so they are not stored as a signal.
- Auth: none.
- Calls: `GET https://nominatim.openstreetmap.org/search` for the city bounding box, then `POST https://overpass-api.de/api/interpreter`. The box is the Nominatim `boundingbox`. It is not hardcoded. `{{bbox}}` in a dry run means that value is still unknown.
- Rate limit: one request at a time. The public Overpass instance expects a User-Agent and no parallel calls. This client waits 1 second, caches by query text, and stops on 429.
- ToS: use the public instance lightly and keep the results cached. Do not send overlapping Overpass requests.

## Wikidata

- Docs: https://www.wikidata.org/w/api.php
- Extract: address (`P969`), coordinates (`P625`), inception (`P571`). Those claims are not aspects, so they are not stored as a signal.
- Auth: none.
- Calls: `action=wbsearchentities` by venue name and city, then `action=wbgetentities` with `props=claims` only after the search returns a Q-id. The id is not guessed.
- Rate limit: no key. This client waits 1 second and stops on 429. A User-Agent is sent.
- ToS: https://www.wikidata.org/wiki/Wikidata:Licensing — content is under CC0. Still send one request at a time.

## Yelp Fusion

- Docs: https://docs.developer.yelp.com/docs/fusion-intro
- Search: https://docs.developer.yelp.com/reference/v3_business_search
- Extract: business page URL, hours, rating, price, review text. Discovery filter: category `gaybars`.
- Auth: `Authorization: Bearer` from `YELP_API_KEY`.
- Calls: `GET https://api.yelp.com/v3/businesses/search`, then `GET /v3/businesses/{id}` and `GET /v3/businesses/{id}/reviews` only after search returns an id.
- Rate limit: plan-specific. The trial daily cap and a queries-per-second cap both return 429. Headers include `RateLimit-Remaining` and `RateLimit-ResetTime`. Daily limits reset at midnight UTC. https://docs.developer.yelp.com/docs/places-rate-limiting
- ToS: https://docs.developer.yelp.com/docs/policies — cache within Yelp's display rules; do not store content beyond what the terms allow.

## Foursquare Places

- Docs: https://location.foursquare.com/products/places/ and https://docs.foursquare.com/fsq-developers-places/reference/place-search
- Extract: place page, hours, tips, popularity fields when the response includes them. Popularity can become a `crowd` signal only when the payload has a numeric popularity value.
- Auth: `Authorization: Bearer` from `FOURSQUARE_API_KEY`, plus `X-Places-Api-Version: 2025-06-17`.
- Calls: `GET https://places-api.foursquare.com/places/search`. Tips are `GET /places/{fsq_place_id}/tips` only after search returns an id.
- Rate limit: quota depends on the Places plan. This client still waits 1 second and stops on 429.
- ToS: https://foursquare.com/legal/api/platformpolicy

## Google Places API (New)

- Docs: https://developers.google.com/maps/documentation/places/web-service/text-search
- Extract: `googleMapsUri`, `regularOpeningHours`, `reviews`, `photos` (photo names, not image bytes), `rating`.
- Not extracted: Popular Times. The Places API does not return that field. Do not scrape Google Maps to fill it.
- Auth: `X-Goog-Api-Key` from `GOOGLE_PLACES_API_KEY`. Field mask is required.
- Call: `POST https://places.googleapis.com/v1/places:searchText`
- Rate limit: quota is per Google Cloud project. 429 stops the run.
- ToS: https://developers.google.com/maps/documentation/places/web-service/policies — store place ids, not a private copy of Google content beyond the caching window.

## Eventbrite

- Docs: https://www.eventbrite.com/platform/api and https://www.eventbrite.com/platform/docs/changelog
- Wanted: event name, date, venue, ticket tiers for gay parties in a city.
- Auth: `Authorization: Bearer` from `EVENTBRITE_TOKEN`.
- Public search `GET https://www.eventbriteapi.com/v3/events/search/` was shut down on 12 December 2019. This client does not call it.
- What remains: events you are allowed to list, for example `GET /v3/organizations/{organization_id}/events/` and `GET /v3/venues/{venue_id}/events/`. Those are not a city-wide gay-party search. Without a partner feed the run logs `no recent data`.
- Rate limit: the old search allowance is gone. Any live Eventbrite call still waits 1 second and stops on 429.
- ToS: https://www.eventbrite.com/platform/api — city-wide public event distribution needs Eventbrite's partner program.

## Songkick

- Docs: https://www.songkick.com/developer/location-search and https://www.songkick.com/developer/upcoming-events-for-metro-area
- Extract: metro-area concerts. An event becomes a signal only when the payload already has `aspect`, `sentiment`, and a Songkick `uri`.
- Auth: `apikey` from `SONGKICK_API_KEY`.
- Calls: `GET https://api.songkick.com/api/3.0/search/locations.json?query={city}&apikey=`, then `GET https://api.songkick.com/api/3.0/metro_areas/{metro_area_id}/calendar.json?apikey=` only after the location search returns a metro area id. The id is not guessed.
- Rate limit: no fixed public quota in the docs. This client waits 1 second and stops on 429.
- ToS: https://www.songkick.com/developer — the key stays in the query string and is redacted in dry-run output.

## Ticketmaster Discovery

- Docs: https://developer.ticketmaster.com/products-and-docs/apis/discovery-api/v2/
- Extract: ticketed events, parties, and club nights for the city. An event becomes a signal only when the payload already has `aspect`, `sentiment`, and `url`.
- Auth: `apikey` from `TICKETMASTER_API_KEY`.
- Call: `GET https://app.ticketmaster.com/discovery/v2/events.json?keyword={name}&city={city}&apikey=`. `countryCode` is omitted.
- Rate limit: quota is per API key on the Ticketmaster developer portal. This client waits 1 second and stops on 429.
- ToS: https://developer.ticketmaster.com/products-and-docs/apis/getting-started/ — do not store event content beyond what the application terms allow.

## Bandsintown

- Docs: https://help.artists.bandsintown.com/en/articles/9186477-api-documentation
- Extract: upcoming events for one artist. The city is read from the event's venue. There is no city-calendar endpoint, and one is not invented.
- Auth: `app_id` from `BANDSINTOWN_API_KEY`.
- Call, only when an artist name was provided: `GET https://rest.bandsintown.com/artists/{artist_name}/events/?app_id=`. A venue run with no artist sends nothing.
- Rate limit: not published. This client waits 1 second and stops on 429.
- ToS: the public API is artist events. Do not scrape the website to fake a city search.

## GayCities

- Docs: no public API. Site: https://www.gaycities.com/
- Extract, after ToS review: venue listing URL, gay-specific review text, event listings.
- Auth: none. Gate: `SOURCES_TOS_CHECK=1`. Without that flag the client does not send a request.
- Planned page: `GET https://www.gaycities.com/search/?q={name}+{city}`
- Rate limit: no published API quota. The same 1 second delay and 429 stop apply if a fetch is ever enabled.
- ToS: scraping is not approved by this repo. Read GayCities' terms and get permission before setting the flag. A claim from this source is a tiebreaker only, and it still needs `source_url` and `retrieved_at`.

## Travel Gay

- Docs: no public API. Site: https://www.travelgay.com/
- Extract, after ToS review: venue listing URL and gay travel write-ups.
- Auth: none. Gate: `SOURCES_TOS_CHECK=1`. Without that flag the client does not send a request.
- Planned page: `GET https://www.travelgay.com/?s={name}+{city}`
- Rate limit: same as GayCities.
- ToS: scraping is not approved by this repo. Read Travel Gay's terms and get permission before setting the flag. Same tiebreaker rule, same `source_url` and `retrieved_at` requirement.

## Misterb&b

- Docs: no public API. Site: https://www.misterbandb.com/
- Extract, after ToS review: curated gay venue recommendations on a city guide. A listing becomes a signal only when it already has `aspect`, `sentiment`, and `source_url`.
- Auth: none. Gate: `SOURCES_TOS_CHECK=1`. Without that flag the client does not send a request.
- Confirmed page for São Paulo: `GET https://www.misterbandb.com/gay-guide/brazil/sao-paulo/`. Other cities are not requested, because a guide path is not guessed.
- Rate limit: no published API quota. The same 1 second delay and 429 stop apply if a fetch is ever enabled.
- ToS: scraping is not approved by this repo. Read Misterb&b's terms and get permission before setting the flag.

## TripAdvisor

- Status: `MANUAL_ONLY`.
- Nightlife reviews exist on the site. The Content API is partner-only and is not wired here.
- No request is built and no page is fetched. A person can paste a review later, with the page URL and the date it was read.

## Resident Advisor

- Status: `MANUAL_ONLY`.
- Site: https://ra.co/
- Extract when a person reviews it: club nights and DJ lineups, with the page URL and the date it was read.
- Auth: the API is partner-only. No key is wired.
- No request is sent. The venue is marked for human review.

## Scruff and Grindr

- Status: `MANUAL_ONLY`.
- Sites: https://www.scruff.com/ and https://www.grindr.com/
- Extract when a person reviews it: in-app venue and event features, with a screenshot or page URL and the date it was read.
- Auth: none. There is no public API.
- No request is sent. The venue is marked for human review.

## Reddit

- Docs: https://www.reddit.com/dev/api/ and https://support.reddithelp.com/hc/en-us/articles/16160319875092-Reddit-Data-API-Wiki
- Extract: post permalink and title. A post becomes a signal only when the payload already has `aspect` and `sentiment`. The title is not scored by guesswork.
- Auth: app-only OAuth. `REDDIT_CLIENT_ID` and `REDDIT_CLIENT_SECRET`. `POST https://www.reddit.com/api/v1/access_token` with `grant_type=client_credentials`, then `GET https://oauth.reddit.com/search?q="{name}"+"{city}"&type=link&sort=new&limit=5`.
- User-Agent: `FindingDorothy/phase0`. Reddit rejects calls without one.
- Rate limit: about 100 requests per minute on the free OAuth tier. A 429 stops the run. The client still waits 1 second between calls.
- ToS: https://www.redditinc.com/policies/data-api-terms — use the official API. Do not scrape www.reddit.com.

## Forums

- Status: `NO_UNIVERSAL_API`.
- There is no API that searches every forum. This client does not crawl a guessed list of boards.
- Forum posts that are on Reddit are covered by the Reddit search above.
- A page from any other forum still needs `source_url` and `retrieved_at`, and it is not fetched here.

## Hotel Chilli live counter

- Page: https://hotelchilli.com.br/
- The counter is not in the cached HTML. The page script calls `GET https://hotelchilli.com.br/wp-admin/admin-ajax.php?action=atualizar_contador_chilli` and reads JSON `{ success, data: { contagem, hora } }`.
- HTML fallback, only if that JSON call fails and is not a 429: the text inside `.chilli-card-counter`. That node is a cached shortcode, so it is not the live number.
- Auth: none. Gate: `CHILLI_POLL=1`. Without that flag the 5-minute loop does not start. `--dry-run` sends one request and does not loop or store a count.
- A stored row is one entry in `data/live-occupancy.json`, keyed by `venue_id`. Hotel Chilli uses `sp-hotel-chilli`, `kind` `live-occupancy`, `count`, `source_url` `https://hotelchilli.com.br/`, and `retrieved_at`. The headcount is not turned into `sentiment`. Any later venue counter writes the same shape under its own id.
- The venue card keeps its forecast. A reading under 15 minutes old replaces the “Not enough live signal” line inside the busyness block with a pulsing green dot, a Live badge, and “N inside right now”. A failed poll, a missing row, or an older reading leaves that forecast line as it is. The number is never left on screen after it goes stale.
- Rate limit: one request at a time, then a 5-minute wait. HTTP 429 stops the loop and drops this venue’s latest reading.
- Robots: https://hotelchilli.com.br/robots.txt disallows `/wp-admin/` and allows `/wp-admin/admin-ajax.php`. The venue's own page calls this action every minute. This client uses the same action, slower, and only when the flag is on.
- ToS: the counter is published by the hotel on its homepage. Do not poll it until someone has read the hotel's terms and set `CHILLI_POLL=1`.

## Pride calendar

- Dates live on each city file in `data/cities/<slug>.json`, in that city's `events` array: `{name, type: "pride", start, end, source}`. `source` is the organizer page. The calendar reads those arrays. There is no `data/pride-events.json` and no `data/cities.json` index.
- A row needs the organizer's own page. A guide, a news article, or last year's pattern is not a date.
- A one-day march sets `end` equal to `start`.
- Do not fill next year from a sentence like "the last weekend in June" or "the Sunday after Corpus Christi". Wait until that year's date is written on the page.
- A side party mentioned only as "see Instagram" is not added.

## Instagram

- Status: `MANUAL_ONLY`.
- There is no public API for a third-party profile. Do not scrape instagram.com. The site blocks automated reads, and the terms do not allow that collection.
- No request is sent. A person reads the venue's own profile and writes the notes below. A handle is stored only when the venue's own site, or the city's official tourism page for that venue, names that profile. A guessed handle is not stored.
- Seed field: `instagram` is `{ "handle": "@name", "url": "https://www.instagram.com/name" }`, or `null` when no profile was verified.

### Extraction checklist

For each verified profile, record only what that profile itself shows:

- Hours from the bio, a story highlight, or a post. `source_url` is the profile URL. `hours_note` says where on the profile the hours were read (bio, highlight, or post). `hours_verified` is true only when that place states a full open and a full close for each open day. An open time with no close does not verify hours.
- Address or location tag from the bio. A guide can still not verify hours.
- Recurring parties and events from recent posts: the party name and the weeknight. A one-off date is not a weekly hour.
- Follower count as a rough popularity signal, with `retrieved_at`, because the number changes. It is not an aspect and it is not a sentiment.
