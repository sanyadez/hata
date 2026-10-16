# Hata

**English** · [Українська](README.uk.md)

A home server in a single file: a web dashboard, a Docker app store, files, HTTPS and backups.
It began when CasaOS stopped moving and is a program of its own; it takes a CasaOS install over in one
line, with an undo. ("Hata" — «хата» — is Ukrainian for "home", the same thing "casa" means.)

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
network, disks, their health and protection from a disk failure, backups with restore of a whole app or of
single files, the server's own network — Wi-Fi, a spare way to the internet, an access point —, users and
who may open what, HTTPS, notifications when something breaks. The full list is under [Status](#status).

**What is it an alternative to?**
To the home server programs of that kind: Umbrel, Runtipi, Cosmos, CasaOS. Unlike some of them it is
not an operating system: it is one program installed on the Linux you already have, and removed from it
just as easily. What each of them has: [How Hata compares](COMPARISON.md).

**Is it a web UI for CasaOS?**
No. Hata is a separate program and does not need CasaOS. It has a store of its own,
[Hata Store](https://github.com/sanyadez/hata-store), and it also reads app stores in the CasaOS format, so
the apps of the CasaOS store install here too. If CasaOS is already on the machine, Hata can take its apps
over as they are — see [Moving in from CasaOS](#moving-in-from-casaos).

**And what is CasaOS?**
An open-source home server dashboard by IceWhale, the makers of ZimaBoard: a web page with app tiles, a
Docker app store and a file manager on top of an ordinary Linux. It made the "home server without a
terminal" idea popular. Its core has had no release since December 2024, and that is how Hata began: as
a home for its users. It went its own way from there, with what CasaOS never had: backups and restore,
users with roles and two-factor sign-in, sign-in in front of any app, HTTPS with certificates, disk health
and protection from a disk failure, the server's network settings, store updates that keep your changes,
other machines run from the same page, notifications.

**How is it better than Cockpit?**
It is not better, it does another job. Cockpit administers a Linux server: systemd services, the journal,
network interfaces, system accounts, packages, virtual machines. Hata is about apps and the people of a
home: a store, one-click installs, a dashboard of tiles, backups of app data, family members who open
their apps and nothing else. Cockpit has no app store and no idea of "an app with its data"; Hata does
not manage services, packages or virtual machines. Of the network it does what a home server needs: it
shows the interfaces and changes an address — IPv4 and IPv6 —, with the previous one coming back by itself
if the server can no longer be reached; it joins Wi-Fi, keeps a USB modem as a spare way to the internet,
and can turn the Wi-Fi adapter into an access point. The two do not get in each other's way and can run on one machine.

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
  that only the server's console shows; then it walks through the first choices: the server's name, what
  already runs on the machine, where the data and the backups go, a few apps to start with;
- dashboard: CPU, memory, disk, network and temperature with history, app tiles with live state, a
  "needs attention" list (an app that keeps restarting, a failed install or update, a disk filling up) and
  recent activity;
- the dashboard is yours to arrange: plain links next to the apps, named groups, folders of tiles that
  open in place like on a phone — all by dragging, mouse or finger, with no editing mode to enter; groups
  and the blocks of the page (system numbers, what needs attention, activity) are dragged too, and can be
  taken off and added back; the whole layout can also be edited as text (YAML); a tile opens the app, its
  menu (the button next to it, or a right click) starts, stops and restarts it and leads to its
  settings, logs, terminal and backups;
- a name on the home network: Hata answers to `hata.local` and every app to `<app>.hata.local` over
  multicast DNS — nothing to set up on phones, computers or the router; the name is yours to change, and
  one with another ending (`hata.lan`) works too once your router's DNS knows it;
- terminal in the browser, for administrators: a shell on the server (it keeps running when the page is
  closed and shows the latest output when you come back) and a shell inside a container of an app;
- the look is yours as well: accent and background colours (a light background turns the page light), a
  background picture — one of the built-in ones or your own;
- app store: [Hata Store](https://github.com/sanyadez/hata-store) — every app a plain compose file that
  runs without Hata too, with its texts, its settings and what it asks of the server said before installing;
  the settings go into the app's `.env`, a taken port is moved to a free one, passwords are made; it also
  reads stores in the CasaOS format (`x-casaos`): the CasaOS store and any other one added by its address;
  search and categories, install with live progress;
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
  internet shared through the server — on a network, a channel and an address of your choosing — and a
  spare cable port can give the internet out the same way; IPv6 is set next to IPv4 (from the router,
  fixed, or off), a Wi-Fi network that hides its name is joined by typing it, an interface handed over
  to NetworkManager can be given back;
  on request every way is checked each minute, a spare one takes over while the main has no internet,
  and a way that stops reaching the internet shows up in "needs attention"; an interface the internet
  comes in on (a provider's cable straight in the server) is marked as the internet side, and nothing of
  the server answers there — the pages, the apps with Docker's ports, the network folders — while an
  interface with a public address that is not marked is pointed out;
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
  folders the app uses outside its own (media, documents) go into its snapshots when you choose them;
  a snapshot can be looked into like a disk, a file taken out of it, and single files and folders put
  back without restoring the whole app;
- a backup of the whole server: with every run Hata's own state (settings, users, the dashboard, the
  apps' compose files) is saved next to the apps' snapshots, and `sudo hata restore <backup folder>` on a
  new machine brings back Hata and then every app from its latest snapshot;
- a second copy of the backups somewhere else: every snapshot is sent over SFTP to a NAS, a rented
  storage box or another server — with a key Hata makes for itself, never a password — or into a bucket
  of S3-compatible storage (Backblaze B2, Wasabi, Cloudflare R2, Amazon S3, MinIO), in parts, so a large
  snapshot does not cost memory. With a passphrase the files are encrypted before they leave, so
  whoever keeps them cannot read them. A day the other
  machine was off is caught up the next time, and a copy that falls behind shows up under "needs
  attention". `hata restore` opens such a copy when given the passphrase, and takes the copy's own
  address — `s3://bucket/folder` or `sftp://user@host/folder` — fetching the latest snapshots by itself;
- disks and their health (Settings → Storage): every disk with what it says about itself (SMART) in plain
  words — healthy, wearing out or failing, and why — its temperature, how full it is and where it is
  mounted; the file systems of the server, network folders included. Health is read every half an hour
  without waking a disk that sleeps, a disk in trouble shows up under "needs attention" and is sent as a
  notification, and a disk can be told to test itself. The counters that matter are remembered: a disk's
  page says "was 0 until 14 Sep", and a counter that grows is sent as a notification again. It needs
  `smartmontools`, which Hata offers to install; nothing on a disk is changed;
- putting a disk to use (same page): a disk is formatted in one dialog — one partition, ext4, a folder
  under `/mnt`, a line in `/etc/fstab` that does not hold up the start when the disk is absent (Docker waits for the
  disk, and without it the apps that keep data there stay stopped instead of starting empty on the
  system's disk — the home page says which disk is missing); a disk that
  already holds files (ext4, XFS, Btrfs, FAT, exFAT, NTFS) is connected as it is, nothing on it changed;
  a USB disk can be connected by itself when plugged in, and is ejected before it is pulled out. A disk
  nothing uses yet is said so on the home page too, and what a plugged-in stick holds can be copied
  onto the server — all of it or the folders and files you choose, into the folder you choose. Erasing
  asks for the disk's name and your password, and is never offered for the system's disk, a disk
  something else uses or a member of an array;
- formatting for other devices too: a disk, a stick or a single partition becomes ext4, exFAT, FAT32 or
  NTFS under the label you type, with the partition table and type each kind of device expects, and is
  then kept connected, connected until unplugged, or left ready to take away — a stick Hata connected
  is let go of for it. A file system can be checked and repaired (what an unplugging without ejecting
  leaves behind, the NTFS mark that stops a disk from connecting included) and renamed. A partition can
  be smaller than the disk, with another made later in the room that is left; a disk that goes to
  somebody else is erased, with every block written over if you ask. Long runs show what the programs
  say and how far they are, and a data disk on its way to full is said a month ahead;
- the data folder moves to a disk with one button (Settings → Apps, or right after formatting a disk):
  the apps are stopped, everything is copied, the apps' compose files — comments and all —, the backups,
  the shared folders and the folders on the dashboard are pointed at the new place, and the apps start
  again; the old folder is kept until you delete it, and a snapshot taken before the move still restores;
- several disks as one folder (mergerfs, installed on request): a new file goes to the disk with the most
  free room, every file stays a plain file on one of the disks. A disk that is plugged in shows up on the
  page by itself, and the disks are in the sidebar of Files;
- protection from a disk failure (SnapRAID, installed on request): one disk holds parity for the
  others, the disks stay plain disks; a sync every night and a check every week; when a disk dies, a
  new one in its place is filled back from the parity; files deleted by mistake since the last sync
  come back the same way — and a sync after which too many files would be forgotten waits for your
  word; damage a check finds is repaired from the parity;
- what fills the data folder (same page): measured once a day — its folders, the data of each app, the
  trash — with how much each grew over the week and, when the disk is filling up, in how long it will
  be full at this pace;
- folders shared over the network (Settings → Network folders, or a folder's menu in Files): a folder of
  the server opens in Explorer, Finder or a phone's file manager like a network disk (SMB). People connect
  with the name and password they sign in to Hata with; for every folder each user may look, change or
  nothing at all, and so may "anyone without a password". What lands there takes the owner of its
  folder, so apps still reach it. Samba does the serving: the installer puts it in and Hata sets it up
  whole — the `smb.conf` that was there is kept next to it and put back when Hata is removed. A Samba that
  stopped, or a shared folder whose disk is gone, shows up under "needs attention". No address
  has to be typed: while something is shared, the server shows up by itself under "Network" in Explorer on
  Windows, in the sidebar of Finder and in the Files app of a phone, under its name on the home network;
- network places: a folder of a NAS, another computer or a server elsewhere — over SMB, NFS, SFTP, WebDAV
  or FTP — mounted here as an ordinary folder under `/mnt/net`, so it is in Files, in every folder picker,
  and apps and backups can use it. It is tried before it is kept (a wrong password or a missing folder is
  said in the server's own words), it comes back by itself after a restart or when the server is back, and
  one that stops answering shows up under "needs attention". Servers that announce themselves on the home
  network are listed, and so are a server's shares;
- files: the server's files in the browser, opened in the data folder and reaching everywhere — folders,
  upload by drag and drop (whole folders too, large files in parts), download of a file or of a folder as a
  ZIP archive, rename, move, copy, delete — into a trash, from where a thing is put back within 30 days —, copying a path, putting a folder on the dashboard, a menu on the right click (of the file, of everything selected, of the folder), the other disks of the server at the top of the data folder and in every folder picker, pictures, video and sound opened in place, text
  files made and edited in place, ZIP and tar archives extracted into a folder next to them, files found by
  name under the folder you are in; what is renamed, moved, copied, deleted or extracted is in the
  activity log. What is uploaded into an app's folder belongs to the same user the app runs as;
  the system's own folders cannot be deleted by a slip of the hand;
- users: administrators, members (who see the apps and open them, nothing more) and shared guest accounts;
  invitations by link; two-factor sign-in with an authenticator app and recovery codes; passkeys (sign in with the
  device's fingerprint, face or PIN) when Hata is reached by a domain over HTTPS; a rule that every
  administrator signs in with a second factor; a list of one's sessions with sign-out per device; a
  sign-in log;
- sign-in in front of any app: Hata takes over the app's port and lets through only people who are signed
  in to Hata and allowed to open that app — no domain or HTTPS needed, the app's address stays the same. The app's
  other published ports are listed next to it and can be put behind the same sign-in when they are web
  pages too;
- remote access, three ways on one page, each one nothing until its button is pressed: WireGuard for
  your own devices (Hata makes the keys and hands every phone a QR code and every computer a file; a
  device sees the server alone, or the home network when you allow it), WireGuard out to a server of
  yours elsewhere from the configuration it gave, and Tailscale for a home behind a provider's NAT;
- other machines of the house — a PC, a virtual machine, a container with Linux — looked after from
  Hata: one line run there installs a small client that connects to Hata by itself (no port to open on
  the machine, the connection is encrypted end to end even over plain HTTP), and the machine shows its
  state, its Docker containers grouped by compose project (start, stop, restart, logs, a shell inside)
  and a terminal of its own. Its files are in Hata's Files next to the server's: look, edit, upload,
  download, and copy or move folders between the server and the machines. Apps from the store are
  installed onto a machine as onto the server, their tiles are on the home page, and an app moves from
  the server to a machine and back, with its data. Their snapshots are kept on the server with the
  others, in the daily run, and put back from there. A machine is restarted or shut down from Hata,
  and woken up again (Wake-on-LAN). Hata keeps the clients at its own version;
- HTTPS, your choice of three: none (address and ports, for a home network); behind your own proxy (nginx,
  Caddy, Traefik) with a check that the proxy is set up right; or by Hata itself with certificates from
  Let's Encrypt. With a domain, every app has its own address, `<app>.<domain>`;
- notifications: what the home page lists as needing attention also reaches you where you are — on your
  phone or computer (a notification from the browser, when Hata is opened over HTTPS), in Telegram through
  a bot of your own, in an ntfy topic, by mail through your provider's SMTP server or a relay of your own,
  or as a webhook for your own automation. Each problem is told once,
  after it has lasted a minute and a half, in the words of the home page;
- an MCP server for AI agents: an agent that speaks MCP can say why an app is down (state of the
  containers, the tail of the log and the likely causes in one answer), update apps, install from the store,
  take and restore snapshots. It connects with an access key made in the settings, and a key has one of
  three levels — look, operate, everything; no level reaches users, passwords, files or a shell. Secrets in
  compose files are hidden from keys that may not change them, and what an agent did is in the activity log
  under the key's name. A key can be made to ask first: a call that removes an app, restores a snapshot
  or replaces a compose file then waits until an administrator allows it — on Hata's page or from the
  notification. A connector with nowhere to paste a key signs in instead (OAuth): it is given the
  server's address, and an administrator says in Hata what it may do;
- an assistant on every page of Hata, in a window opened from the button in the corner: ask in your own words why an app is down or what fills the disk, and
  it looks with the same tools and acts — what only looks runs at once, every change is shown first
  and waits for "Run". The model is yours to name: the API of a provider you have a key for, or a model
  on your own machine;
- updates of Hata itself from the web UI: a newer release is downloaded, checked against its checksums and
  started; if it does not come up, the previous version is put back by itself. Apps keep running meanwhile.
  The version that ran before can be gone back to with a button, and `sudo hata update` does the same
  from a shell; an app's update can be undone from the activity log, from the snapshot taken right before it;
- the whole history of what happened on the server and who did it, by day, with a search;
- Docker itself is installed by a button where it is missing, and started where it is not running;
- system programs (Settings): every program of the system Hata relies on in one list — Docker, Samba,
  NetworkManager, mergerfs, SnapRAID and the rest — with what it is for, whether it is installed and in
  which version, and the button that installs a missing one or removes one you do not want (not while
  something of Hata's stands on it);
- English and Ukrainian UI, light and dark, phone-friendly.

Not there yet: wildcard certificates (DNS challenge), share links for files, a second copy of the backups
in Google Drive or Box.

## Screenshots

### Pages

| | |
|---|---|
| ![Sign-in](screenshots/signin.png) Sign-in | ![The trash: deleted files are kept for 30 days](screenshots/trash.png) The trash: deleted files are kept for 30 days |
| ![An app's logs](screenshots/app-logs.png) An app's logs | ![An app's compose file](screenshots/app-compose.png) An app's compose file |
| ![An app's snapshots](screenshots/app-backups.png) An app's snapshots | ![A shell inside an app's container](screenshots/app-terminal.png) A shell inside an app's container |
| ![The server's terminal](screenshots/terminal.png) The server's terminal | ![Bringing in containers that already run](screenshots/import.png) Bringing in containers that already run |
| ![Users, who can open what, invitations](screenshots/users.png) Users, who can open what, invitations | ![Inside a snapshot: a file taken out, chosen files and folders put back](screenshots/snapshot-files.png) Inside a snapshot: a file taken out, chosen files and folders put back |
| ![The whole history: what happened on the server and who did it](screenshots/activity.png) The whole history: what happened on the server and who did it | ![An app from the store installed here or on another machine](screenshots/store-install-on.png) An app from the store installed here or on another machine |
| ![The assistant looks first and asks before it changes anything](screenshots/assistant.png) The assistant looks first and asks before it changes anything | ![The assistant's answer once the change is made](screenshots/assistant-done.png) The assistant's answer once the change is made |

### Other machines

| | |
|---|---|
| ![Machines: the other computers of the house](screenshots/machines.png) Machines: the other computers of the house | ![A machine: its state at a glance](screenshots/machine.png) A machine: its state at a glance |
| ![A machine's apps: installed, updated, backed up and moved from here](screenshots/machine-apps.png) A machine's apps: installed, updated, backed up and moved from here | ![A machine's Docker containers](screenshots/machine-containers.png) A machine's Docker containers |
| ![A terminal on the machine](screenshots/machine-terminal.png) A terminal on the machine | ![A machine's files in Files](screenshots/machine-files.png) A machine's files in Files |

### First run

| | | |
|---|---|---|
| ![First run: the server's name and time zone](screenshots/welcome.png) The server's name and time zone | ![First run: where the data lives](screenshots/welcome-data.png) Where the data lives | ![First run: a few apps to start with](screenshots/welcome-apps.png) A few apps to start with |

### Settings

| | |
|---|---|
| ![Account: password, two-factor sign-in, passkeys, sessions](screenshots/settings-account.png) Account: password, two-factor sign-in, passkeys, sessions | ![General](screenshots/settings-general.png) General |
| ![Appearance](screenshots/settings-appearance.png) Appearance | ![Apps: the data and configuration folders](screenshots/settings-apps.png) Apps: the data and configuration folders |
| ![App stores](screenshots/settings-stores.png) App stores | ![Storage: disks, file systems, what fills the data folder](screenshots/settings-storage.png) Storage: disks, file systems, what fills the data folder |
| ![Network folders (SMB)](screenshots/settings-shares.png) Network folders (SMB) | ![HTTPS and domain](screenshots/settings-https.png) HTTPS and domain |
| ![Notifications](screenshots/settings-notifications.png) Notifications | ![Agents: access keys for the MCP server](screenshots/settings-agents.png) Agents: access keys for the MCP server |
| ![About and updates](screenshots/settings-about.png) About and updates | ![Network: interfaces, Wi-Fi, the ways to the internet](screenshots/settings-network.png) Network: interfaces, Wi-Fi, the ways to the internet |
| ![Storage: protection from a disk failure](screenshots/settings-protection.png) Storage: protection from a disk failure | ![Remote access: Tailscale and WireGuard](screenshots/settings-remote.png) Remote access: Tailscale and WireGuard |
| ![The assistant: which model it talks to and what it may do](screenshots/settings-assistant.png) The assistant: which model it talks to and what it may do | ![System programs: what Hata relies on, installed or not](screenshots/settings-tools.png) System programs: what Hata relies on, installed or not |

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
hata restore <folder>   bring the server back from a backup folder: Hata's state, then every app
                        (or from s3://bucket/folder, sftp://user@host/folder — the second copy)
hata unseal <file.enc>  open one file of an encrypted copy of the backups
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
