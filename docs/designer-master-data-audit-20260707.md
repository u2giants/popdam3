# Designer Master Data Audit - 2026-07-07

Source: live production Supabase project `qsllyeztdwjgirsysgai`, `public.style_tracker_rows` as used by `https://dam.designflow.app/styles`.

Compared `9,491` nonblank Designer cells (`124` distinct normalized values) against active rows in `core.creative_designer`.

Good match rule: exact normalized match, unique first-name/name-token match to a creative designer, or all slash/ampersand-separated parts matching active creative designers.

Manual decisions applied on 2026-07-07:

- `Elizabeth` is linked to `core.creative_designer` -> `Liz Parkin`.
- `Martina` is linked to `core.creative_designer` -> `Martina Cardoso`.
- Remaining values below were marked Master Data-only, so they retain their legacy text and are not linked to a shared table.

| Value | Rows | Licensed | Generic | Closest creative designer | Score |
|---|---:|---:|---:|---|---:|
| Buyer | 551 | 551 | 0 | Jen Chaffier | 0.167 |
| Gina | 319 | 319 | 0 | Siyuan | 0.333 |
| Destiny Lewis | 235 | 235 | 0 | Derrick Smith | 0.308 |
| Darzano | 178 | 178 | 0 | Sarbani Ghosh | 0.385 |
| Alejandra | 154 | 154 | 0 | Malachi Cameron | 0.267 |
| Ricardo | 125 | 119 | 6 | Erica Perestrelo | 0.375 |
| Stallion Art Wholesale | 118 | 118 | 0 | Leonard Boone | 0.364 |
| Mukesh | 106 | 106 | 0 | James Ashley | 0.250 |
| Eli | 95 | 93 | 2 | Theo Kim | 0.250 |
| Cliff | 93 | 93 | 0 | Jen Chaffier | 0.250 |
| Four Seasons | 67 | 67 | 0 | Deborah Salles | 0.286 |
| nimesh | 65 | 61 | 4 | James Ashley | 0.333 |
| Mal | 54 | 0 | 54 | James Ashley | 0.250 |
| Leo | 52 | 52 | 0 | Theo Kim | 0.250 |
| Tan | 48 | 0 | 48 | Siyuan | 0.333 |
| Rivera | 42 | 42 | 0 | Rodrigo Garcia | 0.286 |
| Jon Scheerz | 33 | 33 | 0 | Jen Chaffier | 0.417 |
| 4 Seasons | 31 | 31 | 0 | James Ashley | 0.250 |
| Randi | 31 | 31 | 0 | Sarbani Ghosh | 0.231 |
| Shane | 29 | 29 | 0 | Siyuan | 0.333 |
| Mike W | 28 | 28 | 0 | Malachi Cameron | 0.200 |
| Shiva | 27 | 27 | 0 | Siyuan | 0.333 |
| Martin Aguilar | 22 | 22 | 0 | Mauricio Casagrande | 0.368 |
| Scott | 22 | 22 | 0 | Marcel Zabolotniy | 0.176 |
| Mike | 20 | 15 | 5 | Liz Parkin | 0.200 |
| Rosenthal | 16 | 16 | 0 | Beckett Schiaparelli | 0.250 |
| Reilley | 15 | 15 | 0 | James Ashley | 0.333 |
| Vishal | 14 | 14 | 0 | Siyuan | 0.333 |
| Angie | 12 | 12 | 0 | Jen Chaffier | 0.250 |
| Depury | 11 | 11 | 0 | Deborah Salles | 0.214 |
| Rex | 10 | 10 | 0 | Deborah Salles | 0.143 |
| Ann Marie | 9 | 0 | 9 | Jen Chaffier | 0.417 |
| Erik | 9 | 9 | 0 | Derrick Smith | 0.308 |
| Lorelyn | 9 | 0 | 9 | Leonard Boone | 0.308 |
| Chad | 8 | 8 | 0 | Jen Chaffier | 0.250 |
| Devon | 8 | 8 | 0 | Vie Dionisio | 0.250 |
| Jeanette | 8 | 0 | 8 | Beckett Schiaparelli | 0.250 |
| Peter | 8 | 8 | 0 | Erica Perestrelo | 0.250 |
| Shira | 8 | 8 | 0 | Siyuan | 0.333 |
| Cross | 7 | 7 | 0 | Sarbani Ghosh | 0.231 |
| Erica/Martina | 7 | 7 | 0 | Erica Perestrelo | 0.438 |
| Factory | 7 | 1 | 6 | Marcel Zabolotniy | 0.235 |
| Factory Offer/Jen | 7 | 0 | 7 | Malachi Cameron | 0.294 |
| IKONICK | 7 | 7 | 0 | Vie Dionisio | 0.333 |
| Alejandra/Derrick | 6 | 6 | 0 | Leonard Boone | 0.294 |
| Kate | 6 | 4 | 2 | Erica Perestrelo | 0.188 |
| Caldwell | 5 | 5 | 0 | Beckett Schiaparelli | 0.250 |
| Julio | 5 | 5 | 0 | Malachi Cameron | 0.200 |
| Michele | 5 | 5 | 0 | Malachi Cameron | 0.267 |
| Romain | 5 | 5 | 0 | Liz Parkin | 0.300 |
| Albert | 4 | 3 | 1 | Malachi Cameron | 0.267 |
| Anastasia | 4 | 0 | 4 | Tanisha Shah | 0.500 |
| Becket | 4 | 4 | 0 | Derrick Smith | 0.308 |
| Chloe | 4 | 4 | 0 | Jen Chaffier | 0.250 |
| Daniel Ste | 4 | 4 | 0 | Tanisha Shah | 0.417 |
| Deborah / Martina | 4 | 4 | 0 | Deborah Salles | 0.529 |
| Ferrara | 4 | 4 | 0 | Deborah Salles | 0.286 |
| Johnny | 4 | 4 | 0 | James Ashley | 0.250 |
| Matthew Lev | 4 | 4 | 0 | Theo Kim | 0.364 |
| Shweta | 3 | 0 | 3 | Tanisha Shah | 0.250 |
| Alexander Tsaplin | 2 | 2 | 0 | Deborah Salles | 0.294 |
| Elizabeth/Marcel | 2 | 2 | 0 | Erica Perestrelo | 0.313 |
| Gedda | 2 | 2 | 0 | James Ashley | 0.167 |
| Maria Alissa | 2 | 0 | 2 | Mauricio Casagrande | 0.368 |
| Mauricio/Martina | 2 | 2 | 0 | Mauricio Casagrande | 0.526 |
| Miguel | 2 | 2 | 0 | Siyuan | 0.333 |
| Omar | 2 | 2 | 0 | Leonard Boone | 0.231 |
| Shiva (Nimesh didn't respond) | 2 | 2 | 0 | Erica Perestrelo | 0.346 |
| ? | 1 | 1 | 0 | - | 0.000 |
| AJ | 1 | 1 | 0 | Siyuan | 0.167 |
| Albert/Liz | 1 | 1 | 0 | Erica Perestrelo | 0.250 |
| Buyer - BGP8RDYPN01 | 1 | 1 | 0 | Liz Parkin | 0.235 |
| Buyer - HF1SDYCP01 | 1 | 1 | 0 | Beckett Schiaparelli | 0.200 |
| Buyer - HF1SDYWP02 | 1 | 1 | 0 | Beckett Schiaparelli | 0.200 |
| Buyer - HF42DYTS01 | 1 | 1 | 0 | Beckett Schiaparelli | 0.200 |
| Buyer - HF93SMBB02 | 1 | 1 | 0 | Derrick Smith | 0.250 |
| Danilo/Elizabeth | 1 | 1 | 0 | Tanisha Shah | 0.313 |
| Dario | 1 | 1 | 0 | Sarbani Ghosh | 0.308 |
| Eduarda | 1 | 1 | 0 | Leonard Boone | 0.308 |
| Eisen | 1 | 1 | 0 | Siyuan | 0.333 |
| Erica / Elizabeth | 1 | 1 | 0 | Erica Perestrelo | 0.471 |
| Eylee | 1 | 1 | 0 | James Ashley | 0.250 |
| Five Below | 1 | 0 | 1 | Marcel Zabolotniy | 0.294 |
| Gary | 1 | 0 | 1 | Rodrigo Garcia | 0.214 |
| Germain | 1 | 1 | 0 | Liz Parkin | 0.300 |
| Gopal | 1 | 1 | 0 | Deborah Salles | 0.214 |
| Hikari | 1 | 0 | 1 | Liz Parkin | 0.400 |
| Jenni | 1 | 0 | 1 | Jen Chaffier | 0.333 |
| Marcel/Mukesh | 1 | 1 | 0 | Marcel Zabolotniy | 0.353 |
| Mateus | 1 | 1 | 0 | James Ashley | 0.250 |
| Mau | 1 | 1 | 0 | James Ashley | 0.167 |
| Muraleedharan | 1 | 1 | 0 | Mauricio Casagrande | 0.368 |
| Octavio | 1 | 1 | 0 | Jen Chaffier | 0.250 |
| Paulo | 1 | 1 | 0 | Liz Parkin | 0.200 |
| Pavel | 1 | 1 | 0 | James Ashley | 0.250 |
| Ralph Cifra | 1 | 0 | 1 | Malachi Cameron | 0.400 |
| Reused | 1 | 1 | 0 | Erica Perestrelo | 0.250 |
| Roman | 1 | 0 | 1 | Siyuan | 0.333 |
| Shreyash | 1 | 1 | 0 | James Ashley | 0.333 |
| tech designer | 1 | 1 | 0 | Jen Chaffier | 0.308 |
| Theo/Cliff | 1 | 1 | 0 | Theo Kim | 0.500 |
| Wildeman | 1 | 1 | 0 | Siyuan | 0.375 |
