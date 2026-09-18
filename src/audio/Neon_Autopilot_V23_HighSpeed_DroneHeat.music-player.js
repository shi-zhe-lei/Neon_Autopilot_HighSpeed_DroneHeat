/*
 * V23 background-music library transport.
 *
 * Native media remains the audible authority for both HTTP(S) and direct file launches. Two short-lived
 * decks provide equal-power crossfades, while source-derived rhythm profiles follow each deck's currentTime
 * without rerouting audio. No media exists before explicit play intent.
 * Realm selection is presentation-only and never consumes gameplay RNG.
 */
(() => {
  'use strict';

  const library = window.NeonV23MusicLibrary;
  if (!library) throw new Error('V23 music library dependency missing');
  const rhythm = window.NeonV23MusicRhythm;
  if (!rhythm) throw new Error('V23 music rhythm dependency missing');

  const MODE_STORAGE_KEY = 'cc-v23-music-mode';
  const TRACK_STORAGE_KEY = 'cc-v23-music-track';
  const DEFAULT_CROSSFADE_MS = 1_600;
  const DEFAULT_GAMEPLAY_MUSIC_GAIN = 0.17;
  const DEFAULT_SHUFFLE_SEED = 0x23_51_4d;
  const MUSIC_METER_BANDS_HZ = rhythm.BAND_RANGES_HZ;
  const VALID_MODE_IDS = new Set(Object.keys(library.PLAY_MODES));
  const DEFAULT_CLOCK = Object.freeze({
    now: () => (typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now()
      : Date.now())
  });

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
  }

  /** Convert catalog mastering offsets once per deck so frame-time fades stay allocation-free. */
  function decibelsToLinearGain(decibels) {
    return Math.pow(10, Number(decibels) / 20);
  }

  /** Use a native media element so the exact same local track path works under HTTP and file protocols. */
  function defaultMediaElementFactory(url) {
    if (typeof window.Audio === 'function') return new window.Audio(url);
    if (typeof document.createElement !== 'function') return null;
    const element = document.createElement('audio');
    element.src = url;
    return element;
  }

  function createController(options = {}) {
    const clock = options.clock ?? DEFAULT_CLOCK;
    if (typeof clock.now !== 'function') throw new TypeError('Music clock must provide now()');
    const mediaElementFactory = options.mediaElementFactory ?? defaultMediaElementFactory;
    const crossfadeMs = Math.max(250, Number(options.crossfadeMs) || DEFAULT_CROSSFADE_MS);
    const shuffleSeed = Number(options.shuffleSeed ?? DEFAULT_SHUFFLE_SEED) >>> 0;
    let storage = options.storage ?? null;
    let storageError = null;
    if (!storage && !Object.prototype.hasOwnProperty.call(options, 'storage')) {
      try {
        storage = window.localStorage;
      } catch (error) {
        storageError = error;
        console.warn('[V23 music] Browser storage is unavailable; session choices remain available.', error);
      }
    }

    let storedMode = null;
    let storedTrackId = null;
    try {
      storedMode = storage?.getItem?.(MODE_STORAGE_KEY) ?? null;
      storedTrackId = storage?.getItem?.(TRACK_STORAGE_KEY) ?? null;
    } catch (error) {
      storageError = error;
      console.warn('[V23 music] Unable to read persisted library choices.', error);
    }

    let enabled = options.enabled !== false;
    let disposed = false;
    let unlocked = false;
    let visible = document.visibilityState !== 'hidden';
    let modeId = VALID_MODE_IDS.has(storedMode) ? storedMode : library.PLAY_MODES.adaptive.id;
    let selectedTrackId = library.TRACK_BY_ID[storedTrackId] ? storedTrackId : library.TRACKS[0].id;
    let realmIndex = 0;
    let realmProgress = 0;
    let realmTrackIndex = 0;
    let realmChapterIndex = 0;
    let desiredTrackId = modeId === library.PLAY_MODES.adaptive.id
      ? library.trackForRealmProgress(realmIndex, realmProgress).id
      : selectedTrackId;
    let currentTrackId = null;
    let activeDeck = null;
    let requestGeneration = 0;
    let shuffleCounter = 0;
    let baseGain = 0;
    let lastGameplayGain = DEFAULT_GAMEPLAY_MUSIC_GAIN;
    let previewing = false;
    let meterLastSampleAt = clock.now();
    const meterBands = new Float32Array(MUSIC_METER_BANDS_HZ.length);
    const meterTargets = new Float32Array(MUSIC_METER_BANDS_HZ.length);
    const profileScratch = new Float32Array(MUSIC_METER_BANDS_HZ.length);
    const decks = new Set();
    const listeners = new Set();
    const loadedTrackIds = new Set();
    const failedTrackIds = new Set();

    const themeValidation = library.validateThemeContract();
    const rhythmValidation = rhythm.validateProfiles();
    const diagnostics = {
      supported: typeof mediaElementFactory === 'function',
      enabled,
      disposed,
      unlocked,
      status: 'unrequested',
      transport: 'html-media-crossfade',
      modeId,
      currentTrackId,
      desiredTrackId,
      selectedTrackId,
      currentTitle: null,
      currentRealmId: null,
      realmIndex,
      realmProgress,
      realmTrackIndex,
      realmChapterIndex,
      themeContractId: library.THEME_CONTRACT.id,
      themeAligned: themeValidation.ok && rhythmValidation.ok,
      semanticContractId: library.THEME_CONTRACT.id,
      semanticAligned: themeValidation.semanticAligned,
      licensingAligned: themeValidation.licensingAligned,
      loudnessContractId: rhythm.LOUDNESS_CONTRACT.id,
      loudnessAligned: rhythmValidation.loudnessAligned,
      playerSignoffPending: themeValidation.playerSignoffPending,
      trackCount: library.TRACKS.length,
      crossfadeMs,
      activeDeckCount: 0,
      loadedTrackIds: [],
      failedTrackIds: [],
      unlockAttemptCount: 0,
      unlockSuccessCount: 0,
      switchCount: 0,
      automaticSwitchCount: 0,
      manualSwitchCount: 0,
      sequentialAdvanceCount: 0,
      shuffleAdvanceCount: 0,
      active: false,
      audible: false,
      previewing,
      baseGain: 0,
      activeDeckVolume: 0,
      activeTrackMixGainDb: 0,
      activeTrackLinearGain: 1,
      activeTrackIntegratedLufs: null,
      activeTrackEffectiveLufs: null,
      activeTrackTruePeakDbtp: null,
      activeTrackCrossfadeWorstCaseDbtp: null,
      activeMediaCurrentTime: 0,
      activeMediaPaused: true,
      analysisSupported: rhythmValidation.ok,
      analysisStatus: rhythmValidation.ok ? 'profile-ready' : 'profile-error',
      analysisTransport: 'precomputed-five-band-envelope',
      analysisContextState: 'not-required',
      analysisLive: false,
      rhythmEnergy: 0,
      spectrumBands: Array(MUSIC_METER_BANDS_HZ.length).fill(0),
      analysisError: rhythmValidation.ok ? null : rhythmValidation.failures.join(','),
      lastReason: 'none',
      lastError: storageError ? String(storageError.message || storageError) : null
    };

    /** Publish a stable read-only-shaped diagnostic record without exposing writable deck objects. */
    function snapshot() {
      const currentTrack = library.TRACK_BY_ID[currentTrackId] ?? null;
      const currentProfile = currentTrack ? rhythm.PROFILE_BY_TRACK_ID[currentTrack.id] ?? null : null;
      diagnostics.enabled = enabled;
      diagnostics.disposed = disposed;
      diagnostics.unlocked = unlocked;
      diagnostics.modeId = modeId;
      diagnostics.currentTrackId = currentTrackId;
      diagnostics.desiredTrackId = desiredTrackId;
      diagnostics.selectedTrackId = selectedTrackId;
      diagnostics.currentTitle = currentTrack?.title ?? null;
      diagnostics.currentRealmId = currentTrack?.realmId ?? null;
      diagnostics.realmIndex = realmIndex;
      diagnostics.realmProgress = realmProgress;
      diagnostics.realmTrackIndex = realmTrackIndex;
      diagnostics.realmChapterIndex = realmChapterIndex;
      diagnostics.activeDeckCount = decks.size;
      diagnostics.loadedTrackIds = [...loadedTrackIds];
      diagnostics.failedTrackIds = [...failedTrackIds];
      diagnostics.active = Boolean(activeDeck && !activeDeck.element.paused && !activeDeck.element.ended);
      let crossfadeDeckAudible = false;
      for (const deck of decks) {
        if (!deck.element.paused && !deck.element.ended && deck.fade > 0 && deck.outputVolume > 0) {
          crossfadeDeckAudible = true;
          break;
        }
      }
      diagnostics.audible = Boolean(enabled && visible && baseGain > 0 && crossfadeDeckAudible);
      diagnostics.previewing = previewing;
      diagnostics.baseGain = baseGain;
      diagnostics.activeDeckVolume = Number(activeDeck?.outputVolume) || 0;
      diagnostics.activeTrackMixGainDb = Number(activeDeck?.mixGainDb) || 0;
      diagnostics.activeTrackLinearGain = Number(activeDeck?.mixGainLinear) || 1;
      diagnostics.activeTrackIntegratedLufs = currentProfile?.integratedLufs ?? null;
      diagnostics.activeTrackEffectiveLufs = currentProfile
        ? currentProfile.integratedLufs + currentTrack.mixGainDb
        : null;
      diagnostics.activeTrackTruePeakDbtp = currentProfile?.truePeakDbtp ?? null;
      diagnostics.activeTrackCrossfadeWorstCaseDbtp = currentProfile
        ? currentProfile.truePeakDbtp
          + currentTrack.mixGainDb
          + rhythm.LOUDNESS_CONTRACT.equalPowerCrossfadeReserveDb
        : null;
      diagnostics.activeMediaCurrentTime = Number(activeDeck?.element.currentTime) || 0;
      diagnostics.activeMediaPaused = activeDeck ? Boolean(activeDeck.element.paused) : true;
      diagnostics.analysisContextState = 'not-required';
      diagnostics.spectrumBands = Array.from(meterBands);
      return diagnostics;
    }

    function emit() {
      const current = snapshot();
      for (const listener of listeners) listener(current);
    }

    function persist(key, value) {
      try {
        storage?.setItem?.(key, value);
      } catch (error) {
        diagnostics.lastError = String(error.message || error);
        console.warn('[V23 music] Unable to persist a library choice.', error);
      }
    }

    /** Keep audible gain exclusively on the native element; rhythm sampling is timeline-only. */
    function applyDeckOutput(deck, requestedVolume) {
      if (!deck) return;
      const outputVolume = enabled && visible ? clamp(requestedVolume, 0, 1) : 0;
      deck.outputVolume = outputVolume;
      deck.element.volume = outputVolume;
    }

    /** Remove one retired deck and release its decoder and network resources. */
    function releaseDeck(deck) {
      if (!deck || !decks.has(deck)) return;
      deck.element.onended = null;
      deck.element.onerror = null;
      applyDeckOutput(deck, 0);
      deck.element.pause();
      deck.element.volume = 0;
      deck.element.removeAttribute?.('src');
      deck.element.load?.();
      decks.delete(deck);
      if (activeDeck === deck) activeDeck = null;
    }

    /** Evaluate an equal-power gain lane so two overlapping tracks retain nearly constant perceived energy. */
    function updateDeckFade(deck, nowMs) {
      const progress = clamp((nowMs - deck.fadeStartedAt) / crossfadeMs, 0, 1);
      deck.fade = Math.sqrt(
        (1 - progress) * deck.fadeFrom * deck.fadeFrom
        + progress * deck.fadeTo * deck.fadeTo
      );
      applyDeckOutput(deck, baseGain * deck.fade * deck.mixGainLinear);
      if (progress >= 1 && deck.fadeTo === 0) releaseDeck(deck);
    }

    function beginFade(deck, target, nowMs) {
      updateDeckFade(deck, nowMs);
      deck.fadeFrom = deck.fade;
      deck.fadeTo = clamp(target, 0, 1);
      deck.fadeStartedAt = nowMs;
    }

    function recordFailure(trackId, error) {
      if (disposed) return false;
      const blocked = error?.name === 'NotAllowedError';
      diagnostics.status = blocked ? 'blocked' : 'error';
      diagnostics.lastError = String(error?.message || error || 'Background music playback failed');
      diagnostics.lastReason = `failure:${trackId}`;
      if (!blocked) failedTrackIds.add(trackId);
      if (blocked) unlocked = false;
      console.warn(`[V23 music] Unable to play ${trackId}; the selected theme remains pending.`, error);
      emit();
      return false;
    }

    /** Record one failed deck exactly once and release its media resource before exposing the error state. */
    function failDeck(deck, error) {
      if (!deck || deck.failureRecorded) return false;
      deck.failureRecorded = true;
      const trackId = deck.trackId;
      releaseDeck(deck);
      return recordFailure(trackId, error);
    }

    /** Commit a successfully playing deck, then retire the prior one through the shared render-time crossfade. */
    function activateDeck(deck, reason) {
      if (disposed || !decks.has(deck) || deck.requestGeneration !== requestGeneration) {
        releaseDeck(deck);
        return false;
      }
      const nowMs = clock.now();
      const wasUnlocked = unlocked;
      if (activeDeck && activeDeck !== deck) beginFade(activeDeck, 0, nowMs);
      activeDeck = deck;
      beginFade(deck, 1, nowMs);
      currentTrackId = deck.trackId;
      realmTrackIndex = library.TRACK_BY_ID[deck.trackId]?.realmTrackIndex ?? realmTrackIndex;
      unlocked = true;
      loadedTrackIds.add(deck.trackId);
      diagnostics.status = 'ready';
      diagnostics.lastError = null;
      diagnostics.lastReason = reason;
      if (!wasUnlocked) diagnostics.unlockSuccessCount++;
      diagnostics.switchCount++;
      if (reason === 'realm' || reason.startsWith('realm-')) diagnostics.automaticSwitchCount++;
      else if (reason.startsWith('manual')) diagnostics.manualSwitchCount++;
      emit();
      return true;
    }

    function handleTrackEnded(deck) {
      if (disposed || deck !== activeDeck) return;
      if (modeId === library.PLAY_MODES.manual.id) return;
      let nextTrackId;
      if (modeId === library.PLAY_MODES.adaptive.id) {
        nextTrackId = library.adjacentRealmTrackId(deck.trackId, 1);
        realmTrackIndex = library.TRACK_BY_ID[nextTrackId].realmTrackIndex;
      } else if (modeId === library.PLAY_MODES.shuffle.id) {
        shuffleCounter++;
        diagnostics.shuffleAdvanceCount++;
        nextTrackId = library.shuffledTrackId(deck.trackId, shuffleCounter, shuffleSeed);
      } else {
        diagnostics.sequentialAdvanceCount++;
        nextTrackId = library.adjacentTrackId(deck.trackId, 1);
      }
      desiredTrackId = nextTrackId;
      requestPlayback(
        nextTrackId,
        false,
        modeId === library.PLAY_MODES.adaptive.id ? 'realm-rotate' : 'ended'
      );
    }

    /** Blend playing decks by equal-power fade, then smooth the exact score timeline for readable rhythm. */
    function getVisualization() {
      const nowMs = clock.now();
      const frameUnits = clamp((nowMs - meterLastSampleAt) / (1_000 / 60), 0.25, 4);
      meterLastSampleAt = nowMs;
      const current = snapshot();
      meterTargets.fill(0);
      let totalWeight = 0;
      if (current.audible && rhythmValidation.ok) {
        for (const deck of decks) {
          if (deck.element.paused || deck.element.ended || deck.fade <= 0) continue;
          profileScratch.fill(0);
          if (!rhythm.sampleInto(deck.trackId, Number(deck.element.currentTime) || 0, profileScratch)) continue;
          // Meter blending follows the same power contribution as the audible per-track mastering lane.
          const weight = deck.fade * deck.fade * deck.mixGainLinear * deck.mixGainLinear;
          for (let index = 0; index < meterTargets.length; index++) {
            meterTargets[index] += profileScratch[index] * weight;
          }
          totalWeight += weight;
        }
      }
      const sampling = totalWeight > 0;
      if (sampling) {
        for (let index = 0; index < meterTargets.length; index++) meterTargets[index] /= totalWeight;
      }
      let energyTotal = 0;
      for (let index = 0; index < meterBands.length; index++) {
        const target = sampling ? meterTargets[index] : 0;
        const response = target > meterBands[index]
          ? 1 - Math.pow(0.22, frameUnits)
          : 1 - Math.pow(0.74, frameUnits);
        meterBands[index] += (target - meterBands[index]) * response;
        energyTotal += meterBands[index];
      }
      diagnostics.analysisLive = sampling;
      diagnostics.analysisStatus = sampling
        ? 'profile-live'
        : rhythmValidation.ok ? 'profile-ready' : 'profile-error';
      diagnostics.rhythmEnergy = energyTotal / meterBands.length;
      diagnostics.spectrumBands = Array.from(meterBands);
      return {
        supported: diagnostics.analysisSupported,
        status: diagnostics.analysisStatus,
        live: sampling,
        energy: diagnostics.rhythmEnergy,
        bands: [...diagnostics.spectrumBands]
      };
    }

    function createDeck(track, generation) {
      const element = mediaElementFactory(track.url);
      if (!element) throw new Error(`Music element factory returned no element for ${track.id}`);
      element.preload = 'auto';
      element.playsInline = true;
      // Adaptive must reach every track in the current realm pool; only an explicit manual choice loops forever.
      element.loop = modeId === library.PLAY_MODES.manual.id;
      element.volume = 0;
      const deck = {
        trackId: track.id,
        element,
        requestGeneration: generation,
        fade: 0,
        fadeFrom: 0,
        fadeTo: 0,
        fadeStartedAt: clock.now(),
        outputVolume: 0,
        mixGainDb: track.mixGainDb,
        mixGainLinear: decibelsToLinearGain(track.mixGainDb),
        failureRecorded: false
      };
      element.onended = () => handleTrackEnded(deck);
      element.onerror = () => failDeck(deck, element.error || new Error(`Media error for ${track.id}`));
      decks.add(deck);
      return deck;
    }

    /**
     * Start playback before returning from the trusted event call stack; promise settlement only commits the deck.
     * Later automatic realm switches are allowed after the controller has already been user-unlocked once.
     */
    function requestPlayback(trackId, trusted = false, reason = 'manual') {
      if (disposed || !enabled || !diagnostics.supported) return Promise.resolve(false);
      const track = library.TRACK_BY_ID[trackId];
      if (!track) throw new RangeError(`Unknown music track ${trackId}.`);
      desiredTrackId = track.id;
      diagnostics.desiredTrackId = desiredTrackId;
      diagnostics.lastReason = reason;
      if (!trusted && !unlocked) {
        emit();
        return Promise.resolve(false);
      }
      if (activeDeck?.trackId === track.id) {
        activeDeck.element.loop = modeId === library.PLAY_MODES.manual.id;
        if (!activeDeck.element.paused) {
          emit();
          return Promise.resolve(true);
        }
      }

      diagnostics.unlockAttemptCount++;
      diagnostics.status = 'loading';
      const generation = ++requestGeneration;
      let deck;
      try {
        deck = activeDeck?.trackId === track.id ? activeDeck : createDeck(track, generation);
        deck.requestGeneration = generation;
        const playResult = deck.element.play();
        return Promise.resolve(playResult)
          .then(() => activateDeck(deck, reason))
          .catch((error) => failDeck(deck, error));
      } catch (error) {
        return Promise.resolve(deck ? failDeck(deck, error) : recordFailure(track.id, error));
      }
    }

    /** Explicit trusted intent unlocks the pending track; merely opening the library does not allocate media. */
    function unlock(reason = 'manual', trusted = false) {
      if (!trusted) return Promise.resolve(false);
      return requestPlayback(desiredTrackId, true, reason);
    }

    function setMode(nextModeId, metadata = {}) {
      if (!VALID_MODE_IDS.has(nextModeId)) throw new RangeError(`Unknown music mode ${nextModeId}.`);
      if (disposed) return Promise.resolve(false);
      modeId = nextModeId;
      persist(MODE_STORAGE_KEY, modeId);
      if (modeId === library.PLAY_MODES.adaptive.id) {
        const realmTrack = library.trackForRealmProgress(realmIndex, realmProgress);
        realmTrackIndex = realmTrack.realmTrackIndex;
        realmChapterIndex = realmTrack.realmTrackIndex;
        desiredTrackId = realmTrack.id;
      }
      else if (modeId === library.PLAY_MODES.manual.id) desiredTrackId = selectedTrackId;
      if (activeDeck) activeDeck.element.loop = modeId === library.PLAY_MODES.manual.id;
      emit();
      return requestPlayback(desiredTrackId, Boolean(metadata.trusted), metadata.reason || `mode:${modeId}`);
    }

    function selectTrack(trackId, metadata = {}) {
      if (!library.TRACK_BY_ID[trackId]) throw new RangeError(`Unknown music track ${trackId}.`);
      if (disposed) return Promise.resolve(false);
      selectedTrackId = trackId;
      desiredTrackId = trackId;
      modeId = library.PLAY_MODES.manual.id;
      persist(TRACK_STORAGE_KEY, selectedTrackId);
      persist(MODE_STORAGE_KEY, modeId);
      emit();
      return requestPlayback(trackId, Boolean(metadata.trusted), metadata.reason || 'manual:select');
    }

    function step(direction, metadata = {}) {
      const basis = currentTrackId || desiredTrackId || selectedTrackId;
      const nextId = library.adjacentTrackId(basis, direction);
      return selectTrack(nextId, {
        ...metadata,
        reason: metadata.reason || (Number(direction) < 0 ? 'manual:previous' : 'manual:next')
      });
    }

    function setEnabled(nextEnabled, metadata = {}) {
      if (disposed) return Promise.resolve(false);
      enabled = Boolean(nextEnabled);
      if (!enabled) {
        unlocked = false;
        for (const deck of decks) {
          applyDeckOutput(deck, 0);
          deck.element.pause();
        }
        diagnostics.status = 'paused';
        emit();
        return Promise.resolve(false);
      }
      emit();
      return metadata.trusted
        ? unlock(metadata.reason || 'master-toggle', true)
        : Promise.resolve(true);
    }

    /** Consume read-only presentation state and advance fades; this method has no gameplay return channel. */
    function update(input = {}) {
      if (disposed) return false;
      const previousAudible = diagnostics.audible;
      const previousPreviewing = diagnostics.previewing;
      const previousBaseGain = diagnostics.baseGain;
      const nextRealmIndex = Number.isInteger(input.realmIndex) ? input.realmIndex : realmIndex;
      const nextRealmProgress = clamp(Number(input.realmProgress) || 0, 0, 0.999_999);
      const nextRealmTrack = library.trackForRealmProgress(nextRealmIndex, nextRealmProgress);
      const realmChanged = nextRealmIndex !== realmIndex;
      const realmTrackChanged = nextRealmTrack.realmTrackIndex !== realmChapterIndex;
      realmProgress = nextRealmProgress;
      if (realmChanged || realmTrackChanged) {
        realmIndex = nextRealmIndex;
        realmChapterIndex = nextRealmTrack.realmTrackIndex;
        realmTrackIndex = nextRealmTrack.realmTrackIndex;
        if (modeId === library.PLAY_MODES.adaptive.id) {
          const realmTrackId = nextRealmTrack.id;
          if (realmTrackId !== desiredTrackId) {
            desiredTrackId = realmTrackId;
            requestPlayback(realmTrackId, false, realmChanged ? 'realm' : 'realm-chapter');
          }
        }
      } else {
        realmIndex = nextRealmIndex;
      }
      previewing = Boolean(input.previewing);
      const inputGain = clamp(Number(input.musicGain) || 0, 0, 1);
      if (inputGain > 0) lastGameplayGain = inputGain;
      // A paused or preflight library preview reuses the last real flight mix (or its idle baseline). It must not
      // introduce a separate audition loudness that makes development listening differ from the delivered scene.
      baseGain = previewing && inputGain === 0 ? lastGameplayGain : inputGain;
      const nowMs = clock.now();
      for (const deck of [...decks]) updateDeckFade(deck, nowMs);
      const current = snapshot();
      if (
        current.audible !== previousAudible
        || current.previewing !== previousPreviewing
        || Math.abs(current.baseGain - previousBaseGain) >= 0.01
      ) {
        for (const listener of listeners) listener(current);
      }
      return true;
    }

    function onTrustedInteraction(event) {
      if (disposed || !enabled || unlocked) return;
      if (!window.NeonV23Audio?.shouldUnlockForInteraction?.(event)) return;
      const target = typeof Element === 'function' && event.target instanceof Element ? event.target : null;
      if (target?.closest('#audioBtn')) return;
      unlock(event.type, true);
    }

    function onVisibilityChange() {
      if (disposed) return;
      visible = document.visibilityState !== 'hidden';
      for (const deck of decks) applyDeckOutput(deck, baseGain * deck.fade * deck.mixGainLinear);
      emit();
    }

    document.addEventListener('pointerdown', onTrustedInteraction, true);
    document.addEventListener('keydown', onTrustedInteraction, true);
    document.addEventListener('click', onTrustedInteraction, true);
    document.addEventListener('visibilitychange', onVisibilityChange);

    function subscribe(listener) {
      if (typeof listener !== 'function') return () => {};
      if (disposed) {
        listener(snapshot());
        return () => {};
      }
      listeners.add(listener);
      listener(snapshot());
      return () => listeners.delete(listener);
    }

    function destroy() {
      if (disposed) return Promise.resolve(true);
      disposed = true;
      enabled = false;
      unlocked = false;
      diagnostics.disposed = true;
      diagnostics.enabled = false;
      diagnostics.status = 'destroyed';
      document.removeEventListener('pointerdown', onTrustedInteraction, true);
      document.removeEventListener('keydown', onTrustedInteraction, true);
      document.removeEventListener('click', onTrustedInteraction, true);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      for (const deck of [...decks]) releaseDeck(deck);
      meterBands.fill(0);
      meterTargets.fill(0);
      diagnostics.analysisLive = false;
      diagnostics.rhythmEnergy = 0;
      emit();
      listeners.clear();
      return Promise.resolve(true);
    }

    return Object.freeze({
      get enabled() { return enabled; },
      get supported() { return diagnostics.supported; },
      getDiagnostics: snapshot,
      unlock,
      setEnabled,
      setMode,
      selectTrack,
      previous: (metadata) => step(-1, metadata),
      next: (metadata) => step(1, metadata),
      update,
      getVisualization,
      subscribe,
      destroy
    });
  }

  window.NeonV23MusicPlayer = Object.freeze({
    version: 'V23-music-player-8',
    MODE_STORAGE_KEY,
    TRACK_STORAGE_KEY,
    DEFAULT_CROSSFADE_MS,
    createController
  });
})();
