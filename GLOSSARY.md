# Cityslicker

A browser toy that grows a city on its own, inspired by SimCity 4, and lets the viewer watch, scrub and capture its growth.

## Language

**City**:
The settlement that grows on the map without any input from the Viewer. Its name, like each Centre's, comes from its Charter.
_Avoid_: Town, map, world

**Seed**:
The number that, within a Charter, supplies all of a City's randomness.
_Avoid_: Random seed, city ID

**Charter**:
Everything that determines a City: its Seed plus the Viewer's Terrain and growth settings. It is fixed for the whole Run. The same Charter always grows the same Terrain and, on the same browser, exactly the same City.
_Avoid_: Config, settings, preset, recipe

**Ambition**:
The Charter setting for how large the City becomes by the end of its Run, from sleepy town to metropolis. It is unrelated to playback speed.
_Avoid_: Growth speed, growth rate, size

**RCI lean**:
The Charter setting that biases Demand toward Residential or Industrial, from commuter town to port city.
_Avoid_: Zone balance, economy mix

**Viewer**:
The person watching a City grow. They observe and control playback but never build or zone.
_Avoid_: Player, mayor, user

### Growth

**Zone type**:
One of Residential, Commercial or Industrial (RCI); every zoned Lot has exactly one.
_Avoid_: Land use, category

**Zoning**:
The City claiming bare tiles beside a Road as a new Lot of one Zone type. Land freed by demolition goes back to bare and can be zoned again.
_Avoid_: Allocation, plotting

**Demand**:
The City's current appetite for more of each Zone type; it decides what gets built next.
_Avoid_: Need, pressure

**Density**:
How intensely a Lot is built up: Low, Medium or High.
_Avoid_: Level, size

**Redevelopment**:
Replacing a Lot's Building with a denser one as its surroundings mature, sometimes merging neighbouring Lots of the same Zone type into one larger Lot first.
_Avoid_: Upgrade, rebuild

**Abandonment**:
A Building falling empty because its Zone type is no longer wanted there, shown faded and overgrown until it is demolished.
_Avoid_: Decay, blight, dereliction

**Land value**:
How desirable a tile is to build on, raised by water, Parks, Civic buildings and closeness to a large Centre and lowered by slopes and pollution.
_Avoid_: Desirability, price

**Centre**:
The heart of one settlement within the City, where its densest Buildings cluster. A City can have several: a new one is founded when growth reaches good land far from every existing Centre. Centres keep their identity even after their built-up areas grow together.
_Avoid_: Downtown, CBD, core, hub

### Playback

**Time lapse**:
The recorded history of a City's growth from its first Road to the Present.
_Avoid_: Recording, replay, history

**Run**:
One City's full span of growth: 100 simulated years from the first Road. The Time lapse of a finished Run has a fixed length.
_Avoid_: Game, session, playthrough

**Idle**:
The state after a Run finishes: Ambient life carries on, but no Building, Lot or Road changes.
_Avoid_: Epilogue, ambient mode

**Present**:
The latest moment the City has grown to; the Time lapse cannot be scrubbed past it. The City grows, and the Present advances, only while the Playhead is at the Present.
_Avoid_: Now, live edge, head

**Playhead**:
The moment of the Time lapse currently being shown. It can sit anywhere from the start to the Present.
_Avoid_: Cursor, current time

**Milestone**:
A notable moment in a Run, such as a Centre founded or the first highway, pinned on the Time lapse so the Viewer can jump to it.
_Avoid_: Event, achievement, bookmark

**Auto camera**:
An optional camera mode that drifts on its own toward wherever the City is changing; any camera input from the Viewer ends it.
_Avoid_: Cinematic mode, follow cam, screensaver

**Ambient life**:
The cars, people and day/night cycle that animate the City on their own real-time clock. They keep going while paused, rewinding or Idle, and never affect growth.
_Avoid_: Background activity, decoration, flavour

**Snapshot**:
A picture of the City at the Playhead's moment, as the Viewer currently sees it, saved for the Viewer to keep.
_Avoid_: Screenshot, capture, save

### Places

**Terrain**:
The land the City grows on: its hills, rivers and coastline. It is shaped by the Seed and never changes during a Run.
_Avoid_: Landscape, ground

**Terrace**:
A Lot on a gentle slope that sits on a small retaining wall so it can be built on; the Terrain beneath is unchanged.
_Avoid_: Platform, foundation, flattening

**Bridge**:
A short stretch of Road, straight or diagonal, that spans water.
_Avoid_: Crossing, overpass

**Lot**:
A rectangle of 1×1 up to 4×4 tiles with one use: a Zone type, a Park or a Civic building. Zoned Lots can merge but never split; Park and Civic Lots never change once laid out.
_Avoid_: Plot, parcel

**Building**:
The structure standing on a Lot.
_Avoid_: Structure, house

**Park**:
Green space from 1×1 up to 4×4 tiles that the City lays out to lift Land value, often near Centres and water.
_Avoid_: Green, garden, plaza

**Civic building**:
A non-zoned Building the City adds as a Centre grows, such as a school, fire station or town hall. It affects Land value and nothing else.
_Avoid_: Service building, public building, amenity

**Landmark**:
A Civic building that marks a large Centre, such as a clock tower.
_Avoid_: Monument, wonder

**Regional highway**:
The highway that already crosses the map edge to edge at year 0; it is the City's link to the outside world, and the first village grows where it meets good land.
_Avoid_: Neighbour connection, interstate, main road

**Pocket park**:
A small patch of greenery filling the triangular sliver between a diagonal Road and the grid; it is not a Lot.
_Avoid_: Filler, wedge

**Road**:
A path of tiles, straight or diagonal, that Lots are zoned along. Every Road has a Road tier.
_Avoid_: Street (that is a Road tier), path

**Road tier**:
A Road's class. Dirt road, street and avenue form a ladder that busy Roads climb over time; highway is separate and is only ever built, never reached by promotion.
_Avoid_: Road type, road level

**Traffic**:
An estimate of how heavily a Road is used, based on the homes and jobs it connects and how central it is; no individual trips are simulated.
_Avoid_: Congestion, load, flow

**Promotion**:
A Road moving up one step of the dirt road → street → avenue ladder because its Traffic has stayed high.
_Avoid_: Upgrade, widening
