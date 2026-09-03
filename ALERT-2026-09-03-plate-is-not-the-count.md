# ALERT, 2026-09-03: the weekly plate figure is the Sunday batch plus midweek mail, and the Sunday batch matches the count

Written from the PLT dashboard repo (`st-edward-plt-dashboard`) on 2026-09-03, for
whoever opens this repo next. Nothing in this repo was changed. Read this before
touching `plate-status.js`, `hub-exit.js`, or the counting rhythm note in CLAUDE.md.

## What was measured today

Read from Little Green Light over SSH on the `LGL` Render service, using this repo's
own `fetchGiftsForRange` and `isPlateType`, Offertory fund only, no donor fields
printed. Week of 17 to 23 August 2026:

| Received date | What | Gifts | Amount |
|---|---|---|---|
| Thu 20 Aug | Check | 5 | $551.00 |
| Sun 23 Aug | Cash | 37 | $3,034.00 |
| Sun 23 Aug | Check | 59 | $7,327.00 |
| Week plate total (what `hub-exit` sends as `giving.lgl_plate`) | | 101 | $10,912.00 |

The 96 gifts dated Sunday 23 August reached LGL between the PLT hub's reads of
Thursday 27 August and Friday 28 August, four days after the weekend. The five
Thursday checks were in LGL by Monday 24 August and are what the hub held as $551.00
all week.

The money counters' sheet for the same weekend, typed into the PLT hub: $8,281.00
across the five Masses plus $2,030.00 of money that came in at no Mass (a separate
collection handed in by the 2:30 PM community, and the box during the week), so
**$10,311.00 in all**. Against the Sunday batch that is **$50.00**. So Pushpay's
Sunday-dated batch IS the counted collection, keyed by envelope, and the week's
plate total is that batch plus the Thursday mail. An earlier draft of this file said
the sheet was $2,080 short; that draft had left the untied money out.

Week of 24 to 30 August, as of the hub's read at 4 AM Thursday 3 September: plate
$0.00, online $8,529.96, count sheet $8,369.50 and complete since Wednesday.

## What Eric said today, verbatim

> "The processing of the envelopes/basket/offertory runs in house for the count,
> then to Barb (book keeper/accounting clerk), then to the diocese where our
> accounting is outsourced, and they're 60 days behind in their books for us."

> "the pushpay numbers for the collections don't hit pushpay until they've gone
> through the ledger..."

> "Starting soon-ish, barb will note the income in pushpay when it's counted and
> deposited. but right now, there's that delay"

The data above shows the 23 August batch keyed within four days regardless, so the
delay Eric describes and the delay measured do not agree, and that is unresolved.

## Why this repo has the same problem

1. **CLAUDE.md's counting rhythm line** ("Barb enters them, so plate money is
   USUALLY in LGL by Thursday", confirmed 2026-08-11) describes what Eric today
   called the future process. Re-verify it after Barb's change has run a few weeks.
2. **`plate-status.js` marks a week complete on any plate gift.** For the week of
   23 August, the five mailed checks of Thursday 20 August would have answered
   `plateLanded: true` a full week before the basket landed. This is the weakness
   CLAUDE.md already records under "three mail cheques marked the week complete";
   today's week is a second, live example of it. Tightening it is Eric's call.
3. **The exit sends one weekly plate sum.** The PLT hub now wants to state, per
   weekend, "Pushpay's batch for this Sunday" against the counters' sheet, and it
   cannot separate the Sunday batch ($10,361.00) from midweek plate ($551.00) out of
   one number. A per day plate figure, or a Sunday and midweek split, added inside
   contract version 1 as an added field, would let it. Coordinate with
   `sources.py` and `docs/exit-contract.md` in the PLT repo before changing the
   payload.
4. **The count and the Sunday batch agree to $50 once untied money is in.** So
   "the count landed" means the Sunday-dated batch, roughly 75 to 100 gifts, and
   not any plate gift in the week.

## How the numbers were read

Run on the `LGL` Render web service (`render services` lists it), from the deployed
checkout, read only:

```
ssh srv-d6rf4os50q8c73c1lg70@ssh.oregon.render.com \
  'cd /opt/render/project/src && node --input-type=module -' < read_lgl_gifts.mjs
```

```js
import { fetchGiftsForRange, isOffertory, isPlateType, paymentTypeOf, receivedDay } from "./hub-exit.js";
import { fetchLGLApiGiftsPaged } from "./lgl-api.js";
const gifts = await fetchGiftsForRange(fetchLGLApiGiftsPaged, "2026-08-17", { lookbackDays: 30 });
const rows = {};
for (const g of gifts) {
  const d = receivedDay(g);
  if (!d || d < "2026-08-17" || d > "2026-08-30" || !isOffertory(g)) continue;
  const t = paymentTypeOf(g) || "(none)";
  const k = `${d}|${isPlateType(t) ? "PLATE" : "online"}|${t}`;
  rows[k] = rows[k] || { n: 0, cents: 0 };
  rows[k].n += 1; rows[k].cents += Math.round(Number(g.received_amount) * 100);
}
for (const k of Object.keys(rows).sort()) console.log(k, rows[k].n, (rows[k].cents / 100).toFixed(2));
```

The PLT side of this is recorded as D116 in that repo's `docs/decisions.md`.
