# PMS Integration Process

This document describes how Dextr integrates with a new Property Management System (PMS). It covers the end-to-end workflow from initial contact through certification and production access.

For PMS-specific technical details (APIs, configuration, reservation flows), see the individual integration guides (if available) in this folder (e.g. `Cloudbeds_integration.md`).

---

## Overview

A PMS integration connects Dextr's AI products — **Daisy** (voice/text reservations) and **Alfred** — to a hotel's property management system. The integration enables availability checks, reservation creation, updates, cancellations, and webhook-driven sync for guest lifecycle events.

Typical timeline: **~2 months** per PMS, driven largely by PMS-side response times and certification steps. The tech team should move at maximum velocity on everything within our control.

---

## 1. How an Integration Starts

There are two common entry points.

### 1a. New hotel (via Sajid)

Sajid connects us with a new hotel. Two paths:

| Scenario | What happens |
|----------|--------------|
| Hotel uses a PMS we already support | Onboarding team handles the rest. No new integration work. |
| Hotel uses an unsupported PMS | Tech team begins a new PMS integration (continue from Section 2). |

### 1b. New PMS (via Angel)

Angel connects us with a new PMS vendor directly. Some PMS systems require us to find one or more hotels using their system before granting certification. In that case, hotel discovery becomes part of the certification prerequisites.

---

## 2. Initial Contact with the PMS

The tech team connects with the PMS team via:

- **Call** — if the PMS allows it
- **Email** — otherwise, or as a supplement to calls

In either case, we introduce Dextr and explain how Daisy and Alfred work: AI-driven reservation handling over text and voice, with payments processed via Stripe.

---

## 3. Discovery Questions

Once the PMS shares API and webhook documentation, we send a structured set of questions to clarify the reservation lifecycle and integration constraints. Adapt the template below for each PMS.

> Thank you for providing the comprehensive list of APIs and webhooks; the documentation is very detailed and helpful.
>
> As we look to integrate [PMS Name] with our AI products, we would like to clarify a few points regarding the reservation lifecycle. Our AI handles checking availability, as well as creating, updating, and cancelling reservations through direct communication with customers via text or call. To ensure a seamless integration, could you provide more insight into the following:
>
> - **Reservation Lifecycle:** What is the typical flow from an API perspective? Which APIs have to be invoked in a sequential manner to get the availability details and create reservations? It would be great if we can have any guide which gives us the exact steps needed to create/modify reservations.
> - **API Restrictions:** Are there any specific APIs restricted based on the tokens provided?
> - **Payment Workflow:** Our AI processes payments via Stripe. We intend to collect the payment and then invoke the [PMS Name] APIs to create the reservation. Does [PMS Name] support this workflow?
> - **Pricing and Discounts:** Is it possible to override [PMS Name] pricing to apply discounts on our end? Additionally, is pricing information a required field during reservation creation?
> - **Multi-room Reservations:** How are multi-room reservations handled via the API? For instance, if the customer wants to book two rooms for a given duration, can it be done?
> - **Reservation Webhooks:** If we subscribe to the relevant reservation webhooks, will we get notified about all reservations created/modified/cancelled across all platforms (Dextr and non-Dextr), and also guest check-in and check-out events?

---

## 4. Technical Integration

### 4.1 API and webhook analysis

Review the PMS documentation and map each capability to Daisy and Alfred:

- Refer https://docs.google.com/spreadsheets/d/1ykikDVAl6SgOJuuRU-iVP6mzNeJ7XYfmhr6Ep9XmTX8/edit?usp=share_link for the complete capabilities
- Availability and rate quoting
- Reservation create / update / cancel
- Payment handling (Stripe-first vs PMS-native)
- Webhooks for reservation and guest lifecycle events

Document gaps, deferred scope, and open questions.

### 4.2 Sandbox access

The PMS provides a sandbox environment:

- PMS dashboard (for manual verification)
- API credentials (tokens, keys, etc.)

### 4.3 Implementation

Implement the integration in the codebase following existing PMS patterns (client, types, service layer, webhooks). Reference prior integrations (ResNexus, Hostaway, Stayntouch, Cloudbeds) for structure.

---

## 5. Testing

### 5.1 Database setup

Add the test hotel to the required tables:

| Table | Purpose |
|-------|---------|
| `hotels` | Hotel record with `pms_provider`, `business_id`, etc. |
| `hotel_configurations` | Hotel-specific settings |
| `channels` | Communication channel configuration |

### 5.2 Agent setup

Create a test agent on **Vapi** or **n8n**. The onboarding team can assist with this.

### 5.3 End-to-end testing

Call or text the agent and exercise all flows:

- Availability check
- Reservation creation (with payment)
- Reservation modification / cancellation (if supported)
- Webhook delivery and handling

Fix issues and re-test until all scoped flows pass.

---

## 6. Certification Demo

Once all flows are implemented and tested — or when completion is clearly scheduled — book a call with the PMS team to demo the integration.

**Demo checklist:**

- [ ] Availability and quoting
- [ ] Reservation creation with and without payment
- [ ] Reservation update / cancellation (if in scope)
- [ ] Webhook sync (reservation and guest events)

If the PMS is satisfied, they advance us to the next certification stage and grant **production environment access**.

---

## 7. Production Rollout

After certification:

1. Receive production API credentials from the PMS.
2. Onboarding team provisions the hotel(s) in production.
3. Monitor initial live reservations and webhook delivery.

---

## 8. Known Bottlenecks

### Timezone

The tech team is based in India; most PMS teams are in the US.

- Emails sent during our daytime arrive at their nighttime.
- Responses typically come during their business hours (our nighttime).
- For email threads, plan to be available at night for back-and-forth when responses are time-sensitive.

### Response delays

PMS teams may take **days** to respond to technical questions. This is the primary driver of the ~2-month integration timeline.

### Mitigation

- Send comprehensive, well-structured questions upfront (Section 3) to reduce back-and-forth.
- Parallelize work: start API analysis and sandbox testing while waiting for answers on non-blocking items.
- Maintain maximum velocity on all work within our control — implementation, testing, and demo prep should not wait on PMS responses unless blocked.

---

## Process Summary

```
New hotel or PMS contact
        │
        ▼
  Already integrated? ──yes──► Onboarding team handles hotel setup
        │
       no
        ▼
  Contact PMS (call / email)
  Introduce Dextr, Daisy, Alfred
        │
        ▼
  Send discovery questions
  Review APIs & webhooks
        │
        ▼
  Receive sandbox credentials
  Implement & unit-test code
        │
        ▼
  Provision test hotel (DB + agent)
  End-to-end test via call/text
        │
        ▼
  Demo to PMS team
        │
        ▼
  Certification → production access
        │
        ▼
  Onboarding team rolls out hotel(s)
```
