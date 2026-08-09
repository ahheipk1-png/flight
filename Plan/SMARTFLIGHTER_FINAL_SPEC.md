# SmartFlighter — Final Product & Technical Specification
## Product: SmartFlighter
### Positioning: Fly smarter, not just cheaper.
### Status: Final product direction for MVP development

> **Brand note:** Use the supplied SmartFlighter visual assets consistently throughout the interface. Domain/trademark clearance should still be completed before public launch.

---

# Brand & Visual Assets

SmartFlighter should use the following three transparent PNG assets as the canonical visual set.

## A. Primary Logo

![SmartFlighter primary logo](assets/smartflighter-logo.png)

**File:** `assets/smartflighter-logo.png`

Use for:

- website header
- landing page
- navigation
- authentication screens
- email/header branding
- social/profile branding where the horizontal wordmark fits

Implementation guidance:

- preserve the transparent background
- do not place it inside another blue badge or colored logo box
- keep generous whitespace around it
- do not stretch or distort it
- use `object-fit: contain`
- on desktop, target roughly `160–220px` displayed width depending on header layout
- create a separate favicon/app icon later from the airplane character only

## B. Searching / Loading Illustration

![SmartFlighter searching illustration](assets/smartflighter-searching.png)

**File:** `assets/smartflighter-searching.png`

Use while SmartFlighter is:

- searching flexible dates
- evaluating nearby airports
- checking connections
- generating stopover candidates
- comparing sellers
- calculating trip scores

Suggested loading copy:

```text
Finding smarter ways to fly…
```

Optional rotating sub-messages:

```text
Checking flexible dates…
Comparing nearby airports…
Looking for better stopovers…
Checking connection comfort…
Comparing trusted sellers…
```

Do **not** show a fake numeric percentage unless the backend can provide meaningful progress.

## C. Search Complete / Success Illustration

![SmartFlighter search complete illustration](assets/smartflighter-search-complete.png)

**File:** `assets/smartflighter-search-complete.png`

Use when:

- the initial search has completed
- itinerary optimization has finished
- refreshed results are ready
- a saved-trip analysis has completed successfully

Suggested completion copy:

```text
Smart options found
```

or:

```text
Your smarter trips are ready
```

The tick is the only semantic difference from the loading illustration, making the transition easy for users to understand.

## Visual State Sequence

```text
SEARCH FORM
    ↓
smartflighter-searching.png
    ↓
RESULTS READY
    ↓
smartflighter-search-complete.png
    ↓
MAP + RESULTS
```

The loading and completion illustrations should occupy the **same visual box and same rendered dimensions** so there is no layout jump when the state changes.

Recommended CSS:

```css
.search-state-image {
  width: min(420px, 78vw);
  aspect-ratio: 3 / 2;
  object-fit: contain;
}
```

For the transition:

```text
searching illustration
        ↓ subtle fade
completion illustration
        ↓ 400–800 ms
results interface
```

Avoid excessive animation. The airplane character already gives the product personality; the surrounding UI should remain clean and professional.


---


# Product Design Direction

SmartFlighter should feel **simple, calm, and professional**, even though the optimization engine behind it is sophisticated.

UI principles:

- default search should be easier than the underlying model
- advanced options should be progressively disclosed
- use generous whitespace and a restrained color palette
- prefer plain-language explanations over technical scores
- show one primary recommendation reason at a time
- use the map to explain geography, not as decoration
- avoid dense dashboards, excessive badges, and unnecessary animation
- keep loading and completion states visually consistent
- every complex recommendation should answer **why**

The user should experience:

```text
simple input
    ↓
SmartFlighter does the hard work
    ↓
a small number of understandable choices
```

---

# 1. Product Vision

Traditional flight search assumes the traveler already knows:

- origin airport
- destination
- departure date
- return date

SmartFlighter should invert that model.

The traveler provides **constraints, preferences, and tolerance**, while the engine discovers and ranks viable trips.

The engine may optimize:

- destination
- departure date
- return date
- trip length
- origin airport
- destination airport
- alternate nearby airport
- connection airport
- connection duration
- stopover city
- stopover duration
- airport switching
- seller / OTA
- connection risk
- schedule reliability
- layover cost
- door-to-door cost

Core promise:

> **Tell us how you want to travel. We find the smartest trip.**

