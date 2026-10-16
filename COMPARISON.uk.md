# Hata поруч з іншими

[English](COMPARISON.md) · **Українська**

Що мають програми домашнього сервера того ж роду, що й Hata, станом на **жовтень 2026 року**. Порівнюються
версії: Hata 0.18, umbrelOS 2.0, ZimaOS 1.7, CasaOS 0.4.15, Runtipi 4.10, Cosmos 0.23, Unraid 7.3.

Кожна клітинка про інший продукт узята з його власної документації, нотаток до випусків або вихідного
коду — див. [Джерела](#джерела). «—» означає, що вбудованого нема, наскільки з них видно; окремий
застосунок із магазину продукту чи плагін так і названо. Ці продукти швидко змінюються: якщо клітинка
неправильна чи застаріла, будь ласка, [відкрийте issue](https://github.com/sanyadez/hata/issues).

## Що це

| | Hata | umbrelOS | ZimaOS | CasaOS | Runtipi | Cosmos | Unraid |
|---|---|---|---|---|---|---|---|
| Що це | одна програма на вашому Linux | власна ОС | власна ОС | шар над вашим Linux | шар над вашим Linux (контейнери) | шар над вашим Linux або контейнер | власна ОС |
| Де працює | Linux із systemd, x86-64 і arm64 | Umbrel Home/Pro, x86-64, Raspberry Pi 5, віртуалка | залізо Zima, x86-64 (UEFI), віртуалка | Debian, Ubuntu, Raspberry Pi OS; також armv7 | 64-бітний Linux | Debian, Ubuntu, Fedora або Docker | x86-64, завантаження з USB чи диска |
| Ціна | безкоштовно для особистого вжитку | безкоштовно (продають залізо) | безкоштовно до 4 дисків і 3 учасників; Plus — $29 одноразово | безкоштовно | безкоштовно | безкоштовно; Pro — від $16 на місяць | $49 / $109 / $249 |
| Ліцензія | PolyForm Noncommercial 1.0.0 | PolyForm Noncommercial 1.0.0 | лише образи, ліцензії на код нема | Apache-2.0 | GPL-3.0 | Apache-2.0 + Commons Clause | закрита (API відкритий) |
| Останній випуск | 2026 | 2026 | 2026 | грудень 2024 | 2026 | 2026 | 2026 |

## Люди й доступ

| | Hata | umbrelOS | ZimaOS | CasaOS | Runtipi | Cosmos | Unraid |
|---|---|---|---|---|---|---|---|
| Користувачі | адміністратори, учасники, гості; хто який застосунок відкриває | власник і учасники; спільні застосунки й теки | власник і учасники; доступ до кожної теки | один | один адміністратор; гостьова панель | користувачі й адміністратори; групи в Pro | один адміністратор; окремі користувачі для спільних тек |
| Двофакторний вхід | застосунок-автентифікатор, passkey; можна зробити обов'язковим для адміністраторів | застосунок-автентифікатор | — | — | застосунок-автентифікатор | так | через власного провайдера OpenID |
| Вхід перед застосунками | будь-який застосунок, за його портом; домен не потрібен | так | — | — | для кожного застосунку, з доменом | так; також провайдер OpenID Connect для застосунків | — |
| HTTPS | Let's Encrypt або за вашим власним проксі | власний центр сертифікації для імен `.local` | — (Nginx Proxy Manager із магазину) | — | Let's Encrypt (Traefik); самопідписаний у домашній мережі | Let's Encrypt, wildcard через DNS | Let's Encrypt на myunraid.net або власний |

## Застосунки

| | Hata | umbrelOS | ZimaOS | CasaOS | Runtipi | Cosmos | Unraid |
|---|---|---|---|---|---|---|---|
| Формат застосунку | звичайний compose-файл на диску | compose із магазину | compose | compose з `x-casaos` | compose з `x-runtipi` | cosmos-compose; імпорт compose | шаблони Docker; compose — плагіном |
| Зміна застосунку | форма налаштувань або сам compose-файл; ваші зміни лишаються після оновлень із магазину | теки й змінні | налаштування або YAML | форма налаштувань | окремі доповнення, лишаються після оновлень | на сторінці | форма шаблону |
| Магазини | Hata Store, 200+ застосунків; інші магазини за адресою | 300+ застосунків; магазини спільноти | сотні застосунків; магазини спільноти | ~180 застосунків; інші магазини | ~270 застосунків; інші магазини за адресою Git | 250+ застосунків; інші джерела | Community Applications (плагін), ~4 500 |

## Дані

| | Hata | umbrelOS | ZimaOS | CasaOS | Runtipi | Cosmos | Unraid |
|---|---|---|---|---|---|---|---|
| Резервні копії | кожного застосунку, щодня й перед кожним оновленням; окремі файли назад; увесь сервер відновлюється однією командою | уся тека даних, щогодини, шифровано, знімки можна переглядати | теки між пристроями за розкладом, із версіями | — | кожного застосунку, на самому сервері; перед оновленнями | Restic: шифровано, за розкладом, окремі файли назад | плагін |
| Копія деінде | SFTP або S3-сумісне сховище; шифрується до відправлення | зовнішній диск, NAS, інший Umbrel | Google Drive, Dropbox, OneDrive, мережа, USB | — | — | місця Rclone | лише конфігурація, у їхню хмару |
| Здоров'я дисків | SMART простими словами, з історією лічильників | SMART, температура, знос | так | SMART: справний / ні | — | SMART | SMART |
| Форматування | ext4, exFAT, FAT32, NTFS; розділи; стирання | ext4, exFAT (зовнішні диски) | так | ext4 | — | ext4, XFS, NTFS, FAT32, exFAT | XFS, Btrfs, ZFS, ext4, NTFS, exFAT |
| Кілька дисків / відмова диска | об'єднання mergerfs; парність SnapRAID | дзеркало ZFS або RAIDZ | RAID 0/1/5/6, JBOD | об'єднання mergerfs (бета) | — | об'єднання MergerFS; парність SnapRAID | масив із парністю; ZFS |
| Теки в мережі (SMB) | користувачі Hata, читання чи запис для кожної теки, гості; сервер сам видно в Провіднику й Finder | кожна тека — для облікового запису, що її створив | учасники, читання чи запис; гості | лише гостьові теки | — | так; також NFS, SFTP, WebDAV | SMB і NFS, для кожного користувача |
| Підключення мережевих місць | SMB, NFS, SFTP, WebDAV, FTP | SMB; файли з хмарних дисків | SMB | SMB; Google Drive, Dropbox | — | Rclone (SMB, SFTP, WebDAV, FTP, S3…) | плагін |
| Файловий менеджер у браузері | так, із кошиком і архівами | так | так, із кошиком | так | — | — | так |

## Мережа й доступ здалеку

| | Hata | umbrelOS | ZimaOS | CasaOS | Runtipi | Cosmos | Unraid |
|---|---|---|---|---|---|---|---|
| Доступ здалеку | WireGuard (сервер і клієнт), Tailscale | Tailscale (застосунок із магазину) | власна програма-клієнт; Tailscale і WireGuard як застосунки з магазину | — | застосунки з магазину | Constellation (mesh-VPN на Nebula) | WireGuard; Tailscale (плагін) |
| Мережа сервера | адреси (IPv4, IPv6), Wi-Fi, точка доступу, запасний шлях до інтернету, закритий бік інтернету; кожна зміна сама скасовується, якщо її не підтвердити | адреса, Wi-Fi | адреса | — | — | — | адреса, об'єднання портів, VLAN, Wi-Fi |

## Більше, ніж один сервер

| | Hata | umbrelOS | ZimaOS | CasaOS | Runtipi | Cosmos | Unraid |
|---|---|---|---|---|---|---|---|
| Інші машини | легкий клієнт на будь-якому Linux: контейнери, застосунки, файли, резервні копії, перенесення застосунку, Wake-on-LAN | — | перемикання між пристроями Zima у своїй програмі | — | — | сервери, з'єднані через Constellation; розгортання на них — у Pro | Unraid Connect, хмарна панель |
| Віртуальні машини | — | Windows, Linux, Android | так | — | — | — | так (KVM) |
| ШІ-агенти (MCP) | MCP із трьома рівнями для кожного ключа, дозвіл на руйнівні дії, вхід через OAuth; помічник, вбудований у сторінку | MCP, один набір дозволів для всіх токенів | локальний ШІ-пошук; агенти як застосунки з магазину | — | — | — | API; MCP — плагіном |
| Програми для телефона й комп'ютера | — (сторінка встановлюється як застосунок, зі сповіщеннями) | iPhone, Mac; Photos | Windows, macOS, iOS, Android; фото в беті | — | — | Android, Windows, macOS, Linux (бета) | — |
| Сповіщення | push у браузері, Telegram, ntfy, пошта, вебхук | на сторінці | на сторінці | на сторінці | на сторінці | на сторінці, пошта, вебхук | браузер, пошта, Telegram, Discord, ntfy та інші |
| Самооновлення | зі сторінки; сама повертається, якщо нова версія не запрацювала, кнопка повернення назад | так | так | так | з командного рядка | так | так, і повернення назад |
| Термінал у браузері | сервер і кожен контейнер | сервер і кожен контейнер | контейнери; сервер — у режимі розробника | так | — | сервер і кожен контейнер | так |

## Чого в Hata нема

- Віртуальних машин.
- Програм для телефона й комп'ютера та застосунку для фото.
- RAID і ZFS: захист від відмови диска — це парність SnapRAID над звичайними дисками.
- Провайдера OpenID Connect для застосунків: вхід Hata стоїть перед застосунком, а сам застосунок не
  знає, хто зайшов.
- Років використання: вона молода й перевірена на кількох машинах.

## Джерела

- **umbrelOS**: [README](https://github.com/getumbrel/umbrel/blob/master/README.md),
  [випуск 2.0.0](https://github.com/getumbrel/umbrel/releases/tag/2.0.0),
  [код](https://github.com/getumbrel/umbrel/tree/master/packages/umbreld/source/modules) (app gateway,
  backups, RAID, Samba, network storage, MCP, notifications), [umbrel.com](https://umbrel.com/umbrelos)
- **ZimaOS**: [репозиторій](https://github.com/IceWhaleTech/ZimaOS),
  [випуски](https://github.com/IceWhaleTech/ZimaOS/releases), [сторінка продукту](https://www.zimaspace.com/zimaos),
  [документація](https://www.zimaspace.com/docs/zimaos/features) (RAID, резервні копії, доступ здалеку,
  Samba, магазин, ZVM)
- **CasaOS**: [репозиторій і випуски](https://github.com/IceWhaleTech/CasaOS/releases),
  [служба користувачів](https://github.com/IceWhaleTech/CasaOS-UserService/blob/main/route/v1/user.go),
  [спільні теки](https://github.com/IceWhaleTech/CasaOS/blob/main/service/shares.go),
  [локальне сховище](https://github.com/IceWhaleTech/CasaOS-LocalStorage/blob/main/service/disk.go),
  [магазин](https://github.com/IceWhaleTech/CasaOS-AppStore),
  [повідомлення про вразливості](https://github.com/IceWhaleTech/CasaOS/security/advisories)
- **Runtipi**: [репозиторій](https://github.com/runtipi/runtipi), [архітектура](https://runtipi.io/docs/reference/architecture),
  [dynamic compose](https://runtipi.io/docs/reference/dynamic-compose),
  [налаштування застосунків](https://runtipi.io/docs/guides/customize-app-config),
  [CLI](https://runtipi.io/docs/reference/using-the-cli), [магазин](https://github.com/runtipi/runtipi-appstore)
- **Cosmos**: [документація](https://cosmos-cloud.io/docs/index/) (користувачі, OpenID, домени, резервні
  копії, сховище, віддалене сховище, Constellation), [Pro](https://cosmos-cloud.io/pro),
  [ліцензія](https://github.com/azukaar/Cosmos-Server/blob/master/LICENCE),
  [журнал змін](https://github.com/azukaar/Cosmos-Server/blob/unstable/changelog.md),
  [клієнти](https://cosmos-cloud.io/clients)
- **Unraid**: [документація](https://docs.unraid.net/) (нотатки до випусків 7.0–7.3, керування
  користувачами, захист з'єднання, WireGuard, Tailscale, Unraid Connect, оновлення),
  [ціни](https://account.unraid.net/buy), [Community Applications](https://ca.unraid.net/)
