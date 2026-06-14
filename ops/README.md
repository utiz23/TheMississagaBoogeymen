# ops/ — operational units (in-repo, reproducible)

## Nightly OCR verification

`eanhl-verify.service` + `eanhl-verify.timer` run `scripts/verify-ocr.sh --full`
nightly — the catch-all that exercises the heavy end-to-end path the advisory
pre-push hook skips. The units are committed here so the deliverable lives in
the repo; only the `systemctl enable` is machine-local.

### systemd (preferred)

```bash
mkdir -p ~/.config/systemd/user
ln -sf "$PWD/ops/eanhl-verify.service" ~/.config/systemd/user/eanhl-verify.service
ln -sf "$PWD/ops/eanhl-verify.timer"   ~/.config/systemd/user/eanhl-verify.timer
systemctl --user daemon-reload
systemctl --user enable --now eanhl-verify.timer
loginctl enable-linger "$USER"        # run while logged out
systemctl --user list-timers eanhl-verify.timer
```

Edit `WorkingDirectory` / `EnvironmentFile` in `eanhl-verify.service` if the
repo is not at `~/projects/eanhl-team-website`.

Logs: `journalctl --user -u eanhl-verify.service -e`

### cron fallback (no systemd --user)

```cron
# 03:30 nightly — full OCR verify. Edit the repo path.
30 3 * * *  cd "$HOME/projects/eanhl-team-website" && set -a && . ./.env && set +a && bash scripts/verify-ocr.sh --full >> "$HOME/eanhl-verify.log" 2>&1
```

## Enforcement model (read this)

- **Authoritative, fail-closed:** the `decoder-runs activate` quality gate
  (WS0.1A). Bad runs cannot become canonical regardless of local git config.
- **Advisory:** the `.githooks/pre-push` hook (bypassable with `--no-verify`),
  self-installed via the root `package.json` `prepare` script
  (`git config core.hooksPath .githooks`) on `pnpm install`.
- **Catch-all:** this nightly timer.