---

# 2. Product Differentiation

The product is not just a cheap-flight finder.

It should solve questions such as:

- What if I am flexible on destination?
- What if I am flexible on dates?
- What if Hamilton or Waterloo is much cheaper than Pearson?
- What if a 24–48 hour layover lets me visit another city?
- What if I arrive at KIX but depart from Kobe after two days?
- Is a 1h45 connection technically valid but realistically stressful?
- Do I need immigration, customs, security, bag collection, or a terminal transfer?
- How long does the terminal transfer really take?
- How reliable is the incoming flight?
- What happens if I miss the connection?
- Is the cheapest OTA actually trustworthy?
- How much will the layover really cost after hotel and airport transport?

The engine should optimize **the whole travel experience**, not just airfare.

---

# 3. Product Pillars

## 3.1 Flexible Destination Discovery

Allow users to search:

- Anywhere
- region
- country group
- multiple countries
- multiple cities
- climate / season preference
- maximum flight time
- maximum budget

Example:

```text
From: Toronto region
Where: Japan / Korea / Taiwan / Hong Kong / Singapore
When: Any 10–16 day trip between Sep 1 and Nov 30
Budget: <= CAD $1,100
```

Destination becomes an optimization variable.

---

## 3.2 Flexible Date Discovery

Instead of forcing exact dates:

```text
Departure window: Sep 1 – Oct 31
Trip length: 10–16 days
```

Search:

```text
departure_date ∈ date_window
return_date = departure_date + trip_length
trip_length ∈ [10, 16]
```

The engine should identify unusually cheap combinations.

---

## 3.3 Nearby Airport Optimization

Origin should be a **travel region**, not necessarily one airport.

Example:

```text
GREATER TORONTO REGION

YYZ  Toronto Pearson
YTZ  Billy Bishop
YHM  Hamilton
YKF  Waterloo Region
BUF  Buffalo (optional)
```

A user can set:

```text
Maximum extra ground travel: 120 min
Only use an alternate airport if savings >= $100/person
```

For families, savings should be calculated across all passengers.

---

## 3.4 Geographic Airport Interchangeability

Airports belong to geographic groups.

Example:

```text
KANSAI TRAVEL REGION

KIX  Kansai International
ITM  Osaka Itami
UKB  Kobe
```

A multi-day stopover may make airport switching perfectly reasonable:

```text
Arrive KIX
Stay Osaka/Kobe 2 nights
Depart UKB
```

The engine must not treat this like a 2-hour airport transfer.

---

# 4. Map-First Product Design

The results page should be designed around a **primary interactive map**.

The map is not decorative. It communicates the optimization.

The SmartFlighter brand/loading artwork remains a local UI asset and should not be rendered as part of the map itself.

Show:

- origin airport
- alternate origin airports
- connection airports
- stopover cities
- destination
- alternate arrival/departure airports
- flight legs
- airport switching
- ground-transfer legs

Example:

```text
YYZ ● ───────── TPE ● ───────── KIX ★
                   │
                2 nights
                ~31 usable hours
                ~$126 stopover cost
```

When the user selects another result, the map updates rather than reloading.

Suggested desktop layout:

```text
┌──────────────────────────────────────────────────────────────┐
│ SEARCH / FILTER BAR                                          │
├───────────────────────┬──────────────────────────────────────┤
│ RESULT LIST           │ INTERACTIVE MAP                      │
│                       │                                      │
│ Best Value            │ YYZ ●── TPE ●── KIX ★                │
│ Free City             │                                      │
│ Safest                │                                      │
│ Cheapest              │                                      │
├───────────────────────┴──────────────────────────────────────┤
│ SELECTED ITINERARY DETAILS                                   │
└──────────────────────────────────────────────────────────────┘
```

Mobile:

```text
MAP
↓
ranking tabs
↓
result cards
↓
selected details
```

---

# 5. Map Implementation

Recommended for MVP:

## Option A — Google Maps JavaScript API

Use:

- AdvancedMarkerElement
- Polyline / geodesic lines
- InfoWindow
- fitBounds
- optional Routes API for ground travel

Important cost-control principle:

> Load the map once per result page, then update markers and polylines when the selected itinerary changes.

Do not reload the map for each card.

## Option B — MapLibre + OpenStreetMap

Use later if:

