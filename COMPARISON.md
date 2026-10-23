# How Hata compares

**English** · [Українська](COMPARISON.uk.md)

What the home server programs of Hata's kind have, as of **October 2026**. Versions compared: Hata 0.24,
umbrelOS 2.0, ZimaOS 1.7, CasaOS 0.4.15, Runtipi 4.10, Cosmos 0.23, Unraid 7.3.

Every cell about another product comes from its own documentation, release notes or source code — see
[Sources](#sources). "—" means not built in, as far as those show; an extra app from the product's store
or a plugin is named as such. These products change fast: if a cell is wrong or out of date, please
[open an issue](https://github.com/sanyadez/hata/issues).

## What it is

| | Hata | umbrelOS | ZimaOS | CasaOS | Runtipi | Cosmos | Unraid |
|---|---|---|---|---|---|---|---|
| Kind | one program on your Linux | its own OS | its own OS | a layer on your Linux | a layer on your Linux (containers) | a layer on your Linux, or a container | its own OS |
| Runs on | Linux with systemd, x86-64 and arm64 | Umbrel Home/Pro, x86-64, Raspberry Pi 5, a VM | Zima hardware, x86-64 (UEFI), a VM | Debian, Ubuntu, Raspberry Pi OS; also armv7 | 64-bit Linux | Debian, Ubuntu, Fedora, or Docker | x86-64, boots from USB or a drive |
| Price | free for personal use | free (hardware sold) | free up to 4 disks and 3 members; Plus $29 once | free | free | free; Pro from $16 a month | $49 / $109 / $249 |
| Licence | PolyForm Noncommercial 1.0.0 | PolyForm Noncommercial 1.0.0 | images only, no source licence | Apache-2.0 | GPL-3.0 | Apache-2.0 + Commons Clause | closed (its API is open) |
| Last release | 2026 | 2026 | 2026 | December 2024 | 2026 | 2026 | 2026 |

## People and access

| | Hata | umbrelOS | ZimaOS | CasaOS | Runtipi | Cosmos | Unraid |
|---|---|---|---|---|---|---|---|
| Users | administrators, members, guests; who opens which app; members' folders in Files, read or write | owner and members; shared apps and folders | owner and members; per-folder access | one | one administrator; a guest dashboard | users and administrators; groups in Pro | one administrator; separate users for shares |
| Two-factor sign-in | authenticator app, passkeys; can be required for administrators | authenticator app | — | — | authenticator app | yes | through an OpenID provider of your own |
| Sign-in in front of apps | any app, by its port; no domain needed; the app is told who came in | yes | — | — | per app, with a domain | yes; also an OpenID Connect provider for apps | — |
| HTTPS | Let's Encrypt, or behind your own proxy | its own certificate authority for `.local` names | — (Nginx Proxy Manager from the store) | — | Let's Encrypt (Traefik); self-signed on the home network | Let's Encrypt, wildcard by DNS | Let's Encrypt on myunraid.net, or your own |

## Apps

| | Hata | umbrelOS | ZimaOS | CasaOS | Runtipi | Cosmos | Unraid |
|---|---|---|---|---|---|---|---|
| App format | plain compose file on disk | compose from the store | compose | compose with `x-casaos` | compose with `x-runtipi` | cosmos-compose; compose imported | Docker templates; compose by plugin |
| Changing an app | settings form, or the compose file itself; your changes stay through store updates | folders and variables | settings, or the YAML | settings form | overrides kept apart, they stay through updates | in the page | template form |
| Stores | Hata Store, 200+ apps; other stores by address | 300+ apps; community stores | hundreds of apps; community stores | ~180 apps; other stores | ~270 apps; other stores by Git address | 250+ apps; other sources | Community Applications (plugin), ~4,500 |

## Data

| | Hata | umbrelOS | ZimaOS | CasaOS | Runtipi | Cosmos | Unraid |
|---|---|---|---|---|---|---|---|
| Backups | per app, daily and before every update; single files back; whole server restored by one command | the whole data folder, hourly, encrypted, snapshots browsable | folders between devices on a schedule, with versions | — | per app, on the server; before updates | Restic: encrypted, scheduled, single files back | plugin |
| Copy elsewhere | SFTP, or S3-compatible storage; encrypted before it leaves | external drive, NAS, another Umbrel | Google Drive, Dropbox, OneDrive, the network, USB | — | — | Rclone destinations | configuration only, to its cloud |
| Disk health | SMART in plain words, with the history of the counters | SMART, temperature, wear | yes | SMART pass/fail | — | SMART | SMART |
| Formatting | ext4, exFAT, FAT32, NTFS; partitions; erase | ext4, exFAT (external disks) | yes | ext4 | — | ext4, XFS, NTFS, FAT32, exFAT | XFS, Btrfs, ZFS, ext4, NTFS, exFAT |
| Several disks / a failed disk | mergerfs pool; SnapRAID parity; one wizard sets up both | ZFS mirror or RAIDZ | RAID 0/1/5/6, JBOD | mergerfs pool (beta) | — | MergerFS pool; SnapRAID parity | parity array; ZFS |
| Folders over the network (SMB) | users of Hata, read or write per folder, guests; found in Explorer and Finder by itself; Time Machine | each share for the account that made it | members, read or write; guests | guest shares only | — | yes; also NFS, SFTP, WebDAV | SMB and NFS, per user |
| Mounting network places | SMB, NFS, SFTP, WebDAV, FTP | SMB; files from cloud drives | SMB | SMB; Google Drive, Dropbox | — | Rclone (SMB, SFTP, WebDAV, FTP, S3…) | plugin |
| File manager in the browser | yes, with a trash and archives | yes | yes, with a recycle bin | yes | — | — | yes |

## Network and reach

| | Hata | umbrelOS | ZimaOS | CasaOS | Runtipi | Cosmos | Unraid |
|---|---|---|---|---|---|---|---|
| Remote access | WireGuard (server and client), Tailscale | Tailscale (store app) | its own client app; Tailscale and WireGuard as store apps | — | store apps | Constellation (a Nebula mesh VPN) | WireGuard; Tailscale (plugin) |
| The server's network | addresses (IPv4, IPv6), Wi-Fi, an access point, a spare way to the internet, a closed internet side; every change undone by itself unless confirmed | address, Wi-Fi | address | — | — | — | address, bonding, VLANs, Wi-Fi |

## Beyond one server

| | Hata | umbrelOS | ZimaOS | CasaOS | Runtipi | Cosmos | Unraid |
|---|---|---|---|---|---|---|---|
| Other machines | a small client on any Linux: containers, apps, files, backups, Docker's images and volumes, system updates, moving an app over, Wake-on-LAN | — | switching between Zima devices in its app | — | — | servers linked over Constellation; deploying across them in Pro | Unraid Connect, a cloud dashboard |
| Virtual machines | those of a Proxmox VE server: power, settings, snapshots, backups, clones, console and screen; new ones from cloud images or discs | Windows, Linux, Android | yes | — | — | — | yes (KVM) |
| AI agents (MCP) | MCP with three levels per key, approval of what destroys, OAuth sign-in; an assistant built into the page | MCP, one set of permissions for all its tokens | local AI search; agents as store apps | — | — | — | API; MCP by plugin |
| Phone and desktop apps | — (the page installs as an app, with notifications) | iPhone, Mac; Photos | Windows, macOS, iOS, Android; photos in beta | — | — | Android, Windows, macOS, Linux (beta) | — |
| Notifications | browser push, Telegram, ntfy, mail, webhook | in the page | in the page | in the page | in the page | in the page, mail, webhook | browser, mail, Telegram, Discord, ntfy and more |
| Updating itself | from the page, every step shown, cancel until swapped; put back by itself if the new version fails, a button to go back; stable or pre-releases, at a set time | yes | yes | yes | from the command line | yes | yes, and downgrade |
| Terminal in the browser | the server and each container | the server and each container | containers; the server in developer mode | yes | — | the server and each container | yes |

## What Hata does not have

- A hypervisor of its own: the virtual machines it manages are those of a Proxmox VE server.
- Phone and desktop apps, and a photos app.
- RAID and ZFS: protection from a disk failure is SnapRAID parity over plain disks.
- An OpenID Connect provider for apps: Hata's sign-in stands in front of an app and tells it who came in by
  headers (`Remote-User`), which only apps that read such headers use.
- Years of use: it is young, and verified on a handful of machines.

## Sources

- **umbrelOS**: [README](https://github.com/getumbrel/umbrel/blob/master/README.md),
  [2.0.0 release](https://github.com/getumbrel/umbrel/releases/tag/2.0.0),
  [source](https://github.com/getumbrel/umbrel/tree/master/packages/umbreld/source/modules) (app gateway,
  backups, RAID, Samba, network storage, MCP, notifications), [umbrel.com](https://umbrel.com/umbrelos)
- **ZimaOS**: [repository](https://github.com/IceWhaleTech/ZimaOS),
  [releases](https://github.com/IceWhaleTech/ZimaOS/releases), [product page](https://www.zimaspace.com/zimaos),
  [docs](https://www.zimaspace.com/docs/zimaos/features) (RAID, backup, remote access, Samba, app store, ZVM)
- **CasaOS**: [repository and releases](https://github.com/IceWhaleTech/CasaOS/releases),
  [user service](https://github.com/IceWhaleTech/CasaOS-UserService/blob/main/route/v1/user.go),
  [shares](https://github.com/IceWhaleTech/CasaOS/blob/main/service/shares.go),
  [local storage](https://github.com/IceWhaleTech/CasaOS-LocalStorage/blob/main/service/disk.go),
  [app store](https://github.com/IceWhaleTech/CasaOS-AppStore),
  [security advisories](https://github.com/IceWhaleTech/CasaOS/security/advisories)
- **Runtipi**: [repository](https://github.com/runtipi/runtipi), [architecture](https://runtipi.io/docs/reference/architecture),
  [dynamic compose](https://runtipi.io/docs/reference/dynamic-compose),
  [app customisation](https://runtipi.io/docs/guides/customize-app-config),
  [CLI](https://runtipi.io/docs/reference/using-the-cli), [app store](https://github.com/runtipi/runtipi-appstore)
- **Cosmos**: [docs](https://cosmos-cloud.io/docs/index/) (users, OpenID, domains, backups, storage,
  remote storage, Constellation), [Pro](https://cosmos-cloud.io/pro),
  [licence](https://github.com/azukaar/Cosmos-Server/blob/master/LICENCE),
  [changelog](https://github.com/azukaar/Cosmos-Server/blob/unstable/changelog.md),
  [clients](https://cosmos-cloud.io/clients)
- **Unraid**: [docs](https://docs.unraid.net/) (release notes 7.0–7.3, user management, securing the
  connection, WireGuard, Tailscale, Unraid Connect, updating), [prices](https://account.unraid.net/buy),
  [Community Applications](https://ca.unraid.net/)
