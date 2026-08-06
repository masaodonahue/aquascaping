# Sprint backlog

Planned app work, newest ideas at the bottom. Not yet implemented — these are
captured here on purpose so `main` stays deployable. Delete an item when it ships.

---

## Product list: add & manage products (e.g. Fritz Paracleanse)

**Where it lives today:** the Dose modal (`doseModal`, [index.html:1697](index.html:1697)).
The product chips come from two sources merged together:

- `DOSE_PRESETS` — a hardcoded array ([index.html:1686](index.html:1686)).
- History scan — any `product` you've dosed before shows up automatically
  (`seen` map, [index.html:1700](index.html:1700)).

A "Something else" chip already lets you type a custom product, pick a unit, and
log it. So a new product like **Fritz Paracleanse** *can* be logged today — but:

- It only joins the list **after** its first dose is recorded. There's no "add
  it now" affordance.
- There's no way to **curate** the list — rename, remove a typo'd duplicate, or
  set a product's default unit/amount without dosing it.
- New permanent presets require **editing code** (`DOSE_PRESETS`).

**Direction (matches the app's conventions):** store user products as `setting`
rows, the same way dose rules already live (`product_rule_*`, `doseRule` at
[index.html:899](index.html:899)) — newest row wins, no schema migration, no
second tab. A small "Manage products" surface (a section in the Dose modal, or
under Reference) to add/rename/retire an entry and set its default unit + amount.
`DOSE_PRESETS` becomes the seed list; user rows extend it.

**Open question (yours):** where the "add / manage" entry point lives — inline in
the Dose modal vs. a Reference block. Leaning Dose modal since that's where the
list is already used.

---

## Info buttons: "what it treats" per product

Add the little round **"i"** button next to each product; tapping it shows a
quick description of what the product is for / what it treats.

**Needs a description store.** Suggest a `PRODUCT_INFO` map keyed by product slug
for the known set, plus an optional description field captured when adding a
custom product (ties into the item above). Info button surfaces on the product
chips in the Dose modal at minimum; nice on the Reference roster too.

**Domain note — flag shrimp safety on meds.** Per the aquascaping methodology,
any medication has to account for the Amano shrimp (copper is lethal; most
whole-water treatments are risky; default is the medicated-food method with
Seachem Focus, and pull Purigen during a course). So the info blurb for a
*medication* should carry a short shrimp-safety line, not just "what it treats."

**Starter copy** (accurate as of writing — verify against the label before
shipping, especially dosing and invert safety):

| Product | Purpose / what it treats | Shrimp / notes |
|---|---|---|
| Fritz Paracleanse | Internal parasites — worms, flukes, some protozoans (praziquantel + metronidazole). Deworming course. | Fish-safe med; confirm invert tolerance, prefer medicated food; pull Purigen. |
| Seachem ParaGuard | External parasites, fungal & mild bacterial (broad-spectrum, aldehyde-based). | Caution with shrimp/inverts; avoid whole-water dosing near them. |
| Seachem KanaPlex | Bacterial & some fungal infections; works internally when bound to food. | Bind to food w/ Seachem Focus; pull Purigen during course. |
| Seachem Prime | Water conditioner — detoxifies chlorine, chloramine, ammonia, nitrite. *Not a medication.* | Invert-safe at label dose. |
| Seachem Reef Iodide | Iodine supplement for shrimp molting. | The point *is* the shrimp — dose every 3–4 weeks. |
| Seachem Flourish | Comprehensive trace/micro fertilizer. | Fertilizer, not a treatment. |
| Tropica Specialised | All-in-one macro + micro fertilizer. | Fertilizer. |
| Aquario Neo solid tab | Root/substrate fertilizer tab. | Fertilizer. |
| API Aquarium Salt | General tonic — stress, gill/electrolyte support. | Use sparingly; hard on plants and inverts at high doses. |