- map traffic becomes large
- custom styling becomes important
- Google Maps pricing becomes material

The product architecture should wrap the mapping provider:

```text
MapProvider
  addAirportMarker()
  addStopoverMarker()
  drawFlightLeg()
  drawGroundLeg()
  fitItinerary()
```

---

# 6. Connection Intelligence Engine

A connection is a process, not just a duration.

Model:

```text
deplane
↓
walk
↓
immigration?
↓
customs?
↓
bag reclaim?
↓
bag recheck?
↓
terminal transfer?
↓
security?
↓
walk to gate
↓
boarding cutoff
```

Return:

```text
Connection quality
🟢 Comfortable
🟡 Acceptable
🟠 Risky
🔴 Very risky
```

---

# 7. Connection Preferences

Allow:

```text
Connection tolerance

○ Aggressive
● Comfortable
○ Conservative
```

and explicit settings:

```text
Minimum normal layover: 2h00
Maximum normal layover: 5h00

Avoid awkward waits:
5h00 – 10h00

Allow long stopovers:
10h00 – 72h00
```

---

# 8. Context-Sensitive Connection Time

Estimate:

```text
comfortable_connection_time =
    deplaning
  + immigration
  + customs
  + baggage
  + terminal transfer
  + security
  + gate walk
  + boarding buffer
  + uncertainty buffer
```

Inputs:

- international → international
- international → domestic
- domestic → international
- domestic → domestic
- terminal change
- airport change
- self-transfer
- separate tickets
- checked baggage
- airline combination
- airport
- passenger nationality
- visa/residency status
- time of day
- congestion

---

# 9. Immigration / Customs / Security Rules

The system should determine:

```text
Immigration required?       yes/no
Customs required?           yes/no
Security again?             yes/no
Bag reclaim?                yes/no/maybe
Bag recheck?                yes/no/maybe
Transit visa?               yes/no/maybe
Airside transfer allowed?   yes/no
```

Rules must be itinerary-specific, not merely country-specific.

Store sources and last verification dates.

---

# 10. Terminal Transfer Intelligence

Create a graph for major airports.

Example:

```text
Terminal 1 ── train 8m ── Terminal 2
     │
     └── bus 15m ── Terminal 4
```

Each edge:

```text
from_terminal
to_terminal
mode
min_minutes
typical_minutes
airside_or_landside
security_required
immigration_required
hours
source_url
verified_at
```

Later:

```text
Airport
↓
Terminal
↓
Concourse
↓
Gate area
```

---

# 11. Connection Success Probability

Estimate:

```text
P(successful connection)
```

Concept:

```text
P(
incoming_delay
+ connection_process_time
<
available_connection_time
)
```

Display:

```text
Actual layover:          2h45
Comfortable minimum:     2h05
Estimated buffer:        40m
Connection success:      94%
```

---

# 12. Operational Reliability

Do not reduce reliability to country stereotypes.

Model using:

- flight number
- route
- airline
- airport
- departure time
- weekday
- season
- weather exposure
- ATC congestion
- recent reliability

Store:

```text
median arrival delay
75th percentile
90th percentile
95th percentile
cancellation rate
diversion rate
on-time percentage
```

---

# 13. Missed-Connection Recovery

A missed connection can be mildly annoying or disastrous.

Calculate:

```text
Recovery Score
```

Factors:

- next onward flight time
- number of alternatives that day
- same-airline alternatives
- alliance alternatives
- nearby airports
- rebooking protection
- overnight probability
- visa implications

Example:

```text
Next flight: 2h35 later
6 alternatives today
Recovery risk: LOW
```

vs:

```text
Next flight: 23h40 later
1 daily flight
Recovery risk: HIGH
```

---

# 14. Stopover Optimization

Long layovers can be a feature.

Suggested zones:

```text
0–2h      Too short
2–5h      Good connection
5–10h     Awkward wait
10–24h    Long layover / possible city visit
24–72h    Stopover
72h+      Extended stopover
```

Thresholds should be configurable.

---

# 15. Stopover Search Controls

Example:

```text
☑ Allow stopovers

Minimum: 12h
Maximum: 72h

Preferred:
☑ 1 night
☑ 2 nights
☑ 3 nights

Preferred cities:
Tokyo
Seoul
Taipei
Hong Kong
Singapore
Istanbul
Doha

Only show if net extra cost <= $150
```

