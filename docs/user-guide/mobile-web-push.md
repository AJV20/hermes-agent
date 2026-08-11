# Hermes Mobile Web Push

Hermes Mobile Web Push is optional. Without the `web-push` extra, the capability endpoint reports the feature as disabled and the browser is not allowed to save subscriptions.

## Install the transport

Install Hermes with the exact-pinned Web Push extra:

```bash
uv tool install 'hermes-agent[web-push]'
```

For a source checkout, sync the extra instead:

```bash
uv sync --extra web-push
```

## Create the VAPID identity

Create the keypair inside the active Hermes home:

```bash
uv run --extra web-push python -c 'from hermes_cli.config import get_hermes_home; from hermes_cli.mobile_push import ensure_vapid_keypair; ensure_vapid_keypair(get_hermes_home())'
```

This creates:

- `mobile-web-push-vapid-public.txt` — public application-server key; safe for the authenticated capability API.
- `secrets/mobile-web-push-vapid-private.pem` — private P-256 key, forced to mode `0600`.

The private key is never returned by a mobile API or written to the notification database. Hermes refuses to load the managed private-key file if its mode is not exactly `0600`. Existing deployments may instead supply the same identity through the scoped `HERMES_MOBILE_WEB_PUSH_VAPID_PUBLIC_KEY` and `HERMES_MOBILE_WEB_PUSH_VAPID_PRIVATE_KEY` secret names.

Restart the Hermes dashboard/gateway service after installing the optional dependency or creating the keypair. Do not reboot the host.

## Enable the server feature

Web Push is disabled by default even when the optional transport and keypair exist. Enable it explicitly and set a valid VAPID contact:

```bash
hermes config set mobile.push.enabled true
hermes config set mobile.push.vapid_subject mailto:admin@example.com
```

The subject may be a `mailto:` address or an HTTPS contact URL. It is not secret.

## Browser behavior

- Notification permission is requested only after the user taps **Enable on this device**.
- iPhone and iPad require Hermes to be added to the Home Screen and opened as the installed app.
- Lock-screen previews remain opaque: detailed text is fetched only after opening the authenticated mobile app.
- Subscriptions and delivery queues are profile-local.
- Category choices are stored per device.
- Delivery uses an atomic durable queue with bounded batches, retries, leases, and 404/410 subscription removal.
