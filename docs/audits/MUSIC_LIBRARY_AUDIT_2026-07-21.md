# Neon 六境背景音乐库审查 / Neon Six-Realm Music Library Audit

初审 / Initial review: `2026-07-21`  
双曲扩展 / Two-score expansion: `2026-07-26`  
最终叙事重配 / Final narrative remap: `2026-07-29`

## 中文

### 结论与签收边界

最终曲库采用“六境双曲”合同：十二首本地、无人声配乐按旅程顺序分为晨岛、云野、雨林、霞谷、禁阁和伊甸六组，每组恰好两首。最终重配不再按曲名或速度把地图简化成“太空、竞速、危险”标签，而是按六境内涵形成一条连续弧线：

`觉醒与初飞 → 好奇、伙伴与自由飞行 → 脆弱、庇护、失落、道歉与成长 → 自信、技巧、嬉游与旅程高潮 → 记忆回望、敬畏、智慧与静默升阶 → 朝圣、恐惧、牺牲、死亡、释放与重生`

本项目对 `10` 首采用 CC0，对 `Happy flutes, for fantasy setting` 和 `Death Is Just Another Path` 采用 CC-BY 3.0。每首交付文件必须由来源页、作者、采用许可、源文件 SHA-256、交付 SHA-256、时长和离线响度档案共同固定；任一字节替换都必须重新审查、重新测量并生成新的节奏包。

**自动验证不等于玩家听感签收。** 自动化只能证明目录、字节、配置、技术响度和播放路径符合合同；它不能证明场景情绪、长时间疲劳、天气遮蔽、交叉淡化时机或不同设备听感已经被玩家接受。本报告不得把自动测试通过表述为玩家主观认可。

### 审查方法

- **场景内涵先行：** 先定义该境在整段旅程中的精神作用，再选择乐器、速度、密度和动态，而不是从“飞船”“星海”“竞速”等表面词反推音乐。
- **源页证据与项目解释分栏：** 作者、许可、标签与作者正文取自官方作品页；六境叙事是本项目的场景解释，不把推断伪装成作者原意。
- **一境两职：** 槽位 `0` 建立该境核心状态，槽位 `1` 推进或释放同一状态；第二首不能只是更响、更快。
- **为世界声留白：** 所有曲目无人声；雨、雷、风、推进、制动、碰撞和导航提示必须仍可辨认。高能量不等于持续满频或 EDM 节拍。
- **许可可复现：** 页面并列多种许可时明确记录项目采用哪一种；CC-BY 改编件必须署名、链接许可并说明转码与响度调整。

### 六境逐曲语义矩阵