---

# 16. Multi-City Stopover Generation

Ordinary:

```text
YYZ → BKK
BKK → YYZ
```

Stopover candidate:

```text
YYZ → IST      Sep 10
IST → BKK      Sep 12
BKK → YYZ      Sep 25
```

Compute:

```text
stopover_airfare_premium =
multi_city_fare - ordinary_through_fare
```

The premium can be:

- positive
- zero
- negative

---

# 17. Free City Feature

Create a dedicated ranking:

## FREE CITY

A stopover where the extra trip cost is very low or negative.

Categories:

```text
💰 FREE CITY
Net extra cost <= $0

✨ CHEAP ADD-ON
Net extra cost <= $100

👍 GOOD VALUE
Net extra cost <= $250

💸 EXPENSIVE STOPOVER
Net extra cost > $250
```

---

# 18. Estimated Stopover Cost

Calculate:

```text
Stopover Cost =
    hotel
  + airport transport
  + local transport
  + meals
  + visa/entry fees
  + baggage storage
```

Separate:

## Essential

```text
hotel
airport-city transport
visa
baggage
```

## Typical Optional

```text
meals
local transit
attractions
```

Display ranges rather than false precision.

---

# 19. Usable Sightseeing Time

Estimate:

```text
usable_city_time =
    layover_duration
  - arrival_processing
  - airport_to_city
  - city_to_airport
  - departure_buffer
```

Example:

```text
Layover                  18h00
Arrival processing       -1h10
Airport → city           -0h55
City → airport           -0h55
Departure buffer         -2h30
──────────────────────────────
Usable city time         12h30
```

---

# 20. Airport Changes During Stopovers

Airport-change penalty should depend on available time.

Example:

```text
<4h        reject / extreme penalty
4–8h       very high penalty
8–12h      high
12–24h     moderate
24–48h     low
48h+       very low
```

For:

```text
Arrive HND
2 nights Tokyo
Depart NRT
```

model:

```text
HND → hotel
hotel → NRT
```

not:

```text
HND → NRT immediately
```

Same for:

```text
KIX → Osaka/Kobe → UKB
```

---

# 21. Seller / OTA Reliability

The cheapest seller should not automatically rank first.

Score:

- ticket issuance reliability
- refunds
- schedule-change servicing
- customer support
- price transparency
- hidden/post-booking fees
- industry accreditation
- complaint history
- years operating

Display:

```text
Airline direct        $843   🟢 96
Trusted OTA           $821   🟢 89
Unknown OTA           $775   🟠 61
High-risk OTA         $748   🔴 34
```

---

# 22. Risk-Adjusted Fare

Concept:

```text
effective_cost =
    airfare
  + expected_problem_cost
  + inconvenience_penalty
```

Display simply:

```text
Cheapest: $748
⚠ Higher servicing risk

Recommended: $821
+$73
Much stronger post-booking support
```

---

# 23. Door-to-Door Cost

Estimate:

```text
door_to_door_cost =
    airfare
  + origin_ground_transport
  + parking
  + bags
  + seats
  + stopover cost
  + airport switching
  + destination ground transport
```

Important for:

```text
YYZ vs YHM vs YKF
```

and families.

---

# 24. Ranking Modes

Support:

```text
BEST
CHEAPEST
LOWEST RISK
FASTEST
BEST STOPOVER
FREE CITY
BEST FOR FAMILY
AIRLINE DIRECT
```

---

# 25. Personalized Utility Function

Start with explicit explainable scoring.

```text
Score =
    - w1 * fare
    - w2 * travel_time
    - w3 * connection_risk
    - w4 * awkward_layover
    - w5 * self_transfer_risk
    - w6 * seller_risk
    - w7 * airport_change_penalty
    + w8 * stopover_value
    + w9 * destination_preference
    + w10 * unusual_price_discount
    + w11 * recovery_quality
```

---

# 26. Search Architecture

Do not brute-force live fare APIs.

Use:

```text
USER CONSTRAINTS
       │
       ▼
INDICATIVE / DISCOVERY SEARCH
       │
       ▼
CANDIDATE GENERATOR
       │
       ▼
PRUNING
       │
       ▼
TOP CANDIDATES
       │
       ▼
LIVE FARE SEARCH
       │
       ▼
CONNECTION INTELLIGENCE
       │
       ▼
STOPOVER COST ENGINE
       │
       ▼
SELLER INTELLIGENCE
       │
       ▼
FINAL RANKING
```

