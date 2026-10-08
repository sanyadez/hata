# Hata

A home server in a single file — a CasaOS competitor built on Bun with zero dependencies.
("Hata" — «хата» — is Ukrainian for "home", the same thing "casa" means.)

Web dashboard, Docker app store, files, HTTPS and backups: one process, one binary, no microservices,
no database server next to it and no npm packages. Compatible with the CasaOS app store.

## Status

Early development. What works today:

- one binary that installs itself as a systemd service (`hata install`);
- first run creates the administrator — there are no default credentials, and the setup needs a code
  that only the server's console shows;
- dashboard: CPU, memory, disk, network, temperature, app tiles with live state;
- app store: reads the CasaOS store (`x-casaos`), search and categories, a form for ports, folders and
  variables, install with live progress;
- custom apps: paste any compose file;
- per app: start, stop, restart, image update, live logs, editing the compose file, removal with or
  without data;
- English and Ukrainian UI, light and dark, phone-friendly.

Not there yet: reverse proxy and HTTPS, more users and 2FA, backups, import of existing containers and
CasaOS installs, file manager.

## Install

On a Linux machine (x64 or arm64) with Docker Engine and the compose plugin:

```sh
sudo ./hata-linux-x64 install
```

It copies itself to `/usr/local/bin/hata`, starts the `hata` service and prints the address for creating
the administrator. State lives in `/var/lib/hata`; every app is a plain compose project in
`/var/lib/hata/apps/<name>/` that keeps working without Hata.

```
hata              run the server
hata install      install as a systemd service and start it (needs root)
hata uninstall    stop and remove the service (apps and data stay)
hata setup-url    print the address for creating the first administrator
hata version      print the version
```

`HATA_PORT`, `HATA_HOST` and `HATA_DATA_DIR` override where the server listens (default: port 80 as root,
8080 otherwise) and where it keeps its state.

## Development

Needs only [Bun](https://bun.com) 1.4 or newer — there is nothing to install.

```sh
bun run dev      # run from source with reload, state in ./data
bun test         # unit tests
bun run build    # dist/hata-linux-x64 and dist/hata-linux-arm64
```

## License

[MIT](LICENSE)
