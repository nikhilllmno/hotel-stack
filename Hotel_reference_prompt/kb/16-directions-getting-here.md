---
id: directions-getting-here
title: Directions & Getting Here
editable: true
depends_on: [facts.location.avoid_route, facts.location.best_route, facts.location.enchanted_rock_miles, facts.location.minutes_to_town, facts.location.minutes_to_wineries, facts.property.address, facts.property.town]
---
# Directions & Getting Here

**Address:** {{facts.property.address}}

**  IMPORTANT — Best Route:**
* **TAKE:** **{{facts.location.best_route}}** — this is the best route to the ranch
* **DO NOT TAKE:** {{facts.location.avoid_route}} — this is the "back way" that crosses cattle ranches and low water crossings

**Before you arrive:**
* **Gas up / charge your vehicle** before heading to the ranch — the nearest gas station and charging options are approximately **{{facts.location.minutes_to_town}} minutes away** in town
* **Grocery stores:** Several within {{facts.location.minutes_to_town}} minutes, including HEB (full-service) and Walmart — stock up before arriving if needed

**Location context:**
* Approximately **{{facts.location.minutes_to_town}} minutes from downtown {{facts.property.town}}**
* {{facts.location.enchanted_rock_miles}} miles to **Enchanted Rock**
* About {{facts.location.minutes_to_wineries}}-minute drive from wineries along Highway 290
