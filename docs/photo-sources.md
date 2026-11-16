# Restaurant photo sources

Photos come from the restaurant's own Instagram (@chateau_capitaine), stored locally so the site does not depend on expiring CDN URLs.

**Rule (Anthony, 2026-11-14):** restaurant-posted photos only (no customer uploads), no text or promo artwork, sharp at about 1080px or more on the short side, and only dishes on the current menu. Check the visible post date; listing update dates and copyright years are not enough.

| File (`public/photos/`) | Source post | Post date | Size | Placement |
| --- | --- | --- | --- | --- |
| `lobster-platter-instagram.jpg` | [post](https://www.instagram.com/chateau_capitaine/p/DXr35aPETzg/) | 2026-04-28 | n/a (earlier selection) | Kitchen gallery, schema image |
| `caviar-service-instagram.jpg` | [post](https://www.instagram.com/chateau_capitaine/p/DXYMj-BjfLh/) | 2026-04-20 | n/a (earlier selection) | Kitchen gallery, schema image, About banquet photo |
| `chilean-sea-bass.jpg` | [post](https://www.instagram.com/chateau_capitaine/p/Cyvrhm3umMk/) | 2023-10-23 | 1079x1079 | Kitchen gallery, home signature dish, schema image |
| `lulya-kebab.jpg` | [post](https://www.instagram.com/chateau_capitaine/p/Cyn5o3UOK8x/) | 2023-10-20 | 1079x1079 | Kitchen gallery |
| `mushroom-napoleon.jpg` | [post](https://www.instagram.com/chateau_capitaine/p/DNJCrWAtKED/) | 2025-08-09 | 1440x1711 | Kitchen gallery |
| `mixed-carpaccio.jpg` | [post](https://www.instagram.com/chateau_capitaine/p/C0mrhDzpAnD/) | 2023-12-08 | 1079x1079 | Kitchen gallery |
| `salmon-tartare.jpg` | [post](https://www.instagram.com/chateau_capitaine/p/DNd-dIuyHIt/) | 2025-08-17 | 1440x1380 | Kitchen gallery, home signature dish |
| `beef-tartare.jpg` | [post](https://www.instagram.com/chateau_capitaine/p/C2sRSiZOP7Q/) | 2024-01-29 | 1080x1080 | Kitchen gallery |
| `banquet-platters.jpg` | [post](https://www.instagram.com/chateau_capitaine/p/CjrJcZFD0Jg/) | 2022-10-14 | 1064x1064 | Private events gallery |
| `sesame-tuna.jpg` | [post](https://www.instagram.com/chateau_capitaine/p/DXr4EhAET2f/) | 2026-04-29 | 1350x1688 | Kitchen gallery |
| `t-bone-steak.jpg` | [post](https://www.instagram.com/chateau_capitaine/p/CvpgzdwuPV4/) | 2023-08-07 | 1080x1080 | Kitchen gallery, schema image |
| `borscht.jpg` | [post](https://www.instagram.com/chateau_capitaine/p/CzHCP6ru2RK/) | 2023-11-01 | 1080x1080 | Kitchen gallery |
| `chicken-tabaka.jpg` | [post](https://www.instagram.com/chateau_capitaine/p/CzUACSWOTB8/) | 2023-11-06 | 1080x1080 | Kitchen gallery, home signature dish |

Home and gallery descriptions name only the menu dish and what the photo itself shows (checked by eye by the planner, 2026-11-14), not the Instagram captions.

Removed 2026-11-14 as blurry or too small: `mixed-pickles.jpg`, `roasted-duck.jpg`, `red-caviar.jpg`, `entrance-night.jpg`, `kebabs-grill.jpg`, `tomahawk-steak.jpg`. Home signature dishes now use `chilean-sea-bass.jpg`, `chicken-tabaka.jpg` and `salmon-tartare.jpg`; the restaurant schema images are `chilean-sea-bass.jpg`, `t-bone-steak.jpg`, `caviar-service-instagram.jpg` and `lobster-platter-instagram.jpg`. Venue and chef placeholders still need suitable verified photographs.

## Other candidates

- [OpenTable](https://www.opentable.com/r/chateau-de-capitaine-brooklyn): the inspected restaurant-uploaded exterior photo is dated October 1, 2018; excluded.
- [Tripadvisor](https://www.tripadvisor.com/Restaurant_Review-g60827-d7256824-Reviews-Chateau_De_Capitaine-Brooklyn_New_York.html): the interior photo is dated June 2016; excluded.
- [June 23, 2026 event collaboration](https://www.instagram.com/anastasy__events/p/DZ7mS8sDpst/): both inspected carousel stills focus on people rather than a useful restaurant view; neither was downloaded.

## Verification

Gallery and About photos were checked at 375px, 768px, and 1280px. Both loaded and retained full portrait framing. Adding `min-w-0` to the About photo grid fixed mobile overflow. Lint and production build passed.
