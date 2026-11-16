---
id: parking-directions
editable: true
used_by: [voice, text]
depends_on: [facts.fees.ev_charging_penalty, facts.location.avoid_route, facts.location.best_route, facts.location.enchanted_rock_miles, facts.location.minutes_to_town, facts.property.town, tool.search_knowledge_base]
---
# Parking and EV charging
- **No electric vehicle charging.** Plugging into any ranch power source is not allowed because it can disrupt power across the property. Vehicles found charging incur a ${{facts.fees.ev_charging_penalty}} fee. Suggest charging at the local HEB or elsewhere in town before arriving.
- If a guest's car doesn't have enough charge to get back to town: the ranch doesn't offer towing, so suggest a local towing service.
- **Parking:** Cabins 1 to 5 park in front of the cabins. Cottages 6 to 16 use the upper area only for unloading, then park in the Hall parking lot without blocking the road. Only handicapped parking is near the cottages. Overflow parking is available for events.

# Directions
- The best route is {{facts.location.best_route}}.
- Do NOT take {{facts.location.avoid_route}}. That back way crosses cattle ranches and low water crossings.
- Get gas or charge before arriving. The nearest stations are in town.
- The ranch is about {{facts.location.minutes_to_town}} minutes from downtown {{facts.property.town}} and {{facts.location.enchanted_rock_miles}} miles from Enchanted Rock.
- Do not give turn-by-turn directions. If a guest needs directions from a specific place, offer to take a message for the manager.
- For transportation and wine tours, use `search_knowledge_base`.
