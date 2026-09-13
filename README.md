# Market Pulse source

Crypto, DeFi sentiment, and U.S. Treasury yields on your Car Thing.

Webapps for the Spotify Car Thing running [bridgething](https://bridgething.com).

## First run

1. Push this repo to `https://github.com/dharmapoudel/bridgething-market-pulse-source`.
2. In **Settings > Pages**, set the source to **Deploy from a branch**, branch `gh-pages`, folder `/ (root)`.

The catalog is published to `https://dharmapoudel.github.io/bridgething-market-pulse-source/catalog.v1.json`, which can be submitted to <bridgething.com/apps>

## Develop

```sh
bun run dev            # develop the app against a connected bridgething instance
bun run dev:device     # show the dev server on the car thing screen
bun run push           # build and install to the device
bun run check          # ensure the catalog is valid
```

## Apps

- **Market Pulse** (`apps/market-pulse`) — crypto prices with 7-day sparklines, the Fear & Greed sentiment gauge, and the U.S. Treasury yield curve. Permanent app ID `01a0989a-d829-74f3-8463-5e44485c96fb`.