---

# 27. Search-Space Pruning

Avoid:

```text
50 destinations
× 60 dates
× 7 trip lengths
× 10 origins
× 20 stopovers
```

Instead:

1. identify cheap regions/dates using indicative data
2. expand only promising combinations
3. run live search
4. generate stopover variants for best routes
5. generate airport-switch variants only when likely beneficial

---

# 28. Data Sources

## Flight fares

Potential:

- Skyscanner
- Duffel
- SerpApi / Google Flights
- Travelpayouts / Aviasales
- airline NDC
- GDS later

Use provider abstraction.

## Visa / transit

Later:

- IATA Timatic

MVP:

- official government pages
- official airport connection guides
- curated major-hub rules

## Airport / terminal

- official airport sites
- airline transfer guides
- OAG
- Cirium
- curated graph

## Reliability

- BTS
- FAA
- EUROCONTROL
- Cirium
- airport statistics

## Hotel

MVP:

- cached typical hotel ranges

Later:

- hotel affiliate/API provider

## Ground transport

MVP:

- curated airport-city estimates
- Google Maps / Routes where needed

---

# 29. Data Model

## airports

```text
id
iata
icao
name
city
metro_area_id
travel_region_id
country
latitude
longitude
timezone
```

## metro_areas

```text
id
name
country
```

## airport_equivalence

```text
airport_a
airport_b
ground_time_minutes
ground_cost_estimate
same_metro
same_travel_region
```

## terminals

```text
airport_id
terminal_code
name
```

## terminal_edges

```text
airport_id
from_terminal
to_terminal
transport_mode
min_minutes
typical_minutes
airside
security_required
immigration_required
```

## connection_rules

```text
airport_id
arrival_type
departure_type
immigration_required
customs_required
security_required
bag_reclaim_rule
airside_possible
base_process_minutes
source_url
verified_at
confidence
```

## flight_observations

```text
flight_number
origin
destination
scheduled_departure
scheduled_arrival
actual_departure
actual_arrival
cancelled
observed_date
```

## fare_observations

```text
origin
destination
departure_date
return_date
trip_length
cabin
fare
currency
seller_id
provider
observed_at
```

## sellers

```text
id
name
domain
iata_verified
arc_verified
reliability_score
refund_score
ticketing_score
support_score
price_transparency_score
```

## stopover_costs

```text
airport_id
hotel_category
hotel_estimate
airport_city_transport
local_transport
meal_estimate
currency
season
updated_at
```

---

# 30. Backend API

Suggested:

```text
POST /api/search
POST /api/search/flexible
POST /api/search/stopovers

GET /api/airports/nearby
GET /api/airports/{iata}
GET /api/airports/{iata}/connections

POST /api/connection/analyze
POST /api/stopover/analyze

GET /api/sellers/{seller}
GET /api/fares/history

POST /api/trips/score
```

---

# 31. Example Search Request

```json
{
  "origin": {
    "location": "Toronto",
    "airports": ["YYZ", "YTZ", "YHM", "YKF"],
    "max_ground_minutes": 120,
    "min_saving_per_person": 100
  },
  "destination": {
    "regions": ["Japan", "Korea", "Taiwan", "Hong Kong"],
    "allow_any": false
  },
  "dates": {
    "departure_from": "2026-09-01",
    "departure_to": "2026-10-31",
    "trip_length_min": 10,
    "trip_length_max": 16
  },
  "budget": {
    "currency": "CAD",
    "max_total": 1100
  },
  "connections": {
    "max_stops": 1,
    "min_normal_minutes": 120,
    "max_normal_minutes": 300
  },
  "stopovers": {
    "enabled": true,
    "min_hours": 12,
    "max_hours": 72,
    "max_net_extra_cost": 150,
    "allow_airport_switch": true
  },
  "seller": {
    "minimum_reliability": 75,
    "prefer_airline_direct": true
  }
}
```

---


# Search State UX

The search experience should have three clear states.

## Idle

Show the normal flexible-search form and the primary SmartFlighter logo.

## Searching

