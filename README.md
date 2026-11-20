# PCPriceTracker

A mobile app for following Indian PC component prices. Pick a product listing and a target price. The app includes price-history charts and code for a local notification when a price reaches the target.

## Follow a price through the code

| Step | Implementation |
| --- | --- |
| Choose a listing | [App.tsx](App.tsx) recognises product URLs from MDComputers, Vedant Computers, PrimeABGB and Computech. |
| Collect an observation | The [Node.js collector](collectTrackedProducts.mjs) reads tracked products and records price observations in Supabase. |
| Schedule collection | The [GitHub Actions workflow](.github/workflows/price-collector.yml) is configured to run every six hours and can also be started manually. |
| View the result | The Expo / React Native app uses TypeScript, a [Supabase client](lib/supabase.ts) and a price-history chart. |

## Local development

The project uses Expo SDK 54. From the project directory, install the locked dependencies with `npm ci`, then start Expo with `npm start`. For data-backed features, the client expects an existing compatible Supabase database and the environment variables `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY`.

The collector runs separately. Its workflow uses the server-side secrets `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`. Keep the service-role key in the collector environment. A fresh checkout requires a configured backend to test collection and price alerts end to end.
