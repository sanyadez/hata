# Hata

**English** · [Українська](README.uk.md)

A home server in a single file: a web dashboard, a Docker app store, files, HTTPS and backups.
Works with the CasaOS app store and takes a CasaOS install over in one line, with an undo.
("Hata" — «хата» — is Ukrainian for "home", the same thing "casa" means.)

One process, one binary, no microservices, no database server next to it and no npm packages — built
on Bun with zero dependencies. An app is a plain compose file on disk: Hata does not hide Docker.

```sh
curl -fsSL https://raw.githubusercontent.com/sanyadez/hata/main/install.sh | sudo sh
```

On a Linux machine with systemd, x86_64 or arm64 — see [Install](#install); coming from CasaOS, see
[Moving in from CasaOS](#moving-in-from-casaos).

![The dashboard: system numbers, app tiles in groups, what needs attention and recent activity](screenshots/dashboard.png)

| | |
|---|---|
| ![The app store](screenshots/store.png) The app store | ![An app's page](screenshots/app.png) An app's page |
| ![An app's settings as a form](screenshots/app-settings.png) An app's settings as a form | ![The file manager](screenshots/files.png) Files |
| ![Backups](screenshots/backups.png) Backups | <img src="screenshots/phone.png" alt="The dashboard on a phone" width="240"> On a phone |

Every page and every look: [Screenshots](#screenshots).

## Questions and answers

**What does it do?**
It turns a Linux machine — an old PC, a mini PC, a Raspberry Pi, a VM — into a home server you run from a
browser instead of a terminal. You pick an app in the store (Jellyfin, Nextcloud, Home Assistant, Pi-hole
and well over a hundred more), press "Install", and it runs in Docker. Around the apps Hata does the rest of what
a home server needs: a dashboard with the state of the machine, a file manager, folders shared over the
network, disks and their health, backups with restore, users and who may open what, HTTPS, notifications
when something breaks. The full list is under [Status](#status).

**What is it an alternative to?**
To CasaOS first of all, and to the others of that kind: Umbrel, Runtipi, Cosmos. Unlike some of them it is
not an operating system: it is one program installed on the Linux you already have, and removed from it
just as easily.

**Is it a web UI for CasaOS?**
No. Hata is a separate program that replaces CasaOS and does not need it. What it shares with CasaOS is
the app store: Hata reads the same store format, so the same apps install here. If CasaOS is already on the
machine, Hata can take its apps over as they are — see [Moving in from CasaOS](#moving-in-from-casaos).

**And what is CasaOS?**
An open-source home server dashboard by IceWhale, the makers of ZimaBoard: a web page with app tiles, a
Docker app store and a file manager on top of an ordinary Linux. It made the "home server without a
terminal" idea popular. Hata starts from what CasaOS does and adds what it lacks: backups and restore,
users with roles and two-factor sign-in, sign-in in front of any app, HTTPS with certificates, disk health,
store updates that keep your changes, notifications.

**How is it better than Cockpit?**
It is not better, it does another job. Cockpit administers a Linux server: systemd services, the journal,
network interfaces, system accounts, packages, virtual machines. Hata is about apps and the people of a
home: a store, one-click installs, a dashboard of tiles, backups of app data, family members who open
their apps and nothing else. Cockpit has no app store and no idea of "an app with its data"; Hata does
not manage services, packages or virtual machines. Of the network it does what a home server needs: it
shows the interfaces and changes an address, with the previous one coming back by itself if the server
can no longer be reached. The two do not get in each other's way and can run on one machine.

**Can it manage containers and compose files like Portainer?**
Apps, yes. Every app is a compose project, and on its page you start, stop and restart it, update its
images, watch CPU and memory per container, read live logs, open a shell inside a container and edit the
compose file — as text or as a form. You can paste any compose file or a `docker run` command to make an
app, and what already runs on the machine (compose projects started elsewhere, single containers) can be
taken in as apps. What Hata does not have is Portainer's view of Docker itself: there are no lists of
images, volumes and networks to browse and clean up, no Swarm or Kubernetes, and one Hata looks after one
machine. Portainer runs fine next to it — as an app from the store.

**Does it check Docker registries for newer images?**
Yes. Once a day Hata asks the registries whether the tags your apps use — `latest`, say — point at newer
images than the ones running; nothing is downloaded for that. An app with a newer image gets a mark on
its tile, and "Update images" lights up on its page. Updating stays your decision unless you switch on
"Update the apps by itself" in Settings → Apps: then the running apps with newer images are updated
every day at the time you set, with a snapshot of the app's data taken first, and any app can be left
out. Hata also notices when the app store has a newer version of an app. Images come from any registry
the compose file names; a sign-in saved with `docker login` is used, signing in to a private registry
is not in the UI.

## Status

Early development. What works today:

- one-line install: one binary that sets itself up as a systemd service;
- one-line move from CasaOS: its apps are taken over where they are, with an undo;
- first run creates the administrator — there are no default credentials, and the setup needs a code
  that only the server's console shows;
- dashboard: CPU, memory, disk, network and temperature with history, app tiles with live state, a
  "needs attention" list (an app that keeps restarting, a failed install or update, a disk filling up) and
  recent activity;
- the dashboard is yours to arrange: plain links next to the apps, named groups, folders of tiles that
  open in place like on a phone — all by dragging, mouse or finger, with no editing mode to enter; groups
  and the blocks of the page (system numbers, what needs attention, activity) are dragged too, and can be
  taken off and added back; the whole layout can also be edited as text (YAML); a tile opens the app, the
  small button next to it leads to its page in Hata;
- a name on the home network: Hata answers to `hata.local` and every app to `<app>.hata.local` over
  multicast DNS — nothing to set up on phones, computers or the router; the name is yours to change, and
  one with another ending (`hata.lan`) works too once your router's DNS knows it;
- terminal in the browser, for administrators: a shell on the server (it keeps running when the page is
  closed and shows the latest output when you come back) and a shell inside a container of an app;
- the look is yours as well: accent and background colours (a light background turns the page light), a
  background picture — one of the built-in ones or your own;
- app store: reads the CasaOS store (`x-casaos`), search and categories, a form for ports, folders and
  variables, install with live progress;
- custom apps: fill in a form or paste any compose file;
- import of what already runs: a compose project started elsewhere becomes an app without a restart; a
  container started with `docker run` is rebuilt into an app from a compose file written out of its settings
  (shown and editable before anything happens), on the same volumes, with the old container put back if the
  new one does not come up;
- store updates that keep your changes: when the store has a newer version of an app, Hata shows what
  changes in its compose file and merges it in — your ports, folders, variables and edits by hand stay, and
  where you and the store changed the same line, yours wins and the difference is shown;
- network: the server's interfaces with address, gateway and DNS; an address is changed from the page —
  fixed or from the router — through NetworkManager (installed on request, an interface the system set
  up is handed over as it is), and every change is on trial: unless the page reaches the server again
  within a minute and a half, the previous settings come back by themselves; Wi-Fi: the networks in
  reach, joining one with its password, forgetting it; a USB modem or a phone sharing its connection is
  recognised, and you choose which interface is the main way to the internet and which a spare one;
  the Wi-Fi adapter can be an access point of the server's own, joined by a QR code, with the
  internet shared through the server;
- newer images: once a day the registries are asked whether the tags of your apps have moved on, and an
  app with a newer image is marked; on request the running apps are updated by themselves at a set time,
  each after a snapshot of its data;
- per app, on its own page: start, stop, restart, image update, CPU and memory per container, live logs,
  editing the compose file, removal with or without data;
- app settings as a form, the one known from CasaOS: image, title and icon, the web UI's address, network,
  ports, volumes, environment variables, devices, command, privileges, memory limit, CPU shares, restart
  policy, capabilities, host name — for every service of the app, and services are added and removed as
  tabs. It edits the same compose file: what the form does not show stays as written. A custom app can be
  described in this form instead of a compose file, and the form can be filled in from a `docker run`
  command pasted from an app's instructions. An app's icon can be a picture of your own: it is kept next
  to the compose file as `icon.*` and used instead of the store's;
- backups: a snapshot of an app (compose file, its folders, its Docker volumes) as a plain `tar.gz`, daily
  on a schedule and before every update, restore to any snapshot — also of an app that was removed;
- a backup of the whole server: with every run Hata's own state (settings, users, the dashboard, the
  apps' compose files) is saved next to the apps' snapshots, and `sudo hata restore <backup folder>` on a
  new machine brings back Hata and then every app from its latest snapshot;
- a second copy of the backups on another machine: every snapshot is sent over SFTP to a NAS, a rented
  storage box or another server — with a key Hata makes for itself, never a password. With a passphrase
  the files are encrypted before they leave, so the other machine cannot read them. A day the other
  machine was off is caught up the next time, and a copy that falls behind shows up under "needs
  attention". `hata restore` opens such a copy when given the passphrase;
- disks and their health (Settings → Storage): every disk with what it says about itself (SMART) in plain
  words — healthy, wearing out or failing, and why — its temperature, how full it is and where it is
  mounted; the file systems of the server, network folders included. Health is read every half an hour
  without waking a disk that sleeps, a disk in trouble shows up under "needs attention" and is sent as a
  notification, and a disk can be told to test itself. The counters that matter are remembered: a disk's
  page says "was 0 until 14 Sep", and a counter that grows is sent as a notification again. It needs
  `smartmontools`, which Hata offers to install; nothing on a disk is changed;
- putting a disk to use (same page): a new disk is prepared in one dialog — one partition, ext4, a folder
  under `/mnt`, a line in `/etc/fstab` that does not hold up the start when the disk is absent (Docker waits for the
  disk, and without it the apps that keep data there stay stopped instead of starting empty on the
  system's disk — the home page says which disk is missing); a disk that
  already holds files (ext4, XFS, Btrfs, FAT, exFAT, NTFS) is connected as it is, nothing on it changed;
  a USB disk can be connected by itself when plugged in, and is ejected before it is pulled out. Erasing
  asks for the disk's name and your password, and is never offered for the system's disk, a disk in use
  or a member of an array;
- the data folder moves to a disk with one button (Settings → Apps, or right after preparing a disk):
  the apps are stopped, everything is copied, the apps' compose files — comments and all —, the backups,
  the shared folders and the folders on the dashboard are pointed at the new place, and the apps start
  again; the old folder is kept until you delete it, and a snapshot taken before the move still restores;
- several disks as one folder (mergerfs, installed on request): a new file goes to the disk with the most
  free room, every file stays a plain file on one of the disks. A disk that is plugged in shows up on the
  page by itself, and the disks are in the sidebar of Files;
- what fills the data folder (same page): measured once a day — its folders, the data of each app, the
  trash — with how much each grew over the week and, when the disk is filling up, in how long it will
  be full at this pace;
- folders shared over the network (Settings → Network folders, or a folder's menu in Files): a folder of
  the server opens in Explorer, Finder or a phone's file manager like a network disk (SMB). People connect
  with the name and password they sign in to Hata with; for every folder each user may look, change or
  nothing at all, and so may "anyone without a password". What lands there takes the owner of its
  folder, so apps still reach it. Samba does the serving: the installer puts it in and Hata sets it up
  whole — the `smb.conf` that was there is kept next to it and put back when Hata is removed. No address
  has to be typed: while something is shared, the server shows up by itself under "Network" in Explorer on
  Windows, in the sidebar of Finder and in the Files app of a phone, under its name on the home network;
- files: the server's files in the browser, opened in the data folder and reaching everywhere — folders,
  upload by drag and drop (whole folders too, large files in parts), download of a file or of a folder as a
  ZIP archive, rename, move, copy, delete — into a trash, from where a thing is put back within 30 days —, copying a path, putting a folder on the dashboard, pictures, video and sound opened in place, text
  files edited in place. What is uploaded into an app's folder belongs to the same user the app runs as;
  the system's own folders cannot be deleted by a slip of the hand;
- users: administrators, members (who see the apps and open them, nothing more) and shared guest accounts;
  invitations by link; two-factor sign-in with an authenticator app and recovery codes; passkeys (sign in with the
  device's fingerprint, face or PIN) when Hata is reached by a domain over HTTPS; a list of one's
  sessions with sign-out per device; a sign-in log;
- sign-in in front of any app: Hata takes over the app's port and lets through only people who are signed
  in to Hata and allowed to open that app — no domain or HTTPS needed, the app's address stays the same. The app's
  other published ports are listed next to it and can be put behind the same sign-in when they are web
  pages too;
- HTTPS, your choice of three: none (address and ports, for a home network); behind your own proxy (nginx,
  Caddy, Traefik) with a check that the proxy is set up right; or by Hata itself with certificates from
  Let's Encrypt. With a domain, every app has its own address, `<app>.<domain>`;
- notifications: what the home page lists as needing attention also reaches you where you are — on your
  phone or computer (a notification from the browser, when Hata is opened over HTTPS), in Telegram through
  a bot of your own, in an ntfy topic, or as a webhook for your own automation. Each problem is told once,
  after it has lasted a minute and a half, in the words of the home page;
- an MCP server for AI agents: an agent that speaks MCP can say why an app is down (state of the
  containers, the tail of the log and the likely causes in one answer), update apps, install from the store,
  take and restore snapshots. It connects with an access key made in the settings, and a key has one of
  three levels — look, operate, everything; no level reaches users, passwords, files or a shell. Secrets in
  compose files are hidden from keys that may not change them, and what an agent did is in the activity log
  under the key's name;
- updates of Hata itself from the web UI: a newer release is downloaded, checked against its checksums and
  started; if it does not come up, the previous version is put back by itself. Apps keep running meanwhile;
- English and Ukrainian UI, light and dark, phone-friendly.

Not there yet: wildcard certificates (DNS challenge), share links for files.

## Screenshots

### Pages

| | |
|---|---|
| ![Sign-in](screenshots/signin.png) Sign-in | ![The trash: deleted files are kept for 30 days](screenshots/trash.png) The trash: deleted files are kept for 30 days |
| ![An app's logs](screenshots/app-logs.png) An app's logs | ![An app's compose file](screenshots/app-compose.png) An app's compose file |
| ![An app's snapshots](screenshots/app-backups.png) An app's snapshots | ![A shell inside an app's container](screenshots/app-terminal.png) A shell inside an app's container |
| ![The server's terminal](screenshots/terminal.png) The server's terminal | ![Bringing in containers that already run](screenshots/import.png) Bringing in containers that already run |
| ![Users, who can open what, invitations](screenshots/users.png) Users, who can open what, invitations |  |

### Settings

| | |
|---|---|
| ![Account: password, two-factor sign-in, passkeys, sessions](screenshots/settings-account.png) Account: password, two-factor sign-in, passkeys, sessions | ![General](screenshots/settings-general.png) General |
| ![Appearance](screenshots/settings-appearance.png) Appearance | ![Apps: the data and configuration folders](screenshots/settings-apps.png) Apps: the data and configuration folders |
| ![App stores](screenshots/settings-stores.png) App stores | ![Storage: disks, file systems, what fills the data folder](screenshots/settings-storage.png) Storage: disks, file systems, what fills the data folder |
| ![Network folders (SMB)](screenshots/settings-shares.png) Network folders (SMB) | ![HTTPS and domain](screenshots/settings-https.png) HTTPS and domain |
| ![Notifications](screenshots/settings-notifications.png) Notifications | ![Agents: access keys for the MCP server](screenshots/settings-agents.png) Agents: access keys for the MCP server |
| ![About and updates](screenshots/settings-about.png) About and updates |  |

### Looks

The look is set in Settings → Appearance: an accent colour and a background colour (eight of each, or any
colour of your own; a light background turns the whole page light), and a background picture — six built in,
or your own — with a veil over it that can be made lighter or darker.

Background pictures:

| | | |
|---|---|---|
| ![Dusk](screenshots/theme-dusk.png) Dusk | ![Aurora, violet accent](screenshots/theme-aurora.png) Aurora, violet accent | ![Mist, green accent](screenshots/theme-mist.png) Mist, green accent |
| ![Dunes, coral accent](screenshots/theme-dunes.png) Dunes, coral accent | ![Ocean, blue accent](screenshots/theme-ocean.png) Ocean, blue accent | ![Contours, lime accent](screenshots/theme-contours.png) Contours, lime accent |

Background and accent colours:

| | | |
|---|---|---|
| ![Hata's own colours](screenshots/theme-colour-1.png) Hata's own colours | ![Slate, coral accent](screenshots/theme-colour-2.png) Slate, coral accent | ![Pine, pink accent](screenshots/theme-colour-3.png) Pine, pink accent |
| ![Plum, violet accent](screenshots/theme-colour-4.png) Plum, violet accent | ![Maroon, blue accent](screenshots/theme-colour-5.png) Maroon, blue accent | ![Black, cyan accent](screenshots/theme-colour-6.png) Black, cyan accent |
| ![Light and warm, green accent](screenshots/theme-colour-7.png) Light and warm, green accent | ![Light and cool, lime accent](screenshots/theme-colour-8.png) Light and cool, lime accent |  |

## Install

On a Linux machine with systemd (x86_64 or arm64):

```sh
curl -fsSL https://raw.githubusercontent.com/sanyadez/hata/main/install.sh | sudo sh
```

The script downloads the binary of the latest release and checks it against the release's checksums,
installs Docker if it is missing, and starts the `hata` service. It ends by printing the address for
creating the administrator. To update, use Settings → About in the web UI, or run it again. If port 80 is taken, Hata picks the next free port and
says which; `--port <number>` chooses one.

State lives in `/var/lib/hata` — the configuration folder; every app is a plain compose project in
`/var/lib/hata/apps/<name>/` that keeps working without Hata. The folder can be moved from Settings → Apps
(to another disk, say): everything is copied, Hata restarts there, the apps keep running.
What must stay private — password hashes, sessions, certificate keys, the notification tokens — is kept
apart in `/etc/hata` and does not move with it. Next to an app's `compose.yml`, which is yours to edit, `hata.yml` holds what Hata
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