Replace the main result area with:

```text
[ smartflighter-searching.png ]

Finding smarter ways to fly…

Checking flexible dates, nearby airports,
connections and stopovers.
```

Keep the page calm and uncluttered.

If individual backend stages are known, update a single secondary status line. Do not create many simultaneous spinners.

## Complete

Briefly switch to:

```text
[ smartflighter-search-complete.png ]

Your smarter trips are ready
```

Then reveal:

```text
map
+
ranked trip cards
+
connection / stopover details
```

The searching and complete images must use the same container dimensions so the completion tick appears as a natural state change rather than a new layout.

---

# 32. Frontend UX

Main search should avoid feeling like a standard airline form.

Use:

```text
FROM
Toronto region
YYZ YTZ YHM YKF

WHERE
Japan / Korea / Taiwan / Hong Kong / Singapore

WHEN
Any 10–16 days
Sep 1 – Oct 31

BUDGET
≤ CAD $1,100

CONNECTION
Comfortable
Minimum 2h
Avoid 5–10h awkward waits

STOPOVERS
Yes
12–72h
Net extra cost <= $150
```

---

# 33. Result Card

Example:

```text
★★★★★ BEST VALUE

Toronto → Osaka
Sep 18 – Oct 2
14 days

YYZ → TPE → KIX

Fare: CAD $782

TPE connection: 2h55
🟢 97% comfortable

Immigration:       No
Terminal change:   No
Security again:    Yes

Seller:
Airline direct
🟢 High confidence
```

---

# 34. Stopover Card

```text
✨ FREE CITY

Toronto → Taipei → Osaka

Taipei:
2 nights / 41 hours

Airfare:                  $746
Normal itinerary:         $775

Airfare saving:            $29

Hotel:                     $92
Airport-city transport:    $14
Meals/local transit:       $35

Estimated net extra cost: $112
Usable city time:          31h

★★★★★
```

---

# 35. Connection Detail Drawer

```text
TPE CONNECTION ANALYSIS

Layover:               2h55
Comfortable minimum:   1h50

Immigration:           No
Security:              Yes
Terminal transfer:     No
Gate walk:             10–18m

Connection success:    97%
Recovery quality:      High

🟢 Comfortable
```

---

# 36. Map Interaction

When a result is selected:

1. clear old flight overlays
2. add origin marker
3. add stopover marker(s)
4. add destination marker
5. add alternate-airport markers where relevant
6. draw flight legs
7. draw ground leg if airport switching occurs
8. fit map bounds
9. highlight the selected result

Pin click should show:

```text
TPE — Taipei

Stopover: 41h
Hotel estimate: $92
Airport-city: $14
Usable city time: 31h
Entry required: Yes
```

---

# 37. Recommended Stack

## Frontend

```text
Next.js
React
TypeScript
Tailwind CSS
Google Maps JavaScript API
```

## Backend

```text
Python
FastAPI
```

## Database

```text
PostgreSQL
PostGIS
```

## Cache

```text
Redis
```

---

# 38. MVP Geography

## Origins

```text
YYZ
YTZ
YHM
YKF
```

Optional:

```text
BUF
```

## Major destinations / hubs

```text
HND NRT KIX ITM UKB
ICN
TPE
HKG
SIN
BKK
IST
DOH
DXB
LHR
CDG
AMS
FRA
LIS
OPO
```

---

# 39. MVP Phases

## Phase 1 — Flexible Search + Map

Build:

- flexible dates
- destination regions
- nearby airports
- map-first result UI
- simple price ranking
- fare cache
- trip-length filter

## Phase 2 — Connection Intelligence

Add:

- minimum connection
- awkward layover filtering
- basic immigration/security rules
- terminal changes
- connection risk

## Phase 3 — Stopover Discovery

Add:

- 12–72h stopovers
- multi-city generation
- stopover premium
- hotel estimate
- airport-city transport
- usable sightseeing time
- Free City

## Phase 4 — Seller Intelligence

Add:

- seller score
- direct airline preference
- accreditation
- complaint indicators
- risk-adjusted fare

## Phase 5 — Reliability

Add:

- historical delay
- cancellation probability
- missed-connection recovery
- seasonality

## Phase 6 — Personalization

Learn:

- airport preferences
- connection tolerance
- stopover-city preferences
- seller tolerance
- airport-switch tolerance
- value of time

