# AI Dev Cockpit — Uygulama Planı (Tauri v2)

## Amaç ve ilk kullanım
Unity ile oyun geliştiriyorsun (Unreal sonra eklenecek). Windows ve macOS'ta çalışacak, çok hafif bir masaüstü uygulaması istiyorsun. İçinde şunlar olacak: AI CLI'ların (Claude Code, Codex, Gemini…) çalıştığı birden fazla terminal, gömülü tarayıcı, ajan durum paneli, proje dashboard'u ve basit bir "ikinci beyin" modülü. Önce kişisel kullanım, sonra ekip içi. Modüler olmalı ki yeni özellik eklemek kolay olsun.

İlk kişisel sürümde geliştirici bir Unity projesi seçer, aynı proje kökünde iki terminal açar, birinde ajanla çalışırken diğerinde Git kullanır. Ajan izin istediğinde ilgili panele tek tıkla geçer. Ertesi açılışta panel düzenini bulur ve desteklenen ajan oturumunu sürdürebilir. Bu akış M2'de kullanılabilir olmalı. M3'te Unity hata kaydı aynı çalışma alanına eklenir.

Ön araştırmadaki karşılaştırma adayları cmux, Wave, Paradev, Nimbalyst, Warp, Conductor ve opcode. Ürün kararını belirleyecek ölçüler Windows ve macOS desteği, aynı anda açık terminallerin kaynak tüketimi ve Unity projesinde ajanlar arasında geçiş kolaylığıdır. Piyasada eşdeğer ürün bulunmadığı iddiası ayrıca doğrulama gerektirir.

## Yerel CLI ve kimlik doğrulama (kesin kural)
- **API anahtarı kullanılmaz.** Cockpit yalnızca makinede kurulu CLI'ları (`claude`, `codex`, `gemini`) çalıştırır. Her CLI kendi abonelik girişini kullanır. Girişler `claude` içinde `/login`, `codex login` ve `gemini` ilk açılış akışıyla yapılır.
- **Cockpit kimlik bilgisi saklamaz, okumaz, taşımaz.** Giriş bilgileri CLI'ların kendi klasörlerinde kalır: `~/.claude`, `~/.claude.json`, `~/.codex`, `~/.gemini`. Bu klasörler masaüstü uygulamaları kaldırılırken silinmemelidir, çünkü CLI girişleri, oturum geçmişi ve MCP ayarları (ör. Unity MCP) buradadır.
- **API anahtarı ortam değişkenleri alt süreçlerden çıkarılır.** `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `OPENAI_API_KEY`, `GEMINI_API_KEY` ve `GOOGLE_API_KEY` değişkenleri ajan sürecinin ortamına aktarılmaz. Kullanıcının ortamında bu değişkenler tanımlıysa Cockpit uyarı gösterir. Gerekçe: CLI anahtarı görürse abonelik yerine API faturalamasına geçebilir.
- **Giriş durumu panelde görünür.** Adapter, CLI kurulu mu, sürümü ne ve giriş yapılmış mı sorularını yanıtlar. Giriş yoksa "Giriş yap" eylemi ilgili CLI'nın giriş akışını bir terminal panelinde açar. Cockpit giriş ekranını taklit etmez.
- **Uygulama içi AI özellikleri de CLI üzerinden çalışır.** İleride özet ya da arama gibi bir özellik gerekirse API değil, başsız CLI modu kullanılır: `claude -p --output-format stream-json`, `codex exec --json`.
- Gemini CLI tarafında ücretsiz hesapların Antigravity CLI'ya taşındığı bildirildi (Haziran 2026, doğrulanmadı). Gemini adapter'ı M2'de kurulu araca göre yazılır.

## Seçilen stack
| Katman | Seçim | Neden |
|---|---|---|
| Kabuk | **Tauri 2.12.x**, gömülü tarayıcı için `features=["unstable"]` | Sistem webview'ini kullanır. M0'da iki platformda geçen tam yama sürümü ve ön yüz bağımlılıkları kilit dosyalarına kaydedilir. |
| UI | **Svelte 5 + Vite** | Virtual DOM yok, runtime küçük, sık güncellenen widget'lara uygun. |
| Docking | **dockview** (vanilla core) | Sekme, split ve floating desteği var. Layout `toJSON`/`fromJSON` ile kaydedilip geri yükleniyor. |
| Terminal | **@xterm/xterm 6 + addon-fit**, isteğe bağlı addon-webgl | M0'da uyumlu sürümler kilitlenir. WebGL açılamazsa varsayılan çizici kullanılır. Görünmeyen panelde çizim maliyeti azaltılırken PTY çıktısı işlenmeye devam eder. |
| PTY | **portable-pty** üzerine Rust modülü | Oturumun girdisi, çıktısı, boyutu, çıkış kodu ve süreç temizliği tek yerde yönetilir. |
| IPC | PTY oturumu başına bir `tauri::ipc::Channel`, ham bayt aktarımı | Başlangıç denemesi 8 ms veya 1 KB. M0 ölçümleri paket boyutunu ve aktarımda bekleyen bayt sınırını belirler. |
| Kalıcılık | `tauri-plugin-store` (ayarlar ve layout), `rusqlite` + FTS5 (ikinci beyin indeksi) | Basit tutmak için. Ayarlarda kimlik bilgisi ya da anahtar tutulmaz. |
| Dosya izleme | `notify` + `notify-debouncer-full` | Log takibi ve not vault'u için. |

## Klasör yapısı
Repo konumu: `C:\Users\seko\Desktop\Projeler\Cockpit`. Tek Rust crate ve tek Vite uygulaması olacak.
```
cockpit/
  src/                       # Svelte 5
    core/ module.ts bus.ts settings.ts layout.ts ipc.ts
    modules/
      terminal/  browser/  agents/(adapters/claude|codex|gemini|shell.ts)
      project/(GitStatus, UnityLog, Tasks)  brain/(NoteList, Editor, Search)
  src-tauri/
    capabilities/ main.json   # yerel ana webview etiketine özel izinler
    src/ lib.rs  pty/ hooks/ browser/ project/ brain/   # her biri bir tauri plugin
