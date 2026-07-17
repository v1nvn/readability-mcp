# Consent Banner Fixture - Example News

## How Consent Overlays Break Extraction

Consent and GDPR overlays are near-universal on European websites. They sit on top of the article, inflate link and button counts, and skew the density heuristics that article extractors rely on. Removing them before scoring is one of the highest-leverage correctness fixes available.

The key insight is that a real overlay covers the entire viewport — both width and height — while navigation chrome is wide but short. A navbar is typically 50 to 80 pixels tall, while a modal is full-height. That distinction is load-bearing for any heuristic that hopes to preserve fixed navigation while removing banners.

## Why density math suffers

Readability scores candidate nodes by the ratio of prose to structural markup. A consent banner injects a paragraph, two buttons, and a wrapper div above the article, which dilutes the score of the true content root and sometimes causes the wrong sibling to win. Stripping the banner first lets the article root score cleanly.

The same logic applies to newsletter popups, age-gate modals, and any full-viewport interstitial that the page layers on top of the prose. They are not content; they are chrome.