---

# 40. Explainability

Never show only:

```text
Score: 84
```

Show why:

```text
✓ $182 below typical fare
✓ 2h55 comfortable connection
✓ No immigration during transfer
✓ Airline-direct seller
✓ Six backup flights if connection is missed
✓ 31 usable hours in Taipei for ~$112 extra
```

Explainability should be a core product principle.

---

# 41. Natural-Language Search

Later support:

```text
"I want somewhere in Asia for around two weeks in October.

Leaving from Toronto.

Under $1,200.

I don't want short connections.

I would happily spend 1–2 days in Tokyo, Seoul, Taipei,
Hong Kong, or Singapore.

Check Hamilton and Waterloo too if I can save at least
$100 per person."
```

AI converts the request into structured constraints.

Important:

> AI parses the request.  
> The optimization engine makes the decision.

Never let an LLM invent fares, visa rules, or airport facts.

---

---

# 42. True Trip Cost

SmartFlighter should compare **real trip cost**, not just the advertised fare.

Estimate:

```text
true_trip_cost =
    airfare
  + baggage
  + seat fees
  + origin transport
  + parking
  + airport switching
  + stopover essentials
  + destination airport transport
```

Example:

```text
Ticket                     $742
Checked bag                 $70
Seat selection              $35
Airport parking             $48
Stopover hotel              $92
Airport transport           $28
────────────────────────────────
Estimated real cost       $1,015
```

This allows a nominally more expensive fare to rank higher when it is genuinely cheaper overall.

---

# 43. “Worth Leaving the Airport?” Decision

For long layovers, SmartFlighter should explicitly answer:

> **Is there enough usable time to leave the airport and enjoy the city?**

Example:

```text
Seoul layover              17h40
Arrival processing         -1h10
Airport → city             -0h55
City → airport             -0h55
Departure safety buffer    -2h30
────────────────────────────────
Usable city time          ~12h10

✓ Worth leaving the airport
```

Versus:

```text
Paris layover               8h05
Usable city time           ~2h40

Not recommended for a city visit
```

The result should consider:

- immigration
- baggage
- airport-city travel
- time of day
- public-transit operating hours
- required return buffer
- whether the airport has easy city access

---

# 44. Fare Flexibility Score

A ticket is more than its price.

Compare:

```text
                         Option A     Option B
Fare                       $712         $764
Carry-on                      ✓            ✓
Checked bag                   $            ✓
Seat selection                $            ✓
Change fee                  $180          $50
Refundability                No        Partial
Seller                      OTA       Airline
```

SmartFlighter can summarize:

> **Pay $52 more for included baggage, better change rules, and airline-direct servicing.**

Potential dimensions:

- baggage included
- seat selection
- change rules
- cancellation rules
- refundability
- same-day change
- airline-direct servicing
- fare expiration / hold rules where available

---

# 45. Traveler Profiles

The same itinerary should not be scored identically for every traveler.

Initial profiles:

```text
Flexible solo traveler
Family with children
Senior traveler
Business traveler
Budget explorer
Custom
```

Example family defaults:

```text
connection buffer        high
number of stops          low
self-transfer            avoid
separate tickets         avoid
seller reliability       high
overnight airport wait   avoid
recovery quality         high
```

Profiles are only defaults. Users can override individual preferences.

---

# 46. Anywhere-for-My-Budget Map

This should become one of SmartFlighter's strongest discovery experiences.

Example input:

```text
Toronto
September – October
10–16 days
Under CAD $1,000
```

Map results:

```text
Seoul       $721
Taipei      $748
Osaka       $782
Tokyo       $814
Hong Kong   $754
Lisbon      $603
```

Selecting a destination reveals:

- cheapest date combinations
- best-value itinerary
- connection quality
- stopover opportunities
- true trip cost
- seller quality

This directly supports the product principle:

> **The traveler does not need to know the destination before searching.**

---

# 47. Open-Jaw and Regional Trip Discovery

SmartFlighter should not assume the return journey uses the same city or airport.

Examples:

```text
YYZ → HND
travel through Japan
KIX → YYZ
```

or:

```text
YYZ → KIX
Kansai trip
UKB → CTS
HND → YYZ
```

The optimizer should evaluate:

