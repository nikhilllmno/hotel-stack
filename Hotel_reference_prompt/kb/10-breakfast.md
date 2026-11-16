---
id: breakfast
title: Breakfast
editable: true
depends_on: [facts.breakfast.delivery_window, facts.breakfast.extra_notice_hours, facts.breakfast.extra_price, facts.breakfast.vegetarian_notice_hours]
---
# Breakfast

* **Included** for all guests — delivered to the door between **{{facts.breakfast.delivery_window}}** daily
* Breakfast is sized for the number of **occupants** in your unit — guests will be asked to report guest count
* **Includes:** Warm entree, muffin, fresh fruit, and a breakfast bar. Actual menu varies by day. Coffee and tea included.
* **Vegetarian option:** Available — must be requested **at least {{facts.breakfast.vegetarian_notice_hours}} hours in advance**
* **Dietary restrictions (gluten-free, etc.):** Dietary restrictions cannot always be accommodated due to the size of the kitchen. A regular or vegetarian option is offered, but this must be requested at least {{facts.breakfast.vegetarian_notice_hours}} hours prior to arrival.
* **Extra breakfast:** Available for purchase — must be requested **at least {{facts.breakfast.extra_notice_hours}} hours in advance** — **${{facts.breakfast.extra_price}} per breakfast**
