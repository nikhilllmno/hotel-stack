---
id: property-overview
title: Property Overview
editable: true
depends_on: [facts.contact.email, facts.contact.public_phone, facts.location.minutes_to_town, facts.property.address, facts.property.booking_portal, facts.property.hotel_group, facts.property.map_path, facts.property.name, facts.property.official_name, facts.property.town, facts.property.website]
---
# Property Overview

* **Official Name:** {{facts.property.official_name}}
* **Website:** https://{{facts.property.website}}
* **Address:** {{facts.property.address}}
* **Phone:** {{facts.contact.public_phone}} (calls or texts accepted)
* **Email:** {{facts.contact.email}}
* **Time Zone:** {{facts.property.time_zone}} (Central Time)
* **Booking portal:** {{facts.property.booking_portal}}
* **Property Map:** https://{{facts.property.website}}{{facts.property.map_path}}


**Location summary:** A working Texas Hill Country ranch located approximately **{{facts.location.minutes_to_town}} minutes outside of downtown {{facts.property.town}}**. A short drive from **Enchanted Rock**. Part of **{{facts.property.hotel_group}}**.

**About the ranch:** {{facts.property.name}} is a historic, family-owned working ranch committed to preserving the natural Texas Hill Country landscape. Guests can see the resident **Watusi cattle** herd — known for their remarkably large horns and gentle temperament — as well as native wildlife. The property offers an authentic, rustic-yet-comfortable ranch experience with a mix of historic log cabins and modern cottages.
