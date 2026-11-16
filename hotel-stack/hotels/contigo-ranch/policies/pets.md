---
id: pets
editable: true
used_by: [voice, text]
depends_on: [facts.pets.allowed, facts.pets.fee, facts.pets.cat_fee_per_night, facts.pets.max_per_unit, facts.pets.unauthorized_fee, tool.search_knowledge_base]
---
# Pet Policy
- Allowed: {{facts.pets.allowed}}. No pigs, pet rodents, or other animals.
- Up to {{facts.pets.max_per_unit}} pets per unit, dogs and cats combined.
- Dogs and cats must be approved when the reservation is made. They cannot be added at arrival without advance notice.
- Dogs: ${{facts.pets.fee}} non-refundable pet deposit per unit. The fee applies to every unit the dog enters, because each needs extra cleaning. Keep this in mind for groups.
- Cats: ${{facts.pets.cat_fee_per_night}} per cat, per night. Cats do not pay the one-time dog deposit.
- With the fee, dog bowls, poop bags, and a blanket for the dog are provided.
- Breed and size restrictions may apply.
- A ${{facts.pets.unauthorized_fee}} fee applies for unauthorized pets, and guests will be asked to vacate.
- Dogs are not allowed on furniture and must be kenneled when left alone in the unit. A few kennels can be borrowed first come, first served.
- Dogs must be on a leash at all times on the ranch, to protect them, the cattle, and the mini horses.
- For anything else about pets, use `search_knowledge_base`.
