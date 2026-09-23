# Publish a self-hosted EnderChest instance

Each host runs their own EnderChest server, accounts, database, and files. The
product website is not a relay. An invite link reaches the host's public
address, so the host's computer and Docker must stay running.

Complete the local setup first. Then run `bash publish.sh` on Linux, or
double-click `Publish-EnderChest.cmd` on Windows. Pick one connection method:

## Tailscale Funnel

Install [Tailscale](https://tailscale.com/download) on the host and sign in to
the host's own account. Choose
**Tailscale Funnel** in the publishing launcher. It starts Funnel for the local
EnderChest app, then asks for the HTTPS `*.ts.net` URL printed by Tailscale.
The launcher saves that URL and starts EnderChest with secure cookies and
same-origin, five-minute signed file links. Garage remains private. Invitees
use a normal browser; they do not need Tailscale.

Funnel supports only its `*.ts.net` names and has bandwidth limits. See
[Tailscale's Funnel limits](https://tailscale.com/docs/features/tailscale-funnel/).
It is a
reasonable option for small personal installations, not a promise of unlimited
drive bandwidth. Tailscale account plans and permitted use are determined by
Tailscale. The host owns that account; EnderChest does not create it or pay for
it. Keep Tailscale running on the host.

## Own HTTPS provider

Choose **Own HTTPS provider** when the host already has a tunnel or reverse
proxy that offers a public HTTPS origin and routes requests to EnderChest at
`http://127.0.0.1:3000` on the host. Enter that origin, such as
`https://drive.family.example`. This mode also uses same-origin signed file
links, so Garage does not need a public hostname. The host manages the
provider and its charges, if any. The provider must pass all request paths and
support streaming uploads and downloads.

## Own domain with Caddy

Choose **Own domain with Caddy** for direct access to a host with a reachable
public IP. Use two hostnames under a domain the host controls, such as
`drive.family.example` for the app and `files.family.example` for Garage's
presigned links. They may point to the same IP, but must be different origins.

1. Reserve a stable LAN address for the host in the router.
2. Add an A record for each hostname to the public IPv4. Add AAAA records only
   when the host is also reachable over IPv6. Keep DNS updated if the IP changes.
3. Forward inbound TCP ports 80 and 443 to the host and allow them through its
   firewall. Do not forward PostgreSQL, Garage's private port, or app port 3000.
4. Enter both hostnames in the publishing launcher, without `https://`.

Caddy obtains HTTPS certificates. This mode keeps Garage's direct S3 presigned
links, with narrowly configured browser CORS. If the host is behind CGNAT or
cannot forward ports, use Funnel or an HTTPS tunnel provider instead.

## Check before inviting

From a phone on **mobile data**, not home Wi-Fi:

1. Open the published HTTPS address and confirm the EnderChest login page loads
   without a certificate warning.
2. Sign in as admin. Under Administration > Invitations, confirm the displayed
   address belongs to this host. Copy an invite link and register a test user.
3. Upload, list, download, and delete a test file. Request a presigned link and
   open it in a private browser window without an EnderChest session.
4. Restart Docker and confirm the accounts and files persist. For Funnel, also
   confirm Tailscale reconnects and the same public address works afterward.

The launchers never remove database or Garage volumes. Do not use
`docker compose down --volumes` on an installation containing data. A public
address alone does not grant file access; EnderChest still enforces login,
invitations, ownership, and short-lived signed links.
