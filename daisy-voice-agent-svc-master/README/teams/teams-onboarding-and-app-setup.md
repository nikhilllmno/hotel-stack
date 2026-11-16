# Microsoft Teams: app setup and hotel onboarding

Runbook for the Teams notification integration. This file covers only the setup steps. How the integration works in code is in the "Chat notifications" section of the root `README.md`.

There are three parts:

1. One-time setup on the Daisy side (Azure Bot and Entra app).
2. Building and distributing the Teams app package.
3. Onboarding each hotel.

Microsoft's portal labels change often. Treat the menu names below as a guide and check them against the current Microsoft docs when you do the setup.

## Part 1: Daisy side, one time

### 1.1 Create the Azure Bot and Entra app

1. In the Azure portal, create an **Azure Bot** resource in Daisy's tenant.
2. Choose **single-tenant** as the app type. Microsoft stopped allowing new multi-tenant bots after 31 Jul 2025.
3. Do not choose a user-assigned managed identity. It only works for code running on Azure compute, and Daisy runs on AWS (ECS + EC2).
4. Let Azure create the Entra app registration with the bot, or point it at one you made.
5. In the app registration, create a **client secret** (or upload a certificate). Record the expiry date and set a reminder to rotate it.
6. Record the values we need:
   - `TEAMS_BOT_APP_ID`: the application (client) ID.
   - `TEAMS_BOT_APP_PASSWORD`: the client secret value.
   - `TEAMS_BOT_TENANT_ID`: Daisy's directory (tenant) ID.
7. On the bot resource, under Channels, turn on **Microsoft Teams**.
8. Under Configuration, set the **messaging endpoint** to `https://<our-domain>/webhook/teams`. The endpoint must be reachable over HTTPS from the internet.

### 1.2 Add the env vars

- `TEAMS_BOT_APP_ID`, `TEAMS_BOT_APP_PASSWORD` and `TEAMS_BOT_TENANT_ID` are read in `config.ts` and listed in `.env.example`. Add them to each environment's secrets.
- Do not commit the secret. Store it where the other secrets are stored.
- Run `npm run migrate` so the `hotels.notification_type`, `teams_conversation_references` and `chat_outbound_messages` migrations are applied.

### 1.3 What the SDK does with these values

You do not write this code, but it explains why the values are needed.

- Outbound: the SDK gets a `client_credentials` token from `https://login.microsoftonline.com/{TEAMS_BOT_TENANT_ID}/oauth2/v2.0/token` with scope `https://api.botframework.com/.default`.
- Inbound: the SDK checks the `Authorization: Bearer` JWT. The audience must equal the app ID and the issuer must be `https://api.botframework.com`. The signing keys come from `https://login.botframework.com/v1/.well-known/openidconfiguration`.

## Part 2: Teams app package

The Teams app is a zip that points at our bot. Users cannot add a bot to Teams unless it is wrapped in a Teams app.

### 2.1 Build the package

The repo does not hold the manifest or the icons, so assemble the zip yourself. It needs three files at its root:

- `manifest.json` (sample below)
- `color.png` (192 x 192), the Daisy brand icon
- `outline.png` (32 x 32), a transparent outline version of the icon

You can build the package in the Teams Developer Portal instead, which also validates the manifest and tells you the latest `manifestVersion`.

Required manifest content (sample; use the latest `manifestVersion` that Developer Portal validates, and replace the placeholders):

```json
{
  "$schema": "<current manifest schema URL>",
  "manifestVersion": "<latest supported>",
  "version": "1.0.0",
  "id": "<new GUID for the Teams app>",
  "developer": {
    "name": "Daisy",
    "websiteUrl": "https://<our-site>",
    "privacyUrl": "https://<our-site>/privacy",
    "termsOfUseUrl": "https://<our-site>/terms"
  },
  "name": { "short": "Daisy", "full": "Daisy hotel assistant" },
  "description": {
    "short": "Hotel escalations, alerts and call transcripts.",
    "full": "Daisy posts guest escalations, payment and PMS alerts and call transcripts to your channels, and lets your team reply and react from Teams."
  },
  "icons": { "color": "color.png", "outline": "outline.png" },
  "accentColor": "#FFFFFF",
  "bots": [
    {
      "botId": "<TEAMS_BOT_APP_ID>",
      "scopes": ["team", "personal"],
      "supportsFiles": false,
      "isNotificationOnly": false
    }
  ],
  "webApplicationInfo": {
    "id": "<TEAMS_BOT_APP_ID>",
    "resource": "https://RscBasedStoreApp"
  },
  "authorization": {
    "permissions": {
      "resourceSpecific": [
        { "name": "ChannelMessage.Read.Group", "type": "Application" }
      ]
    }
  },
  "validDomains": []
}
```

Notes:

- `botId` must equal the bot's app ID.
- `ChannelMessage.Read.Group` lets the bot receive every message in the Team's channels. Without it the bot only gets messages that @mention it, so a plain thread reply to an escalation would not reach us. The Team owner consents to it when the app is added.
- `isNotificationOnly` must be `false`, because the bot receives replies, reactions and button clicks.
- Validate the package in Developer Portal before sharing it.

