# Supabase browser SDK

`supabase-2.116.0.js` is the unmodified UMD build from the pinned npm package
`@supabase/supabase-js@2.116.0` (`dist/umd/supabase.js`). The MIT license is included
as `supabase-LICENSE`. The file is served by this repository's GitHub Pages so login
does not depend on another JavaScript CDN.

To update, pin the package in package.json/package-lock.json, copy its UMD build and
license here, update index.html, and run the app/auth/sync tests. Never put user
sessions, passwords, service-role keys, or library exports in this directory.