```

## Çekirdek sözleşmeler (modülerliğin temeli)
**Modül arayüzü (TS):** Yeni bir özellik eklemek için bir modül klasörü açıp registry'ye kaydetmek yetiyor.
```ts
interface CockpitModule {
  id: string; title: string; icon: string;
  createView(el: HTMLElement, ctx: ModuleCtx): { dispose(): void; serialize?(): unknown };
  commands?: { id: string; title: string; run(ctx: ModuleCtx): void }[];
}
// ModuleCtx = { bus, settings, invoke, projectId, paneId, state }
```
- **Rust tarafı:** Her klasör ayrı bir `tauri::plugin::Builder` olur ve `init()` fonksiyonu sunar. Komutlar `plugin:pty|spawn` biçiminde adlandırılır. Plugin'ler aynı crate içinde ortak `State` paylaşabilir; örneğin hook dinleyicisinin token'ı PTY oturumuna eşlemesi bu yolla yapılır. Ön yüze giden her şey event ya da Channel ile gider.
- **Event bus:** Konu adları `modül:olay` biçiminde, örneğin `agent:status`, `pty:exit`, `unity:log`, `brain:changed`. Yoğun PTY çıktısı bus'tan geçmez, Channel'dan gider.
- **Terminal yaşam döngüsü.** Rust tarafında PTY bir oturum kimliğiyle tutulur. Sekme gizleme, taşıma ve görünümün yeniden oluşturulması oturumu sürdürür. Terminali kapatma işlemi oturumu sonlandırır. Layout yalnızca panel türünü, projeyi ve geri yüklenebilir ayarları saklar. Uygulama yeniden açıldığında shell yeni süreçle başlar. Ajan geçmişi sağlayıcının oturum kimliğiyle, kullanıcının “Sürdür” eylemi üzerinden açılır.
- **Ajan başlatma.** Ajanlar doğrudan değil, kullanıcının shell'i üzerinden başlatılır: macOS'ta `$SHELL -l -c`, Windows'ta `pwsh -NoLogo -Command`. Gerekçeler:
  - macOS'ta Finder'dan açılan uygulama shell PATH'ini almaz.
  - Windows'ta `claude` gibi komutlar `.cmd` shim'idir ve `portable-pty` bunları doğrudan başlatamaz.
- **Terminal çıktısı güvenilmez veridir.**
  - OSC 52 pano yazımı varsayılan olarak kapalıdır.
  - OSC 8 linklerinde yalnızca `http` ve `https` kabul edilir; linkler sistem tarayıcısında açılır.
  - OSC 0/2 başlıkları kısaltılıp temizlenir.
  - OSC bildirimlerine hız sınırı konur.
- **Klavye ve pano.**
  - macOS'ta `macOptionIsMeta=false`; Türkçe düzende `@` Option ile yazılır.
  - Windows'ta AltGr kombinasyonları desteklenir.
  - Panoda metin yokken basılan Ctrl+V terminale `\x16` olarak gönderilir. Böylece Claude Code ekran görüntüsünü kendi panodan okur.
  - Panele sürüklenen dosyanın yolu Tauri drag-drop olayından alınıp terminale yazılır.
  - Uygulama kısayolları (Ctrl+W, Ctrl+T, Ctrl+Tab) `attachCustomKeyEventHandler` ile tek bir kurala göre ayrılır. Terminalde kullanılan tuşlar uygulamaya yönlendirilmez.
- **Akış kontrolü.** Ön yüz, xterm'in `write` geri çağrısında işlenen baytları topluca Rust'a bildirir. Üst eşikte Rust PTY okumayı bekletir, alt eşikte sürdürür. Girdi, resize ve kapatma ayrı işlenir. Panel kapanırsa bekleyen okuyucu serbest bırakılır. [xterm.js akış kontrolü](https://xtermjs.org/docs/guides/flowcontrol/)
- **Ajan adapter'ı.** Başlatma, güvenilir durum sinyalleri ve geçmişten sürdürme desteği sağlayıcı bazında tanımlanır.
```ts
interface AgentAdapter {
  id: string;
  launch(options: LaunchOptions): CommandSpec;
  prepareHooks?(session: SessionContext): Promise<HookRegistration>;
  resume?(cwd: string, providerSessionId: string): CommandSpec;
  onSignal?(signal: AgentSignal): AgentState | undefined;
}
```
- **Ajan durumu.** Süreç çıkışı `exited` durumuna geçirir. Aktif oturumda adapter önce doğrulanmış hook olayını, ardından anlamı o CLI sürümünde sınanmış terminal sinyalini kullanır. Claude için ilk eşlemeler `UserPromptSubmit → working`, `PermissionRequest → needs_input`, `Stop → idle`. Genel bildirimler alt türüne göre yorumlanır. Gemini için `BeforeAgent` ve `AfterAgent`, Codex için kurulu sürümün desteklediği ve etkinleştirilmiş hook'lar denenir. Her sağlayıcı için sınanan CLI sürümü ve gözlenen geçişler kaydedilir. [Claude Code](https://code.claude.com/docs/en/hooks) · [Codex](https://developers.openai.com/codex/hooks/) · [Gemini CLI](https://geminicli.com/docs/hooks/)
- Çıktı sessiz kaldığında son doğrulanmış durum korunur. Güvenilir sinyal alınmamışsa rozet “Durum bilinmiyor” gösterir. Son çıktı zamanı ayrı gösterilebilir. Tek başına BEL, genel OSC bildirimi ve ilerleme yüzdesi izin isteği sayılmaz.
- **Hook dinleyicisi.** Rust, `127.0.0.1` üzerinde geçici port açar ve her oturuma rastgele token üretir. Token günlüklerden ve layout'tan çıkarılır, oturum kapanınca geçersizleşir. İstek kabul kuralları:
  - Yalnızca `POST` kabul edilir.
  - `Origin` başlığı taşıyan istek reddedilir; bu başlığı tarayıcılar gönderir, hook komutları göndermez.
  - `Host` başlığı birebir `127.0.0.1:<port>` olmalıdır.
  - Gövde en fazla 64 KB olabilir.
  - CORS başlığı döndürülmez.
  - Hook gövdesinde prompt ve araç girdileri bulunur; bunlar günlüğe yazılmaz.
- **Token sınırı.** Token env var ile geçer, bu yüzden ajanın başlattığı her alt süreç onu okuyabilir. Bu yolla en fazla durum rozeti taklit edilebilir. Token'a bundan fazla yetki verilmez.
- **Hook yapılandırması proje reposuna yazılmaz.** Ayar CLI'ya dışarıdan verilir:
  - Claude: `claude --settings <geçici-dosya>`
  - Codex: `codex -c notify=[...]`
  - Gemini: sistem ayar dosyası env var ile gösterilir; değişken adı M2'de doğrulanır.

  Geçici dosyalar uygulama verisinde tutulur. Açılışta bayat kalmış dosyalar silinir. Repoya yazmak kaçınılmazsa önce yedek alınır, birleştirilir ve dosya `.git/info/exclude` içine eklenir. Kurulum kullanılamıyorsa terminal yine açılır ve rozet mevcut sinyalleri kullanır.
- **Kapanış.** Durumu `working` olan bir ajan varken uygulama kapatılırsa onay istenir. Job Object çalışan ajanı dosya yazarken sonlandırabilir.
- **Ayarlar:** `settings.json` sürüm numarası taşır. Layout ayrı bir `layout.json` dosyasında durur. Layout bozulursa varsayılana dönülür, ayarlar kaybolmaz.

## İkinci beyin (basit model, ileride detaylandırılacak)
- **Kaynak düz `.md` dosyaları.** Varsayılan vault klasörü `<proje>/.cockpit/brain/`, ayarlardan global bir klasör de seçilebilir. Front-matter içinde `tags: [..]` tutulur, notlar `[[not-adı]]` ile birbirine bağlanır. Vault Obsidian ile de açılabilir.
- **İndeks.** Her vault için uygulama verisi altında ayrı bir `brain.db` tutulur. Not anahtarı vault'a göre göreli yoldur. Not, FTS5 kaydı ve giden bağlantılar tek işlemde güncellenir. Başlangıç taraması uygulama kapalıyken yapılan silme ve taşımaları da işler.
- **Eşzamanlı düzenleme.** Editör kaydetmeden önce diskteki sürümü karşılaştırır. Ajan açık notu değiştirmişse kullanıcı iki metni de görebilir ve kendi taslağını ayrı kaydedebilir. Önizlemede ham HTML kapalıdır. Uzak görseller yüklenmez.
- **Yol güvenliği.** `[[...]]` bağlantıları ve dosya yolları canonicalize edilir. Vault dışına çıkan yol (`../`, symlink) reddedilir.
- **Ekip fazı kararı.** Vault'un git'e girip girmeyeceği ekip fazından önce netleşir. Notlar ajanlar tarafından okunduğu için dışarıdan kopyalanan metin prompt injection kaynağı olabilir.
- **Ajanların erişimi.** Ajanlar Markdown dosyalarını doğrudan kullanır. Proje sahibi isterse ilgili `CLAUDE.md` veya `AGENTS.md` dosyasına vault yolunu ekler. Aynı dosyada ikinci bir yönlendirme oluşturulması önlenir.
- **Sonra eklenecekler:** `brain.search`/`brain.write` sunan küçük bir MCP sunucusu, ardından embedding desteği.
- **Arayüz:** Not listesi, FTS araması, düz editör artı önizleme, backlink listesi.

## Kilometre taşları
**M0: Spike, risk azaltma (her iki işletim sisteminde).** Bir xterm paneli portable-pty üzerinden shell çalıştıracak, bir child webview de bir URL açacak.
- Kabul kriterleri:
  - Shell ve Claude etkileşimli açılır. Windows'ta imleç konumu sorgusu (`ESC[6n`) ilk çıktı sırasında da yanıt alır. Girdi köprüsü önceden hazırlanır, PTY yazıcısı hazır olana kadar ilk yanıtlar sırada tutulur. Pencere boyutundaki değişiklik PTY'ye iletilir.
  - Finder'dan ya da Başlat menüsünden açılan uygulamada `claude`, `codex` ve `gemini` bulunur. macOS'ta PATH sorunu, Windows'ta `.cmd` shim sorunu yaşanmaz. Alt sürecin ortamında API anahtarı değişkeni yoktur.
  - Türkçe klavye: `ğüşıöçİ`, `@` ve `#` iki işletim sisteminde de doğru yazılır (macOS'ta Option, Windows'ta AltGr). Panodaki ekran görüntüsü Ctrl+V ile Claude Code'a ulaşır.
  - Tarayıcı paneli pencere yeniden boyutlandırılırken ve farklı ekran ölçekleri arasında taşınırken hizasını korur. Windows'ta webview oluşturma asenkron komut üzerinden sınanır. [Tauri WebviewBuilder](https://docs.rs/tauri/latest/tauri/webview/struct.WebviewBuilder.html)
  - Uygulama normal kapanınca ve zorla sonlandırılınca Cockpit'in başlattığı shell, ajan ve deneme alt sürecinin PID'leri kontrol edilir. Windows'ta kapanışta süreçleri sonlandıran Job Object, macOS'ta süreç grubu ve ana uygulamanın kaybını algılayan bir gözetici denenir.
  - Sıra numaralı satırlarla 50 MB çıktı üretilir. Test, xterm'in işlediği son sıra numarasını ve akış boyunca sıra bütünlüğünü izler. Ayrı bir kesintisiz çıktı denemesinde Ctrl+C yanıtı için ilk hedef 500 ms'dir. Bir panel yük altındayken diğer panel klavye girdisi alır.
  - Yerel ana arayüz ve harici sayfa için M3'teki yetki testi geçer. Ayrı pencere seçeneği de aynı teste tabidir. Gömülü görünüm iki platformdan birinde hizalama, odak veya yetki testini geçemezse o platformda ayrı pencereyle M1'e ilerlenir. Yetki testi orada da başarısızsa bağlantı sistem tarayıcısında açılır.

**M1: İskelet.** dockview, modül registry'si, ayarlar ve layout kalıcılığı, N tane terminal paneli, shell profilleri.
- Kabul kriterleri:
  - 12 panel açık kalabiliyor.
  - Uygulama yeniden başlayınca layout geri geliyor.
  - Bozuk bir layout dosyası varsayılana dönüyor.
  - Ctrl+W, Ctrl+T ve Ctrl+Tab kısayollarının çakışması çözülmüş; terminalde kullanılan tuşlar uygulamaya kaçmıyor.
  - OSC 52 kapalı. Bir OSC 8 `file://` linki açılmıyor.
  - Çalışan bir ajan varken kapatma onay soruyor.
  - Windows'ta altı boş shell ve tek görünür terminalle hedef 250 MB altıdır. Release derlemede 60 saniye beklenir. Uygulama ve ona ait WebView2 süreçlerinin özel çalışma kümeleri toplanır, shell ve ajan tüketimi ayrıca raporlanır. 12 panel kapasitesi ayrı sınanır.

**M2: Ajanlar.** Claude, Codex ve Gemini adapter'ları, hook dinleyicisi, OSC parser, durum paneli ve sidebar rozetleri, OS bildirimi, resume desteği.
- Kabul kriterleri:
  - Sağlayıcıdan doğrulanmış olay geldikten sonra rozet en geç 1 saniye içinde güncellenir. En az 10 saniye çıktı üretmeyen aktif bir işlem “boşta” görünmez. Hook kapalıyken, CLI kurulu değilken ve süreç çıktığında kullanıcı doğru durumu görür.
  - Yanlış token 403 alıyor. `Origin` başlıklı ya da yanlış `Host` başlıklı istek ve 64 KB'yi aşan gövde reddediliyor. Gömülü tarayıcıdan atılan istek işleyiciye ulaşmıyor.
  - Bir ajan oturumu açılıp kapatıldıktan sonra `git status` temiz. Uygulama çöktükten sonraki açılışta bayat hook dosyaları siliniyor.
  - Giriş durumu doğru görünüyor: kurulu değil, giriş yok, hazır. "Giriş yap" eylemi CLI'nın kendi giriş akışını açıyor. `ANTHROPIC_API_KEY` tanımlıyken uyarı çıkıyor ve değişken alt sürece geçmiyor.
  - Birinci uçtan uca örnek Claude ile yapılır. Yeniden başlatınca kullanıcı aynı projede önceki sağlayıcı oturumunu sürdürebilir. Codex ve Gemini için kurulu sürümde başlatma, izin, tur sonu ve sürdürme ayrı kaydedilir. Arayüz yalnızca doğrulanan işlemleri sunar.

**M3: Tarayıcı ve proje dashboard'u.** Tarayıcıda URL çubuğu, geri/ileri ve devtools var. Modal açıkken ya da panel sürüklenirken webview gizlenir. Dashboard'da git durumu (`git status --porcelain=v2`), Unity `Editor.log` takibi (hata satırları renkli) ve vault'taki `TASKS.md` görev listesi yer alır.
- Kabul kriterleri:
  - Tarayıcı ayrı bir `data_directory` kullanıyor. Kamera, mikrofon, konum, indirme, `file:` ve `javascript:` varsayılan olarak reddediliyor.
  - Git durumu için yalnızca `.git/index` ve `.git/HEAD` izleniyor; proje kökü recursive izlenmiyor. `git status` debounce ediliyor ve büyük LFS repolarında `--untracked-files=no` ile çalışıyor. Unity içe aktarma yaparken (`Library/`, `Temp/` yoğun yazılırken) CPU sakin kalıyor.
  - Ayrıcalıklı capability yalnızca yerel ana webview'in tam etiketini eşler. Çoklu webview penceresinde pencere etiketiyle toplu izin verilmez. Tarayıcı HTTP(S) adresleriyle sınırlandırılır, yönlendirmeler ve yeni pencere istekleri aynı kurala tabidir.
  - Test derlemesinde ana arayüz zararsız, izin gerektiren bir tanı komutunu çağırabilir. Harici deneme sayfasından aynı işlem reddedilir ve Rust işleyicisine giriş sayacı artmaz. Etkin izin yapılandırması ayrıca PTY, dosya ve süreç komutlarının yalnız ana webview'e açık olduğunu doğrular. [Tauri capability kapsamı](https://v2.tauri.app/reference/acl/capability/) · [Çalışma zamanı yetki kontrolü](https://v2.tauri.app/security/runtime-authority/)
  - Unity yeniden başladığında hem dosyanın kısaltılması hem de yeni dosyayla değiştirilmesi sınanır. Log kaynağı panelde görünür. Varsayılan Editor.log kullanıcıya aittir. Eşzamanlı projeler için oturumun kendi log yolu seçilebilir. TASKS.md, M4 kurulmadan da düz Markdown olarak okunur.
  - `Editor.log` yolu iki işletim sisteminde de doğrulanmış. Windows: `%LOCALAPPDATA%\Unity\Editor\Editor.log`, macOS: `~/Library/Logs/Unity/Editor.log`.

**M4: İkinci beyin.** Vault, indeks, arama ve backlink'ler.
- Kabul kriterleri:
  - Bir ajanın yazdığı not 2 saniye içinde aramada çıkıyor.
  - `brain.db` silinince indeks aynı sonuçlarla yeniden kuruluyor.
  - İki projede aynı adlı not doğru vault'ta bulunur. Dosya yeniden adlandırıldığında eski arama kaydı kalkar. Ajan ve editör aynı notu değiştirdiğinde iki metin de korunur.

**M5: Cilalama ve dağıtım.**
- İçerik:
  - Windows için NSIS ve WebView2 bootstrapper, macOS için universal dmg.
  - Gizli tarayıcı panelinde WebView2 düşük bellek hedefi, desteklenen runtime üzerinde bellek kazancı ve sekmeye dönüş süresi ölçülerek etkinleştirilir.
  - Unity batch build komutu: `Unity -batchmode -quit -projectPath P -executeMethod X -logFile -`. Proje Editor'de açıkken (`Temp/UnityLockfile` var) build başlatılmaz ve kullanıcı uyarılır.
  - unity-mcp (CoplayDev) algılanıyor ve yapılandırılıyor.
  - İsteğe bağlı Git worktree ile ayrı dalda çalışılır. Normal Unity reposunda Git dışında tutulan `Library/` yeni worktree ilk açıldığında yeniden üretilir. Arayüz ilk içe aktarmanın süresini ve ek disk ihtiyacını belirtir. [Git worktree](https://git-scm.com/docs/git-worktree) · [Unity Asset Database](https://docs.unity3d.com/6000.0/Documentation/Manual/AssetDatabase.html)
- Kabul ölçütü Windows çevrimiçi NSIS paketi için 15 MB altıdır. WebView2 indirmesi ayrıca raporlanır ve runtime bulunmayan temiz Windows VM'de kurulum denenir. Universal macOS DMG boyutu ayrı ölçülür ve temiz macOS ortamında ilk açılış doğrulanır. [Tauri Windows dağıtımı](https://v2.tauri.app/distribute/windows-installer/)

**Ekip fazı.** Updater, imzalama ve macOS noter onayı, tauri-action ile CI, eklenti yükleme, Unreal modülü (`Saved/Logs`, RunUAT), Perforce izolasyonu ve telefondan uzak görüntüleme. İmzalama maliyeti dağıtım modeli seçildiğinde hesaplanır. Dinamik eklentiler açılmadan önce hangi yerel yetkilere erişebilecekleri ayrıca tasarlanır.

## Doğrulama
- **Rust unit testleri:**
  - Parçalara bölünmüş chunk'larda OSC parser.
  - Token kontrolü.
  - Log truncate durumu.
  - Tag ve link regex'leri.
  - FTS'nin yeniden kurulması.
  - Hook isteği reddi: `Origin`, `Host`, boyut ve metot kontrolleri.
  - Vault yol kaçışı: `../` ve symlink.
  - Alt süreç ortamından API anahtarı değişkenlerinin çıkarılması.
  - OSC 52/8 filtreleri.
- **Vitest:** Adapter'ların `launch` ve `onSignal` davranışı, sessiz oturum ve süreç çıkışı, layout geri yükleme, ayar sürümü geçişi.
- **İki işletim sisteminde manuel doğrulama.** Her aşamada o ana kadar tamamlanan özellikler yeniden sınanır.
  - 12 panel aç.
  - Yoğun çıktı bas.
  - Uygulamayı öldür ve yetim süreç kalıp kalmadığına bak.
  - Tarayıcı panelinin üstünde modal aç.
  - Unity'yi yeniden başlat.
- **Performans.** Aynı makinede 1, 6 ve 12 panelle boşta RAM ve CPU, yoğun çıktıda Ctrl+C gecikmesi kaydedilir. README'deki sonuçlarda işletim sistemi, webview sürümü, görünür panel sayısı ve derleme profili belirtilir. 250 MB hedefi M1'de tanımlanan Windows senaryosuna aittir.

## Başlıca riskler
1. **Child webview `unstable` API'si.** Minor sürümde bozulabilir. Tauri sürümü birebir sabitlenir, ayrı pencereli fallback hazır tutulur.
2. **ConPTY'nin Windows'a özgü hataları.** Önce Windows'ta test edilir.
3. **CLI hook formatları sık değişiyor.** Adapter testlerinde sürümle birlikte örnek olaylar saklanır. Sinyal kaybolursa terminal kullanılabilir kalır.
4. **Harici içerik ve yerel komutlar.** Tarayıcı eklenirken ve her Tauri yükseltmesinde M3'teki izin testi hem panelde hem ayrı pencere modunda tekrarlanır.
5. **Native webview HTML'in üstünde çizilir.** Menüler altında kalır. Çözüm: modal açıkken ya da sürükleme sırasında webview gizlenir.
6. **Yanlış faturalama.** Ortamda API anahtarı kalırsa CLI abonelik yerine API ile faturalayabilir. Değişkenler alt süreçten çıkarılır ve kullanıcı uyarılır.
7. **CLI giriş verisinin kaybı.** Masaüstü uygulamaları kaldırılırken `~/.claude`, `~/.codex` ve `~/.gemini` silinirse girişler ve oturum geçmişi gider.
8. **Unity proje kilidi ve dosya izleyici fırtınası.** M3 ve M5 kriterleriyle karşılanır.
9. **Windows'ta RAM avantajı sınırlı.** WebView2 çok süreçli çalıştığı için Electron'a göre fark beklenenden küçük olabilir. M0'da ölçülür.
