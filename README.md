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
- dashboard: CPU, memory, disk, network, temperature, app tiles with live state;
- app store: reads the CasaOS store (`x-casaos`), search and categories, a form for ports, folders and
  variables, install with live progress;
- custom apps: paste any compose file;
- per app: start, stop, restart, image update, live logs, editing the compose file, removal with or
  without data;
- English and Ukrainian UI, light and dark, phone-friendly.

Not there yet: reverse proxy and HTTPS, more users and 2FA, backups, import of containers that have no
compose file, file manager.

## Install

On a Linux machine with systemd (x86_64 or arm64):

```sh
curl -fsSL https://raw.githubusercontent.com/sanyadez/hata/main/install.sh | sudo sh
```

The script downloads the binary of the latest release and checks it against the release's checksums,
installs Docker if it is missing, and starts the `hata` service. It ends by printing the address for
creating the administrator. Run it again to update. If port 80 is taken, Hata picks the next free port and
says which; `--port <number>` chooses one.

State lives in `/var/lib/hata`; every app is a plain compose project in `/var/lib/hata/apps/<name>/` that
keeps working without Hata.

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

Not moved yet: containers CasaOS shows that were started without a compose file ("legacy" apps), and
CasaOS's own settings and users.

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

[MIT](LICENSE)
