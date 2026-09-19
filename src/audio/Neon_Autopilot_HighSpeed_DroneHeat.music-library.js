/*
 * Neon six-realm narrative score catalog.
 *
 * This module owns immutable presentation metadata and deterministic playlist selection. Realm semantics,
 * licensing, provenance, and mastering offsets are explicit contracts; gameplay state never flows back
 * from this catalog. Display tags are localized copy and are deliberately not used as semantic evidence.
 */
(() => {
  'use strict';

  const THEME_CONTRACT = Object.freeze({
    id: 'sky-six-realm-semantics-v3',
    allowedLicenses: Object.freeze(['CC0-1.0', 'CC-BY-3.0']),
    requiredTrackCount: 12,
    requiredRealmCount: 6,
    minimumTracksPerRealm: 2,
    tracksPerRealm: 2,
    maximumAbsoluteMixGainDb: 3,
    maximumInRealmLoudnessDeltaLu: 0.15,
    masteringContractId: 'ebu-r128-scene-master-v1',
    realmStrategy: 'two-narrative-chapters-per-shared-route-realm',
    selectionAuthority: 'presentation-only',
    auditorySignoff: 'pending-player',
    gameplayWrites: false
  });

  /** Freeze one realm's two narrative chapters and the acoustic limits that protect its actual meaning. */
  function defineRealmContract({
    realmIndex,
    realmName,
    narrative,
    energyRange,
    targetEffectiveLufsRange,
    maximumPercussionDensity,
    chapters
  }) {
    return Object.freeze({
      realmIndex,
      realmName,
      narrative,
      energyRange: Object.freeze([...energyRange]),
      targetEffectiveLufsRange: Object.freeze([...targetEffectiveLufsRange]),
      maximumPercussionDensity,
      chapters: Object.freeze(chapters.map((chapter) => Object.freeze({
        role: chapter.role,
        requiredSemanticTokens: Object.freeze([...chapter.requiredSemanticTokens])
      })))
    });
  }

  const REALM_SCORE_CONTRACTS = Object.freeze({
    'dawn-isle': defineRealmContract({
      realmIndex: 0,
      realmName: '晨岛云海',
      narrative: 'awakening-first-light-and-the-courage-to-fly',
      energyRange: [0.12, 0.32],
      targetEffectiveLufsRange: [-22.2, -21.7],
      maximumPercussionDensity: 0,
      chapters: [
        { role: 'awakening', requiredSemanticTokens: ['awakening', 'solitude', 'first-light'] },
        { role: 'first-flight', requiredSemanticTokens: ['courage', 'first-flight', 'cloud-sea'] }
      ]
    }),
    'prairie-garden': defineRealmContract({
      realmIndex: 1,
      realmName: '云野花庭',
      narrative: 'childlike-curiosity-friendship-and-free-flight',
      energyRange: [0.24, 0.5],
      targetEffectiveLufsRange: [-21.2, -20.7],
      maximumPercussionDensity: 0.15,
      chapters: [
        { role: 'free-roaming', requiredSemanticTokens: ['meadow', 'curiosity', 'freedom'] },
        { role: 'companionship', requiredSemanticTokens: ['companionship', 'play', 'flower-court'] }
      ]
    }),
    'rainforest-glow': defineRealmContract({
      realmIndex: 2,
      realmName: '雨林幽光',
      narrative: 'fragility-shelter-loss-apology-and-growth',
      energyRange: [0.18, 0.4],
      targetEffectiveLufsRange: [-22.2, -21.7],
      maximumPercussionDensity: 0.12,
      chapters: [
        { role: 'seeking-shelter', requiredSemanticTokens: ['exposure', 'shelter', 'guarded-light'] },
        { role: 'growth-after-loss', requiredSemanticTokens: ['loss', 'apology', 'renewed-growth'] }
      ]
    }),
    'twilight-valley': defineRealmContract({
      realmIndex: 3,
      realmName: '霞谷暮光',
      narrative: 'confidence-skill-play-and-a-journey-crescendo',
      energyRange: [0.55, 0.78],
      targetEffectiveLufsRange: [-20.2, -19.7],
      maximumPercussionDensity: 0.65,
      chapters: [
        { role: 'skilled-flight', requiredSemanticTokens: ['flight', 'skill', 'confidence'] },
        { role: 'crescendo', requiredSemanticTokens: ['competition', 'playfulness', 'journey-climax'] }
      ]
    }),
    'star-vault': defineRealmContract({
      realmIndex: 4,
      realmName: '禁阁星穹',
      narrative: 'wisdom-memory-review-awe-and-stillness-before-eden',
      energyRange: [0.1, 0.28],
      targetEffectiveLufsRange: [-23.2, -22.7],
      maximumPercussionDensity: 0.05,
      chapters: [
        { role: 'remembering', requiredSemanticTokens: ['memory', 'reflection', 'awe'] },
        { role: 'silent-ascent', requiredSemanticTokens: ['wisdom', 'ascent', 'stillness'] }
      ]
    }),
    'eden-eye': defineRealmContract({
      realmIndex: 5,
      realmName: '伊甸风眼',
      narrative: 'pilgrimage-fear-sacrifice-death-release-and-rebirth',
      energyRange: [0.32, 0.68],
      targetEffectiveLufsRange: [-21.2, -20.7],
      maximumPercussionDensity: 0.3,
      chapters: [
        { role: 'pilgrimage-and-sacrifice', requiredSemanticTokens: ['pilgrimage', 'fear', 'sacrifice'] },
        { role: 'release-and-rebirth', requiredSemanticTokens: ['release', 'compassion', 'rebirth'] }
      ]
    })
  });

  const PLAY_MODES = Object.freeze({
    adaptive: Object.freeze({ id: 'adaptive', name: '随境', description: '随当前天空与地貌区域自动换曲' }),
    sequential: Object.freeze({ id: 'sequential', name: '顺序', description: '按六区旅程顺序连续播放' }),
    shuffle: Object.freeze({ id: 'shuffle', name: '漫游', description: '以独立音乐序列随机播放且不重复当前曲' }),
    manual: Object.freeze({ id: 'manual', name: '自选', description: '循环玩家亲自选择的主题曲' })
  });

  /** Seal one provenance-rich score so the UI, loudness profile, and semantic validator share one authority. */
  function defineTrack({
    id,
    title,
    sourceTitle,
    author,
    url,
    sourcePage,
    sourceSha256,
    sha256,
    durationSeconds,
    license,
    attribution = '',
    realmIndex,
    realmTrackIndex,
    realmId,
    realmName,
    cueRole,
    icon,
    energy,
    mixGainDb,
    percussionDensity,
    tempoClass,
    instrumentation,
    semanticTokens,
    palette,
    themeTags
  }) {
    return Object.freeze({
      id,
      title,
      sourceTitle,
      author,
      url,
      sourcePage,
      sourceSha256,
      sha256,
      durationSeconds,
      license,
      attribution,
      realmIndex,
      realmTrackIndex,
      realmId,
      realmName,
      cueRole,
      icon,
      energy,
      // All redistributed masters target -20 LUFS; realm gain preserves intentional narrative hierarchy.
      mixGainDb,
      percussionDensity,
      tempoClass,
      instrumentation: Object.freeze([...instrumentation]),
      semanticTokens: Object.freeze([...semanticTokens]),
      palette: Object.freeze([...palette]),
      themeTags: Object.freeze([...themeTags]),
      instrumental: true,
      loopStrategy: 'equal-power-crossfade'
    });
  }

  const TRACKS = Object.freeze([
    defineTrack({
      id: 'dawn-awakening',
      title: '初光苏醒',
      sourceTitle: 'First Light Particles',
      author: 'Yoiyami',
      url: 'assets/audio/music_dawn_first_light.ogg',
      sourcePage: 'https://opengameart.org/content/first-light-particles-%E2%80%93-cc0-atmospheric-pianoambient-track',
      sourceSha256: 'f0538a1a67450cc1d5e305fad5bc0d5d422ad809f720d695ab356e55fbe40fc5',
      sha256: '371a78cc69e0fa245a8bbee2a03aaa71d011b4ef08fca778925963dade35edeb',
      durationSeconds: 131.72,
      license: 'CC0-1.0',
      realmIndex: 0,
      realmTrackIndex: 0,
      realmId: 'dawn-isle',
      realmName: '晨岛云海',
      cueRole: 'awakening',
      icon: '☼',
      energy: 0.18,
      mixGainDb: -2,
      percussionDensity: 0,
      tempoClass: 'free-time',
      instrumentation: ['soft-piano', 'drifting-pads'],
      semanticTokens: ['awakening', 'solitude', 'first-light'],
      palette: ['warm-gold', 'cloud-white', 'sea-glass'],
      themeTags: ['初醒', '孤独', '第一束光']
    }),
    defineTrack({
      id: 'dawn-first-flight',
      title: '云阶初翔',
      sourceTitle: 'Heavenly Loop',
      author: 'isaiah658',
      url: 'assets/audio/music_dawn_cloudborne_dream.ogg',
      sourcePage: 'https://opengameart.org/content/heavenly-loop',
      sourceSha256: 'a842e9e054019132cacc8fd352e7b31c000ebb51e0b227a2511e1bccb4eb166e',
      sha256: 'f1b3402f44af98704cb8fa202d9274f2d3a6551c0fd9142862c79c22be69ebd8',
      durationSeconds: 33.652_494,
      license: 'CC0-1.0',
      realmIndex: 0,
      realmTrackIndex: 1,
      realmId: 'dawn-isle',
      realmName: '晨岛云海',
      cueRole: 'first-flight',
      icon: '☼',
      energy: 0.24,
      mixGainDb: -2,
      percussionDensity: 0,
      tempoClass: 'floating',
      instrumentation: ['celesta', 'ambient-pads'],
      semanticTokens: ['courage', 'first-flight', 'cloud-sea'],
      palette: ['heaven-blue', 'sunrise-gold', 'cloud-white'],
      themeTags: ['勇气', '初次飞行', '云海']
    }),
    defineTrack({
      id: 'prairie-meadow',
      title: '草海听风',
      sourceTitle: 'Meadow Thoughts',
      author: 'Écrivain',
      url: 'assets/audio/music_prairie_meadow_harp.ogg',
      sourcePage: 'https://opengameart.org/content/meadow-thoughts',
      sourceSha256: '9c55cfadb5acca6ef9ca81bf89d343b13f2b09984d45ae520cf877f1f9ad4404',
      sha256: '3ce28c79556d52c3286e888e33fa9d2091282b2003fb51b44142ca6a3c47d439',
      durationSeconds: 149.8,
      license: 'CC0-1.0',
      realmIndex: 1,
      realmTrackIndex: 0,
      realmId: 'prairie-garden',
      realmName: '云野花庭',
      cueRole: 'free-roaming',
      icon: '✿',
      energy: 0.28,
      mixGainDb: -1,
      percussionDensity: 0,
      tempoClass: 'gentle',
      instrumentation: ['solo-harp'],
      semanticTokens: ['meadow', 'curiosity', 'freedom'],
      palette: ['meadow-green', 'sunlit-ivory', 'sky-blue'],
      themeTags: ['草海', '好奇', '自由']
    }),
    defineTrack({
      id: 'prairie-companions',
      title: '花庭相遇',
      sourceTitle: 'Happy flutes, for fantasy setting',
      author: 'Magnesus',
      url: 'assets/audio/music_prairie_companion_flutes.ogg',
      sourcePage: 'https://opengameart.org/content/happy-flutes-for-fantasy-setting',
      sourceSha256: '40cb712d9b0c1b6ba8c02338f845790252ea19214c3d0777e221a0024b116b7d',
      sha256: '7cfc9a1a5c49e93862fb7ff51a7e82a403d4d7dfd61b1b75e029aeaed062cb6f',
      durationSeconds: 45.400_612,
      license: 'CC-BY-3.0',
      attribution: 'Tomasz Kucza / magory.games / based on piermic’s Improvisation with Sopranino recorder — CC BY 3.0',
      realmIndex: 1,
      realmTrackIndex: 1,
      realmId: 'prairie-garden',
      realmName: '云野花庭',
      cueRole: 'companionship',
      icon: '✿',
      energy: 0.44,
      mixGainDb: -1,
      percussionDensity: 0.08,
      tempoClass: 'lighthearted',
      instrumentation: ['wood-flutes', 'light-strings'],
      semanticTokens: ['companionship', 'play', 'flower-court'],
      palette: ['petal-pink', 'meadow-green', 'sunlit-gold'],
      themeTags: ['伙伴', '嬉游', '花庭']
    }),
    defineTrack({
      id: 'rainforest-shelter',
      title: '雨幕寻灯',
      sourceTitle: 'Eye of the Storm',
      author: 'Joth',
      url: 'assets/audio/music_rainforest_shelter.ogg',
      sourcePage: 'https://opengameart.org/content/eye-of-the-storm',
      sourceSha256: '3f25710090659287e3f184a2968af8c965b1480eb6d7665b0a0c43866eb8af85',
      sha256: '4d39b83c0a3e6d3bb2ac39334ee476e6191813b9a48351d57b8b83e6e0a29642',
      durationSeconds: 46.132_245,
      license: 'CC0-1.0',
      realmIndex: 2,
      realmTrackIndex: 0,
      realmId: 'rainforest-glow',
      realmName: '雨林幽光',
      cueRole: 'seeking-shelter',
      icon: '☂',
      energy: 0.32,
      mixGainDb: -2,
      percussionDensity: 0.06,
      tempoClass: 'restrained',
      instrumentation: ['soft-piano', 'low-strings', 'rainlike-texture'],
      semanticTokens: ['exposure', 'shelter', 'guarded-light'],
      palette: ['moss-green', 'rain-blue', 'spirit-cyan'],
      themeTags: ['暴露', '庇护', '守护微光']
    }),
    defineTrack({
      id: 'rainforest-growth',
      title: '雨歇余光',
      sourceTitle: 'Emotional Deluge',
      author: 'Joth',
      url: 'assets/audio/music_rainforest_after_rain.ogg',
      sourcePage: 'https://opengameart.org/content/emotional-deluge',
      sourceSha256: '3d688d43dc964af28d3853a9b82053b92334cd505529a898952d73179505818d',
      sha256: '71f82df96cbed501205599dd683cd903fa01a0a41d9626e5b5632ba244c3d391',
      durationSeconds: 40.489_796,
      license: 'CC0-1.0',
      realmIndex: 2,
      realmTrackIndex: 1,
      realmId: 'rainforest-glow',
      realmName: '雨林幽光',
      cueRole: 'growth-after-loss',
      icon: '☂',
      energy: 0.24,
      mixGainDb: -2,
      percussionDensity: 0,
      tempoClass: 'slow',
      instrumentation: ['warm-piano', 'soft-strings'],
      semanticTokens: ['loss', 'apology', 'renewed-growth'],
      palette: ['deep-moss', 'firefly-cyan', 'rain-shadow'],
      themeTags: ['失落', '道歉', '重新成长']
    }),
    defineTrack({
      id: 'valley-flight',
      title: '乘风竞翔',
      sourceTitle: 'Determined to Fly',
      author: 'OwlishMedia',
      url: 'assets/audio/music_valley_flight.ogg',
      sourcePage: 'https://opengameart.org/content/determined-to-fly',
      sourceSha256: 'ab3de3b142879d41b52cb7fba820d2834bfc77cfeb9cc7d19d97884955e3268f',
      sha256: '81f31056de0885e347edfbbb1a9bfe25487748a687256f1cb0d90e0eb01fd3b8',
      durationSeconds: 70.37,
      license: 'CC0-1.0',
      realmIndex: 3,
      realmTrackIndex: 0,
      realmId: 'twilight-valley',
      realmName: '霞谷暮光',
      cueRole: 'skilled-flight',
      icon: '➤',
      energy: 0.62,
      mixGainDb: 0,
      percussionDensity: 0.42,
      tempoClass: 'driving-orchestral',
      instrumentation: ['strings', 'brass', 'orchestral-percussion'],
      semanticTokens: ['flight', 'skill', 'confidence'],
      palette: ['sunset-red', 'ice-blue', 'race-gold'],
      themeTags: ['飞翔', '技巧', '自信']
    }),
    defineTrack({
      id: 'valley-crescendo',
      title: '霞光回响',
      sourceTitle: 'Fantasy Orchestral Theme',
      author: 'Joth',
      url: 'assets/audio/music_valley_crescendo.ogg',
      sourcePage: 'https://opengameart.org/content/fantasy-orchestral-theme',
      sourceSha256: 'add1de5eae0771c4ce5b3782a6eae9c01f321d32446421691426587000e50cdc',
      sha256: '4e538b8690bf6a4647c1112b09e6b3318f3186cb604673015a253af53263ca88',
      durationSeconds: 191.7,
      license: 'CC0-1.0',
      realmIndex: 3,
      realmTrackIndex: 1,
      realmId: 'twilight-valley',
      realmName: '霞谷暮光',
      cueRole: 'crescendo',
      icon: '➤',
      energy: 0.72,
      mixGainDb: 0,
      percussionDensity: 0.52,
      tempoClass: 'rising-orchestral',
      instrumentation: ['strings', 'woodwinds', 'brass', 'orchestral-percussion'],
      semanticTokens: ['competition', 'playfulness', 'journey-climax'],
      palette: ['sunset-gold', 'racing-red', 'cloud-white'],
      themeTags: ['竞逐', '玩心', '旅程高潮']
    }),
    defineTrack({
      id: 'vault-memories',
      title: '星图旧忆',
      sourceTitle: 'Starlike',
      author: 'Écrivain',
      url: 'assets/audio/music_vault_memory_strings.ogg',
      sourcePage: 'https://opengameart.org/content/starlike',
      sourceSha256: '6f5d37c866901c8a0ad63425b6919482d5420ac58ab5e0d5cce349f07ad49eb6',
      sha256: '339dbae2166c7c8e9cc4c91d22927ce6c00559fc84465745fd80e177a67dd17f',
      durationSeconds: 42.480_907,
      license: 'CC0-1.0',
      realmIndex: 4,
      realmTrackIndex: 0,
      realmId: 'star-vault',
      realmName: '禁阁星穹',
      cueRole: 'remembering',
      icon: '✦',
      energy: 0.22,
      mixGainDb: -3,
      percussionDensity: 0,
      tempoClass: 'contemplative',
      instrumentation: ['soft-strings', 'celestial-pads'],
      semanticTokens: ['memory', 'reflection', 'awe'],
      palette: ['star-violet', 'astral-blue', 'silver-white'],
      themeTags: ['记忆', '回望', '敬畏']
    }),
    defineTrack({
      id: 'vault-stillness',
      title: '静默升阶',
      sourceTitle: 'Ice Shine Bells',
      author: 'hc',
      url: 'assets/audio/music_vault_silent_bells.ogg',
      sourcePage: 'https://opengameart.org/content/ice-shine-bells',
      sourceSha256: 'e865d84fe7e0597205d306945debc1fc20e03c06e4b1affb65c0a8e91a932238',
      sha256: 'de5b6a4f5d2cfd6fab58a1c5afe84cfe884f416c60bc46bc8c0d25e808a887a3',
      durationSeconds: 280.009_433,
      license: 'CC0-1.0',
      realmIndex: 4,
      realmTrackIndex: 1,
      realmId: 'star-vault',
      realmName: '禁阁星穹',
      cueRole: 'silent-ascent',
      icon: '✦',
      energy: 0.14,
      mixGainDb: -3,
      percussionDensity: 0,
      tempoClass: 'suspended',
      instrumentation: ['distant-bells', 'glass-tones', 'ambient-pads'],
      semanticTokens: ['wisdom', 'ascent', 'stillness'],
      palette: ['cosmic-blue', 'nebula-violet', 'starlight-white'],
      themeTags: ['智慧', '升阶', '静默']
    }),
    defineTrack({
      id: 'eden-pilgrimage',
      title: '风眼朝圣',
      sourceTitle: 'Death Is Just Another Path',
      author: 'Otto Halmén',
      url: 'assets/audio/music_eden_last_light.ogg',
      sourcePage: 'https://opengameart.org/content/death-is-just-another-path',
      sourceSha256: 'a2a7411f7097a37c3683a6b642ab321e41f321a1faf651d18e71239601f9b8da',
      sha256: 'b48ac143fa8e7d188b18b12f4e12a1f090015c0246ce1242f11d89388aad81b4',
      durationSeconds: 98.7,
      license: 'CC-BY-3.0',
      attribution: 'Death Is Just Another Path — Otto Halmén — CC BY 3.0 / OGA-BY 3.0',
      realmIndex: 5,
      realmTrackIndex: 0,
      realmId: 'eden-eye',
      realmName: '伊甸风眼',
      cueRole: 'pilgrimage-and-sacrifice',
      icon: 'ϟ',
      energy: 0.62,
      mixGainDb: -1,
      percussionDensity: 0.24,
      tempoClass: 'slow-building-orchestral',
      instrumentation: ['low-strings', 'piano', 'orchestral-ensemble'],
      semanticTokens: ['pilgrimage', 'fear', 'sacrifice'],
      palette: ['ember-red', 'ash-black', 'storm-white'],
      themeTags: ['朝圣', '恐惧', '牺牲']
    }),
    defineTrack({
      id: 'eden-rebirth',
      title: '余烬重生',
      sourceTitle: 'Yoiyami Core Theme – Deep Blue Ambient Piano',
      author: 'Yoiyami',
      url: 'assets/audio/music_eden_rebirth.ogg',
      sourcePage: 'https://opengameart.org/content/yoiyami-core-theme-%E2%80%93-deep-blue-ambient-piano',
      sourceSha256: '613d462f5229568ad98dcbe870036ccdf858f5ae33c63386cace86548809cb60',
      sha256: '344da636656feac8efe783c446c3a8091a34ced6fceb4bc80d072e393ea5c52e',
      durationSeconds: 234.96,
      license: 'CC0-1.0',
      realmIndex: 5,
      realmTrackIndex: 1,
      realmId: 'eden-eye',
      realmName: '伊甸风眼',
      cueRole: 'release-and-rebirth',
      icon: 'ϟ',
      energy: 0.36,
      mixGainDb: -1,
      percussionDensity: 0,
      tempoClass: 'breathing',
      instrumentation: ['ambient-piano', 'breath-flute', 'soft-pads'],
      semanticTokens: ['release', 'compassion', 'rebirth'],
      palette: ['dawn-white', 'ember-gold', 'deep-blue'],
      themeTags: ['释放', '慈悲', '重生']
    })
  ]);

  const TRACK_BY_ID = Object.freeze(Object.fromEntries(TRACKS.map((track) => [track.id, track])));
  const TRACKS_BY_REALM = Object.freeze(Object.fromEntries(
    Object.keys(REALM_SCORE_CONTRACTS).map((realmId) => [
      realmId,
      Object.freeze(TRACKS.filter((track) => track.realmId === realmId))
    ])
  ));
  const REALM_IDS = Object.freeze(Object.keys(TRACKS_BY_REALM));
  const TRACK_IDS_BY_REALM = Object.freeze(Object.fromEntries(
    Object.entries(TRACKS_BY_REALM).map(([realmId, tracks]) => [
      realmId,
      Object.freeze(tracks.map((track) => track.id))
    ])
  ));
  // This singular alias remains read-only compatibility for external diagnostics that expect one primary cue.
  const TRACK_ID_BY_REALM = Object.freeze(Object.fromEntries(
    Object.entries(TRACK_IDS_BY_REALM).map(([realmId, trackIds]) => [realmId, trackIds[0]])
  ));

  /** Resolve an unknown realm or slot to Dawn's first chapter without allowing presentation state to block startup. */
  function trackForRealmIndex(realmIndex, realmTrackIndex = 0) {
    const normalizedRealmIndex = Number.isInteger(realmIndex)
      && realmIndex >= 0
      && realmIndex < THEME_CONTRACT.requiredRealmCount
      ? realmIndex
      : 0;
    const realmTracks = TRACKS_BY_REALM[REALM_IDS[normalizedRealmIndex]];
    const normalizedTrackIndex = Number.isInteger(realmTrackIndex)
      ? ((realmTrackIndex % realmTracks.length) + realmTracks.length) % realmTracks.length
      : 0;
    return realmTracks[normalizedTrackIndex];
  }

  /** Split each realm journey into deterministic narrative chapters so every score has an automatic consumer. */
  function trackForRealmProgress(realmIndex, realmProgress = 0) {
    const realmTracks = TRACKS_BY_REALM[trackForRealmIndex(realmIndex).realmId];
    const progress = Math.max(0, Math.min(0.999_999, Number(realmProgress) || 0));
    return realmTracks[Math.floor(progress * realmTracks.length)];
  }

  /** Advance only inside the current realm pool; Adaptive must never leak a neighboring realm's meaning. */
  function adjacentRealmTrackId(trackId, direction = 1) {
    const current = TRACK_BY_ID[trackId] ?? TRACKS[0];
    const realmTracks = TRACKS_BY_REALM[current.realmId];
    const currentIndex = Math.max(0, realmTracks.findIndex((track) => track.id === current.id));
    const step = Number(direction) < 0 ? -1 : 1;
    return realmTracks[(currentIndex + step + realmTracks.length) % realmTracks.length].id;
  }

  /** Return a neighboring catalog item with wraparound; direction never mutates the catalog. */
  function adjacentTrackId(trackId, direction = 1) {
    const currentIndex = Math.max(0, TRACKS.findIndex((track) => track.id === trackId));
    const step = Number(direction) < 0 ? -1 : 1;
    return TRACKS[(currentIndex + step + TRACKS.length) % TRACKS.length].id;
  }

  /**
   * Pick a deterministic non-repeating item from a music-only seed and counter.
   * The arithmetic remains isolated from gameplay RNG so library actions cannot move spawn sequences.
   */
  function shuffledTrackId(trackId, counter = 0, seed = 0x23_51_4d) {
    const currentIndex = Math.max(0, TRACKS.findIndex((track) => track.id === trackId));
    let hash = (Number(seed) >>> 0) ^ Math.imul((Number(counter) >>> 0) + 1, 0x9e_37_79_b1);
    hash ^= hash >>> 16;
    hash = Math.imul(hash, 0x85_eb_ca_6b) >>> 0;
    const offset = 1 + (hash % (TRACKS.length - 1));
    return TRACKS[(currentIndex + offset) % TRACKS.length].id;
  }

  /** Validate provenance, licensing, and machine-readable scene semantics without consulting runtime state. */
  function validateThemeContract(candidateTracks = TRACKS) {
    const tracks = Array.isArray(candidateTracks) ? candidateTracks : [];
    const trackIds = new Set();
    const urls = new Set();
    const realmIds = new Set();
    const trackCountByRealm = new Map();
    const realmTrackIndexes = new Map();
    const failures = [];
    const semanticFailures = [];
    const licensingFailures = [];

    function fail(bucket, message) {
      bucket.push(message);
      failures.push(message);
    }

    for (const track of tracks) {
      const realmContract = REALM_SCORE_CONTRACTS[track.realmId];
      const chapterContract = realmContract?.chapters[track.realmTrackIndex];
      if (trackIds.has(track.id)) failures.push(`duplicate-track:${track.id}`);
      if (urls.has(track.url)) failures.push(`duplicate-url:${track.id}`);
      if (!THEME_CONTRACT.allowedLicenses.includes(track.license)) {
        fail(licensingFailures, `license:${track.id}`);
      }
      if (track.license !== 'CC0-1.0' && !track.attribution) {
        fail(licensingFailures, `attribution:${track.id}`);
      }
      if (!track.instrumental) fail(semanticFailures, `vocals:${track.id}`);
      if (!realmContract) {
        fail(semanticFailures, `realm:${track.id}`);
      } else {
        if (track.realmIndex !== realmContract.realmIndex || track.realmName !== realmContract.realmName) {
          fail(semanticFailures, `realm-identity:${track.id}`);
        }
        if (!chapterContract || track.cueRole !== chapterContract.role) {
          fail(semanticFailures, `cue-role:${track.id}`);
        } else if (!chapterContract.requiredSemanticTokens.every((token) => track.semanticTokens.includes(token))) {
          fail(semanticFailures, `semantic-tokens:${track.id}`);
        }
        if (!Number.isFinite(track.energy)
          || track.energy < realmContract.energyRange[0]
          || track.energy > realmContract.energyRange[1]) {
          fail(semanticFailures, `energy:${track.id}`);
        }
        if (!Number.isFinite(track.percussionDensity)
          || track.percussionDensity < 0
          || track.percussionDensity > realmContract.maximumPercussionDensity) {
          fail(semanticFailures, `percussion:${track.id}`);
        }
      }
      if (!Array.isArray(track.instrumentation) || track.instrumentation.length < 1) {
        fail(semanticFailures, `instrumentation:${track.id}`);
      }
      if (!Array.isArray(track.themeTags) || track.themeTags.length < 3) failures.push(`theme-tags:${track.id}`);
      if (!Number.isFinite(track.mixGainDb)
        || Math.abs(track.mixGainDb) > THEME_CONTRACT.maximumAbsoluteMixGainDb) {
        failures.push(`mix-gain:${track.id}`);
      }
      if (!/^https:\/\/opengameart\.org\/content\//.test(track.sourcePage)) failures.push(`source:${track.id}`);
      if (!/^[a-f0-9]{64}$/.test(track.sourceSha256)) failures.push(`source-sha256:${track.id}`);
      if (!/^[a-f0-9]{64}$/.test(track.sha256)) failures.push(`sha256:${track.id}`);
      if (!Number.isFinite(track.durationSeconds) || track.durationSeconds < 20) failures.push(`duration:${track.id}`);
      trackIds.add(track.id);
      urls.add(track.url);
      realmIds.add(track.realmId);
      trackCountByRealm.set(track.realmId, (trackCountByRealm.get(track.realmId) || 0) + 1);
      const indexes = realmTrackIndexes.get(track.realmId) || new Set();
      if (indexes.has(track.realmTrackIndex)) failures.push(`duplicate-realm-slot:${track.id}`);
      indexes.add(track.realmTrackIndex);
      realmTrackIndexes.set(track.realmId, indexes);
    }

    if (tracks.length !== THEME_CONTRACT.requiredTrackCount) failures.push('track-count');
    if (realmIds.size !== THEME_CONTRACT.requiredRealmCount) failures.push('realm-count');
    for (const realmId of Object.keys(REALM_SCORE_CONTRACTS)) {
      const count = trackCountByRealm.get(realmId) || 0;
      if (count !== THEME_CONTRACT.tracksPerRealm) failures.push(`realm-track-count:${realmId}`);
      const indexes = [...(realmTrackIndexes.get(realmId) || [])].sort((a, b) => a - b);
      if (indexes.length !== THEME_CONTRACT.tracksPerRealm
        || indexes.some((value, index) => value !== index)) {
        failures.push(`realm-track-slots:${realmId}`);
      }
    }

    return Object.freeze({
      ok: failures.length === 0,
      trackCount: tracks.length,
      realmCount: realmIds.size,
      semanticAligned: semanticFailures.length === 0,
      licensingAligned: licensingFailures.length === 0,
      playerSignoffPending: THEME_CONTRACT.auditorySignoff === 'pending-player',
      failures: Object.freeze(failures)
    });
  }

  window.NeonMusicLibrary = Object.freeze({
    version: 'Neon-music-library-4',
    THEME_CONTRACT,
    REALM_SCORE_CONTRACTS,
    PLAY_MODES,
    TRACKS,
    TRACK_BY_ID,
    TRACKS_BY_REALM,
    REALM_IDS,
    TRACK_IDS_BY_REALM,
    TRACK_ID_BY_REALM,
    trackForRealmIndex,
    trackForRealmProgress,
    adjacentRealmTrackId,
    adjacentTrackId,
    shuffledTrackId,
    validateThemeContract
  });
})();
