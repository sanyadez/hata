# Hata

A home server in a single file — a CasaOS competitor built on Bun with zero dependencies.
("Hata" — «хата» — is Ukrainian for "home", the same thing "casa" means.)

Web dashboard, Docker app store, files, HTTPS and backups: one process, one binary, no microservices,
no database server next to it and no npm packages. Compatible with the CasaOS app store.

## Status

Early development. What works today:

- one-line install: one binary that sets itself up as a systemd service;
- one-line move from CasaOS: its apps are taken over where they are, with an undo;
- first run creates the administrator — there are no default credentials, and the setup needs a code
  that only the server's console shows;
- dashboard: CPU, memory, disk, network and temperature with history, app tiles with live state, a
  "needs attention" list (an app that keeps restarting, a failed install or update, a disk filling up) and
  recent activity;
- app store: reads the CasaOS store (`x-casaos`), search and categories, a form for ports, folders and
  variables, install with live progress;
- custom apps: paste any compose file;
- import of what already runs: a compose project started elsewhere becomes an app without a restart; a
  container started with `docker run` is rebuilt into an app from a compose file written out of its settings
  (shown and editable before anything happens), on the same volumes, with the old container put back if the
  new one does not come up;
- store updates that keep your changes: when the store has a newer version of an app, Hata shows what
  changes in its compose file and merges it in — your ports, folders, variables and edits by hand stay, and
  where you and the store changed the same line, yours wins and the difference is shown;
- per app, on its own page: start, stop, restart, image update, CPU and memory per container, live logs,
  editing the compose file, removal with or without data;
- backups: a snapshot of an app (compose file, its folders, its Docker volumes) as a plain `tar.gz`, daily
  on a schedule and before every update, restore to any snapshot — also of an app that was removed;
- files: the server's files in the browser, opened in the data folder and reaching everywhere — folders,
  upload by drag and drop (whole folders too, large files in parts), download of a file or of a folder as a
  ZIP archive, rename, move, copy, delete, copying a path, putting a folder on the dashboard, pictures, video and sound opened in place, text
  files edited in place. What is uploaded into an app's folder belongs to the same user the app runs as;
  the system's own folders cannot be deleted by a slip of the hand;
- users: administrators, members (who see the apps and open them, nothing more) and shared guest accounts;
  invitations by link; two-factor sign-in with an authenticator app and recovery codes; passkeys (sign in with the
  device's fingerprint, face or PIN) when Hata is reached by a domain over HTTPS; a list of one's
  sessions with sign-out per device; a sign-in log;
- sign-in in front of any app: Hata takes over the app's port and lets through only people who are signed
  in to Hata and allowed to open that app — no domain or HTTPS needed, the app's address stays the same;
- HTTPS, your choice of three: none (address and ports, for a home network); behind your own proxy (nginx,
  Caddy, Traefik) with a check that the proxy is set up right; or by Hata itself with certificates from
  Let's Encrypt. With a domain, every app has its own address, `<app>.<domain>`;
- updates of Hata itself from the web UI: a newer release is downloaded, checked against its checksums and
  started; if it does not come up, the previous version is put back by itself. Apps keep running meanwhile;
- English and Ukrainian UI, light and dark, phone-friendly.

Not there yet: wildcard certificates (DNS challenge), backups to another machine, a trash and share links
for files.

## Install

On a Linux machine with systemd (x86_64 or arm64):

```sh
curl -fsSL https://raw.githubusercontent.com/sanyadez/hata/main/install.sh | sudo sh
```

The script downloads the binary of the latest release and checks it against the release's checksums,
installs Docker if it is missing, and starts the `hata` service. It ends by printing the address for
creating the administrator. To update, use Settings → About in the web UI, or run it again. If port 80 is taken, Hata picks the next free port and
says which; `--port <number>` chooses one.

State lives in `/var/lib/hata`; every app is a plain compose project in `/var/lib/hata/apps/<name>/` that
keeps working without Hata. Next to an app's `compose.yml`, which is yours to edit, `hata.yml` holds what Hata
itself knows about it — the store it came from and the store's original file; `docker compose` never reads it.

### Moving in from CasaOS

```sh
curl -fsSL https://raw.githubusercontent.com/sanyadez/hata/main/install.sh | sudo sh -s -- --migrate-casaos
```

Hata takes over the apps CasaOS installed — the same compose files, the same containers, the same data in
`/DATA` — then stops CasaOS and takes port 80. Containers are not recreated during the move, and nothing of
CasaOS is deleted, so it can be taken back:

```sh
sudo hata migrate casaos --dry-run   # only show what would happen
sudo hata migrate casaos --undo      # give the apps back to CasaOS
```

The same move can be made later from the web UI (Apps → Import), which also offers what else runs on the
machine: compose projects started elsewhere are taken over without a restart, and containers started
without a compose file — CasaOS's "legacy" apps among them — are rebuilt into apps on the same volumes and
folders.

Not moved: CasaOS's own settings and users.

### Commands

```
hata                    run the server
hata install            install as a systemd service and start it; --port <number>
hata uninstall          stop and remove the service (apps and data stay)
hata migrate casaos     take over the apps of a CasaOS install; --dry-run, --yes, --keep-casaos, --undo
hata setup-url          print the address for creating the first administrator
hata version            print the version
```

`HATA_PORT`, `HATA_HOST` and `HATA_DATA_DIR` override where the server listens and where it keeps its state.

## Development

Needs only [Bun](https://bun.com) 1.4 or newer — there is nothing to install.

```sh
bun run dev      # run from source with reload, state in ./data
bun test         # unit tests
bun run build    # dist/hata-linux-x64 and dist/hata-linux-arm64
```

## License

[PolyForm Noncommercial 1.0.0](LICENSE). You may use, change and share Hata for any noncommercial purpose —
at home, for study, in a noncommercial organisation — as long as every copy keeps the licence and the
notice naming the author. Commercial use needs a separate licence from the author: write to
<sanyadez@gmail.com>.

Versions up to 0.1.0-alpha.3 were released under the MIT licence. The fonts in `src/ui/fonts` keep their own
licence (SIL Open Font License).