| 区域 / 槽位 | 文件与来源 | 官方源页可支持的语义 | 本项目场景解释 | 明确避开的误读 |
|---|---|---|---|---|
| 晨岛 / `0` | `music_dawn_first_light.ogg` · [First Light Particles](https://opengameart.org/content/first-light-particles-%E2%80%93-cc0-atmospheric-pianoambient-track) · Yoiyami · CC0 | 平静、柔和、内省、略带宇宙感；晨光、觉醒、记忆浮现；无律动、无打击乐。 | 初次醒来和独自辨认世界，以微光而非鼓点开始旅程。 | 英雄登场、胜利号角、科幻推进。 |
| 晨岛 / `1` | `music_dawn_cloudborne_dream.ogg` · [Heavenly Loop](https://opengameart.org/content/heavenly-loop) · isaiah658 · CC0 | 天堂感、梦幻、环境化、无缝循环；不抢注意力而负责建立情绪。 | 从地面独行转向带着勇气的第一次入云，让初飞保持稚嫩和敬畏。 | 宏大终章、强节拍起飞。 |
| 云野 / `0` | `music_prairie_meadow_harp.ogg` · [Meadow Thoughts](https://opengameart.org/content/meadow-thoughts) · Écrivain · CC0 | 草地、篝火、竖琴；正文仅明确独奏竖琴。 | 开阔草地中的好奇和自由漫游不被节拍催赶；自由来自项目场景解释，不归给源曲作者。 | 把“草地”自动等同欢快平台关。 |
| 云野 / `1` | `music_prairie_companion_flutes.ogg` · [Happy flutes, for fantasy setting](https://opengameart.org/content/happy-flutes-for-fantasy-setting) · Magnesus（Tomasz Kucza）· CC-BY 3.0 | 简单活泼的长笛与吉他旋律；快乐、奇幻、巴洛克和中世纪。 | 从独处竖琴转向伙伴相遇、花庭嬉游与结伴共飞，以人的呼吸和弹拨表达轻盈社交。 | 平台游戏循环、EDM drop、派对轰鸣。 |
| 雨林 / `0` | `music_rainforest_shelter.ogg` · [Eye of the Storm](https://opengameart.org/content/eye-of-the-storm) · Joth · CC0 | 循环、平静、悲伤；作者正文仅写明 solo version。 | 雨幕中暂时安静的庇护点，承认疲惫和失落，并给真实降雨声留位。 | 因标题宣称风暴战斗、战争或紧迫。 |
| 雨林 / `1` | `music_rainforest_after_rain.ogg` · [Emotional Deluge](https://opengameart.org/content/emotional-deluge) · Joth · CC0 | 情绪化、缓慢、柔和、温暖；可作角色主题或特定区域音乐。 | 承认失落与受伤，在道歉、互相照亮之后重新成长并继续前行。 | 通关庆功、过甜治愈、压过水声。 |
| 霞谷 / `0` | `music_valley_flight.ogg` · [Determined to Fly](https://opengameart.org/content/determined-to-fly) · OwlishMedia · CC0 | 管弦、民谣、弦乐、高潮、凯尔特；曲名明确飞翔意志。 | 熟练迎风滑翔建立技巧与自信，同时保留身体运动和天空尺度。 | 赛车菜单、太空冒险、持续电子脉冲。 |
| 霞谷 / `1` | `music_valley_crescendo.ogg` · [Fantasy Orchestral Theme](https://opengameart.org/content/fantasy-orchestral-theme) · Joth · CC0 | 旋律性奇幻管弦；由缓慢宁静走向强烈渐强；开场与字幕语义。 | 竞逐不是攻击，而是由嬉游、比试走向共享荣光和整段旅程的高潮。 | 从头到尾最大音量、战斗高潮、廉价胜利 sting。 |
| 禁阁 / `0` | `music_vault_memory_strings.ogg` · [Starlike](https://opengameart.org/content/starlike) · Écrivain · CC0 | 星、银河、弦乐；作者正文仅写 Bowl + Strings。 | 以弦乐与音钵承载祖先记忆、回望反思和面对历史距离的敬畏。 | 把有限源页信息夸成宏大巡航叙事。 |
| 禁阁 / `1` | `music_vault_silent_bells.ogg` · [Ice Shine Bells](https://opengameart.org/content/ice-shine-bells) · hc · CC0 选项 | 平静环境、冰/水晶洞、钟铃；寂静、孤独、空旷、停顿和悲伤。 | 钟声之间的空白让智慧以静默升阶，并在进入伊甸前收束整段回望。 | “星海巡航”、带劲节拍、太空驾驶。 |
| 伊甸 / `0` | `music_eden_last_light.ogg` · [Death Is Just Another Path](https://opengameart.org/content/death-is-just-another-path) · Otto Halmén · CC-BY 3.0 | 较慢、悲伤的管弦；从微小开始并增长到庞大；葬礼、死亡、史诗。 | 克制恐惧不是没有动态，而是把增长留给朝圣、失去和自我交付的重量。 | 恐怖 jump scare、Boss 战、单纯“越危险越吵”。 |
| 伊甸 / `1` | `music_eden_rebirth.ogg` · [Yoiyami Core Theme – Deep Blue Ambient Piano](https://opengameart.org/content/yoiyami-core-theme-%E2%80%93-deep-blue-ambient-piano) · Yoiyami · CC0 | 宁静深蓝情绪；柔和钢琴、温暖低音、空气铺底、吉他回声和尺八式气息；无强律动、内省流动。 | 牺牲之后由呼吸、慈悲和流动完成释放、接纳与重生，重新把旅程交还给光。 | 突然凯旋、片尾流行歌、抹去此前损失。 |

### 许可合同

| 曲目 | 源页许可 | 本项目采用 | 交付要求 |
|---|---|---|---|
| 九首仅列 CC0 的曲目 | CC0 | CC0 | 无强制署名；仍保留标题、作者、源页和哈希以便追溯。 |
| `Ice Shine Bells` | CC-BY 3.0 + CC0 | CC0 | 明确采用 CC0 选项，避免把双许可页错误记录成“只列 CC0”。 |
| `Happy flutes, for fantasy setting` | CC-BY 3.0 | CC-BY 3.0 | Credits 保留 `Tomasz Kucza / magory.games / based on piermic's Improvisation with Sopranino recorder`，链接源页和许可，并说明已转为 Ogg Vorbis 及调整响度。 |
| `Death Is Just Another Path` | CC-BY 3.0 + OGA-BY 3.0 | CC-BY 3.0 | Credits 提及 `Otto Halmén`，链接源页和 CC-BY 3.0，并说明已转为 Ogg Vorbis 及调整响度。 |

[CC0 1.0 摘要与法律文本](https://creativecommons.org/publicdomain/zero/1.0/)；[CC-BY 3.0 许可文本](https://creativecommons.org/licenses/by/3.0/)。

### 响度合同

- 十二首交付 OGG 的离线综合响度目标统一为 `-20 LUFS`，自动合同要求每首真峰值 `<= -2.0dBTP`。当前十二首实测最高值为 `-2.24dBTP`，因此全部严于合同上限。
- 呈现层按境界而非按单曲补偿：晨岛 `-2dB`、云野 `-1dB`、雨林 `-2dB`、霞谷 `0dB`、禁阁 `-3dB`、伊甸 `-1dB`。同境换曲不应由任意音量差制造“第二首更重要”的错觉。
- 单 deck 名义呈现响度分别为晨岛 `-22 LUFS`、云野 `-21`、雨林 `-22`、霞谷 `-20`、禁阁 `-23`、伊甸 `-21`。由 `-2.0dBTP` 合同上限与境界增益推导的单 deck 真峰值上限分别为 `-4 / -3 / -4 / -2 / -5 / -3dBTP`；逐曲实测见下表。
- 母带响度、真峰值、时长和交付 SHA-256 必须来自同一最终文件；下载源 SHA-256 单独保存，用于证明转码链起点，不能替代交付哈希。
- 真峰值合同约束单曲资产与单 deck。双 deck 等功率淡化已经按最坏 `+3dB` 余量验证，估算结果必须 `<= -1.0dBTP`；天气、效果和推进声加入后的整机总线仍需另行签收，自动结果也不替代玩家听感。

### 完整性与响度台账

响度列依次为综合响度 / 真峰值 / 响度范围，测量口径为 `LUFS-I / dBTP / LU`。时长、交付 SHA-256 与下载源 SHA-256 均取自最终曲库记录；交付哈希同时绑定响度和节奏档案。

| 最终文件 | 时长 | `LUFS-I / dBTP / LRA` | 交付 SHA-256 | 下载源 SHA-256 |
|---|---:|---:|---|---|
| `music_dawn_first_light.ogg` | `131.720s` | `-19.97 / -5.77 / 7.50` | `371a78cc69e0fa245a8bbee2a03aaa71d011b4ef08fca778925963dade35edeb` | `f0538a1a67450cc1d5e305fad5bc0d5d422ad809f720d695ab356e55fbe40fc5` |
| `music_dawn_cloudborne_dream.ogg` | `33.652_494s` | `-19.98 / -7.93 / 1.60` | `f1b3402f44af98704cb8fa202d9274f2d3a6551c0fd9142862c79c22be69ebd8` | `a842e9e054019132cacc8fd352e7b31c000ebb51e0b227a2511e1bccb4eb166e` |
| `music_prairie_meadow_harp.ogg` | `149.800s` | `-19.97 / -4.45 / 8.60` | `3ce28c79556d52c3286e888e33fa9d2091282b2003fb51b44142ca6a3c47d439` | `9c55cfadb5acca6ef9ca81bf89d343b13f2b09984d45ae520cf877f1f9ad4404` |
| `music_prairie_companion_flutes.ogg` | `45.400_612s` | `-19.97 / -8.67 / 5.40` | `7cfc9a1a5c49e93862fb7ff51a7e82a403d4d7dfd61b1b75e029aeaed062cb6f` | `40cb712d9b0c1b6ba8c02338f845790252ea19214c3d0777e221a0024b116b7d` |
| `music_rainforest_shelter.ogg` | `46.132_245s` | `-19.96 / -7.33 / 1.10` | `4d39b83c0a3e6d3bb2ac39334ee476e6191813b9a48351d57b8b83e6e0a29642` | `3f25710090659287e3f184a2968af8c965b1480eb6d7665b0a0c43866eb8af85` |
| `music_rainforest_after_rain.ogg` | `40.489_796s` | `-20.00 / -5.27 / 3.20` | `71f82df96cbed501205599dd683cd903fa01a0a41d9626e5b5632ba244c3d391` | `3d688d43dc964af28d3853a9b82053b92334cd505529a898952d73179505818d` |
| `music_valley_flight.ogg` | `70.370s` | `-20.00 / -4.21 / 5.90` | `81f31056de0885e347edfbbb1a9bfe25487748a687256f1cb0d90e0eb01fd3b8` | `ab3de3b142879d41b52cb7fba820d2834bfc77cfeb9cc7d19d97884955e3268f` |
| `music_valley_crescendo.ogg` | `191.700s` | `-20.01 / -5.04 / 9.60` | `4e538b8690bf6a4647c1112b09e6b3318f3186cb604673015a253af53263ca88` | `add1de5eae0771c4ce5b3782a6eae9c01f321d32446421691426587000e50cdc` |
| `music_vault_memory_strings.ogg` | `42.480_907s` | `-20.04 / -7.50 / 7.10` | `339dbae2166c7c8e9cc4c91d22927ce6c00559fc84465745fd80e177a67dd17f` | `6f5d37c866901c8a0ad63425b6919482d5420ac58ab5e0d5cce349f07ad49eb6` |
| `music_vault_silent_bells.ogg` | `280.009_433s` | `-19.97 / -2.24 / 9.20` | `de5b6a4f5d2cfd6fab58a1c5afe84cfe884f416c60bc46bc8c0d25e808a887a3` | `e865d84fe7e0597205d306945debc1fc20e03c06e4b1affb65c0a8e91a932238` |
| `music_eden_last_light.ogg` | `98.700s` | `-19.99 / -3.03 / 17.40` | `b48ac143fa8e7d188b18b12f4e12a1f090015c0246ce1242f11d89388aad81b4` | `a2a7411f7097a37c3683a6b642ab321e41f321a1faf651d18e71239601f9b8da` |
| `music_eden_rebirth.ogg` | `234.960s` | `-20.00 / -8.55 / 10.50` | `344da636656feac8efe783c446c3a8091a34ced6fceb4bc80d072e393ea5c52e` | `613d462f5229568ad98dcbe870036ccdf858f5ae33c63386cace86548809cb60` |

### 播放与自动验证

- `TRACKS_BY_REALM` / `TRACK_IDS_BY_REALM` 是分组权威；兼容的 `TRACK_ID_BY_REALM` 只暴露每境主曲。
- 每境非混合段的前后两章分别选择槽位 `0 / 1`；自然播完只在当前境内轮播，不得落入下一境。
- 只有“自选”循环单曲；“顺序”和“漫游”覆盖全部十二首，“漫游”使用独立 seed/counter，不能改变玩法随机数。
- 两副原生媒体 deck 支持 HTTP(S) 与 `file://`；跨境使用 `1_600ms` 等功率淡化。新曲从零增益进入，旧曲淡出后暂停、移除 `src` 并释放资源。
- `music-rhythm.js` 将最终交付文件解码到 `22_050Hz`，以连续二阶带通滤波生成 `12Hz` 五频段包，再编码为 four-bit / three-byte v2；节奏档案必须绑定交付哈希。
- 自动化应验证每境两首、唯一 URL、不可变对象、无人声、采用许可、来源、源/交付哈希、本地文件、时长、`-20 LUFS`、单轨 `<= -2.0dBTP`、等功率淡化最坏 `+3dB` 后 `<= -1.0dBTP`、境界增益、境内章节、自然轮播、跨境淡化、节奏覆盖、模式持久化、释放与终止幂等。

### 玩家听感签收清单

自动化全部通过之后，仍需玩家在真实场景中确认：

- 晨岛是否保留孤独、觉醒和第一次入云的呼吸，而非像片头胜利曲。
- 云野两首能否从独奏留白自然转向友伴共飞，且没有平台游戏或 EDM 感。
- 雨林音乐是否让雨、雷、积水与庇护空间可听，同时不过度煽情。
- 霞谷渐强是否随飞行与仪式发展，而不是全程轰鸣或赛车菜单。
- 禁阁在高层视角和长时间停留时仍安静、深远，彻底摆脱“星海巡航很带劲”的错位。
- 伊甸是否先克制承载朝圣与牺牲，再以安静释放完成重生，而不是 Boss 战接胜利画面。
- 目标耳机、笔记本扬声器和外放音箱上，音乐与天气、飞船、导航和效果声之间都没有遮蔽或疲劳。

只有玩家在上述场景中完成主观签收，才可写“听感符合场景”；技术报告只能写“自动合同通过”。

## English

### Conclusion and sign-off boundary

The final library follows a two-scores-per-realm contract. Twelve local instrumental/no-lyric scores form six ordered groups for Dawn, Prairie, Rainforest, Valley, Vault, and Eden. The remap no longer reduces realms to surface labels such as space, racing, or danger. It builds one continuous arc:

`awakening and first flight → curiosity, companionship, and free flight → fragility, shelter, loss, apology, and growth → confidence, skill, play, and journey climax → remembering, awe, wisdom, and silent ascent → pilgrimage, fear, sacrifice, death, release, and rebirth`

The project uses CC0 for `10` scores and CC-BY 3.0 for `Happy flutes, for fantasy setting` and `Death Is Just Another Path`. Every delivered score must be pinned by its source page, creator, selected license, source SHA-256, delivered SHA-256, duration, and offline loudness profile. Any byte replacement requires a new review, new measurements, and a regenerated rhythm packet.

**Automated validation is not player listening sign-off.** Automation can prove directory, byte, configuration, technical-loudness, and playback-path contracts. It cannot prove scene emotion, long-session fatigue, weather masking, crossfade timing, device translation, or player acceptance. This report must never translate a passing test into subjective approval.

### Review method

- **Realm meaning first:** define each realm's spiritual duty in the journey before selecting instrumentation, pace, density, and dynamics.
- **Separate evidence from interpretation:** creator, license, tags, and creator copy come from the official source page. Six-realm meaning is the project's scene reading, not a claim made by the composer.
- **Two duties per realm:** slot `0` establishes the core state; slot `1` develops or releases that state. The second score cannot merely be louder or faster.
- **Leave room for the world:** all scores contain no intelligible lyrics. Rain, thunder, wind, propulsion, braking, impact, and navigation cues must remain legible. Energy does not require constant full-spectrum density or an EDM beat.
- **Reproducible licensing:** when a page offers multiple licenses, record the option selected by the project. CC-BY adaptations retain attribution, link the license, and disclose transcoding and loudness changes.

### Six-realm semantic matrix

| Realm / slot | File and source | Official source-page evidence | Project scene reading | Rejected misreading |
|---|---|---|---|---|
| Dawn / `0` | `music_dawn_first_light.ogg` · [First Light Particles](https://opengameart.org/content/first-light-particles-%E2%80%93-cc0-atmospheric-pianoambient-track) · Yoiyami · CC0 | Calm, soft, introspective, slightly cosmic; morning light, awakening, resurfacing memory; no groove or percussion. | The player wakes and first recognizes the world; the journey begins with faint light instead of drums. | Hero entrance, victory fanfare, sci-fi launch. |
| Dawn / `1` | `music_dawn_cloudborne_dream.ogg` · [Heavenly Loop](https://opengameart.org/content/heavenly-loop) · isaiah658 · CC0 | Heavenly, dreamy, ambient, seamless; unobtrusive mood-setting. | Solitary ground travel becomes a courageous first cloud ascent while first flight stays young and reverent. | Grand finale, beat-driven takeoff. |
| Prairie / `0` | `music_prairie_meadow_harp.ogg` · [Meadow Thoughts](https://opengameart.org/content/meadow-thoughts) · Écrivain · CC0 | Meadow, campfire, harp; creator copy only states solo harp. | Open grass lets curiosity and free roaming breathe without a beat rushing exploration. Freedom is a project reading, not a creator claim. | Treating “meadow” as an upbeat platform level. |
| Prairie / `1` | `music_prairie_companion_flutes.ogg` · [Happy flutes, for fantasy setting](https://opengameart.org/content/happy-flutes-for-fantasy-setting) · Magnesus (Tomasz Kucza) · CC-BY 3.0 | Simple lively flute-and-guitar melody; happy, fantasy, Baroque, medieval. | Solo-harp space opens into companionship, flower-court play, and shared flight; breath and plucked strings express light social energy. | Platform loop, EDM drop, party wall of sound. |
| Rainforest / `0` | `music_rainforest_shelter.ogg` · [Eye of the Storm](https://opengameart.org/content/eye-of-the-storm) · Joth · CC0 | Loop, calm, sad; creator copy only states solo version. | A still shelter inside rain acknowledges fatigue and loss while leaving room for real weather. | Inferring battle, war, danger, or urgency from the title. |
| Rainforest / `1` | `music_rainforest_after_rain.ogg` · [Emotional Deluge](https://opengameart.org/content/emotional-deluge) · Joth · CC0 | Emotional, slow, soft, warm; suitable for a character or specific area. | Hurt and loss are acknowledged; apology and shared light make renewed growth possible. | Completion celebration, sugary healing, masking water. |
| Valley / `0` | `music_valley_flight.ogg` · [Determined to Fly](https://opengameart.org/content/determined-to-fly) · OwlishMedia · CC0 | Orchestral, folk, strings, climax, Celtic; flight intent in the title. | Practiced gliding into the wind establishes skill and confidence while preserving body and sky scale. | Racing menu, space adventure, constant electronic pulse. |
| Valley / `1` | `music_valley_crescendo.ogg` · [Fantasy Orchestral Theme](https://opengameart.org/content/fantasy-orchestral-theme) · Joth · CC0 | Melodic fantasy orchestra; slow and serene to intense crescendo; opening/credits use. | Contest is not attack: play and friendly competition grow into shared radiance and the journey climax. | Maximum intensity throughout, battle climax, cheap victory sting. |
| Vault / `0` | `music_vault_memory_strings.ogg` · [Starlike](https://opengameart.org/content/starlike) · Écrivain · CC0 | Star, galaxies, strings; creator copy only states Bowl + Strings. | Bowl and strings carry ancestral memory, reflection, and awe at historical distance. | Inflating sparse source copy into a grand cruise narrative. |
| Vault / `1` | `music_vault_silent_bells.ogg` · [Ice Shine Bells](https://opengameart.org/content/ice-shine-bells) · hc · CC0 option | Calm ambient, icy/crystal cave, bells; silence, solitude, emptiness, pauses, sadness. | Gaps between bells let wisdom ascend in stillness and close the review before Eden. | Energetic star cruise, beat, space driving. |
| Eden / `0` | `music_eden_last_light.ogg` · [Death Is Just Another Path](https://opengameart.org/content/death-is-just-another-path) · Otto Halmén · CC-BY 3.0 | Slower, sadder orchestra; begins small and grows massive; funeral, death, epic. | Restrained fear reserves growth for pilgrimage, loss, and self-giving rather than mere threat. | Jump scare, boss battle, “more danger means louder.” |
| Eden / `1` | `music_eden_rebirth.ogg` · [Yoiyami Core Theme – Deep Blue Ambient Piano](https://opengameart.org/content/yoiyami-core-theme-%E2%80%93-deep-blue-ambient-piano) · Yoiyami · CC0 | Serene deep-blue emotion; soft piano, warm bass, airy pads, guitar echoes, shakuhachi-like breath; no heavy groove, introspective flow. | Breath, compassion, and fluid motion turn sacrifice into release, acceptance, and rebirth, returning the journey to light. | Sudden triumph, pop end credits, erasing prior loss. |

### License contract

| Score | Source-page licenses | Project selection | Delivery requirement |
|---|---|---|---|
| Nine scores whose pages list only CC0 | CC0 | CC0 | Attribution not required; retain title, author, source page, and hashes for provenance. |
| `Ice Shine Bells` | CC-BY 3.0 + CC0 | CC0 | Explicitly select CC0 rather than incorrectly recording the dual-license page as CC0-only. |
| `Happy flutes, for fantasy setting` | CC-BY 3.0 | CC-BY 3.0 | Credits retain `Tomasz Kucza / magory.games / based on piermic's Improvisation with Sopranino recorder`; link source and license; disclose Ogg Vorbis conversion and loudness change. |
| `Death Is Just Another Path` | CC-BY 3.0 + OGA-BY 3.0 | CC-BY 3.0 | Credits mention `Otto Halmén`; link source and CC-BY 3.0; disclose Ogg Vorbis conversion and loudness change. |

[CC0 1.0 summary and legal code](https://creativecommons.org/publicdomain/zero/1.0/); [CC-BY 3.0 license](https://creativecommons.org/licenses/by/3.0/).

### Loudness contract

- All twelve delivered OGG masters target `-20 LUFS` integrated. The automated contract requires every score to remain `<= -2.0dBTP`; the highest current measurement is `-2.24dBTP`, so all twelve are stricter than the ceiling.
- Presentation offsets belong to realms, not individual score compensation: Dawn `-2dB`, Prairie `-1dB`, Rainforest `-2dB`, Valley `0dB`, Vault `-3dB`, and Eden `-1dB`.
- Nominal single-deck presentation loudness is Dawn `-22 LUFS`, Prairie `-21`, Rainforest `-22`, Valley `-20`, Vault `-23`, and Eden `-21`. Combining the `-2.0dBTP` asset ceiling with realm gain yields single-deck ceilings of `-4 / -3 / -4 / -2 / -5 / -3dBTP`; current per-score measurements are listed below.
- Master loudness, true peak, duration, and delivered SHA-256 must describe the same final file. Downloaded-source SHA-256 is stored separately to prove the transcode input and cannot replace the delivered hash.
- The true-peak contract governs an individual asset and one deck. Equal-power two-deck overlap is already checked with a worst-case `+3dB` reserve and must estimate `<= -1.0dBTP`. Whole-bus approval after weather, effects, and propulsion remains separate, and no automated result replaces player listening sign-off.

### Integrity ledger

Loudness entries are integrated loudness / true peak / loudness range in `LUFS-I / dBTP / LU`. Duration, delivered SHA-256, and downloaded-source SHA-256 come from the final catalog; the delivered hash binds both loudness and rhythm evidence.

| Final file | Duration | `LUFS-I / dBTP / LRA` | Delivered SHA-256 | Downloaded-source SHA-256 |
|---|---:|---:|---|---|
| `music_dawn_first_light.ogg` | `131.720s` | `-19.97 / -5.77 / 7.50` | `371a78cc69e0fa245a8bbee2a03aaa71d011b4ef08fca778925963dade35edeb` | `f0538a1a67450cc1d5e305fad5bc0d5d422ad809f720d695ab356e55fbe40fc5` |
| `music_dawn_cloudborne_dream.ogg` | `33.652_494s` | `-19.98 / -7.93 / 1.60` | `f1b3402f44af98704cb8fa202d9274f2d3a6551c0fd9142862c79c22be69ebd8` | `a842e9e054019132cacc8fd352e7b31c000ebb51e0b227a2511e1bccb4eb166e` |
| `music_prairie_meadow_harp.ogg` | `149.800s` | `-19.97 / -4.45 / 8.60` | `3ce28c79556d52c3286e888e33fa9d2091282b2003fb51b44142ca6a3c47d439` | `9c55cfadb5acca6ef9ca81bf89d343b13f2b09984d45ae520cf877f1f9ad4404` |
| `music_prairie_companion_flutes.ogg` | `45.400_612s` | `-19.97 / -8.67 / 5.40` | `7cfc9a1a5c49e93862fb7ff51a7e82a403d4d7dfd61b1b75e029aeaed062cb6f` | `40cb712d9b0c1b6ba8c02338f845790252ea19214c3d0777e221a0024b116b7d` |
| `music_rainforest_shelter.ogg` | `46.132_245s` | `-19.96 / -7.33 / 1.10` | `4d39b83c0a3e6d3bb2ac39334ee476e6191813b9a48351d57b8b83e6e0a29642` | `3f25710090659287e3f184a2968af8c965b1480eb6d7665b0a0c43866eb8af85` |
| `music_rainforest_after_rain.ogg` | `40.489_796s` | `-20.00 / -5.27 / 3.20` | `71f82df96cbed501205599dd683cd903fa01a0a41d9626e5b5632ba244c3d391` | `3d688d43dc964af28d3853a9b82053b92334cd505529a898952d73179505818d` |
| `music_valley_flight.ogg` | `70.370s` | `-20.00 / -4.21 / 5.90` | `81f31056de0885e347edfbbb1a9bfe25487748a687256f1cb0d90e0eb01fd3b8` | `ab3de3b142879d41b52cb7fba820d2834bfc77cfeb9cc7d19d97884955e3268f` |
| `music_valley_crescendo.ogg` | `191.700s` | `-20.01 / -5.04 / 9.60` | `4e538b8690bf6a4647c1112b09e6b3318f3186cb604673015a253af53263ca88` | `add1de5eae0771c4ce5b3782a6eae9c01f321d32446421691426587000e50cdc` |
| `music_vault_memory_strings.ogg` | `42.480_907s` | `-20.04 / -7.50 / 7.10` | `339dbae2166c7c8e9cc4c91d22927ce6c00559fc84465745fd80e177a67dd17f` | `6f5d37c866901c8a0ad63425b6919482d5420ac58ab5e0d5cce349f07ad49eb6` |
| `music_vault_silent_bells.ogg` | `280.009_433s` | `-19.97 / -2.24 / 9.20` | `de5b6a4f5d2cfd6fab58a1c5afe84cfe884f416c60bc46bc8c0d25e808a887a3` | `e865d84fe7e0597205d306945debc1fc20e03c06e4b1affb65c0a8e91a932238` |
| `music_eden_last_light.ogg` | `98.700s` | `-19.99 / -3.03 / 17.40` | `b48ac143fa8e7d188b18b12f4e12a1f090015c0246ce1242f11d89388aad81b4` | `a2a7411f7097a37c3683a6b642ab321e41f321a1faf651d18e71239601f9b8da` |
| `music_eden_rebirth.ogg` | `234.960s` | `-20.00 / -8.55 / 10.50` | `344da636656feac8efe783c446c3a8091a34ced6fceb4bc80d072e393ea5c52e` | `613d462f5229568ad98dcbe870036ccdf858f5ae33c63386cace86548809cb60` |

### Playback and automated validation

- `TRACKS_BY_REALM` and `TRACK_IDS_BY_REALM` are the grouping authority. Compatibility-only `TRACK_ID_BY_REALM` exposes each primary score.
- The first and second chapters of each non-blended realm select slots `0` and `1`. Natural completion rotates only inside the current realm.
- Only Manual loops one score. Sequential and Shuffle cover all twelve; Shuffle owns a private seed/counter and cannot move gameplay RNG.
- Two native-media decks support HTTP(S) and `file://`. Realm changes use a `1_600ms` equal-power crossfade. A retired deck is paused, detached, and released.
- `music-rhythm.js` decodes final delivery files at `22_050Hz`, applies continuous second-order band-pass filters, samples `12Hz` five-band envelopes, and stores four-bit / three-byte v2 packets bound to delivered hashes.
- Automation verifies two scores per realm, unique URLs, immutable records, no intelligible lyrics, selected licenses, provenance, source/delivery hashes, local files, duration, `-20 LUFS`, per-track `<= -2.0dBTP`, worst-case equal-power `+3dB` overlap at `<= -1.0dBTP`, realm gains, journey chapters, in-realm completion, cross-realm fades, rhythm coverage, persistence, release, and terminal idempotence.

### Player listening checklist

After all automation passes, players still need to confirm in context that:

- Dawn preserves solitude, awakening, and the first cloud ascent rather than sounding like a victory intro.
- Prairie moves naturally from solo-harp space into shared flight without platform-game or EDM momentum.
- Rainforest leaves rain, thunder, standing water, and shelter audible without over-scoring emotion.
- Valley's crescendo follows flight and ceremony rather than becoming a constant racing-menu wall.
- Vault remains quiet and deep during high-camera and long-stay play, fully removing the energetic “star cruise” mismatch.
- Eden first carries pilgrimage and sacrifice with restraint, then releases into rebirth without a boss-to-victory cliché.
- On target headphones, laptop speakers, and loudspeakers, music does not mask weather, ship, navigation, or effect cues and does not cause fatigue.

Only an in-context player sign-off supports “the music feels right for the scene.” A technical report may state only “the automated contract passed.”
