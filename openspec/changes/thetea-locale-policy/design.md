# Design

`docs/thetea-locale-policy.json` is a versioned 72-row policy. The locale
resolver selects candidate cultures from a supplied destination registry,
records source/destination and mapping hashes, and marks unavailable, script-
ambiguous and semantic aliases for review. Product and content preparation
uses `inherited-language` as an explicit derivation; it never rewrites a
regional/manual value and never labels inherited content as native.

Typed specification values, units, option IDs and product identity are kept
outside locale expansion. Localized names, descriptions, SEO, definition and
option labels, origins, articles and FAQs use the same target-locale map.
