# EnderChest product site

This is a standalone static site. It is separate from every self-hosted
EnderChest instance; do not deploy the app's Docker stack on the product-site
project. The product site has no user accounts, file storage, or tunnel relay.

`vendor/locomotive-scroll.min.js` is Locomotive Scroll v5.0.1 (MIT), bundled
locally for desktop wheel scrolling. Touch layouts and reduced-motion users
retain native scrolling. Source: https://github.com/locomotivemtl/locomotive-scroll

## Build the download assets

From the repository root, run `npm run build:release`. This creates the ZIP,
tar.gz, and SHA-256 checksum file in `site/downloads/`. The bundle contains the
application and setup launchers, but excludes local `.env` files, database
volumes, object storage, backups, and the product site. Rebuild and review the
bundles whenever the app changes. The site currently links version 0.1.2; update
both site pages when you change the version in `package.json`.

## Vercel

Import this repository as a **new** Vercel project. Set **Root Directory** to
`site`, **Framework Preset** to **Other**, and leave the build command empty.
The static files are served as-is. Add `enderchest.space` and, optionally,
`www.enderchest.space` in the Vercel Domains settings. Enter the DNS records
Vercel displays in GoDaddy. Do not point either name at a personal EnderChest
host. See [Vercel build settings](https://vercel.com/docs/builds/configure-a-build).

## Railway

Create a separate Railway service from this repository. Set its root directory
to `site` and use the included `site/Dockerfile` builder. Railway supplies
`PORT`; the static Caddy server listens on that port. Generate a public domain,
then add `enderchest.space` in Railway's custom-domain settings and enter the
DNS records Railway provides in GoDaddy. See [Railway services](https://docs.railway.com/services).

Choose **one** platform for the apex domain. DNS and HTTPS are managed by that
platform. Neither platform needs PostgreSQL, Garage, Docker Compose, or private
EnderChest environment variables for this static site. Costs depend on the
chosen platform and traffic; check its current plan before deploying.

For a local preview, run `docker build -t enderchest-site ./site` and then
`docker run --rm -p 8088:8080 enderchest-site`; open `http://localhost:8088`.
Download links require that `npm run build:release` has run first.