### 2.2 Test in Daisy's own tenant

1. Upload the zip as a custom app in a test Team in Daisy's own tenant (Teams client: Apps, Manage your apps, Upload an app).
2. Add it to a test Team and channel. @mention the bot and check the webhook receives the activity.
3. Check each flow: a new escalation posted, a thread reply, a reaction, a button click, an edit and a delete.

### 2.3 Cross-tenant check (not yet confirmed)

Daisy's bot is single-tenant, but hotels are in other tenants. Microsoft's guidance is that a single-tenant bot can be used by other tenants once the app is published to the Teams Store. It is not confirmed that a hotel admin can upload our zip directly and have it work.

1. Create a second tenant (a free Microsoft 365 developer tenant works).
2. Upload the same zip there through that tenant's Teams admin center (Teams apps, Manage apps, Upload new app).
3. Add it to a Team and run the checks from 2.2.
4. If it works, Option A below is viable. If it does not, we need the Teams Store listing (Option B). If that is also not workable, the fallback is one bot per hotel with credentials stored per hotel.

### 2.4 How the hotel gets the app

- **Option A: the hotel's Teams admin uploads our zip.** Start here for the first hotels.
  - We send the admin the zip.
  - They upload it in Teams admin center under Teams apps, Manage apps, Upload new app.
  - It then appears in their org's app catalog as "Built for your org". Microsoft says this can take a few hours.
  - Their policies must allow custom apps.
- **Option B: Teams Store listing.** Needed to scale, and the safer cross-tenant path.
  - Publish through Partner Center. Microsoft reviews and certifies the app, which takes time.
  - Hotels search Apps in Teams and install it. Their admin can still allow or block it.
- **Not recommended: a user uploads the zip in the Teams client.** It only works if the admin allows custom upload, it is not discoverable, and it is meant for testing.

## Part 3: Onboarding a hotel

### 3.1 Hotel side

1. The hotel's Teams admin makes the app available (Option A or B above).
2. A Team owner adds the app to the Team:
   - Open the Team, Manage team, Apps, add the app.
   - Or open Apps, select Daisy, choose "Add to a team", and pick the Team and channel.
3. The Team owner approves the `ChannelMessage.Read.Group` consent during that step.
4. The hotel creates (or picks) standard channels for escalations, alerts and transcripts. One channel for all three is fine. Private channels do not work for bot posts, and shared channels have limited support.

### 3.2 Daisy side

1. The bot receives `installationUpdate` and stores a `teams_conversation_references` row (tenant ID, service URL, Team ID).
2. In each target channel, someone @mentions the bot with the link command (for example `@Daisy link`). The bot replies with the channel ID and saves the reference for that channel.
3. Ops set the hotel's `notification_type` to `teams`.
4. Ops put the channel IDs into `telegram_check_in_group_id`, `telegram_alerts_group_id` and `telegram_transcript_group_id` through the existing hotel API or update flow.
5. Send a test escalation. Reply to it in Teams, then react with the agreed "done" reaction, and confirm the escalation moves to DONE.

### 3.3 Rollback

Set the hotel's `notification_type` back to `telegram`. Keep the Telegram IDs in a note before overwriting the columns, because the columns hold only one provider's ID at a time.

## Checklist for the hotel call

### Tenant
- Do they use Microsoft 365 work or school Teams (not free or personal)?
- What is their tenant ID or primary domain?
- Are they in the commercial cloud, or GCC, GCC High or DoD? Government clouds use different endpoints, and custom upload is not possible in GCC High and DoD.

### Admin and policy
- Who is the Teams admin?
- Are custom or third-party apps allowed (Teams admin center: Setup policies and App permission policies)?
- Can they upload a custom app or approve an org-wide app?
- Can Team owners consent to resource-specific permissions (RSC)?
- Is there a security review process, and how long does it take?

### Where messages go
- Which Team?
- Which channel for escalations and daily reports, which for alerts (payments and PMS) and which for transcripts? One channel for all is fine.
- Channels must be standard, not private or shared.
- Will they create the channels before the install?

### Who is involved
- Who owns the Team?
- Who should reply, react and click buttons? They must be members of the Team.
- Do they use guest accounts?

### Notifications
- Do they want an @mention of specific people or a channel mention on new escalations? That needs user names or IDs.
- Teams does not alert people for a plain bot post unless it mentions them.

### Reactions
- Which Teams reaction means "done"? We map it to `allowed_emojis`. Teams' standard reaction types are like, heart, laugh, surprised, sad and angry.

### Compliance
- Message retention, DLP policies or conditional access that could block the bot.
- Is it acceptable to put guest phone numbers and call transcripts in Teams?

### Network
- No firewall change is needed on their side. Microsoft calls our endpoint, so they do not need to allow-list anything.

### Testing
- A test channel and a named person for a live test (send an escalation, reply, react).