- regional ground travel
- route direction
- airfare difference
- time saved by avoiding backtracking
- airport transport
- baggage implications
- whether the itinerary is protected or separately ticketed

This is especially valuable for regions with multiple practical airports.

---

# 48. Price Confidence

Do not display price alone.

Example:

```text
Current fare             $782
Typical fare           $1,020
Historical percentile     12%
Recent observed low      $744
30-day direction           ↓

Fare quality:
Excellent
```

Potential later feature:

```text
Chance of near-term fare increase:
Moderate
```

Any predictive model must remain explicitly probabilistic and must never imply certainty.

---

# 49. SmartFlighter Trip Summary

All underlying complexity should collapse into one simple summary.

Example:

```text
YYZ → TPE → KIX
CAD $782

PRICE           Excellent
CONNECTION      Excellent
STOPOVER        Excellent
SELLER          Excellent
FLEXIBILITY     Good

Estimated real cost       ~$894
Connection success          97%
Taipei usable time           31h

SMARTFLIGHTER PICK

Why:
✓ ~$180 below typical fare
✓ comfortable connection
✓ 2-night Taipei stopover
✓ airline-direct booking
```

This summary should be the primary communication layer.

Detailed calculations remain available in expandable panels.

---

# 50. “Trips I Didn't Know I Wanted”

This should be a core discovery/marketing concept.

Example request:

```text
Toronto
About 2 weeks
September – November
Around CAD $1,000
Somewhere interesting
Comfortable connections
Happy to stop somewhere for 1–3 days
```

SmartFlighter should return:

> **The five smartest vacations available under those constraints.**

This captures the product's most important difference from ordinary flight search.

---

# 51. Final MVP Priority

Do **not** attempt to build every intelligence layer at once.

## MVP 1 — Prove Flexible Discovery

Must have:

- flexible departure window
- flexible trip length
- flexible destination region
- Toronto-area airport group
- basic nearby-airport savings logic
- map-first results
- indicative fare discovery
- live verification of finalists
- simple connection min/max filters

## MVP 2 — Make Connections Smarter

Add:

- airport-specific connection rules
- immigration/security indicators
- terminal changes
- comfortable connection estimate
- connection quality explanation

## MVP 3 — Own Stopover Discovery

Add:

- 12–72h stopovers
- multi-city fare generation
- usable city time
- airport-city transport estimate
- hotel estimate
- net stopover cost
- airport switch during multi-day stops
- “Worth leaving the airport?”
- Free City / Cheap Add-on categories

## MVP 4 — Improve Purchase Quality

Add:

- seller reliability
- airline-direct comparison
- fare flexibility
- true trip cost
- risk-adjusted recommendation

## MVP 5 — Reliability & Recovery

Add:

- historical delays
- cancellation risk
- missed-connection recovery
- backup-flight frequency
- seasonal reliability

## MVP 6 — Personalization

Add:

- traveler profiles
- learned preferences
- price confidence
- natural-language trip discovery

---

# 52. Final Product Principle

SmartFlighter should not answer only:

> **What is the cheapest ticket?**

It should answer:

> **What is the smartest trip available given my time, budget, airport flexibility, connection-risk tolerance, stopover interest, seller preference, and true travel cost?**

The product should make complicated travel decisions feel simple.

---

# 53. Final Product Definition

> **SmartFlighter is a map-first flexible travel optimizer that discovers trips across dates, destinations, airports, connections and stopovers, then ranks them using true cost, connection quality, reliability and seller quality—so travelers can find smarter trips they may never have thought to search for.**

---

# 54. Final Homepage Message

Recommended primary message:

```text
Where could you go?
```

Supporting copy:

```text
Tell us your time, budget and travel preferences.
SmartFlighter searches flexible dates, nearby airports,
safer connections and worthwhile stopovers for you.
```

Primary call to action:

```text
Find smarter trips
```

Alternative campaign line:

> **Show me trips I didn't know I wanted.**

---

# 55. Final Build Rule

When implementation decisions conflict, prioritize in this order:

1. **Correctness**
2. **Trust**
3. **Clarity**
4. **Useful flexibility**
5. **Speed**
6. **Visual polish**
7. **Feature count**

A smaller SmartFlighter that gives trustworthy, explainable recommendations is more valuable than a feature-heavy search engine users cannot understand.
