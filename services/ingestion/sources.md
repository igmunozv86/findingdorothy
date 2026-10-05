# Venue sources

Official APIs come first. A page fetch is only allowed after a ToS review, and only when `SOURCES_TOS_CHECK=1`. GayCities and Travel Gay break a tie when mainstream sources disagree that a place is a gay venue. Their claims still need `source_url` and `retrieved_at`.

Nothing here invents a fact. An empty response is logged as `no recent data` and the venue keeps what it already has.

The client sends one request at a time, waits 1 second between calls, and stops the run on HTTP 429.

A stored signal matches `signals` in `infra/schema.sql` and also carries `source_url` and `retrieved_at` (those two columns live on `sources`). A record with no `source_url` is dropped.

Aspects the table allows: `cleanliness`, `safety`, `crowd`, `facilities`, `staff`, `value`. `sentiment` is a number from -1 to 1. Hours, price, and a star rating are not stored as a signal until they can be tied to one of those aspects without a guess.

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

## TripAdvisor

- Status: `MANUAL_ONLY`.
- Nightlife reviews exist on the site. The Content API is partner-only and is not wired here.
- No request is built and no page is fetched. A person can paste a review later, with the page URL and the date it was read.
