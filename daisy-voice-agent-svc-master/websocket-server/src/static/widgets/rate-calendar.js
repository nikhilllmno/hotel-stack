/*!
 * Dextr rate calendar: a nightly-rate calendar hotels embed on their own website.
 *
 *   <script src="https://<daisy-host>/widgets/rate-calendar.js" defer></script>
 *   <dextr-rate-calendar business-id="12345"
 *                        book-url="https://example.com/book"
 *                        phone="+15417161678"></dextr-rate-calendar>
 *
 * Attributes: business-id (required), book-url, phone (defaults to the hotel's guest line),
 * website-link (falls back to a "Visit website" button when there is no book-url), accent (CSS color),
 * theme ("light" | "auto"), locale, week-start ("0" Sunday | "1" Monday),
 * months-ahead (default 12), unit (a unit id to preselect), api-base
 * (defaults to the origin this script was loaded from).
 *
 * Fires "dextr-rate-ready" with { hotelName, phone, website } once rates first load, and
 * "dextr-rate-select" with { date, unitId, rates } when a guest picks a night.
 */
(function () {
  'use strict';

  if (
    !window.customElements ||
    window.customElements.get('dextr-rate-calendar')
  ) {
    return;
  }

  var currentScript = document.currentScript;
  var SCRIPT_ORIGIN = (function () {
    try {
      return currentScript && currentScript.src
        ? new URL(currentScript.src).origin
        : window.location.origin;
    } catch (e) {
      return window.location.origin;
    }
  })();

  var ALL = 'all';

  // ---------- dates (calendar dates only; no time zones involved) ----------

  function pad(n) {
    return String(n).padStart(2, '0');
  }
  function iso(y, m, d) {
    var t = new Date(Date.UTC(y, m, d));
    return (
      t.getUTCFullYear() +
      '-' +
      pad(t.getUTCMonth() + 1) +
      '-' +
      pad(t.getUTCDate())
    );
  }
  function parts(isoDate) {
    var p = isoDate.split('-').map(Number);
    return { y: p[0], m: p[1] - 1, d: p[2] };
  }
  function addDays(isoDate, n) {
    var p = parts(isoDate);
    return iso(p.y, p.m, p.d + n);
  }
  function daysInMonth(y, m) {
    return new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  }
  function weekday(isoDate) {
    var p = parts(isoDate);
    return new Date(Date.UTC(p.y, p.m, p.d)).getUTCDay();
  }
  function monthKey(y, m) {
    var t = new Date(Date.UTC(y, m, 1));
    return t.getUTCFullYear() + '-' + pad(t.getUTCMonth() + 1);
  }
  function normalizeMonth(view) {
    var t = new Date(Date.UTC(view.y, view.m, 1));
    return { y: t.getUTCFullYear(), m: t.getUTCMonth() };
  }
  function localToday() {
    var t = new Date();
    return iso(t.getFullYear(), t.getMonth(), t.getDate());
  }
  function utcDate(isoDate) {
    var p = parts(isoDate);
    return new Date(Date.UTC(p.y, p.m, p.d, 12));
  }

  // ---------- DOM helper (text is always set via textContent, never HTML) ----------

  function h(tag, attrs) {
    var el = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (key) {
        var value = attrs[key];
        if (value === null || value === undefined || value === false) return;
        if (key === 'text') el.textContent = value;
        else if (key === 'className') el.className = value;
        else el.setAttribute(key, value === true ? '' : value);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined || child === false) continue;
      el.appendChild(
        typeof child === 'string' ? document.createTextNode(child) : child,
      );
    }
    return el;
  }

  var ICON_PREV =
    '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M10 3 5 8l5 5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  var ICON_NEXT =
    '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="m6 3 5 5-5 5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  var STYLES = [
    /* Layout: stay-type buttons; month header; 7-column date grid where each cell is a date and
       its nightly price; the night's detail sits beside the grid when wide, below it when narrow. */
    ':host{',
    '  --drc-ink:#1c2a23; --drc-muted:#5b6a62; --drc-surface:#ffffff; --drc-line:#d9e1dc;',
    '  --drc-accent:#2f5d47; --drc-accent-ink:#ffffff; --drc-closed:#f2f5f3; --drc-cell:#f6f8f7;',
    '  --drc-shadow:0 1px 2px rgba(20,40,30,.05), 0 10px 30px -12px rgba(20,40,30,.18);',
    '  --drc-radius:10px;',
    '  display:block; container:drc / inline-size; color:var(--drc-ink); font:inherit; line-height:1.4;',
    '}',
    ':host([hidden]){display:none}',
    '@media (prefers-color-scheme: dark){:host([theme="auto"]){',
    '  --drc-ink:#e4ece7; --drc-muted:#9fb0a7; --drc-surface:#141c18; --drc-line:#2c3a33;',
    '  --drc-accent:#8cc4a5; --drc-accent-ink:#0f1a14; --drc-closed:#1b2520; --drc-cell:#18211c; --drc-shadow:none;',
    '}}',
    '*{box-sizing:border-box}',
    '.drc{background:var(--drc-surface); border:1px solid var(--drc-line); border-radius:14px; box-shadow:var(--drc-shadow); padding:20px; display:grid; gap:16px}',
    '.units{display:flex; gap:6px; overflow-x:auto; padding-bottom:2px; scrollbar-width:none; -webkit-mask-image:linear-gradient(90deg,#000 calc(100% - 28px),transparent); mask-image:linear-gradient(90deg,#000 calc(100% - 28px),transparent); padding-right:24px}',
    '.units::-webkit-scrollbar{display:none}',
    '.unit{flex:none; font:inherit; font-size:.875em; padding:7px 14px; border-radius:999px; border:1px solid var(--drc-line); background:transparent; color:var(--drc-ink); cursor:pointer; transition:border-color .15s, background-color .15s}',
    '.unit:hover{border-color:var(--drc-accent)}',
    '.unit[aria-pressed="true"]{background:var(--drc-accent); border-color:var(--drc-accent); color:var(--drc-accent-ink)}',
    '.body{display:grid; gap:16px; grid-template-columns:minmax(0,1fr)}',
    '.calendar{min-width:0}',
    '@container drc (min-width: 700px){.body{grid-template-columns:minmax(0,1fr) 280px; align-items:start}}',
    '.body.solo{grid-template-columns:minmax(0,1fr)}',
    '.head{display:flex; align-items:center; justify-content:space-between; gap:8px; margin-bottom:8px}',
    '.month{margin:0; font-size:1.2em; font-weight:600; letter-spacing:-.01em}',
    '.nav{display:grid; place-items:center; width:36px; height:36px; border-radius:50%; border:1px solid var(--drc-line); background:transparent; color:var(--drc-ink); cursor:pointer; transition:border-color .15s}',
    '.nav:hover:not(:disabled){border-color:var(--drc-accent)}',
    '.nav:disabled{opacity:.35; cursor:default}',
    '.caption{margin:0 0 8px; font-size:.8125em; color:var(--drc-muted)}',
    'table{width:100%; border-collapse:separate; border-spacing:4px; table-layout:fixed; margin:0 -4px; width:calc(100% + 8px)}',
    'th{font-weight:500; font-size:.75em; color:var(--drc-muted); padding:2px 0 4px; text-align:center}',
    'td{height:62px; padding:0; border-radius:10px; text-align:left; vertical-align:top; position:relative}',
    'td.day{background:var(--drc-cell); border:1px solid transparent; cursor:pointer; padding:7px 9px; transition:border-color .15s, background-color .15s}',
    'td.day:hover{border-color:var(--drc-accent)}',
    'td.day:focus-visible{outline:2px solid var(--drc-accent); outline-offset:1px}',
    '.num{display:block; font-size:.8125em; color:var(--drc-muted); font-variant-numeric:tabular-nums}',
    '.price{position:absolute; left:9px; right:6px; bottom:7px; font-weight:600; font-size:1em; letter-spacing:-.01em; font-variant-numeric:tabular-nums; white-space:nowrap; overflow:hidden; text-overflow:ellipsis}',
    'td.best .price{color:var(--drc-accent)}',
    'td.today .num{color:var(--drc-ink); font-weight:600; text-decoration:underline; text-underline-offset:3px}',
    'td.closed{background-color:var(--drc-closed); background-image:repeating-linear-gradient(135deg, var(--drc-line) 0 1px, transparent 1px 7px)}',
    'td.closed:hover{border-color:var(--drc-line)}',
    'td.closed .num{color:var(--drc-muted)}',
    'td.past{background:transparent; border-color:transparent; cursor:default}',
    'td.past .num{opacity:.45}',
    'td[aria-selected="true"]{background:var(--drc-accent); border-color:var(--drc-accent); color:var(--drc-accent-ink)}',
    'td[aria-selected="true"] .num,td[aria-selected="true"] .price{color:var(--drc-accent-ink)}',
    '.skeleton{position:absolute; left:7px; bottom:9px; width:58%; height:9px; border-radius:4px; background:var(--drc-line); animation:drc-pulse 1.4s ease-in-out infinite}',
    '@keyframes drc-pulse{50%{opacity:.45}}',
    '@media (prefers-reduced-motion: reduce){.skeleton{animation:none} *{transition:none!important}}',
    '.legend{display:flex; flex-wrap:wrap; gap:6px 14px; margin:8px 0 0; padding:0; list-style:none; font-size:.75em; color:var(--drc-muted)}',
    '.legend li{display:flex; align-items:center; gap:6px}',
    '.swatch{width:12px; height:12px; border-radius:3px; border:1px solid var(--drc-line)}',
    '.swatch{background:var(--drc-cell)}',
    '.swatch.closed{background-color:var(--drc-closed); background-image:repeating-linear-gradient(135deg, var(--drc-line) 0 1px, transparent 1px 4px)}',
    '.dot{width:8px; height:8px; border-radius:50%; background:var(--drc-accent); margin:0 2px}',
    '.panel{border-top:1px solid var(--drc-line); padding-top:14px; display:grid; gap:12px; align-content:start}',
    '@container drc (min-width: 700px){.panel{border-top:0; border-left:1px solid var(--drc-line); padding:4px 0 4px 16px}}',
    '.panel h4{margin:0; font-size:1em; font-weight:600}',
    '.rates{list-style:none; margin:0; padding:0; display:grid}',
    '.rate{display:grid; grid-template-columns:minmax(0,1fr) auto; gap:2px 12px; padding:10px 0; border-top:1px solid var(--drc-line)}',
    '.rate:first-child{border-top:0; padding-top:2px}',
    '.rate .name{font-weight:500; min-width:0; overflow-wrap:anywhere}',
    '.rate .amount{font-weight:600; font-variant-numeric:tabular-nums; text-align:right}',
    '.rate .meta{grid-column:1 / -1; font-size:.8125em; color:var(--drc-muted)}',
    '.rate.unavailable .name,.rate.unavailable .amount{color:var(--drc-muted); font-weight:400}',
    '.actions{display:grid; gap:8px}',
    '.book{display:inline-flex; justify-content:center; align-items:center; min-height:46px; padding:0 20px; border-radius:10px; background:var(--drc-accent); color:var(--drc-accent-ink); text-decoration:none; font-weight:600; letter-spacing:.005em; transition:filter .15s}',
    '.book:hover{filter:brightness(1.07)}',
    '.book:focus-visible,.unit:focus-visible,.nav:focus-visible,.retry:focus-visible,.contact a:focus-visible{outline:2px solid var(--drc-accent); outline-offset:2px}',
    '.contact{margin:0; font-size:.875em; color:var(--drc-muted)}',
    '.contact a{color:var(--drc-ink)}',
    '.hint,.notice{margin:0; color:var(--drc-muted); font-size:.875em}',
    '.notice{padding:18px 4px; display:grid; gap:10px; justify-items:start}',
    '.notice strong{color:var(--drc-ink); font-weight:600; font-size:1rem}',
    '.retry{font:inherit; font-size:.875em; padding:6px 14px; border-radius:999px; border:1px solid var(--drc-line); background:transparent; color:var(--drc-ink); cursor:pointer}',
    '.fine{margin:0; font-size:.75em; color:var(--drc-muted)}',
    '@container drc (max-width: 420px){',
    '  .drc{padding:14px; border-radius:12px} table{border-spacing:3px; margin:0 -3px; width:calc(100% + 6px)}',
    '  td{height:52px; border-radius:8px} td.day{padding:5px 6px}',
    '  .price{left:5px; right:2px; bottom:5px; font-size:min(.8125em, 3.3cqi); letter-spacing:-.02em} .num{font-size:.75em}',
    '}',
  ].join('\n');

  class DextrRateCalendar extends HTMLElement {
    static get observedAttributes() {
      return [
        'business-id',
        'api-base',
        'accent',
        'locale',
        'week-start',
        'months-ahead',
        'unit',
      ];
    }

    constructor() {
      super();
      this.attachShadow({ mode: 'open' });
      this.months = new Map();
      this.unit = ALL;
      this.selected = null;
      this.focusDate = null;
      this.view = null;
      this.wantsGridFocus = false;
      this.lowestInView = null;
      this.onClick = this.onClick.bind(this);
      this.onKeyDown = this.onKeyDown.bind(this);
      this.shadowRoot.addEventListener('click', this.onClick);
      this.shadowRoot.addEventListener('keydown', this.onKeyDown);
    }

    connectedCallback() {
      this.reset();
    }

    attributeChangedCallback(name, oldValue, newValue) {
      if (!this.isConnected || oldValue === newValue) return;
      if (name === 'accent') return this.render();
      this.reset();
    }

    // ---------- configuration ----------

    get businessId() {
      return (this.getAttribute('business-id') || '').trim();
    }
    get apiBase() {
      return (this.getAttribute('api-base') || SCRIPT_ORIGIN).replace(
        /\/+$/,
        '',
      );
    }
    get locale() {
      return this.getAttribute('locale') || navigator.language || 'en-US';
    }
    get weekStart() {
      return this.getAttribute('week-start') === '1' ? 1 : 0;
    }
    get monthsAhead() {
      var n = parseInt(this.getAttribute('months-ahead') || '12', 10);
      return Number.isFinite(n) && n >= 0 ? Math.min(n, 24) : 12;
    }

    reset() {
      var today = localToday();
      var t = parts(today);
      this.today = today;
      this.firstMonth = { y: t.y, m: t.m };
      // With under a week of nights left this month, open on next month; Previous still
      // shows the remaining nights.
      var nightsLeft = daysInMonth(t.y, t.m) - t.d + 1;
      this.view =
        nightsLeft < 7 && this.monthsAhead > 0
          ? normalizeMonth({ y: t.y, m: t.m + 1 })
          : { y: t.y, m: t.m };
      this.months.clear();
      this.announced = false;
      this.unit = this.getAttribute('unit') || ALL;
      this.selected = null;
      this.focusDate = null;
      if (!this.businessId) {
        this.renderNotice('This calendar is missing its business-id.', null);
        return;
      }
      this.load(this.view);
    }

    // ---------- data ----------

    load(view, silent) {
      var key = monthKey(view.y, view.m);
      var entry = this.months.get(key);
      if (entry && entry.status !== 'error') {
        if (silent) return;
        if (entry.status === 'ready') this.afterLoad();
        else this.render();
        return;
      }

      var first = iso(view.y, view.m, 1);
      var start = first < this.today ? this.today : first;
      var end = iso(view.y, view.m, daysInMonth(view.y, view.m));
      entry = { status: 'loading', data: null };
      this.months.set(key, entry);
      if (!silent) this.render();

      var url =
        this.apiBase +
        '/book/rate-calendar?business_id=' +
        encodeURIComponent(this.businessId) +
        '&start_date=' +
        start +
        '&end_date=' +
        end;
      var self = this;
      fetch(url, { headers: { Accept: 'application/json' } })
        .then(function (res) {
          if (res.ok) return res.json();
          entry.status =
            res.status === 400 || res.status === 404 ? 'unsupported' : 'error';
          return null;
        })
        .then(function (data) {
          if (!data) return;
          entry.status = 'ready';
          entry.data = self.index(data);
        })
        .catch(function () {
          entry.status = 'error';
        })
        .then(function () {
          if (self.view && monthKey(self.view.y, self.view.m) === key)
            self.afterLoad();
        });
    }

    index(data) {
      var byDate = new Map();
      (data.nights || []).forEach(function (night) {
        var rates = new Map();
        (night.rates || []).forEach(function (rate) {
          rates.set(String(rate.unit_id), rate);
        });
        byDate.set(night.date, rates);
      });
      return {
        hotelName: data.hotel_name || '',
        phone: data.hotel_phone || '',
        website: data.hotel_website || '',
        currency: data.currency || 'USD',
        start: data.start_date,
        end: data.end_date,
        units: (data.units || []).map(function (u) {
          return { id: String(u.id), name: u.name, maxGuests: u.max_guests };
        }),
        byDate: byDate,
      };
    }

    afterLoad() {
      var entry = this.currentEntry();
      if (entry && entry.status === 'ready') {
        var data = entry.data;
        var unitId = this.unit;
        if (
          unitId !== ALL &&
          !data.units.some(function (u) {
            return u.id === unitId;
          })
        ) {
          this.unit = ALL;
        }
        if (!this.selected || !this.inView(this.selected)) {
          this.selected = this.firstOpenDate(data);
        }
        var next = normalizeMonth({ y: this.view.y, m: this.view.m + 1 });
        if (this.canGoTo(next)) this.load(next, true);
        if (!this.announced) {
          this.announced = true;
          this.dispatchEvent(
            new CustomEvent('dextr-rate-ready', {
              bubbles: true,
              composed: true,
              detail: {
                hotelName: data.hotelName,
                phone: data.phone,
                website: data.website,
              },
            }),
          );
        }
      }
      this.render();
    }

    currentEntry() {
      return this.months.get(monthKey(this.view.y, this.view.m));
    }

    // ---------- derived values ----------

    inView(date) {
      var p = parts(date);
      return p.y === this.view.y && p.m === this.view.m;
    }

    cell(data, date) {
      if (!data || date < data.start || date > data.end)
        return { kind: 'past' };
      var rates = data.byDate.get(date);
      if (!rates) return { kind: 'closed' };
      if (this.unit !== ALL) {
        var rate = rates.get(this.unit);
        return rate && rate.available && rate.price !== null
          ? { kind: 'open', price: rate.price }
          : { kind: 'closed' };
      }
      var lowest = null;
      rates.forEach(function (rate) {
        if (
          rate.available &&
          rate.price !== null &&
          (lowest === null || rate.price < lowest)
        ) {
          lowest = rate.price;
        }
      });
      return lowest === null
        ? { kind: 'closed' }
        : { kind: 'open', price: lowest };
    }

    // The cheapest open night in the visible month, or null when every open night costs
    // the same (highlighting would then mark everything).
    lowestPriceInView(data) {
      if (!data) return null;
      var low = null;
      var high = null;
      var total = daysInMonth(this.view.y, this.view.m);
      for (var d = 1; d <= total; d++) {
        var info = this.cell(data, iso(this.view.y, this.view.m, d));
        if (info.kind !== 'open') continue;
        if (low === null || info.price < low) low = info.price;
        if (high === null || info.price > high) high = info.price;
      }
      return low !== null && high > low ? low : null;
    }

    firstOpenDate(data) {
      for (var d = data.start; d <= data.end; d = addDays(d, 1)) {
        if (this.cell(data, d).kind === 'open') return d;
      }
      return null;
    }

    isSelectable(data, date) {
      if (!data || !date || !this.inView(date)) return false;
      var kind = this.cell(data, date).kind;
      return kind === 'open' || kind === 'closed';
    }

    // The one date cell that takes Tab focus (roving tabindex): the date the guest last
    // moved to if it can be picked, otherwise the selected night, otherwise the first
    // night of the month that can be picked.
    resolveFocus(data) {
      if (!data) return this.focusDate;
      if (this.isSelectable(data, this.focusDate)) return this.focusDate;
      if (this.isSelectable(data, this.selected)) return this.selected;
      var open = this.firstOpenDate(data);
      if (open && this.inView(open)) return open;
      return data && this.inView(data.start) ? data.start : null;
    }

    canGoTo(view) {
      var target = view.y * 12 + view.m;
      var first = this.firstMonth.y * 12 + this.firstMonth.m;
      return target >= first && target <= first + this.monthsAhead;
    }

    money(amount, currency) {
      try {
        return new Intl.NumberFormat(this.locale, {
          style: 'currency',
          currency: currency,
          minimumFractionDigits: amount % 1 === 0 ? 0 : 2,
          maximumFractionDigits: 2,
        }).format(amount);
      } catch (e) {
        return '$' + amount;
      }
    }

    // ---------- rendering ----------

    styleTag() {
      var accent = this.getAttribute('accent');
      var css = STYLES;
      if (accent && window.CSS && CSS.supports('color', accent)) {
        css += '\n:host{--drc-accent:' + accent + '}';
      }
      return h('style', { text: css });
    }

    renderNotice(title, body) {
      this.shadowRoot.replaceChildren(
        this.styleTag(),
        h(
          'section',
          { className: 'drc' },
          h(
            'div',
            { className: 'notice', role: 'status' },
            h('strong', { text: title }),
            body ? h('p', { className: 'hint', text: body }) : null,
          ),
        ),
      );
    }

    render() {
      if (!this.view) return;
      var entry = this.currentEntry();
      var data = entry && entry.status === 'ready' ? entry.data : null;
      var knownUnits = data ? data.units : this.lastUnits || [];
      if (data) this.lastUnits = data.units;

      var root = h('section', {
        className: 'drc',
        'aria-label': 'Nightly rates',
      });

      if (knownUnits.length > 1) {
        var units = h('div', {
          className: 'units',
          role: 'group',
          'aria-label': 'Stay type',
        });
        units.appendChild(this.unitButton(ALL, 'All stays'));
        knownUnits.forEach(function (u) {
          units.appendChild(this.unitButton(u.id, u.name));
        }, this);
        root.appendChild(units);
      }

      var problem =
        entry && (entry.status === 'error' || entry.status === 'unsupported');
      var body = h('div', { className: problem ? 'body solo' : 'body' });
      body.appendChild(this.renderCalendar(entry, data, knownUnits));
      if (data) body.appendChild(this.renderPanel(data));
      root.appendChild(body);

      var active = this.shadowRoot.activeElement;
      var focusKey = active && active.dataset ? active.dataset.focusKey : null;
      var gridHadFocus =
        this.wantsGridFocus ||
        !!(active && active.dataset && active.dataset.date);
      this.shadowRoot.replaceChildren(this.styleTag(), root);

      if (gridHadFocus && data) {
        this.wantsGridFocus = false;
        this.focusFocusDate();
      } else if (focusKey) {
        var target = this.shadowRoot.querySelector(
          '[data-focus-key="' + focusKey + '"]',
        );
        if (target) target.focus();
      }
    }

    unitButton(id, label) {
      return h('button', {
        type: 'button',
        className: 'unit',
        'data-unit': id,
        'data-focus-key': 'unit-' + id,
        'aria-pressed': this.unit === id ? 'true' : 'false',
        text: label,
      });
    }

    renderCalendar(entry, data, units) {
      var wrap = h('div', { className: 'calendar' });
      var title = new Intl.DateTimeFormat(this.locale, {
        month: 'long',
        year: 'numeric',
        timeZone: 'UTC',
      }).format(new Date(Date.UTC(this.view.y, this.view.m, 1, 12)));
      var prev = h('button', {
        type: 'button',
        className: 'nav',
        'data-nav': '-1',
        'data-focus-key': 'prev',
        'aria-label': 'Previous month',
        disabled: !this.canGoTo({ y: this.view.y, m: this.view.m - 1 }),
      });
      prev.innerHTML = ICON_PREV;
      var next = h('button', {
        type: 'button',
        className: 'nav',
        'data-nav': '1',
        'data-focus-key': 'next',
        'aria-label': 'Next month',
        disabled: !this.canGoTo({ y: this.view.y, m: this.view.m + 1 }),
      });
      next.innerHTML = ICON_NEXT;
      var titleId = 'drc-month';
      wrap.appendChild(
        h(
          'div',
          { className: 'head' },
          prev,
          h('h3', { className: 'month', id: titleId, text: title }),
          next,
        ),
      );

      if (
        entry &&
        (entry.status === 'error' || entry.status === 'unsupported')
      ) {
        wrap.appendChild(this.renderProblem(entry.status));
        return wrap;
      }

      var unitName = null;
      if (this.unit !== ALL) {
        units.forEach(function (u) {
          if (u.id === this.unit) unitName = u.name;
        }, this);
      }
      wrap.appendChild(
        h('p', {
          className: 'caption',
          text: unitName
            ? 'Nightly rate for ' + unitName + '.'
            : 'Starting nightly price across all stays.',
        }),
      );

      var table = h('table', { role: 'grid', 'aria-labelledby': titleId });
      var headRow = h('tr');
      var weekdayFmt = new Intl.DateTimeFormat(this.locale, {
        weekday: 'short',
        timeZone: 'UTC',
      });
      var longFmt = new Intl.DateTimeFormat(this.locale, {
        weekday: 'long',
        timeZone: 'UTC',
      });
      for (var i = 0; i < 7; i++) {
        var day = new Date(
          Date.UTC(2023, 0, 1 + ((i + this.weekStart) % 7), 12),
        ); // Jan 1 2023 was a Sunday
        headRow.appendChild(
          h('th', {
            scope: 'col',
            abbr: longFmt.format(day),
            text: weekdayFmt.format(day),
          }),
        );
      }
      table.appendChild(h('thead', null, headRow));

      this.focusDate = this.resolveFocus(data);
      this.lowestInView = this.lowestPriceInView(data);
      var tbody = h('tbody');
      var first = iso(this.view.y, this.view.m, 1);
      var lead = (weekday(first) - this.weekStart + 7) % 7;
      var total = daysInMonth(this.view.y, this.view.m);
      var labelFmt = new Intl.DateTimeFormat(this.locale, {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
        timeZone: 'UTC',
      });
      var row = h('tr');
      for (var b = 0; b < lead; b++)
        row.appendChild(h('td', { role: 'presentation' }));
      for (var d = 1; d <= total; d++) {
        var date = iso(this.view.y, this.view.m, d);
        row.appendChild(this.renderDay(date, d, entry, data, labelFmt));
        if (row.children.length === 7) {
          tbody.appendChild(row);
          row = h('tr');
        }
      }
      if (row.children.length) {
        while (row.children.length < 7)
          row.appendChild(h('td', { role: 'presentation' }));
        tbody.appendChild(row);
      }
      table.appendChild(tbody);
      wrap.appendChild(table);

      wrap.appendChild(
        h(
          'ul',
          { className: 'legend', 'aria-hidden': 'true' },
          h('li', null, h('span', { className: 'swatch' }), 'Available'),
          h(
            'li',
            null,
            h('span', { className: 'swatch closed' }),
            'Not available',
          ),
          this.lowestInView !== null
            ? h(
                'li',
                null,
                h('span', { className: 'dot' }),
                'Lowest price this month',
              )
            : null,
        ),
      );
      return wrap;
    }

    renderDay(date, dayNumber, entry, data, labelFmt) {
      var loading = !entry || entry.status === 'loading';
      var info = loading
        ? { kind: date < this.today ? 'past' : 'loading' }
        : this.cell(data, date);
      var label = labelFmt.format(utcDate(date));
      var classes = ['day'];
      var priceText = null;

      if (info.kind === 'past') {
        classes = ['past'];
        label += ', past date';
      } else if (info.kind === 'closed') {
        classes.push('closed');
        label += ', not available';
      } else if (info.kind === 'open') {
        priceText = this.money(info.price, data.currency);
        label +=
          (this.unit === ALL ? ', from ' : ', ') + priceText + ' per night';
        if (this.lowestInView !== null && info.price === this.lowestInView) {
          classes.push('best');
          label += ', lowest price this month';
        }
      } else {
        label += ', loading rates';
      }
      if (date === this.today) classes.push('today');

      var selectable = info.kind === 'open' || info.kind === 'closed';
      var td = h('td', {
        className: classes.join(' '),
        'data-date': selectable ? date : null,
        role: 'gridcell',
        tabindex: selectable ? (date === this.focusDate ? '0' : '-1') : null,
        'aria-selected': selectable
          ? date === this.selected
            ? 'true'
            : 'false'
          : null,
        'aria-disabled': selectable ? null : 'true',
        'aria-label': label,
      });
      td.appendChild(
        h('span', {
          className: 'num',
          'aria-hidden': 'true',
          text: String(dayNumber),
        }),
      );
      if (priceText)
        td.appendChild(
          h('span', {
            className: 'price',
            'aria-hidden': 'true',
            text: priceText,
          }),
        );
      if (info.kind === 'loading')
        td.appendChild(
          h('span', { className: 'skeleton', 'aria-hidden': 'true' }),
        );
      return td;
    }

    renderPanel(data) {
      var panel = h('div', {
        className: 'panel',
        role: 'region',
        'aria-label': 'Rates for the selected night',
      });
      if (!this.selected) {
        panel.appendChild(
          h('p', {
            className: 'hint',
            text: data.units.length
              ? 'No open nights this month. Try the next month.'
              : 'Online rates aren’t available for this property yet.',
          }),
        );
        panel.appendChild(this.renderActions(data));
        return panel;
      }

      var heading = new Intl.DateTimeFormat(this.locale, {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
        timeZone: 'UTC',
      }).format(utcDate(this.selected));
      panel.appendChild(h('h4', { text: heading }));

      var list = h('ul', { className: 'rates' });
      var rates = data.byDate.get(this.selected) || new Map();
      data.units.forEach(function (unit) {
        if (this.unit !== ALL && unit.id !== this.unit) return;
        var rate = rates.get(unit.id);
        var open = !!(rate && rate.available && rate.price !== null);
        var meta = [];
        if (!open) meta.push('Not available this night');
        if (open && rate.min_stay && rate.min_stay > 1)
          meta.push(rate.min_stay + '-night minimum');
        if (unit.maxGuests) meta.push('Sleeps ' + unit.maxGuests);
        list.appendChild(
          h(
            'li',
            { className: 'rate' + (open ? '' : ' unavailable') },
            h('span', { className: 'name', text: unit.name }),
            h('span', {
              className: 'amount',
              text: open ? this.money(rate.price, data.currency) : '–',
            }),
            meta.length
              ? h('span', { className: 'meta', text: meta.join('. ') + '.' })
              : null,
          ),
        );
      }, this);
      panel.appendChild(list);
      panel.appendChild(
        h('p', {
          className: 'fine',
          text: 'Per night, before taxes and fees. Availability can change until you book.',
        }),
      );
      panel.appendChild(this.renderActions(data));
      return panel;
    }

    renderActions(data) {
      var actions = h('div', { className: 'actions' });
      var bookUrl = this.getAttribute('book-url');
      var website = data && data.website;
      if (bookUrl && /^https?:\/\//i.test(bookUrl)) {
        actions.appendChild(
          h('a', {
            className: 'book',
            href: bookUrl,
            target: '_blank',
            rel: 'noopener',
            text: 'Open booking page',
          }),
        );
      } else if (
        this.hasAttribute('website-link') &&
        website &&
        /^https?:\/\//i.test(website)
      ) {
        actions.appendChild(
          h('a', {
            className: 'book',
            href: website,
            target: '_blank',
            rel: 'noopener',
            text: 'Visit website to book',
          }),
        );
      }
      var contact = this.renderContact(data);
      if (contact) actions.appendChild(contact);
      return actions;
    }

    renderContact(data) {
      var phone = (
        this.getAttribute('phone') ||
        (data && data.phone) ||
        this.lastPhone ||
        ''
      ).trim();
      if (phone) this.lastPhone = phone;
      if (!phone) return null;
      var digits = phone.replace(/[^\d+]/g, '');
      return h(
        'p',
        { className: 'contact' },
        'Questions? Call or text ',
        h('a', { href: 'tel:' + digits, text: this.formatPhone(digits) }),
        '.',
      );
    }

    formatPhone(digits) {
      var m = digits
        .replace(/^\+?1(?=\d{10}$)/, '')
        .match(/^(\d{3})(\d{3})(\d{4})$/);
      return m ? '(' + m[1] + ') ' + m[2] + '-' + m[3] : digits;
    }

    renderProblem(status) {
      if (status === 'unsupported') {
        return h(
          'div',
          { className: 'notice', role: 'status' },
          h('strong', { text: 'Online rates aren’t available yet.' }),
          h('p', {
            className: 'hint',
            text: 'Contact us for prices and open dates.',
          }),
          this.renderContact(),
        );
      }
      return h(
        'div',
        { className: 'notice', role: 'alert' },
        h('strong', { text: 'Rates couldn’t load.' }),
        h('p', {
          className: 'hint',
          text: 'Check your connection, then try again.',
        }),
        h('button', {
          type: 'button',
          className: 'retry',
          'data-retry': '',
          'data-focus-key': 'retry',
          text: 'Try again',
        }),
        this.renderContact(),
      );
    }

    // ---------- interaction ----------

    goTo(view, focusDay) {
      var target = normalizeMonth(view);
      if (!this.canGoTo(target)) return false;
      this.view = target;
      if (focusDay) {
        var day = Math.min(focusDay, daysInMonth(target.y, target.m));
        this.focusDate = iso(target.y, target.m, day);
      }
      this.load(this.view);
      return true;
    }

    select(date) {
      this.selected = date;
      this.focusDate = date;
      this.render();
      var entry = this.currentEntry();
      var rates = entry && entry.data ? entry.data.byDate.get(date) : null;
      this.dispatchEvent(
        new CustomEvent('dextr-rate-select', {
          bubbles: true,
          composed: true,
          detail: {
            date: date,
            unitId: this.unit === ALL ? null : this.unit,
            rates: rates ? Array.from(rates.values()) : [],
          },
        }),
      );
    }

    onClick(event) {
      var target = event.target.closest(
        '[data-date],[data-unit],[data-nav],[data-retry]',
      );
      if (!target) return;
      if (target.dataset.date) return this.select(target.dataset.date);
      if (target.dataset.unit) {
        this.unit = target.dataset.unit;
        var data = this.currentEntry() && this.currentEntry().data;
        if (
          data &&
          this.selected &&
          this.cell(data, this.selected).kind !== 'open'
        ) {
          this.selected = this.firstOpenDate(data) || this.selected;
          this.focusDate = this.selected;
        }
        return this.render();
      }
      if (target.dataset.nav) {
        this.selected = null;
        return this.goTo({
          y: this.view.y,
          m: this.view.m + Number(target.dataset.nav),
        });
      }
      if (target.hasAttribute('data-retry')) {
        this.months.delete(monthKey(this.view.y, this.view.m));
        this.load(this.view);
      }
    }

    onKeyDown(event) {
      var cell = event.target.closest && event.target.closest('td[data-date]');
      if (!cell) return;
      var date = cell.dataset.date;
      var p = parts(date);
      var moves = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
      var offsetInWeek = (weekday(date) - this.weekStart + 7) % 7;
      var next = null;

      if (event.key in moves) next = addDays(date, moves[event.key]);
      else if (event.key === 'Home') next = addDays(date, -offsetInWeek);
      else if (event.key === 'End') next = addDays(date, 6 - offsetInWeek);
      else if (event.key === 'PageUp' || event.key === 'PageDown') {
        event.preventDefault();
        this.wantsGridFocus = true;
        if (
          !this.goTo(
            { y: p.y, m: p.m + (event.key === 'PageDown' ? 1 : -1) },
            p.d,
          )
        ) {
          this.wantsGridFocus = false;
        }
        return;
      } else if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        this.wantsGridFocus = true;
        this.select(date);
        return;
      } else {
        return;
      }

      event.preventDefault();
      if (this.inView(next)) {
        if (this.shadowRoot.querySelector('td[data-date="' + next + '"]')) {
          this.focusDate = next;
          this.wantsGridFocus = true;
          this.render();
        }
        return;
      }
      var np = parts(next);
      this.wantsGridFocus = true;
      if (!this.goTo({ y: np.y, m: np.m }, np.d)) this.wantsGridFocus = false;
    }

    focusFocusDate() {
      var el =
        this.shadowRoot.querySelector(
          'td[data-date="' + this.focusDate + '"]',
        ) || this.shadowRoot.querySelector('td[tabindex="0"]');
      if (el) el.focus();
    }
  }

  window.customElements.define('dextr-rate-calendar', DextrRateCalendar);
})();
