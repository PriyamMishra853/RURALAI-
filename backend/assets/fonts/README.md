# PDF report fonts

The generated PDF reports (clinical summary, medication advice, emergency
referral) need a font that can draw the patient's script. PDF files carry their
own fonts, and pdfkit's built-in set — Helvetica and the other thirteen standard
PDF fonts — covers Latin, Greek and Cyrillic only. Drawing Devanagari or Tamil
with Helvetica produces a page of empty boxes, silently.

These files are deliberately **not committed**: about 10 MB in total, not ours
to redistribute, and a deployment that only ever prints English should not carry
them.

## Installing

Download from <https://fonts.google.com/noto> and drop the `.ttf` files here.
Both weights are needed — a report without bold loses its entire hierarchy.

| File prefix            | Languages it unlocks                                                        |
| ---------------------- | --------------------------------------------------------------------------- |
| `NotoSansDevanagari`   | Hindi, Marathi, Maithili, Sanskrit, Konkani, Nepali, Dogri, Bodo, Bhojpuri, Awadhi, Magahi, Rajasthani, Chhattisgarhi, Haryanvi |
| `NotoSansBengali`      | Bengali, Assamese                                                            |
| `NotoSansTamil`        | Tamil                                                                        |
| `NotoSansTelugu`       | Telugu                                                                       |
| `NotoSansKannada`      | Kannada, Tulu                                                                |
| `NotoSansMalayalam`    | Malayalam                                                                    |
| `NotoSansGujarati`     | Gujarati                                                                     |
| `NotoSansGurmukhi`     | Punjabi                                                                      |
| `NotoSansOriya`        | Odia                                                                         |
| `NotoNaskhArabic`      | Urdu, Kashmiri, Sindhi                                                       |
| `NotoSansOlChiki`      | Santali                                                                      |
| `NotoSansMeeteiMayek`  | Manipuri                                                                     |

Named `<Prefix>-Regular.ttf` and `<Prefix>-Bold.ttf`.

Devanagari is by far the highest-value single file: one face covers fourteen of
the offered languages, including the ones spoken across the districts this
platform actually serves.

English, Khasi and Mizo use the Latin alphabet and need nothing installed.

## Checking

    npm run check:fonts

Reports which scripts are covered and which languages will therefore print an
English report instead. Nothing breaks without the fonts — the report renders in
English and prints a line on the page saying why, so a health worker never hands
a patient a sheet they cannot read while believing otherwise.
