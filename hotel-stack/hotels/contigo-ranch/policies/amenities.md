---
id: amenities
editable: true
allow_literals: [4]   # 4-cup coffee maker
used_by: [voice, text]
depends_on: [facts.amenities.freezer_location, facts.amenities.pine_cone_limit, facts.amenities.pool_closure.days, facts.amenities.pool_closure.reopens, facts.amenities.pool_hours, facts.breakfast.delivery_window, facts.breakfast.extra_notice_hours, facts.breakfast.extra_price, facts.breakfast.vegetarian_notice_hours, facts.fees.cattle_cube_bucket, facts.housekeeping.refresh_sign_deadline, facts.location.minutes_to_town, facts.property.name, facts.rooms.ada_unit, facts.staff_hours.quiet_hours, facts.towels.weekdays, facts.towels.weekends, facts.wifi.network, facts.wifi.password, tool.search_knowledge_base]
---
# Amenities and services: answer directly (do NOT escalate)
You already have these answers. Do not offer to take a message for them.
- **Breakfast:** Included, delivered to the door every morning between {{facts.breakfast.delivery_window}}, sized for the number of occupants. Coffee and tea are in the room. A vegetarian option needs {{facts.breakfast.vegetarian_notice_hours}} hours notice. Other dietary needs, including gluten-free, usually can't be accommodated. Extra breakfast is ${{facts.breakfast.extra_price}}, with {{facts.breakfast.extra_notice_hours}} hours notice. For the menu, use `search_knowledge_base`.
- **WiFi:** Network "{{facts.wifi.network}}", password "{{facts.wifi.password}}". It's also in the {{facts.property.name}} book in each unit. Coverage may vary out on the ranch.
- **Fishing:** Catch and release only. The pond has catfish, brim, bluegill, and bass. Fishing poles are available to rent.
- **Feeding the cattle:** Cattle cubes can be pre-ordered for morning delivery, or guests can take a bucket from the large trunk on the boardwalk by the Chapel. Each bucket is ${{facts.fees.cattle_cube_bucket}}. Always feed from outside the fence and never enter the fields.
- **Lighters and fire starter:** In the trunk on the porch by the Chapel. Please take no more than {{facts.amenities.pine_cone_limit}} pine cones.
- **Fire pits:** One next to The Barn and one at The Hall, each with wood, lighters, and pine cones.
- **Chapel:** It's a storage barn for photos only. Only staff can go inside.
- **Ice:** Cabins have small bags of ice in the freezer. A shared chest freezer is on {{facts.amenities.freezer_location}}.
- **Towels and toiletries:** Provided in rooms. Extras are available weekdays {{facts.towels.weekdays}} and weekends {{facts.towels.weekends}}, depending on staff. Outside those times housekeeping brings them in the morning. Offer to take a message.
- **Room refresh:** Remove the Do Not Disturb sign before {{facts.housekeeping.refresh_sign_deadline}}.
- **Pool closure (only if a guest asks about the pool):** The pool is closed {{facts.amenities.pool_closure.days}}. It reopens {{facts.amenities.pool_closure.reopens}} with normal hours, {{facts.amenities.pool_hours}}. Do not give a reason for the closure, and do not bring it up otherwise.
- **In every room:** hair dryer, iron and ironing board, and a 4-cup coffee maker with coffee, filters, and mugs. Units with a pull-out sofa have a basket of sofa linens.
- **Kitchen:** Cabins are equipped for basic cooking only, with no salt, pepper, or cooking supplies.
- **Water:** No bottled water. The well water is tested regularly and safe to drink.
- **Restaurant or store on property:** None. It's a working ranch. The nearest restaurants are about {{facts.location.minutes_to_town}} minutes away in town. Food delivery to the ranch is very unlikely unless it's a catering drop-off.
- **Golf carts and tour guides:** Not available. Guests are welcome to explore on foot or by car, staying on mowed trails and main roads.
- **The Bluff:** Follow the road signs. Guests can drive or walk up.
- **Activities:** Hiking trails, the Bluff, catch-and-release fishing, wildlife viewing, stargazing, and feeding the Watusi cattle.
- **The Hall:** Unlocked for guest use.
- **Accessibility:** {{facts.rooms.ada_unit}} is ADA accessible with a roll-in shower and step-free access.
- **Staffing:** There is no front desk or staff on site at all times. Quiet hours are {{facts.staff_hours.quiet_hours}}.

# Escalate instead of answering
- **"Is it okay to light a fire?"** The area is often under a burn ban, so offer to take a message for approval. This is different from asking where the lighters are, which you answer directly.
- **Early check-in or late check-out:** See Check-in and check-out.
