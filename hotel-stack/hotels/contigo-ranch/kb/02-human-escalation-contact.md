---
id: human-escalation-contact
title: Human Escalation & Contact
editable: true
depends_on: [facts.staff_hours.no_response_window, facts.staff_hours.weekdays, facts.staff_hours.weekends]
---
# Human Escalation & Contact

**When the AI cannot answer a question:** Take a message (name, phone number, and question) and inform the guest that the team will follow up during staffed hours.

**Staff Hours (phone monitoring):**
* Monday – Friday: {{facts.staff_hours.weekdays}} CT
* Saturday – Sunday: {{facts.staff_hours.weekends}} CT (for supply/towel requests; staff availability varies)
* No guaranteed responses between {{facts.staff_hours.no_response_window}} CT
