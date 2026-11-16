// Doss's change proposals. Every change to the stack (hotel files or code) is a ChangeProposal: core validates it
// against these types, runs checks, asks ReviewChange for a plain-English summary, and waits for the owner's approval.

class FileEdit {
  path string @description("Repo-relative path, e.g. hotels/contigo-ranch/kb/pool.md or src/hotelcore/tools/rooms.py")
  old_text string? @description("Exact existing text to replace; must appear exactly once in the file. Use with new_text.")
  new_text string? @description("Replacement text for old_text (empty string removes it).")
  content string? @description("Full file content: for a new file or a complete rewrite. Do not combine with old_text/new_text.")
  delete bool? @description("true to delete the file.")
}

class ChangeProposal {
  title string @description("Short title, e.g. 'Add pool hours to the knowledge base'")
  reason string @description("Why the owner wants this, in one or two sentences")
  edits FileEdit[]
}

// Texts to guests (owner approves the exact message for every recipient before anything is sent).
class GuestText {
  to string @description("Mobile number in international format, e.g. +18305551234")
  name string? @description("Guest name, shown to the owner (e.g. from the Beds24 booking)")
  text_name string? @description("A hotel text by internal name (see agent_overview texts_danny_can_send); omit for custom wording")
  booking_id int? @description("Beds24 booking id, required for booking templates such as payment_link or booking_confirmation")
  body string? @description("Custom wording, used when no template is given. Short (one SMS) and signed as the hotel.")
}

class GuestTextBatch {
  reason string @description("Why these texts go out, in the owner's words")
  items GuestText[]
  send_at string? @description("When to send, hotel local time 'YYYY-MM-DD HH:MM' (or ISO with offset); omit to send as soon as approved")
}

// Mini apps: small pages Doss builds. Owner apps live inside the dashboard (sandboxed, data through window.hotel);
// public apps are served at /p/<slug> with only public data (availability, hotel info).
class MiniApp {
  slug string @description("URL name, lowercase letters, digits and dashes, e.g. arrivals-board")
  title string
  description string @description("One sentence: what the page is for")
  html string @description("One self-contained HTML document (inline CSS and JS, no external scripts)")
  for_guests bool @description("true = public page guests can open at /p/<slug>; false = owner-only inside the dashboard")
}

enum Risk {
  Low @description("Wording or facts only; guests barely notice")
  Medium @description("Changes what Danny says or does in some conversations")
  High @description("Changes bookings, payments, code paths, or many conversations")
}

class ChangeReview {
  summary string @description("2-3 sentences for the hotel owner: what changes, in plain words")
  risk Risk
  guest_impact string @description("What guests will notice, or 'None'")
  what_to_test string @description("One concrete thing to try after approving, e.g. a question to ask Danny")
}

function DraftChange(request: string, files: string) -> ChangeProposal {
  client Claude
  prompt #"
    You edit the configuration and code of a hotel's AI front desk. Turn the owner's request into exact file edits.

    Rules:
    - Only edit the files shown below, or create new files next to them following the same conventions.
    - Prefer small edits: use old_text/new_text with an exact snippet copied from the file (it must occur exactly once).
    - For a new file use content. Keep the file's existing style (markdown headings, YAML layout, frontmatter).
    - Never invent prices, policies or facts the request does not give.
    - Facts live in facts.yaml and are referenced as {{ '{{facts.path}}' }}; do not hard-code them elsewhere.

    {{ ctx.output_format }}

    {{ _.role("user") }}
    Request: {{ request }}

    Current files:
    {{ files }}
  "#
}

function ReviewChange(diff: string, checks: string) -> ChangeReview {
  client Claude
  prompt #"
    You review a proposed change to a hotel's AI front desk (voice agent Danny, its SMS agent, the dashboard and
    the owner agent Doss) for the hotel owner, who is not technical. Be accurate and brief.

    {{ ctx.output_format }}

    {{ _.role("user") }}
    Diff:
    {{ diff }}

    Automatic checks:
    {{ checks }}
  "#
}

test DraftKbAddition {
  functions [DraftChange]
  args {
    request "Add the pool hours: open daily 9am to 7pm, May through September."
    files #"
      === hotels/contigo-ranch/kb/amenities.md ===
      ---
      id: amenities
      title: Amenities
      ---
      # Amenities
      - Fire pits at every cabin.
      - Free Wi-Fi.
    "#
  }
  @@assert({{ this.edits|length > 0 }})
  @@assert({{ "9" in (this.edits[0].new_text or this.edits[0].content) }})
}

test ReviewSmallWordingChange {
  functions [ReviewChange]
  args {
    diff #"
      --- a/hotels/contigo-ranch/kb/amenities.md
      +++ b/hotels/contigo-ranch/kb/amenities.md
      @@ -6,2 +6,3 @@
       - Fire pits at every cabin.
       - Free Wi-Fi.
      +- Pool: open daily 9am-7pm, May through September.
    "#
    checks "render: ok\nvoice evals: 15/15 passed\ntext evals: 8/8 passed"
  }
  @@assert({{ this.risk == "Low" }})
}
