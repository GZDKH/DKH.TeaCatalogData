# TheTea Shop factual price-list snapshots

This folder contains checked-in, offline fixtures for factual rows published by
the current TheTea shop pages. It does not treat the page as ProductCatalog
retail-price, stock, seller, fulfilment or media-licensing authority.

`tieguanyin-normalizer.js` verifies the immutable row hash and classifies the
Tieguanyin price base into:

- exact fixed-package physical candidates;
- repeated price observations for one exact physical identity;
- rows blocked because the source provides no exact sale quantity.

The normalized source price observations always have `retailPrice: false` and
`publicationAllowed: false`. A later authenticated operator may use only the
physical identity candidates; publishing a seller offer or direct-order price
requires separately verified internal commercial authority.

Run the offline contract test with:

```bash
node scripts/catalog-sources/test-thetea-shop-tieguanyin.js
```

When the page changes, add a new dated fixture and review the normalized diff.
Do not edit an existing dated fixture or silently replace its `rowsSha256`.
