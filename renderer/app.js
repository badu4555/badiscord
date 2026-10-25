// BADISCORD PC - Lógica de Servidores, Voz, Mudo/Fone e Transmissão 1080p

const API_URL = (typeof window !== 'undefined' && window.location && window.location.origin)
  ? `${window.location.origin}/api/token`
  : 'https://badiscord.onrender.com/api/token';
const LIVEKIT_FALLBACK_URL = 'wss://badiscord-hifeof9x.livekit.cloud';
const LIVEKIT_URL = LIVEKIT_FALLBACK_URL;

// Estado da Aplicação
let currentRoom = null;
let currentChannel = null;
let localAudioTrack = null;
let localScreenTrack = null;
let localScreenAudioTrack = null;
let isNativeMobileStreamer = false;
let isNativeMobileSharePending = false;
let isLocalStreamer = false;
let isMuted = false;
let isDeafened = false;
let isLocalSpeaking = false;
let wasMutedBeforeDeafen = false;
let selectedSourceId = null;

// Estado do Perfil de Usuário
const DEFAULT_PROFILE = {
  displayName: 'Bads',
  username: 'bads',
  tag: '0001',
  avatarUrl: '',
  bannerColor: '#5865F2',
  aboutMe: 'Usando o BADISCORD!',
  presenceStatus: 'online',
  profileTags: []
};

let userProfile = DEFAULT_PROFILE;
try {
  const savedProf = localStorage.getItem('badiscord_user_profile');
  if (savedProf) userProfile = { ...DEFAULT_PROFILE, ...JSON.parse(savedProf) };
} catch (e) {}
if (!userProfile.tag) {
  userProfile.tag = '0001';
}
userProfile.profileTags = Array.isArray(userProfile.profileTags)
  ? userProfile.profileTags
    .filter((tag) => tag && ['server', 'friend', 'community'].includes(tag.type) && typeof tag.label === 'string')
    .slice(0, 5)
    .map((tag) => ({ type: tag.type, label: tag.label.trim().slice(0, 24) }))
    .filter((tag) => tag.label)
  : [];

let authenticatedAccount = null;
let messageCacheAccountId = '';
const channelMessagesCache = new Map();
const directMessagesCache = new Map();
let recaptchaSiteKey = '';
const recaptchaWidgets = {};
let spotifyActivity = null;
let spotifyConnected = false;
let spotifyPollingTimer = null;
const USER_VOLUMES_STORAGE_KEY = 'badiscord_user_volumes';
const USER_MUTES_STORAGE_KEY = 'badiscord_muted_users';
const USER_NICKNAMES_STORAGE_KEY = 'badiscord_user_nicknames';
const SOUNDBOARD_USER_VOLUMES_STORAGE_KEY = 'badiscord_soundboard_user_volumes';
const SOUNDBOARD_USER_MUTES_STORAGE_KEY = 'badiscord_soundboard_muted_users';
let userVolumes = {};
let mutedUserIdentities = new Set();
let soundboardUserVolumes = {};
let mutedSoundboardUserIdentities = new Set();
let locallyDisabledVideoIdentities = new Set();
let userNicknames = {};
try {
  const savedUserVolumes = JSON.parse(localStorage.getItem(USER_VOLUMES_STORAGE_KEY) || '{}');
  if (savedUserVolumes && typeof savedUserVolumes === 'object' && !Array.isArray(savedUserVolumes)) {
    userVolumes = savedUserVolumes;
  }
} catch (error) {
  console.warn('Não foi possível carregar os volumes individuais:', error);
}
try {
  const savedMutes = JSON.parse(localStorage.getItem(USER_MUTES_STORAGE_KEY) || '[]');
  if (Array.isArray(savedMutes)) mutedUserIdentities = new Set(savedMutes.filter((id) => typeof id === 'string'));
} catch (error) {
  console.warn('Não foi possível carregar os usuários silenciados:', error);
}
try {
  const savedVolumes = JSON.parse(localStorage.getItem(SOUNDBOARD_USER_VOLUMES_STORAGE_KEY) || '{}');
  if (savedVolumes && typeof savedVolumes === 'object' && !Array.isArray(savedVolumes)) {
    soundboardUserVolumes = savedVolumes;
  }
} catch (error) {
  console.warn('Não foi possível carregar os volumes individuais do soundboard:', error);
}
try {
  const savedMutes = JSON.parse(localStorage.getItem(SOUNDBOARD_USER_MUTES_STORAGE_KEY) || '[]');
  if (Array.isArray(savedMutes)) {
    mutedSoundboardUserIdentities = new Set(savedMutes.filter((id) => typeof id === 'string'));
  }
} catch (error) {
  console.warn('Não foi possível carregar os silêncios individuais do soundboard:', error);
}
try {
  const savedNicknames = JSON.parse(localStorage.getItem(USER_NICKNAMES_STORAGE_KEY) || '{}');
  if (savedNicknames && typeof savedNicknames === 'object' && !Array.isArray(savedNicknames)) {
    userNicknames = savedNicknames;
  }
} catch (error) {
  console.warn('Não foi possível carregar os apelidos:', error);
}

function getUserNickname(identity) {
  return typeof identity === 'string' ? String(userNicknames[identity] || '').trim() : '';
}

function applyUserNickname(member) {
  if (!member || member.id === 'self' || member.id === authenticatedAccount?.id) return member;
  const nickname = getUserNickname(member.id);
  return nickname ? { ...member, name: nickname, initial: nickname[0].toUpperCase() } : member;
}

function isUserMuted(identity) {
  return Boolean(identity && mutedUserIdentities.has(identity));
}

function setUserMuted(identity, muted) {
  if (typeof identity !== 'string' || !identity || identity === 'self' || identity === authenticatedAccount?.id) return;
  if (muted) mutedUserIdentities.add(identity);
  else mutedUserIdentities.delete(identity);
  try {
    localStorage.setItem(USER_MUTES_STORAGE_KEY, JSON.stringify([...mutedUserIdentities]));
  } catch (error) {
    console.warn('Não foi possível salvar os usuários silenciados:', error);
  }
  remoteAudioElements.forEach((element) => {
    if (
      element.dataset.participantIdentity === identity &&
      !remoteScreenAudioElements.has(element) &&
      !remoteSoundboardAudioElements.has(element)
    ) {
      element.volume = muted ? 0 : getUserVolume(identity) / 100;
    }
  });
  updateSoundboardUserAudio(identity);
}

function getUserVolume(identity) {
  const volume = Number(userVolumes[identity]);
  return Number.isFinite(volume) ? Math.max(0, Math.min(100, volume)) : 100;
}

function setUserVolume(identity, value) {
  if (typeof identity !== 'string' || !identity || identity === 'self' || identity === authenticatedAccount?.id) return;
  const volume = Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
  userVolumes[identity] = volume;
  try {
    localStorage.setItem(USER_VOLUMES_STORAGE_KEY, JSON.stringify(userVolumes));
  } catch (error) {
    console.warn('Não foi possível salvar o volume individual:', error);
  }

  remoteAudioElements.forEach((element) => {
    if (
      element.dataset.participantIdentity === identity &&
      !remoteScreenAudioElements.has(element) &&
      !remoteSoundboardAudioElements.has(element)
    ) {
      element.volume = isUserMuted(identity) ? 0 : volume / 100;
    }
  });
}

function isSoundboardUserMuted(identity) {
  return Boolean(identity && mutedSoundboardUserIdentities.has(identity));
}

function getSoundboardUserVolume(identity) {
  const volume = Number(soundboardUserVolumes[identity]);
  return Number.isFinite(volume) ? Math.max(0, Math.min(100, volume)) : 100;
}

function updateSoundboardUserAudio(identity) {
  remoteSoundboardAudioElements.forEach((element) => {
    if (element.dataset.participantIdentity !== identity) return;
    element.volume = isUserMuted(identity) || isSoundboardUserMuted(identity)
      ? 0
      : getSoundboardUserVolume(identity) / 100;
  });
}

function setSoundboardUserMuted(identity, muted) {
  if (typeof identity !== 'string' || !identity || identity === 'self' || identity === authenticatedAccount?.id) return;
  if (muted) mutedSoundboardUserIdentities.add(identity);
  else mutedSoundboardUserIdentities.delete(identity);
  try {
    localStorage.setItem(SOUNDBOARD_USER_MUTES_STORAGE_KEY, JSON.stringify([...mutedSoundboardUserIdentities]));
  } catch (error) {
    console.warn('Não foi possível salvar os silêncios individuais do soundboard:', error);
  }
  updateSoundboardUserAudio(identity);
}

function setSoundboardUserVolume(identity, value) {
  if (typeof identity !== 'string' || !identity || identity === 'self' || identity === authenticatedAccount?.id) return;
  soundboardUserVolumes[identity] = Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
  try {
    localStorage.setItem(SOUNDBOARD_USER_VOLUMES_STORAGE_KEY, JSON.stringify(soundboardUserVolumes));
  } catch (error) {
    console.warn('Não foi possível salvar o volume individual do soundboard:', error);
  }
  updateSoundboardUserAudio(identity);
}

async function initializeRecaptcha() {
  try {
    const response = await fetch('/api/config', { headers: { Accept: 'application/json' } });
    const config = await response.json();
    recaptchaSiteKey = config.recaptchaSiteKey || '';
    if (!recaptchaSiteKey) {
      if (config.recaptchaRequired) {
        document.querySelectorAll('.auth-captcha').forEach((element) => {
          element.textContent = '⚠️ reCAPTCHA ainda não configurado no servidor.';
          element.classList.add('auth-captcha-error');
        });
      }
      return;
    }

    const renderWidgets = () => {
      if (!window.grecaptcha || typeof window.grecaptcha.render !== 'function') {
        window.setTimeout(renderWidgets, 250);
        return;
      }
      ['login', 'register'].forEach((name) => {
        const element = document.getElementById(`${name}Recaptcha`);
        if (element && recaptchaWidgets[name] === undefined) {
          recaptchaWidgets[name] = window.grecaptcha.render(element, {
            sitekey: recaptchaSiteKey,
            theme: 'dark'
          });
        }
      });
    };
    renderWidgets();
  } catch (error) {
    console.warn('Não foi possível carregar o reCAPTCHA:', error);
  }
}

function getRecaptchaToken(name) {
  if (!recaptchaSiteKey) return '';
  const widgetId = recaptchaWidgets[name];
  return widgetId === undefined || !window.grecaptcha ? '' : window.grecaptcha.getResponse(widgetId);
}

function resetRecaptcha(name) {
  const widgetId = recaptchaWidgets[name];
  if (widgetId !== undefined && window.grecaptcha) window.grecaptcha.reset(widgetId);
}

function initializePasswordToggles() {
  document.querySelectorAll('[data-password-toggle]').forEach((button) => {
    button.addEventListener('click', () => {
      const input = document.getElementById(button.dataset.passwordToggle);
      if (!input) return;
      const isVisible = input.type === 'text';
      input.type = isVisible ? 'password' : 'text';
      button.classList.toggle('is-visible', !isVisible);
      button.textContent = isVisible ? '👁' : '🙈';
      button.setAttribute('aria-label', isVisible ? 'Mostrar senha' : 'Ocultar senha');
    });
  });
}

async function submitLoginForm() {
  const form = document.getElementById('formLogin');
  const emailInput = document.getElementById('loginEmail');
  const passwordInput = document.getElementById('loginPassword');
  const submitButton = document.getElementById('btnLoginSubmit');

  if (!form || !emailInput || !passwordInput) return;

  const email = String(emailInput.value || '').trim();
  const password = String(passwordInput.value || '').trim();

  if (!email || !password) {
    showToast('Preencha o e-mail e a senha para entrar.', '⚠️');
    return;
  }

  if (submitButton) {
    submitButton.disabled = true;
    submitButton.textContent = 'Entrando...';
  }

  try {
    const user = await loginAccount(email, password, getRecaptchaToken('login'));
    await finalizeAuthSession(user);
    showToast('Login realizado com sucesso!', '✅');
  } catch (error) {
    resetRecaptcha('login');
    showToast(error.message || 'Não foi possível entrar.', '⚠️');
  } finally {
    if (submitButton) {
      submitButton.disabled = false;
      submitButton.textContent = 'Entrar';
    }
  }
}

function initializeAuthForms() {
  const loginForm = document.getElementById('formLogin');
  if (loginForm) {
    loginForm.addEventListener('submit', (event) => {
      event.preventDefault();
      submitLoginForm();
    });
  }

}

function hasAuthenticatedSession() {
  return Boolean(authenticatedAccount);
}

function getStoredPresenceMembers() {
  try {
    const raw = localStorage.getItem('badiscord_online_members');
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    return [];
  }
}

function saveStoredPresenceMembers(members) {
  try {
    localStorage.setItem('badiscord_online_members', JSON.stringify(members));
  } catch (e) {}
}

function getPresenceIdentityKeys(entry) {
  const keys = [];
  const entryId = entry && typeof entry.id === 'string' ? entry.id.trim() : '';
  if (entryId) keys.push(`id:${entryId.toLowerCase()}`);

  const entryName = (entry?.name || entry?.displayName || 'Bads').toString().trim() || 'Bads';
  const fullTag = (entry?.fullTag || '').toString().trim();
  const tagSeparator = fullTag.lastIndexOf('#');
  const fullTagName = tagSeparator >= 0 ? fullTag.slice(0, tagSeparator).trim() : '';
  const fullTagValue = fullTagName.toLowerCase() === entryName.toLowerCase() ? fullTag.slice(tagSeparator + 1) : '';
  const entryTag = (entry?.tag || fullTagValue || '0001').toString().trim() || '0001';
  keys.push(`tag:${entryName.toLowerCase()}#${entryTag.toLowerCase()}`);
  return keys;
}

function dedupePresenceEntries(entries) {
  const seen = new Set();
  return (Array.isArray(entries) ? entries : []).filter((entry) => {
    const keys = getPresenceIdentityKeys(entry);
    if (keys.some((key) => seen.has(key))) return false;
    keys.forEach((key) => seen.add(key));
    return true;
  });
}

function syncPresenceRoster(account) {
  const activeMembers = getStoredPresenceMembers();
  const sessionAccount = account || authenticatedAccount;
  const memberName = (sessionAccount?.displayName || sessionAccount?.username || userProfile.displayName || 'Bads').trim();
  const memberTag = String(sessionAccount?.tag || userProfile.tag || '0001');
  const memberId = sessionAccount?.id ? String(sessionAccount.id).trim() : '';
  const member = { id: memberId, name: memberName || 'Bads', tag: memberTag };

  const memberKeys = new Set(getPresenceIdentityKeys(member));
  const next = dedupePresenceEntries(activeMembers.filter((entry) => (
    !getPresenceIdentityKeys(entry).some((key) => memberKeys.has(key))
  )));

  next.push({
    id: memberId || `presence-${Date.now()}`,
    name: memberName || 'Bads',
    tag: memberTag,
    fullTag: `${memberName || 'Bads'}#${memberTag}`,
    status: userProfile.presenceStatus === 'invisible' ? 'offline' : (userProfile.presenceStatus || 'online'),
    detail: userProfile.presenceStatus === 'idle' ? 'Ausente' : (userProfile.presenceStatus === 'dnd' ? 'Ocupado' : 'Disponível'),
    color: userProfile.bannerColor || '#5865F2',
    avatarUrl: userProfile.avatarUrl || '',
    profileTags: userProfile.profileTags,
    game: detectedGame && detectedGame.name ? detectedGame.name : '',
    initial: (memberName || 'B')[0].toUpperCase(),
    updatedAt: Date.now()
  });

  saveStoredPresenceMembers(dedupePresenceEntries(next));
  return publishPresenceStatus();
}

function publishPresenceStatus() {
  if (!authenticatedAccount) return Promise.resolve();
  const status = userProfile.presenceStatus || 'online';
  const details = { online: 'Disponível', idle: 'Ausente', dnd: 'Ocupado', invisible: 'Invisível' };
  const gameActivity = typeof detectedGame !== 'undefined' && detectedGame?.name ? detectedGame : null;
  const activity = gameActivity
    ? { type: 'game', text: gameActivity.name, artwork: gameActivity.appIcon || '', url: '' }
    : (spotifyActivity ? { type: 'music', ...spotifyActivity } : { type: '', text: '', artwork: '', url: '' });
  return fetch('/api/presence', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      status,
      detail: details[status] || 'Disponível',
      game: gameActivity?.name || '',
      activityType: activity.type,
      activityText: activity.text,
      activityArtwork: activity.artwork,
      activityUrl: activity.url,
      avatarUrl: userProfile.avatarUrl || '',
      profileColor: userProfile.bannerColor || '#5865F2',
      profileTags: userProfile.profileTags
    })
  }).then(async (response) => {
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || 'Não foi possível atualizar seu status.');
  }).catch((error) => {
    console.warn('Não foi possível atualizar a presença no servidor:', error);
  });
}

function clearCurrentSession() {
  const session = authenticatedAccount;
  const storedMembers = getStoredPresenceMembers();
  if (session) {
    const memberName = (session.displayName || session.username || 'Bads').trim();
    const memberKey = `${memberName.toLowerCase()}#${String(session.tag || '0001')}`;
    const next = storedMembers.filter((entry) => {
      const key = `${(entry.name || 'Bads').toLowerCase()}#${String(entry.tag || '0001')}`;
      return key !== memberKey;
    });
    saveStoredPresenceMembers(next);
  }
  saveStoredPresenceMembers([]);
  authenticatedAccount = null;
}

function saveUserProfile() {
  try {
    localStorage.setItem('badiscord_user_profile', JSON.stringify(userProfile));
  } catch (e) {}
}

function showAuthOverlay() {
  const authOverlay = document.getElementById('authOverlay');
  const appLayout = document.querySelector('.app-layout');
  if (authOverlay) authOverlay.style.display = 'flex';
  if (appLayout) {
    appLayout.style.filter = 'blur(4px)';
    appLayout.style.pointerEvents = 'none';
    appLayout.style.opacity = '0.18';
  }
}

function hideAuthOverlay() {
  const authOverlay = document.getElementById('authOverlay');
  const appLayout = document.querySelector('.app-layout');
  if (authOverlay) authOverlay.style.display = 'none';
  if (appLayout) {
    appLayout.style.filter = 'none';
    appLayout.style.pointerEvents = 'auto';
    appLayout.style.opacity = '1';
  }
}

function openAuthView(viewId) {
  const panes = ['viewAuthLogin', 'viewAuthRegister', 'viewAuthForgot', 'viewAuth2FA'];
  panes.forEach((id) => {
    const pane = document.getElementById(id);
    if (pane) pane.style.display = id === viewId ? 'block' : 'none';
  });
}

async function registerAccount({ email, username, password, recaptchaToken = '' }) {
  const response = await fetch('/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ email, username, password, recaptchaToken })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || 'Não foi possível criar a conta.');
  return { ...payload.user, homeServerId: payload.homeServerId };
}

async function loginAccount(email, password, recaptchaToken = '') {
  const response = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ email, password, recaptchaToken })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || 'E-mail ou senha inválidos.');
  return payload.user;
}

function applySessionToProfile(account) {
  userProfile = {
    ...DEFAULT_PROFILE,
    displayName: account.displayName || account.username,
    username: account.username,
    tag: account.tag || generateAccountTag(),
    avatarUrl: account.avatarUrl || '',
    bannerColor: account.bannerColor || '#5865F2',
    aboutMe: account.aboutMe || 'Usando o BADISCORD!',
    email: account.email,
    presenceStatus: 'online'
  };
  saveUserProfile();
  return userProfile;
}

async function finalizeAuthSession(account) {
  if (!account || !account.id || !account.email) throw new Error('Sessão inválida.');
  if (messageCacheAccountId !== account.id) {
    channelMessagesCache.clear();
    directMessagesCache.clear();
    messageCacheAccountId = account.id;
  }
  authenticatedAccount = account;

  applySessionToProfile(account);
  await syncPresenceRoster(account);
  hideAuthOverlay();
  renderGuilds();
  renderServerMembers();
  renderVoiceParticipants();
  applyUserProfile();
  await loadFriendsFromServer();
  startFriendRequestPolling();
  startPrivateCallPolling();
  await refreshSpotifyConnectionStatus();
  startSpotifyActivityPolling();
  if (await syncLocalServersWithBackend(account.homeServerId || '', true)) {
    startVoiceRosterPolling();
    loadServerMembers(activeServerId);
    startServerMembersPolling();
    await loadServerInvites();
    restoreServerView(activeServerId);
    await loadCustomSoundboard();
    await acceptPendingServerInvite();
  }
}

function logoutAccount() {
  stopNativeMobileShare();
  fetch('/api/auth/logout', { method: 'POST', credentials: 'include' }).catch(() => {});
  authenticatedAccount = null;
  messageCacheAccountId = '';
  channelMessagesCache.clear();
  directMessagesCache.clear();
  clearInterval(friendsPollingTimer);
  friendsPollingTimer = null;
  clearInterval(presenceHeartbeatTimer);
  presenceHeartbeatTimer = null;
  clearInterval(voiceRosterPollingTimer);
  voiceRosterPollingTimer = null;
  clearInterval(serverMembersPollingTimer);
  serverMembersPollingTimer = null;
  clearInterval(privateCallPollingTimer);
  privateCallPollingTimer = null;
  clearInterval(spotifyPollingTimer);
  spotifyPollingTimer = null;
  serverMembersByServer.clear();
  serverRolesByServer.clear();
  spotifyActivity = null;
  spotifyConnected = false;
  serverVoiceRosters.clear();
  incomingFriendRequestIds = null;
  clearInterval(channelMessagesPollingTimer);
  channelMessagesPollingTimer = null;
  channelMessagesLoadGeneration += 1;
  clearCurrentSession();
  const authOverlay = document.getElementById('authOverlay');
  if (authOverlay) authOverlay.style.display = 'flex';
  openAuthView('viewAuthLogin');
  const formLogin = document.getElementById('loginEmail');
  if (formLogin) formLogin.focus();
}

async function ensureAuthState() {
  try {
    const response = await fetch('/api/auth/me', { credentials: 'include', headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error('Sessão ausente');
    const payload = await response.json();
    await finalizeAuthSession(payload.user);
    return true;
  } catch (error) {
    stopNativeMobileShare();
    authenticatedAccount = null;
    clearInterval(friendsPollingTimer);
    friendsPollingTimer = null;
    clearInterval(voiceRosterPollingTimer);
    voiceRosterPollingTimer = null;
    serverVoiceRosters.clear();
    incomingFriendRequestIds = null;
    clearCurrentSession();
    showAuthOverlay();
    openAuthView('viewAuthLogin');
    return false;
  }
}

let livekitRoom = null;
let livekitAudioTrack = null;
let localVoiceCanPublish = true;
let livekitScreenTrack = null;
let livekitScreenAudioTrack = null;
let localStreamResolution = null;
let localStreamFps = null;
const SOUNDBOARD_TRACK_NAME = 'badiscord-soundboard';
const MOBILE_SCREEN_SHARE_SUFFIX = '-mobile-screen';

function getMobileScreenShareIdentity(identity) {
  return `${identity}${MOBILE_SCREEN_SHARE_SUFFIX}`;
}

function isMobileScreenShareIdentity(identity) {
  return typeof identity === 'string' && identity.endsWith(MOBILE_SCREEN_SHARE_SUFFIX);
}

function getVoiceViewerCount(room = livekitRoom) {
  if (!room) return 0;
  return Array.from(room.remoteParticipants.values())
    .filter((participant) => !isMobileScreenShareIdentity(participant.identity))
    .length;
}
let soundboardLiveKitTrack = null;
let soundboardPublishInFlight = null;
let privateCallRoom = null;
let privateCallAudioTrack = null;
let privateCallId = '';
let privateCallEnding = false;
let privateCallPollingTimer = null;
let lastIncomingCallId = '';
let livekitConnectionInFlight = false;
const remoteAudioElements = new Set();
let remoteAudioPlaybackNeedsGesture = false;
let remoteAudioPlaybackWarningShown = false;
const remoteScreenTracks = new Map();
const remoteCameraTracks = new Map();
const remoteScreenAudioElements = new Set();
const remoteSoundboardAudioElements = new Set();
let watchingLiveParticipantId = '';
let currentVoiceRttMs = null;
let pingMeasurementInProgress = false;
const voiceRttByIdentity = new Map();

function getStoredLiveKitUrl() {
  try {
    return localStorage.getItem('badiscord_livekit_url') || LIVEKIT_FALLBACK_URL;
  } catch (e) {
    return LIVEKIT_FALLBACK_URL;
  }
}

function setStoredLiveKitUrl(url) {
  try {
    if (url) localStorage.setItem('badiscord_livekit_url', url);
  } catch (e) {}
}

function getLiveKitRoomName(channelName, serverId = activeServerId) {
  const safeServerId = String(serverId || 'default')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'default';
  const safe = String(channelName || 'geral')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64) || 'geral';
  return `badiscord-${safeServerId}-${safe}`;
}

async function fetchLiveKitConfig() {
  const baseUrl = API_URL.replace(/\/api\/token$/i, '');
  try {
    const response = await fetch(`${baseUrl}/api/config`, { headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    if (payload && payload.livekitUrl) {
      setStoredLiveKitUrl(payload.livekitUrl);
      return payload.livekitUrl;
    }
  } catch (err) {
    console.warn('Não foi possível carregar a configuração do LiveKit do backend:', err);
  }
  return getStoredLiveKitUrl();
}

async function requestLiveKitToken(roomName, participantName, screenShareSession = false) {
  const response = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ roomName, participantName, ...(screenShareSession ? { screenShareSession: true } : {}) })
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || 'Não foi possível obter o token do LiveKit.');
  }

  return {
    token: payload.token,
    canPublish: payload.canPublish !== false,
    participantIdentity: payload.participantIdentity || ''
  };
}

function clearRemoteAudioElements(participantIdentity = '') {
  remoteAudioElements.forEach((element) => {
    if (participantIdentity && element.dataset.participantIdentity !== participantIdentity) return;
    element.remove();
    remoteAudioElements.delete(element);
    remoteScreenAudioElements.delete(element);
    remoteSoundboardAudioElements.delete(element);
  });
}

function playRemoteAudioElement(element) {
  if (!element || element.muted || isDeafened) return;
  element.play().then(() => {
    remoteAudioPlaybackNeedsGesture = false;
  }).catch((error) => {
    if (error.name === 'NotAllowedError') {
      remoteAudioPlaybackNeedsGesture = true;
      if (!remoteAudioPlaybackWarningShown) {
        showToast('O navegador bloqueou o áudio automático. Clique na página para liberar o som.', '🔊');
        remoteAudioPlaybackWarningShown = true;
      }
      return;
    }
    console.warn('Não foi possível reproduzir o áudio recebido:', error);
  });
}

async function resumeRemoteAudioPlayback() {
  if (!remoteAudioPlaybackNeedsGesture || isDeafened) return;
  try {
    await livekitRoom?.startAudio();
  } catch (error) {
    console.warn('Não foi possível ativar o áudio da sala:', error);
  }
  remoteAudioElements.forEach(playRemoteAudioElement);
}

document.addEventListener('pointerdown', resumeRemoteAudioPlayback);
document.addEventListener('keydown', resumeRemoteAudioPlayback);

async function connectToLiveKitRoom(channelName) {
  if (!hasAuthenticatedSession()) {
    throw new Error('Faça login para entrar em um canal de voz.');
  }

  if (!window.LivekitClient || !window.LivekitClient.Room) {
    throw new Error('SDK do LiveKit não foi carregado.');
  }

  if (livekitConnectionInFlight) return livekitRoom;
  livekitConnectionInFlight = true;

  try {
    const roomName = getLiveKitRoomName(channelName);
    const participantName = userProfile.displayName || 'Bads';

    if (!livekitRoom) {
      livekitRoom = new window.LivekitClient.Room({
        adaptiveStream: true,
        dynacast: true,
        logger: false
      });

      livekitRoom.on(window.LivekitClient.RoomEvent.ConnectionStateChanged, (state) => {
        console.log('LiveKit connection state:', state);
        if (state === 'disconnected') {
          clearRemoteAudioElements();
          soundboardLiveKitTrack = null;
          currentVoiceRttMs = null;
          voiceRttByIdentity.clear();
          updatePingUI(null);
        }
        refreshVoiceParticipantViews();
      });

      livekitRoom.on(window.LivekitClient.RoomEvent.ParticipantConnected, (participant) => {
        console.log('Participante conectado:', participant.identity);
        refreshVoiceParticipantViews();
      });

      livekitRoom.on(window.LivekitClient.RoomEvent.ParticipantDisconnected, (participant) => {
        console.log('Participante desconectado:', participant.identity);
        clearRemoteAudioElements(participant.identity);
        remoteScreenTracks.delete(participant.identity);
        remoteCameraTracks.delete(participant.identity);
        voiceRttByIdentity.delete(participant.identity);
        if (watchingLiveParticipantId === participant.identity) stopWatchingLive();
        refreshVoiceParticipantViews();
      });

      livekitRoom.on(window.LivekitClient.RoomEvent.DataReceived, (payload, participant, _kind, topic) => {
        if (topic !== 'badiscord-voice-rtt' || !participant) return;
        try {
          const report = JSON.parse(new TextDecoder().decode(payload));
          const sentAt = Number(report.sentAt);
          const rttMs = Number(report.rttMs);
          if (
            report.type !== 'badiscord-voice-rtt' ||
            !Number.isFinite(sentAt) ||
            Math.abs(Date.now() - sentAt) > 15000 ||
            !Number.isFinite(rttMs) ||
            rttMs < 0 ||
            rttMs > 10000
          ) return;
          voiceRttByIdentity.set(participant.identity, { rttMs, receivedAt: Date.now() });
          updateParticipantRttBadge(participant.identity, rttMs);
        } catch (error) {
          console.warn('Não foi possível interpretar a medição de latência recebida:', error);
        }
      });

      livekitRoom.on(window.LivekitClient.RoomEvent.TrackPublished, refreshVoiceParticipantViews);
      livekitRoom.on(window.LivekitClient.RoomEvent.TrackUnpublished, (publication, participant) => {
        if (publication.source === window.LivekitClient.Track.Source.ScreenShare) {
          remoteScreenTracks.delete(participant.identity);
          if (watchingLiveParticipantId === participant.identity) stopWatchingLive();
          if (
            isNativeMobileStreamer &&
            participant.identity === getMobileScreenShareIdentity(livekitRoom?.localParticipant?.identity)
          ) {
            window.onAndroidScreenShareStateChanged?.(false);
          }
        } else if (publication.source === window.LivekitClient.Track.Source.Camera) {
          remoteCameraTracks.delete(participant.identity);
        }
        refreshVoiceParticipantViews();
      });

      livekitRoom.on(window.LivekitClient.RoomEvent.TrackSubscribed, (track, publication, participant) => {
        if (track.kind === 'audio') {
          const audioElement = track.attach();
          audioElement.autoplay = true;
          audioElement.playsInline = true;
          audioElement.dataset.participantIdentity = participant.identity;
          audioElement.muted = isDeafened;
          if (publication.source === window.LivekitClient.Track.Source.ScreenShareAudio) {
            audioElement.volume = streamPlayerVolume / 100;
            audioElement.muted = isDeafened || isStreamAudioMuted;
            remoteScreenAudioElements.add(audioElement);
          } else if (publication.trackName === SOUNDBOARD_TRACK_NAME) {
            audioElement.volume = soundboardMuted || isUserMuted(participant.identity) || isSoundboardUserMuted(participant.identity)
              ? 0
              : (soundboardVolume / 100) * (getSoundboardUserVolume(participant.identity) / 100);
            remoteSoundboardAudioElements.add(audioElement);
          } else {
            audioElement.volume = isUserMuted(participant.identity) ? 0 : getUserVolume(participant.identity) / 100;
          }
          document.body.appendChild(audioElement);
          remoteAudioElements.add(audioElement);
          playRemoteAudioElement(audioElement);
        } else if (publication.source === window.LivekitClient.Track.Source.ScreenShare) {
          remoteScreenTracks.set(participant.identity, {
            track,
            participant,
            publication
          });
          refreshVoiceParticipantViews();
        } else if (publication.source === window.LivekitClient.Track.Source.Camera) {
          if (locallyDisabledVideoIdentities.has(participant.identity)) {
            publication.setSubscribed(false);
            return;
          }
          remoteCameraTracks.set(participant.identity, track);
          refreshVoiceParticipantViews();
        }
      });

      livekitRoom.on(window.LivekitClient.RoomEvent.TrackUnsubscribed, (track, publication, participant) => {
        track.detach().forEach((audioElement) => {
          remoteAudioElements.delete(audioElement);
          remoteScreenAudioElements.delete(audioElement);
          remoteSoundboardAudioElements.delete(audioElement);
          audioElement.remove();
        });
        if (publication.source === window.LivekitClient.Track.Source.ScreenShare) {
          remoteScreenTracks.delete(participant.identity);
          if (watchingLiveParticipantId === participant.identity) stopWatchingLive();
          if (
            isNativeMobileStreamer &&
            participant.identity === getMobileScreenShareIdentity(livekitRoom?.localParticipant?.identity)
          ) {
            window.onAndroidScreenShareStateChanged?.(false);
          }
        } else if (publication.source === window.LivekitClient.Track.Source.Camera) {
          remoteCameraTracks.delete(participant.identity);
        }
        refreshVoiceParticipantViews();
      });

      [
        window.LivekitClient.RoomEvent.TrackMuted,
        window.LivekitClient.RoomEvent.TrackUnmuted,
        window.LivekitClient.RoomEvent.ParticipantNameChanged,
        window.LivekitClient.RoomEvent.ActiveSpeakersChanged
      ].filter(Boolean).forEach((eventName) => {
        livekitRoom.on(eventName, refreshVoiceParticipantViews);
      });
    }

    if (livekitRoom.state === 'connected' && livekitRoom.name === roomName) {
      return livekitRoom;
    }

    if (livekitRoom.state === 'connected') {
      await livekitRoom.disconnect();
    }

    const [livekitUrl, credentials] = await Promise.all([
      fetchLiveKitConfig(),
      requestLiveKitToken(roomName, participantName)
    ]);
    localVoiceCanPublish = credentials.canPublish;
    await livekitRoom.prepareConnection(livekitUrl, credentials.token);
    await livekitRoom.connect(livekitUrl, credentials.token);
    return livekitRoom;
  } finally {
    livekitConnectionInFlight = false;
  }
}

async function connectPrivateCall(call) {
  if (!call?.roomName || !call.id || privateCallId !== call.id) return;
  if (privateCallRoom?.state === 'connected') return;
  if (!window.LivekitClient?.Room || !window.LivekitClient?.createLocalAudioTrack) {
    throw new Error('O cliente de voz não está disponível neste navegador.');
  }
  const { token } = await requestLiveKitToken(call.roomName, userProfile.displayName || 'Usuário');
  const livekitUrl = await fetchLiveKitConfig();
  const room = new window.LivekitClient.Room({ adaptiveStream: true, dynacast: true });
  privateCallRoom = room;
  room.on(window.LivekitClient.RoomEvent.TrackSubscribed, (track, publication, participant) => {
    if (track.kind !== 'audio') return;
    const audio = track.attach();
    audio.autoplay = true;
    audio.playsInline = true;
    audio.dataset.participantIdentity = participant.identity;
    audio.volume = isUserMuted(participant.identity) ? 0 : getUserVolume(participant.identity) / 100;
    document.body.appendChild(audio);
    remoteAudioElements.add(audio);
    playRemoteAudioElement(audio);
  });
  room.on(window.LivekitClient.RoomEvent.TrackUnsubscribed, (track) => {
    track.detach().forEach((audio) => {
      remoteAudioElements.delete(audio);
      audio.remove();
    });
  });
  await room.prepareConnection(livekitUrl, token);
  await room.connect(livekitUrl, token);
  privateCallAudioTrack = await window.LivekitClient.createLocalAudioTrack({
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
    sampleRate: 48000
  });
  await room.localParticipant.publishTrack(privateCallAudioTrack, {
    source: window.LivekitClient.Track.Source.Microphone
  });
  if (isMuted) await privateCallAudioTrack.mute();
  const bar = document.getElementById('privateCallBar');
  const status = document.getElementById('privateCallStatus');
  const remoteName = call.isCaller ? call.receiver_name : call.caller_name;
  if (status) status.textContent = `Em chamada com ${remoteName || 'amigo'}`;
  if (bar) bar.style.display = 'flex';
}

async function cleanupPrivateCall() {
  privateCallEnding = true;
  if (privateCallAudioTrack) {
    privateCallAudioTrack.stop();
    privateCallAudioTrack = null;
  }
  if (privateCallRoom) {
    await privateCallRoom.disconnect();
    privateCallRoom = null;
  }
  const bar = document.getElementById('privateCallBar');
  if (bar) bar.style.display = 'none';
  privateCallId = '';
  privateCallEnding = false;
}

async function startPrivateCall(member) {
  if (!member?.id || !friendsList.some((friend) => friend.id === member.id)) {
    showToast('Adicione esta pessoa como amiga para ligar.', '⚠️');
    return;
  }
  if (privateCallId) {
    showToast('Você já está em uma chamada ou chamando alguém.', '⚠️');
    return;
  }
  if (!window.LivekitClient?.Room) {
    showToast('A chamada não está disponível neste navegador.', '⚠️');
    return;
  }
  if (currentChannel && !confirm('Você sairá do canal de voz atual para iniciar uma chamada privada. Continuar?')) return;
  try {
    if (currentChannel) await disconnectVoice(false);
    const response = await fetch('/api/calls', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ friendId: member.id })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || 'Não foi possível iniciar a chamada.');
    privateCallId = payload.call.id;
    const status = document.getElementById('privateCallStatus');
    if (status) status.textContent = `Chamando ${member.name}…`;
    const bar = document.getElementById('privateCallBar');
    if (bar) bar.style.display = 'flex';
    showToast(`Chamando ${member.name}…`, '📞');
  } catch (error) {
    showToast(error.message || 'Não foi possível iniciar a chamada.', '⚠️');
  }
}

async function endPrivateCall() {
  const callId = privateCallId;
  if (callId) {
    try {
      const response = await fetch(`/api/calls/${encodeURIComponent(callId)}/end`, {
        method: 'POST', credentials: 'include', headers: { Accept: 'application/json' }
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok && response.status !== 404) throw new Error(payload.error || 'Não foi possível encerrar a chamada.');
    } catch (error) {
      showToast(error.message || 'Não foi possível encerrar a chamada.', '⚠️');
    }
  }
  await cleanupPrivateCall();
}

async function pollPrivateCalls() {
  if (!authenticatedAccount) return;
  try {
    const response = await fetch('/api/calls', { credentials: 'include', headers: { Accept: 'application/json' } });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || 'Não foi possível verificar chamadas.');
    const calls = Array.isArray(payload.calls) ? payload.calls : [];
    if (privateCallId) {
      const current = calls.find((call) => call.id === privateCallId);
      if (!current || ['ended', 'rejected', 'missed'].includes(current.status)) {
        const wasActive = Boolean(privateCallRoom);
        await cleanupPrivateCall();
        if (wasActive) showToast('A chamada foi encerrada.', '📞');
      } else if (current.status === 'active') {
        await connectPrivateCall(current);
      } else {
        const status = document.getElementById('privateCallStatus');
        const remoteName = current.isCaller ? current.receiver_name : current.caller_name;
        if (status) status.textContent = `Chamando ${remoteName || 'amigo'}…`;
      }
    }
    const incoming = calls.find((call) => call.status === 'ringing' && !call.isCaller);
    const incomingModal = document.getElementById('incomingCallModal');
    if (incoming && incomingModal && incoming.id !== lastIncomingCallId) {
      lastIncomingCallId = incoming.id;
      incomingModal.dataset.callId = incoming.id;
      incomingModal.dataset.callerName = incoming.caller_name || 'Usuário';
      const title = document.getElementById('incomingCallTitle');
      const description = document.getElementById('incomingCallDescription');
      if (title) title.textContent = `Chamada de ${incoming.caller_name}`;
      if (description) description.textContent = `${incoming.caller_name} está ligando para você.`;
      incomingModal.style.display = 'flex';
    } else if (!incoming && incomingModal?.style.display === 'flex') {
      incomingModal.style.display = 'none';
    }
  } catch (error) {
    console.warn('Não foi possível verificar chamadas privadas:', error);
  }
}

function startPrivateCallPolling() {
  clearInterval(privateCallPollingTimer);
  privateCallPollingTimer = setInterval(pollPrivateCalls, 3_000);
  pollPrivateCalls();
}

document.getElementById('btnEndPrivateCall')?.addEventListener('click', endPrivateCall);
document.getElementById('btnDeclineCall')?.addEventListener('click', async () => {
  const modal = document.getElementById('incomingCallModal');
  const callId = modal?.dataset.callId;
  if (!callId) return;
  try {
    const response = await fetch(`/api/calls/${encodeURIComponent(callId)}/end`, {
      method: 'POST', credentials: 'include', headers: { Accept: 'application/json' }
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || 'Não foi possível recusar a chamada.');
    modal.style.display = 'none';
    lastIncomingCallId = '';
  } catch (error) {
    showToast(error.message || 'Não foi possível recusar a chamada.', '⚠️');
  }
});
document.getElementById('btnAcceptCall')?.addEventListener('click', async () => {
  const modal = document.getElementById('incomingCallModal');
  const callId = modal?.dataset.callId;
  if (!callId) return;
  if (privateCallId) {
    showToast('Encerre sua chamada atual antes de atender outra.', '⚠️');
    return;
  }
  if (currentChannel && !confirm('Você sairá do canal de voz atual para atender esta chamada privada. Continuar?')) {
    document.getElementById('btnDeclineCall')?.click();
    return;
  }
  try {
    if (currentChannel) await disconnectVoice(false);
    const response = await fetch(`/api/calls/${encodeURIComponent(callId)}/accept`, {
      method: 'POST', credentials: 'include', headers: { Accept: 'application/json' }
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || 'Não foi possível atender a chamada.');
    privateCallId = payload.call.id;
    modal.style.display = 'none';
    await connectPrivateCall({ ...payload.call, caller_name: modal.dataset.callerName, isCaller: false });
  } catch (error) {
    showToast(error.message || 'Não foi possível atender a chamada.', '⚠️');
  }
});

async function publishMicToLiveKit() {
  if (!localVoiceCanPublish || !livekitRoom || livekitRoom.state !== 'connected' || !window.LivekitClient || !window.LivekitClient.createLocalAudioTrack) {
    return null;
  }

  if (livekitAudioTrack) {
    return livekitAudioTrack;
  }

  try {
    livekitAudioTrack = await window.LivekitClient.createLocalAudioTrack({
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      sampleRate: 48000
    });

    await livekitRoom.localParticipant.publishTrack(livekitAudioTrack, {
      source: window.LivekitClient.Track.Source.Microphone
    });

    if (isMuted) await livekitAudioTrack.mute();

    return livekitAudioTrack;
  } catch (err) {
    console.warn('Não foi possível publicar o microfone no LiveKit:', err);
    return null;
  }
}

async function publishSoundboardTrack() {
  if (
    !localVoiceCanPublish ||
    !livekitRoom ||
    livekitRoom.state !== 'connected' ||
    !window.LivekitClient?.Track?.Source?.Unknown
  ) return false;
  if (soundboardLiveKitTrack) return true;
  if (soundboardPublishInFlight) return soundboardPublishInFlight;

  soundboardPublishInFlight = (async () => {
    try {
      const ctx = getSoundboardAudioContext();
      if (!ctx || !soundboardBroadcastGain) {
        throw new Error('O áudio do soundboard não está disponível neste dispositivo.');
      }
      const currentMediaTrack = soundboardBroadcastDestination?.stream.getAudioTracks()[0];
      if (!soundboardBroadcastDestination || currentMediaTrack?.readyState !== 'live') {
        if (soundboardBroadcastDestination) {
          soundboardBroadcastGain.disconnect(soundboardBroadcastDestination);
          soundboardBroadcastDestination.stream.getTracks().forEach((track) => track.stop());
        }
        soundboardBroadcastDestination = ctx.createMediaStreamDestination();
        soundboardBroadcastGain.connect(soundboardBroadcastDestination);
      }

      const mediaTrack = soundboardBroadcastDestination.stream.getAudioTracks()[0];
      if (!mediaTrack || mediaTrack.readyState !== 'live') {
        throw new Error('Não foi possível criar a faixa de áudio do soundboard.');
      }
      const publication = await livekitRoom.localParticipant.publishTrack(mediaTrack, {
        name: SOUNDBOARD_TRACK_NAME,
        source: window.LivekitClient.Track.Source.Unknown,
        dtx: true
      });
      soundboardLiveKitTrack = publication.track || mediaTrack;
      soundboardPublishErrorShown = false;
      return true;
    } catch (error) {
      console.error('Não foi possível transmitir os efeitos sonoros:', error);
      if (soundboardBroadcastDestination) {
        soundboardBroadcastGain?.disconnect(soundboardBroadcastDestination);
        soundboardBroadcastDestination.stream.getTracks().forEach((track) => track.stop());
        soundboardBroadcastDestination = null;
      }
      if (!soundboardPublishErrorShown) {
        showToast('Os efeitos serão reproduzidos só para você: não foi possível publicá-los na chamada.', '⚠️');
        soundboardPublishErrorShown = true;
      }
      return false;
    } finally {
      soundboardPublishInFlight = null;
    }
  })();

  return soundboardPublishInFlight;
}

async function disconnectLiveKitRoom() {
  if (soundboardPublishInFlight) await soundboardPublishInFlight;
  if (soundboardLiveKitTrack && livekitRoom?.state === 'connected') {
    try {
      await livekitRoom.localParticipant.unpublishTrack(soundboardLiveKitTrack);
    } catch (error) {
      console.warn('Não foi possível encerrar a faixa do soundboard:', error);
    }
  }
  soundboardLiveKitTrack = null;
  soundboardPublishInFlight = null;
  soundboardPublishErrorShown = false;
  if (soundboardBroadcastDestination) {
    soundboardBroadcastGain?.disconnect(soundboardBroadcastDestination);
    soundboardBroadcastDestination.stream.getTracks().forEach((track) => track.stop());
    soundboardBroadcastDestination = null;
  }

  if (livekitAudioTrack && typeof livekitAudioTrack.stop === 'function') {
    livekitAudioTrack.stop();
    livekitAudioTrack = null;
  }

  if (livekitScreenTrack && typeof livekitScreenTrack.stop === 'function') {
    livekitScreenTrack.stop();
    livekitScreenTrack = null;
  }

  if (livekitScreenAudioTrack && typeof livekitScreenAudioTrack.stop === 'function') {
    livekitScreenAudioTrack.stop();
    livekitScreenAudioTrack = null;
  }

  if (livekitRoom && livekitRoom.state === 'connected') {
    await livekitRoom.disconnect();
  }
  localVoiceCanPublish = true;
  remoteScreenTracks.clear();
  stopWatchingLive();
  remoteScreenAudioElements.clear();
  clearRemoteAudioElements();
}

const DEFAULT_SERVERS = [];
const HIDDEN_SAMPLE_SERVER_IDS = new Set(['srv-1', 'srv-2', 'pub-1', 'pub-2', 'pub-3', 'pub-4']);

function normalizeServers(list) {
  if (!Array.isArray(list)) return DEFAULT_SERVERS;
  return list.filter((srv) => !HIDDEN_SAMPLE_SERVER_IDS.has(srv.id)).map((srv, idx) => {
    const textChans = Array.isArray(srv.textChannels) && srv.textChannels.length > 0
      ? srv.textChannels
      : ['geral', 'regras-da-casa', 'clipes-e-jogos'];
    const voiceChans = Array.isArray(srv.voiceChannels) && srv.voiceChannels.length > 0
      ? srv.voiceChannels
      : (Array.isArray(srv.channels) && srv.channels.length > 0 ? srv.channels : ['Geral 🔊', 'CS2 Competitivo', 'Live 1080p 60FPS']);
    return {
      ...srv,
      id: srv.id || `srv-${idx + 1}`,
      name: srv.name || `Servidor ${idx + 1}`,
      icon: srv.icon || '🎮',
      textChannels: textChans,
      voiceChannels: voiceChans,
      roleId: srv.roleId || '',
      role: srv.role || 'member',
      isOwner: srv.isOwner !== false
    };
  });
}

let servers = [];
try {
  const saved = localStorage.getItem('badiscord_servers');
  servers = saved ? normalizeServers(JSON.parse(saved)) : DEFAULT_SERVERS;
} catch (e) {
  servers = DEFAULT_SERVERS;
}
let activeServerId = servers[0]?.id || '';
let serverSyncTimeout = null;
const serverVoiceRosters = new Map();
let voiceRosterPollingTimer = null;
let voiceRosterRequestInProgress = false;

function saveServers() {
  try {
    localStorage.setItem('badiscord_servers', JSON.stringify(servers));
  } catch (e) {}
  if (authenticatedAccount) {
    clearTimeout(serverSyncTimeout);
    serverSyncTimeout = setTimeout(() => syncLocalServersWithBackend(), 500);
  }
}

function playPopSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(650, now);
    osc.frequency.exponentialRampToValueAtTime(880, now + 0.08);
    gain.gain.setValueAtTime(0.15, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.08);
  } catch (e) {}
}

// Efeitos Sonoros Sintetizados com Web Audio API (Estilo Discord)
function playConnectSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const now = ctx.currentTime;

    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(523.25, now);
    gain1.gain.setValueAtTime(0.2, now);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start(now);
    osc1.stop(now + 0.18);

    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(783.99, now + 0.09);
    gain2.gain.setValueAtTime(0.25, now + 0.09);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.38);
    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.start(now + 0.09);
    osc2.stop(now + 0.38);
  } catch (err) {
    console.error('Erro ao tocar som:', err);
  }
}

function playDisconnectSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const now = ctx.currentTime;

    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(783.99, now);
    gain1.gain.setValueAtTime(0.2, now);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start(now);
    osc1.stop(now + 0.15);

    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(440, now + 0.08);
    gain2.gain.setValueAtTime(0.2, now + 0.08);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.32);
    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.start(now + 0.08);
    osc2.stop(now + 0.32);
  } catch (err) {}
}

function playMuteSound(muted) {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(muted ? 320 : 640, now);
    gain.gain.setValueAtTime(0.15, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.1);
  } catch (err) {}
}

function playDeafenSound(deafened) {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    if (deafened) {
      osc.frequency.setValueAtTime(440, now);
      osc.frequency.exponentialRampToValueAtTime(220, now + 0.15);
    } else {
      osc.frequency.setValueAtTime(220, now);
      osc.frequency.exponentialRampToValueAtTime(440, now + 0.15);
    }
    gain.gain.setValueAtTime(0.2, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.2);
  } catch (err) {}
}

// ==========================================
// ELEMENTOS DA INTERFACE
// ==========================================
const guildList = document.getElementById('guildList');
document.querySelectorAll('.mobile-back-button').forEach((button) => {
  button.addEventListener('click', () => document.body.classList.remove('mobile-stage-open'));
});
const btnAddGuild = document.getElementById('btnAddGuild');
const btnHomeDM = document.getElementById('btnHomeDM');
const serverHeaderWrapper = document.getElementById('serverHeaderWrapper');
const guildHeader = document.getElementById('guildHeader');
const guildTitle = document.getElementById('guildTitle');
const guildBadge = document.getElementById('guildBadge');
const guildDropdownIcon = document.getElementById('guildDropdownIcon');
const serverDropdownMenu = document.getElementById('serverDropdownMenu');

const channelsScroll = document.getElementById('channelsScroll');
const textChannelsContainer = document.getElementById('textChannelsContainer');
const voiceChannelsContainer = document.getElementById('voiceChannelsContainer');
const btnAddTextChannel = document.getElementById('btnAddTextChannel');
const btnAddVoiceChannel = document.getElementById('btnAddVoiceChannel');

const dmNavWrapper = document.getElementById('dmNavWrapper');
const currentChannelTitle = document.getElementById('currentChannelTitle');
const connectionBadge = document.getElementById('connectionBadge');
const voiceConnectionPanel = document.getElementById('voiceConnectionPanel');
const vcChannelText = document.getElementById('vcChannelText');
const vcPingValue = document.getElementById('vcPingValue');
const stagePingPill = document.getElementById('stagePingPill');
const vcPingBadge = document.getElementById('vcPingBadge');
const pingDot = document.getElementById('pingDot');
const vcSignalIcon = document.getElementById('vcSignalIcon');
const emptyState = document.getElementById('emptyState');
const stageContent = document.getElementById('stageContent');
const streamViewerWrapper = document.getElementById('streamViewerWrapper');
const remoteVideoPlayer = document.getElementById('remoteVideoPlayer');
const participantsGrid = document.getElementById('participantsGrid');
const voiceSelfCard = document.getElementById('voiceSelfCard');
const voiceSelfAvatar = document.getElementById('voiceSelfAvatar');
const voiceSelfAvatarImg = document.getElementById('voiceSelfAvatarImg');
const voiceSelfInitial = document.getElementById('voiceSelfInitial');
const voiceSelfName = document.getElementById('voiceSelfName');
const voiceSelfChannel = document.getElementById('voiceSelfChannel');
const voiceSelfSpeaking = document.getElementById('voiceSelfSpeaking');
const voiceFloatingBar = document.getElementById('voiceFloatingBar');
const btnToggleMic = document.getElementById('btnToggleMic');
const btnToggleDeaf = document.getElementById('btnToggleDeaf');
const btnShareScreen = document.getElementById('btnShareScreen');
const btnShareCam = document.getElementById('btnShareCam');
const btnDisconnectVoice = document.getElementById('btnDisconnectVoice');

// Botões da Barra Flutuante do Palco (Foto 1)
const btnStageMic = document.getElementById('btnStageMic');
const stageMicIcon = document.getElementById('stageMicIcon');
const btnStageActivities = document.getElementById('btnStageActivities');
const btnStageSoundboard = document.getElementById('btnStageSoundboard');

// Atalhos Rápidos da Dock de Voz (Foto 1 & 2)
const dockBtnCam = document.getElementById('dockBtnCam');
const dockBtnStream = document.getElementById('dockBtnStream');
const dockBtnActivities = document.getElementById('dockBtnActivities');
const dockBtnSoundboard = document.getElementById('dockBtnSoundboard');
const btnQuickDisconnect = document.getElementById('btnQuickDisconnect');

// Painel de Atividade de Jogo (Counter-Strike 2 - Foto 1 & 2)
const gameActivityPanel = document.getElementById('gameActivityPanel');
const gameActivityTitle = document.getElementById('gameActivityTitle');
const gameActivityStatus = document.getElementById('gameActivityStatus');
const btnGameQuickStream = document.getElementById('btnGameQuickStream');

// Popup Flutuante do Soundboard Rápido
const soundboardQuickPopup = document.getElementById('soundboardQuickPopup');
const btnCloseSoundboardQuick = document.getElementById('btnCloseSoundboardQuick');
const customSoundboardQuickGrid = document.getElementById('customSoundboardQuickGrid');

// Notificações Toast
const toastNotification = document.getElementById('toastNotification');
const toastIcon = document.getElementById('toastIcon');
const toastMsg = document.getElementById('toastMsg');

// Modal Criar Servidor
const createServerModal = document.getElementById('createServerModal');
const btnCloseServerModal = document.getElementById('btnCloseServerModal');
const btnCancelServer = document.getElementById('btnCancelServer');
const btnConfirmServer = document.getElementById('btnConfirmServer');
const inputServerName = document.getElementById('inputServerName');

// Modal Criar Canal (Texto ou Voz)
const createChannelModal = document.getElementById('createChannelModal');
const btnCloseChannelModal = document.getElementById('btnCloseChannelModal');
const btnCancelCreateChannel = document.getElementById('btnCancelCreateChannel');
const btnConfirmCreateChannel = document.getElementById('btnConfirmCreateChannel');
const inputNewChannelName = document.getElementById('inputNewChannelName');
const createChannelSubtitle = document.getElementById('createChannelSubtitle');
const channelInputPrefix = document.getElementById('channelInputPrefix');
const optTypeText = document.getElementById('optTypeText');
const optTypeVoice = document.getElementById('optTypeVoice');

// Visão do Canal de Chat de Texto (Foto 1)
const textChatView = document.getElementById('textChatView');
const chatChannelTitle = document.getElementById('chatChannelTitle');
const chatWelcomeTitle = document.getElementById('chatWelcomeTitle');
const chatWelcomeDesc = document.getElementById('chatWelcomeDesc');
const chatMessagesScroll = document.getElementById('chatMessagesScroll');
const messagesList = document.getElementById('messagesList');
const chatInputForm = document.getElementById('chatInputForm');
const chatInputText = document.getElementById('chatInputText');
const chatAttachButton = document.querySelector('.chat-attach-btn');
const chatAttachMenu = document.getElementById('chatAttachMenu');
const chatImageInput = document.getElementById('chatImageInput');
const chatFileInput = document.getElementById('chatFileInput');
const btnChatEmoji = document.getElementById('btnChatEmoji');
const btnJumpToVoice = document.getElementById('btnJumpToVoice');
const voiceConnectedStrip = document.getElementById('voiceConnectedStrip');
const stripChannelName = document.getElementById('stripChannelName');
const btnToggleMembers = document.getElementById('btnToggleMembers');
const btnToggleVoiceMembers = document.getElementById('btnToggleVoiceMembers');
const btnCloseMembers = document.getElementById('btnCloseMembers');
const membersSidebar = document.getElementById('membersSidebar');
const membersScroll = document.getElementById('membersScroll');

// Visão de Início / Amigos / DMs (Foto 2)
const friendsView = document.getElementById('friendsView');
const friendsCardsList = document.getElementById('friendsCardsList');
const activeNowList = document.getElementById('activeNowList');
const dmConversationsList = document.getElementById('dmConversationsList');
const inputFriendsSearch = document.getElementById('inputFriendsSearch');
const friendsCountLabel = document.getElementById('friendsCountLabel');

// Modal de Confirmação de Troca de Canal de Voz
const voiceSwitchModal = document.getElementById('voiceSwitchModal');
const btnCancelVoiceSwitch = document.getElementById('btnCancelVoiceSwitch');
const btnConfirmVoiceSwitch = document.getElementById('btnConfirmVoiceSwitch');
const btnCloseVoiceSwitchModal = document.getElementById('btnCloseVoiceSwitchModal');
const chkDontAskVoiceSwitch = document.getElementById('chkDontAskVoiceSwitch');

// Modal Compartilhamento de Tela
const screenShareModal = document.getElementById('screenShareModal');
const btnCloseModal = document.getElementById('btnCloseModal');
const btnCancelShare = document.getElementById('btnCancelShare');
const btnConfirmShare = document.getElementById('btnConfirmShare');
const sourcesGrid = document.getElementById('sourcesGrid');
const selectResolution = document.getElementById('selectResolution');
const selectFps = document.getElementById('selectFps');

// ==========================================
// ESTADO DE NAVEGAÇÃO E VISÕES
// ==========================================
let currentView = 'voice'; // 'voice' | 'chat' | 'friends'
let currentTextChannel = 'geral';
let inHomeView = false;
let selectedChannelType = 'text';
let isCamActive = false;
let localCamTrack = null;
let toastTimeout = null;
let suppressVoiceSwitchPrompt = false;
let pendingVoiceSwitchTarget = null;
let resolveVoiceSwitchPrompt = null;

// Sistema de Notificações Toast
function showToast(msg, icon = '📋') {
  if (!toastNotification) return;
  if (toastIcon) toastIcon.textContent = icon;
  if (toastMsg) toastMsg.textContent = msg;

  toastNotification.style.display = 'flex';
  toastNotification.classList.add('show');

  if (toastTimeout) clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => {
    toastNotification.classList.remove('show');
    setTimeout(() => {
      toastNotification.style.display = 'none';
    }, 250);
  }, 2800);
}

// Alternar entre as 3 visões principais
function switchView(viewName) {
  currentView = viewName;
  document.body.classList.add('mobile-stage-open');
  const voiceStageView = document.getElementById('voiceStageView');

  if (voiceStageView) voiceStageView.style.display = viewName === 'voice' ? 'flex' : 'none';
  if (textChatView) textChatView.style.display = viewName === 'chat' ? 'flex' : 'none';
  if (friendsView) friendsView.style.display = viewName === 'friends' ? 'flex' : 'none';
  updateVoiceSelfCard();

  if (membersSidebar) {
    const showMembers = (viewName === 'chat' || viewName === 'voice') && !currentDmFriend;
    membersSidebar.style.display = showMembers ? 'flex' : 'none';
    if (!showMembers) {
      membersSidebar.classList.remove('is-open');
      [btnToggleMembers, btnToggleVoiceMembers].filter(Boolean).forEach((button) => {
        button.setAttribute('aria-expanded', 'false');
      });
    }
  }

  if (voiceConnectedStrip) {
    if (currentChannel && viewName === 'chat') {
      voiceConnectedStrip.style.display = 'flex';
      if (stripChannelName) stripChannelName.textContent = currentChannel;
    } else {
      voiceConnectedStrip.style.display = 'none';
    }
  }
}

// ==========================================
// RENDERIZAÇÃO DE SERVIDORES E NAVEGAÇÃO
// ==========================================
function renderGuilds() {
  if (!guildList) return;
  guildList.innerHTML = '';

  servers.forEach(srv => {
    const icon = document.createElement('div');
    icon.className = `guild-icon-wrap ${!inHomeView && srv.id === activeServerId ? 'active' : ''}`;

    const serverIcon = document.createElement('button');
    serverIcon.type = 'button';
    serverIcon.className = 'guild-icon';
    serverIcon.setAttribute('aria-label', `Abrir servidor ${srv.name}`);
    serverIcon.title = srv.name;
    if (srv.iconUrl) {
      const image = document.createElement('img');
      image.src = srv.iconUrl;
      image.alt = '';
      serverIcon.appendChild(image);
    } else {
      serverIcon.textContent = srv.icon || srv.name.slice(0, 2).toUpperCase();
    }

    serverIcon.addEventListener('click', () => {
      restoreServerView(srv.id);
    });

    serverIcon.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      openServerContextMenu(e.clientX, e.clientY, srv);
    });

    icon.appendChild(serverIcon);

    if (srv.isOwner !== false) {
      const editButton = document.createElement('button');
      editButton.type = 'button';
      editButton.className = 'guild-icon-edit';
      editButton.setAttribute('aria-label', `Alterar imagem de ${srv.name}`);
      editButton.title = 'Alterar imagem do servidor';
      editButton.textContent = '📷';
      editButton.addEventListener('click', (event) => {
        event.stopPropagation();
        window.changeServerIcon?.(srv);
      });
      icon.appendChild(editButton);
    }

    guildList.appendChild(icon);
  });
}

function selectServer(serverId) {
  activeServerId = serverId;
  renderGuilds();

  const srv = servers.find(s => s.id === serverId);
  if (srv) {
    if (authenticatedAccount) loadServerMembers(serverId);
    if (guildTitle) guildTitle.textContent = srv.name;
    if (guildBadge) {
      guildBadge.replaceChildren();
      if (srv.iconUrl) {
        const image = document.createElement('img');
        image.src = srv.iconUrl;
        image.alt = '';
        guildBadge.appendChild(image);
      } else {
        guildBadge.textContent = srv.icon || '🍺';
      }
    }
    renderChannels(srv);
    if (authenticatedAccount) refreshServerVoiceRoster(serverId).catch((error) => {
      console.warn('Não foi possível atualizar os participantes dos canais de voz:', error);
    });
  }
  if (authenticatedAccount) loadCustomSoundboard();
}

// Renderização dos Canais de Texto e Voz do Servidor
function renderChannels(server) {
  if (textChannelsContainer) textChannelsContainer.innerHTML = '';
  if (voiceChannelsContainer) voiceChannelsContainer.innerHTML = '';

  // 1. Canais de Texto (#)
  const textChans = server.textChannels || ['geral', 'regras-da-casa', 'clipes-e-jogos'];
  textChans.forEach(chan => {
    const item = document.createElement('div');
    item.className = `channel-item text-channel-item ${currentView === 'chat' && currentTextChannel === chan ? 'active' : ''}`;
    item.dataset.channel = chan;
    item.dataset.type = 'text';

    const icon = document.createElement('span');
    icon.className = 'channel-icon';
    icon.textContent = '#';

    const name = document.createElement('span');
    name.className = 'channel-name';
    name.textContent = chan;

    item.appendChild(icon);
    item.appendChild(name);

    item.addEventListener('click', () => {
      openTextChannel(chan);
    });

    if (textChannelsContainer) textChannelsContainer.appendChild(item);
  });

  // 2. Canais de Voz (🔊)
  const voiceChans = server.voiceChannels || ['Geral 🔊', 'CS2 Competitivo', 'Live 1080p 60FPS'];
  voiceChans.forEach(chan => {
    const block = document.createElement('div');
    block.className = 'channel-block';
    block.dataset.channel = chan;

    const item = document.createElement('div');
    item.className = `channel-item voice-channel-item ${currentChannel === chan ? 'active' : ''}`;
    item.dataset.channel = chan;
    item.dataset.type = 'voice';

    const icon = document.createElement('span');
    icon.className = 'channel-icon';
    icon.textContent = '🔊';

    const name = document.createElement('span');
    name.className = 'channel-name';
    name.textContent = chan;

    item.appendChild(icon);
    item.appendChild(name);

    const settingsButton = document.createElement('button');
    settingsButton.type = 'button';
    settingsButton.className = 'voice-channel-settings-button';
    settingsButton.title = `Configurações de ${chan}`;
    settingsButton.setAttribute('aria-label', `Configurações de ${chan}`);
    settingsButton.textContent = '⚙';
    settingsButton.addEventListener('click', (event) => {
      event.stopPropagation();
      openVoiceChannelSettings(server, chan, settingsButton);
    });
    item.appendChild(settingsButton);

    const usersList = document.createElement('div');
    usersList.className = 'channel-users-list';
    usersList.id = `users-${chan}`;

    block.appendChild(item);
    block.appendChild(usersList);

    if (voiceChannelsContainer) voiceChannelsContainer.appendChild(block);

    item.addEventListener('click', () => {
      joinVoiceChannel(chan);
    });
  });

  (server.voiceChannels || []).forEach((channelName) => updateSidebarChannelUsers(channelName));
  applyProfileCustomization();
}

async function refreshServerVoiceRoster(serverId = activeServerId) {
  if (!authenticatedAccount || !serverId || voiceRosterRequestInProgress) return;
  voiceRosterRequestInProgress = true;
  try {
    const response = await fetch(`/api/servers/${encodeURIComponent(serverId)}/voice-participants`, {
      credentials: 'include',
      headers: { Accept: 'application/json' }
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || 'Não foi possível consultar os canais de voz.');
    if (serverId !== activeServerId) return;

    const rosters = new Map();
    Object.entries(payload.channels || {}).forEach(([channelName, participants]) => {
      rosters.set(channelName, Array.isArray(participants) ? participants : []);
    });
    serverVoiceRosters.set(serverId, rosters);
    const server = servers.find((item) => item.id === serverId);
    (server?.voiceChannels || []).forEach((channelName) => updateSidebarChannelUsers(channelName, serverId));
  } finally {
    voiceRosterRequestInProgress = false;
  }
}

function startVoiceRosterPolling() {
  clearInterval(voiceRosterPollingTimer);
  voiceRosterPollingTimer = null;
  if (!authenticatedAccount) return;
  refreshServerVoiceRoster().catch((error) => {
    console.warn('Não foi possível carregar os participantes dos canais de voz:', error);
  });
  voiceRosterPollingTimer = setInterval(() => {
    refreshServerVoiceRoster().catch((error) => {
      console.warn('Não foi possível atualizar os participantes dos canais de voz:', error);
    });
  }, 5000);
}

function closeVoiceChannelSettingsMenu() {
  document.querySelector('.voice-channel-settings-menu')?.remove();
}

function openVoiceChannelSettings(server, channelName, anchor) {
  closeVoiceChannelSettingsMenu();

  const menu = document.createElement('div');
  menu.className = 'voice-channel-settings-menu';
  const actions = [
    { label: '✏️ Editar nome', action: 'edit' },
    { label: '⚙️ Configurações de voz', action: 'settings' },
    { label: '🗑️ Excluir canal', action: 'delete', danger: true }
  ];

  actions.forEach(({ label, action, danger }) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    if (danger) button.className = 'danger';
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      closeVoiceChannelSettingsMenu();

      if (action === 'edit') {
        const nextName = window.prompt('Novo nome do canal de voz:', channelName)?.trim();
        if (!nextName || nextName === channelName) return;
        if (server.voiceChannels.includes(nextName)) {
          showToast('Já existe um canal com esse nome.', '⚠️');
          return;
        }
        const index = server.voiceChannels.indexOf(channelName);
        if (index < 0) return;
        server.voiceChannels[index] = nextName;
        if (currentChannel === channelName) currentChannel = nextName;
        saveServers();
        renderChannels(server);
        showToast(`Canal renomeado para ${nextName}.`, '✅');
      }

      if (action === 'settings') {
        const currentBitrate = server.voiceSettings?.[channelName]?.bitrate || 96;
        const bitrate = window.prompt('Bitrate do canal em kbps (64, 96, 128 ou 256):', String(currentBitrate))?.trim();
        if (!bitrate) return;
        const allowedBitrates = [64, 96, 128, 256];
        if (!allowedBitrates.includes(Number(bitrate))) {
          showToast('Escolha um bitrate válido: 64, 96, 128 ou 256 kbps.', '⚠️');
          return;
        }
        if (!server.voiceSettings) server.voiceSettings = {};
        server.voiceSettings[channelName] = { bitrate: Number(bitrate) };
        saveServers();
        showToast(`Bitrate de ${channelName} definido em ${bitrate} kbps.`, '⚙️');
      }

      if (action === 'delete') {
        if (server.voiceChannels.length <= 1) {
          showToast('Mantenha pelo menos um canal de voz.', '⚠️');
          return;
        }
        if (!window.confirm(`Excluir o canal de voz "${channelName}"?`)) return;
        if (currentChannel === channelName) disconnectVoice(false);
        server.voiceChannels = server.voiceChannels.filter((channel) => channel !== channelName);
        saveServers();
        renderChannels(server);
        showToast(`Canal ${channelName} excluído.`, '🗑️');
      }
    });
    menu.appendChild(button);
  });

  document.body.appendChild(menu);
  const rect = anchor.getBoundingClientRect();
  menu.style.left = `${Math.min(rect.right + 4, window.innerWidth - menu.offsetWidth - 8)}px`;
  menu.style.top = `${Math.min(rect.top, window.innerHeight - menu.offsetHeight - 8)}px`;
  window.setTimeout(() => document.addEventListener('click', closeVoiceChannelSettingsMenu, { once: true }), 0);
}

// Atualizar o nome do usuário embaixo da sala na barra lateral
function getServerOnlineProfiles() {
  if (!hasAuthenticatedSession()) return [];

  const localMember = {
    id: authenticatedAccount?.id || 'self',
    name: userProfile.displayName || 'Bads',
    tag: userProfile.tag || '0001',
    fullTag: `${userProfile.displayName || 'Bads'}#${userProfile.tag || '0001'}`,
    initial: (userProfile.displayName || 'B')[0].toUpperCase(),
    color: userProfile.bannerColor || '#5865F2',
    avatarUrl: userProfile.avatarUrl || '',
    profileTags: userProfile.profileTags,
    game: detectedGame && detectedGame.name ? detectedGame.name : '',
    detail: userProfile.aboutMe || 'Disponível',
    status: currentChannel ? 'online' : (userProfile.presenceStatus === 'invisible' ? 'offline' : (userProfile.presenceStatus || 'online')),
    isOwner: true
  };

  const rosterMembers = (Array.isArray(getStoredPresenceMembers()) ? getStoredPresenceMembers() : []).map((member) => ({
    id: member.id || member.fullTag || member.name,
    name: member.name || 'Bads',
    username: member.username || '',
    tag: member.tag || '0001',
    fullTag: member.fullTag || `${member.name || 'Bads'}#${member.tag || '0001'}`,
    profileTags: Array.isArray(member.profileTags) ? member.profileTags : [],
    initial: member.initial || (member.name || 'B')[0].toUpperCase(),
    color: member.color || '#5865F2',
    avatarUrl: member.avatarUrl || '',
    game: member.game || '',
    detail: member.detail || 'Disponível',
    status: member.status || 'online',
    isOwner: false
  })).filter((member) => (member.status || 'online') !== 'offline');

  const onlineFriends = (Array.isArray(friendsList) ? friendsList : []).filter((friend) => {
    const state = (friend.status || 'online');
    return state !== 'offline';
  }).map((friend) => ({
    id: friend.id,
    name: friend.name,
    username: friend.username || '',
    tag: friend.tag || '0001',
    fullTag: friend.fullTag || `${friend.name}#${friend.tag || '0001'}`,
    initial: friend.initial || friend.name[0].toUpperCase(),
    color: friend.color || '#5865F2',
    avatarUrl: friend.avatarUrl || '',
    game: friend.game || '',
    detail: friend.detail || 'Disponível',
    status: friend.status || 'online',
    isOwner: false
  }));

  const combined = dedupePresenceEntries([
    localMember,
    ...rosterMembers,
    ...onlineFriends
  ]);

  return combined.map(applyUserNickname).filter((member) => {
    const status = (member.status || 'online');
    return status !== 'offline';
  });
}

function getVoiceChannelParticipants(channelName = currentChannel, serverId = activeServerId) {
  if (!hasAuthenticatedSession() || !channelName) return [];

  const roomName = getLiveKitRoomName(channelName, serverId);
  const isCurrentVoiceRoom = Boolean(
    livekitRoom &&
    livekitRoom.state === 'connected' &&
    livekitRoom.name === roomName
  );
  const profilesById = new Map();
  getStoredPresenceMembers().forEach((member) => {
    const id = member?.id ? String(member.id) : '';
    if (id) profilesById.set(id, member);
  });
  (serverMembersByServer.get(serverId) || []).forEach((member) => {
    const id = member?.id ? String(member.id) : '';
    if (id) profilesById.set(id, member);
  });
  (Array.isArray(friendsList) ? friendsList : []).forEach((friend) => {
    const id = friend?.id ? String(friend.id) : '';
    if (id && !profilesById.has(id)) profilesById.set(id, friend);
  });

  if (!isCurrentVoiceRoom) {
    return (serverVoiceRosters.get(serverId)?.get(channelName) || []).map((participant) => {
      const profile = profilesById.get(participant.id) || {};
      const name = participant.name || profile.name || participant.id || 'Usuário';
      return applyUserNickname({
        id: participant.id,
        name,
        username: profile.username || '',
        tag: profile.tag || '0001',
        fullTag: profile.fullTag || `${name}#${profile.tag || '0001'}`,
        initial: profile.initial || name[0].toUpperCase(),
        color: profile.color || '#5865F2',
        avatarUrl: profile.avatarUrl || '',
        game: profile.game || '',
        activityType: profile.activityType || (profile.game ? 'game' : ''),
        activityText: profile.activityText || profile.game || '',
        activityArtwork: profile.activityArtwork || '',
        activityUrl: profile.activityUrl || '',
        detail: profile.detail || 'Disponível',
        status: 'online',
        isOwner: false,
        isSpeaking: false,
        isStreaming: false,
        pingMs: null,
        viewerCount: 0
      });
    });
  }

  const localMember = {
    id: 'self',
    name: userProfile.displayName || 'Bads',
    tag: userProfile.tag || '0001',
    fullTag: `${userProfile.displayName || 'Bads'}#${userProfile.tag || '0001'}`,
    initial: (userProfile.displayName || 'B')[0].toUpperCase(),
    color: userProfile.bannerColor || '#5865F2',
    avatarUrl: userProfile.avatarUrl || '',
    game: detectedGame?.name || '',
    activityType: detectedGame?.name ? 'game' : (spotifyActivity ? 'music' : ''),
    activityText: detectedGame?.name || spotifyActivity?.text || '',
    activityArtwork: detectedGame?.appIcon || spotifyActivity?.artwork || '',
    activityUrl: spotifyActivity?.url || '',
    detail: userProfile.aboutMe || 'Disponível',
    status: 'online',
    isOwner: true,
    isSpeaking: isLocalSpeaking,
    isStreaming: isLocalStreamer || remoteScreenTracks.has(getMobileScreenShareIdentity(livekitRoom?.localParticipant?.identity || authenticatedAccount?.id || '')),
    screenShareParticipantId: isNativeMobileStreamer || remoteScreenTracks.has(getMobileScreenShareIdentity(livekitRoom?.localParticipant?.identity || authenticatedAccount?.id || ''))
      ? getMobileScreenShareIdentity(livekitRoom?.localParticipant?.identity || authenticatedAccount?.id || '')
      : '',
    pingMs: currentVoiceRttMs,
    viewerCount: isLocalStreamer && isCurrentVoiceRoom ? getVoiceViewerCount() : 0
  };

  const participants = [livekitRoom.localParticipant, ...livekitRoom.remoteParticipants.values()]
    .filter((participant) => participant === livekitRoom.localParticipant || !isMobileScreenShareIdentity(participant.identity));
  return participants.filter(Boolean).map((participant) => {
    if (participant === livekitRoom.localParticipant) return localMember;

    const profile = profilesById.get(participant.identity) || {};
    const name = participant.name || profile.name || participant.identity || 'Usuário';
    const mobileScreenShareIdentity = getMobileScreenShareIdentity(participant.identity);
    const hasMobileScreenShare = remoteScreenTracks.has(mobileScreenShareIdentity);
    const isStreaming = Array.from(participant.videoTrackPublications.values()).some((publication) => (
      publication.source === window.LivekitClient.Track.Source.ScreenShare
    )) || remoteScreenTracks.has(participant.identity) || hasMobileScreenShare;
    const pingReport = voiceRttByIdentity.get(participant.identity);
    return applyUserNickname({
      id: participant.identity,
      name,
      username: profile.username || '',
      tag: profile.tag || '0001',
      fullTag: profile.fullTag || `${name}#${profile.tag || '0001'}`,
      initial: profile.initial || name[0].toUpperCase(),
      color: profile.color || '#5865F2',
      avatarUrl: profile.avatarUrl || '',
      game: profile.game || '',
      activityType: profile.activityType || (profile.game ? 'game' : ''),
      activityText: profile.activityText || profile.game || '',
      activityArtwork: profile.activityArtwork || '',
      activityUrl: profile.activityUrl || '',
      detail: profile.detail || 'Disponível',
      status: 'online',
      isOwner: false,
      isSpeaking: Boolean(participant.isSpeaking),
      isMuted: participant.isMicrophoneEnabled === false,
      isStreaming,
      screenShareParticipantId: hasMobileScreenShare ? mobileScreenShareIdentity : participant.identity,
      pingMs: pingReport && Date.now() - pingReport.receivedAt < 15000 ? pingReport.rttMs : null,
      viewerCount: isStreaming ? getVoiceViewerCount() : 0
    });
  });
}

function renderLiveIndicator(member) {
  if (!member.isStreaming) return null;
  const indicator = document.createElement('span');
  indicator.className = 'live-indicator';
  indicator.title = `${member.viewerCount || 0} assistindo`;
  const badge = document.createElement('span');
  badge.className = 'live-indicator-badge';
  badge.textContent = `● AO VIVO ${member.viewerCount || 0}`;
  indicator.appendChild(badge);
  if (member.id !== 'self') {
    const watchButton = document.createElement('button');
    watchButton.type = 'button';
    watchButton.className = 'live-watch-button';
    watchButton.textContent = 'Assistir';
    watchButton.setAttribute('aria-label', `Assistir à transmissão de ${member.name}`);
    watchButton.addEventListener('click', (event) => {
      event.stopPropagation();
      watchLiveStream(member.screenShareParticipantId || member.id);
    });
    indicator.appendChild(watchButton);
  }
  return indicator;
}

function watchLiveStream(participantId) {
  if (!currentChannel || !livekitRoom || livekitRoom.state !== 'connected') {
    showToast('Entre no canal de voz para assistir a esta transmissão.', '⚠️');
    return;
  }
  const stream = remoteScreenTracks.get(participantId);
  if (!stream || !remoteVideoPlayer || !streamViewerWrapper) {
    showToast('A transmissão está conectando. Tente novamente em instantes.', '⏳');
    return;
  }
  try {
    const mobileQuality = window.LivekitClient?.VideoQuality?.MEDIUM;
    const desktopQuality = window.LivekitClient?.VideoQuality?.HIGH;
    const requestedQuality = isMobileStreamDevice() ? mobileQuality : desktopQuality;
    if (requestedQuality !== undefined) stream.publication?.setVideoQuality(requestedQuality);
    stream.track.attach(remoteVideoPlayer);
    remoteVideoPlayer.muted = true;
    remoteVideoPlayer.defaultMuted = true;
    streamViewerWrapper.style.display = 'flex';
    const streamerName = document.getElementById('streamerName');
    if (streamerName) streamerName.textContent = `🎮 Ao Vivo: ${stream.participant.name || 'Transmissão'}`;
    const loopbackBadge = document.getElementById('streamLoopbackBadge');
    if (loopbackBadge) loopbackBadge.style.display = 'none';
    const viewerCount = document.getElementById('liveViewerCount');
    if (viewerCount) viewerCount.textContent = `👁 ${getVoiceViewerCount()}`;
    if (btnStopStreamDirect) btnStopStreamDirect.style.display = 'none';
    if (participantsGrid) participantsGrid.style.display = 'none';
    watchingLiveParticipantId = participantId;
    switchView('voice');
    remoteVideoPlayer.play().catch((error) => {
      console.warn('Não foi possível iniciar a reprodução da transmissão:', error);
      showToast('Clique na transmissão novamente para liberar a reprodução.', '⚠️');
    });
  } catch (error) {
    console.warn('Não foi possível abrir a transmissão:', error);
    showToast('Não foi possível abrir esta transmissão.', '⚠️');
  }
}

function isMobileStreamDevice() {
  const userAgent = navigator.userAgent || '';
  return Boolean(
    navigator.userAgentData?.mobile ||
    /Android|iPhone|iPad|iPod|Mobile/i.test(userAgent) ||
    (/Macintosh/i.test(userAgent) && navigator.maxTouchPoints > 1)
  );
}

function stopWatchingLive() {
  if (watchingLiveParticipantId) {
    const stream = remoteScreenTracks.get(watchingLiveParticipantId);
    if (stream) stream.track.detach(remoteVideoPlayer);
  }
  watchingLiveParticipantId = '';
  if (remoteVideoPlayer && !isLocalStreamer) remoteVideoPlayer.srcObject = null;
  if (streamViewerWrapper && !isLocalStreamer) streamViewerWrapper.style.display = 'none';
  const viewerCount = document.getElementById('liveViewerCount');
  if (viewerCount && !isLocalStreamer) viewerCount.textContent = '👁 0';
  if (btnStopStreamDirect) btnStopStreamDirect.style.display = '';
  if (participantsGrid && currentChannel && !isLocalStreamer) participantsGrid.style.display = 'grid';
}

function refreshVoiceParticipantViews() {
  if (livekitRoom?.state === 'connected' && (isLocalStreamer || watchingLiveParticipantId)) {
    const viewerCount = document.getElementById('liveViewerCount');
    if (viewerCount) viewerCount.textContent = `👁 ${getVoiceViewerCount()}`;
  }
  if (!currentChannel) return;
  updateSidebarChannelUsers(currentChannel);
  renderVoiceParticipants();
}

function updateSidebarChannelUsers(channelName, serverId = activeServerId) {
  if (!channelName) return;

  const targetList = document.getElementById(`users-${channelName}`);
  if (!targetList) return;
  targetList.innerHTML = '';

  const onlineMembers = getVoiceChannelParticipants(channelName, serverId);
  onlineMembers.forEach((member) => {
    const userItem = document.createElement('div');
    userItem.className = 'channel-user-item';
    userItem.dataset.participantIdentity = member.id;
    userItem.dataset.channelName = channelName;
    userItem.dataset.serverId = serverId;
    userItem.id = member.id === 'self' ? 'sidebarLocalUser' : '';
    if (member.id === 'self' && isLocalSpeaking) userItem.classList.add('speaking');

    const avatar = document.createElement('div');
    avatar.className = 'channel-user-avatar';
    if (member.avatarUrl) {
      avatar.innerHTML = `<img src="${member.avatarUrl}" style="width:100%;height:100%;border-radius:50%;object-fit:cover;">`;
    } else {
      avatar.style.backgroundColor = member.color || '#5865F2';
      avatar.textContent = member.initial || member.name[0].toUpperCase();
    }

    const name = document.createElement('span');
    name.className = 'channel-user-name';
    name.textContent = member.name;
    const isCurrentVoiceRoom = livekitRoom?.state === 'connected' &&
      livekitRoom.name === getLiveKitRoomName(channelName, serverId);

    const micIcon = document.createElement('span');
    micIcon.className = 'channel-user-mic';
    micIcon.id = member.id === 'self' ? 'sidebarUserMic' : '';
    micIcon.textContent = member.id === 'self'
      ? (isDeafened ? '🔇 🚫🎧' : (isMuted ? '🔇' : '🎤'))
      : (member.isMuted === true ? '🔇' : (member.isMuted === false ? (member.game ? '🎮' : '🔊') : ''));

    userItem.appendChild(avatar);
    userItem.appendChild(name);
    if (isCurrentVoiceRoom) userItem.appendChild(createParticipantRttBadge(member));
    const liveIndicator = renderLiveIndicator(member);
    if (liveIndicator) userItem.appendChild(liveIndicator);
    userItem.appendChild(micIcon);
    targetList.appendChild(userItem);
    userItem.addEventListener('click', (event) => {
      openMemberProfilePopover(member, event);
    });
  });
}

// Renderizar participantes na tela principal da sala de voz (Estilo Discord 1:1)
function renderVoiceParticipants() {
  if (!participantsGrid) return;
  remoteCameraTracks.forEach((track) => track.detach());
  if (localCamTrack) localCamTrack.detach();
  participantsGrid.innerHTML = '';

  const onlineMembers = getVoiceChannelParticipants();

  onlineMembers.forEach((member) => {
    const card = document.createElement('div');
    card.className = 'participant-card';
    card.dataset.participantIdentity = member.id;
    if (member.id === 'self') {
      card.id = 'localParticipantCard';
      if (isLocalSpeaking) card.classList.add('speaking');
    }
    if (member.id !== 'self' && member.isSpeaking) card.classList.add('speaking');

    const cameraTrack = member.id === 'self'
      ? (isCamActive ? localCamTrack : null)
      : remoteCameraTracks.get(member.id);
    if (cameraTrack) {
      card.classList.add('has-camera');
      const cameraVideo = document.createElement('video');
      cameraVideo.className = 'participant-camera-video';
      cameraVideo.autoplay = true;
      cameraVideo.playsInline = true;
      cameraVideo.muted = member.id === 'self';
      cameraTrack.attach(cameraVideo);
      cameraVideo.play().catch((error) => {
        console.warn('Não foi possível reproduzir a câmera:', error);
      });
      card.appendChild(cameraVideo);
    }

    const avatar = document.createElement('div');
    avatar.className = 'participant-avatar-lg';
    if (member.avatarUrl) {
      avatar.innerHTML = `<img src="${member.avatarUrl}" alt="Avatar">`;
    } else {
      avatar.style.backgroundColor = member.color || '#5865F2';
      avatar.textContent = (member.name || 'U')[0].toUpperCase();
    }

    const tag = document.createElement('div');
    tag.className = 'participant-name-tag';

    const nameSpan = document.createElement('span');
    nameSpan.textContent = member.name;
    tag.appendChild(nameSpan);
    tag.appendChild(createParticipantRttBadge(member));
    const liveIndicator = renderLiveIndicator(member);
    if (liveIndicator) tag.appendChild(liveIndicator);

    if (member.game) {
      const gamePill = document.createElement('span');
      gamePill.className = 'participant-game-pill';
      gamePill.textContent = member.game;
      tag.appendChild(gamePill);
    }

    const micIcon = document.createElement('div');
    micIcon.className = 'participant-mic-icon';
    micIcon.id = member.id === 'self' ? 'participantMicIcon' : '';
    micIcon.textContent = member.id === 'self'
      ? (isMuted ? '🔇' : (isDeafened ? '🚫🎧' : '🎤'))
      : (member.isMuted ? '🔇' : (member.game ? '🎮' : '🔊'));

    card.appendChild(avatar);
    card.appendChild(tag);
    card.appendChild(micIcon);
    participantsGrid.appendChild(card);
    card.addEventListener('click', (event) => {
      openMemberProfilePopover(member, event);
    });
  });
}

function updateVoiceSelfCard() {
  if (!voiceSelfCard) return;
  const isVisible = Boolean(currentChannel && currentView === 'voice' && hasAuthenticatedSession());
  voiceSelfCard.style.display = isVisible ? 'flex' : 'none';
  if (!isVisible) {
    updateLocalSpeakingState(false);
    return;
  }

  if (voiceSelfName) voiceSelfName.textContent = userProfile.displayName || userProfile.username || 'Bads';
  if (voiceSelfChannel) voiceSelfChannel.textContent = `No canal: ${currentChannel}`;
  if (voiceSelfAvatarImg && voiceSelfInitial) {
    if (userProfile.avatarUrl) {
      voiceSelfAvatarImg.src = userProfile.avatarUrl;
      voiceSelfAvatarImg.style.display = 'block';
      voiceSelfInitial.style.display = 'none';
    } else {
      voiceSelfAvatarImg.removeAttribute('src');
      voiceSelfAvatarImg.style.display = 'none';
      voiceSelfInitial.style.display = 'block';
      voiceSelfInitial.textContent = (userProfile.displayName || userProfile.username || 'B')[0].toUpperCase();
    }
  }
  if (voiceSelfAvatar) voiceSelfAvatar.style.backgroundColor = userProfile.bannerColor || '#5865F2';
}

function updateLocalSpeakingState(isSpeaking) {
  isLocalSpeaking = isSpeaking;
  const participantCard = document.getElementById('localParticipantCard');
  const sidebarUser = document.getElementById('sidebarLocalUser');
  [participantCard, sidebarUser, voiceSelfCard].forEach((element) => {
    if (element) element.classList.toggle('speaking', isSpeaking);
  });
  if (voiceSelfSpeaking) voiceSelfSpeaking.hidden = !isSpeaking;
}

function openVoiceSwitchConfirmation(targetChannel) {
  const voiceSwitchModal = document.getElementById('voiceSwitchModal');
  const voiceSwitchTargetName = document.getElementById('voiceSwitchTargetName');
  const dontAskCheckbox = document.getElementById('chkDontAskVoiceSwitch');

  if (!voiceSwitchModal || !voiceSwitchTargetName) {
    return Promise.resolve(true);
  }

  pendingVoiceSwitchTarget = targetChannel;
  voiceSwitchTargetName.textContent = targetChannel;
  if (dontAskCheckbox) dontAskCheckbox.checked = false;
  voiceSwitchModal.style.display = 'flex';

  return new Promise((resolve) => {
    resolveVoiceSwitchPrompt = resolve;
  });
}

function closeVoiceSwitchConfirmation() {
  const voiceSwitchModal = document.getElementById('voiceSwitchModal');
  if (voiceSwitchModal) voiceSwitchModal.style.display = 'none';
  pendingVoiceSwitchTarget = null;
  resolveVoiceSwitchPrompt = null;
}

// Conectar ao Canal de Voz
async function joinVoiceChannel(channelName) {
  if (!hasAuthenticatedSession()) {
    showAuthOverlay();
    openAuthView('viewAuthLogin');
    showToast('Crie uma conta e faça login para entrar no canal de voz.', '🔒');
    return;
  }

  if (currentChannel === channelName) {
    switchView('voice');
    return;
  }

  if (currentChannel && currentChannel !== channelName) {
    if (!suppressVoiceSwitchPrompt) {
      const shouldSwitch = await openVoiceSwitchConfirmation(channelName);
      if (!shouldSwitch) return;
    }

    await disconnectVoice(false);
  }

  playConnectSound();

  currentChannel = channelName;
  currentChannelTitle.textContent = channelName;
  switchView('voice');

  document.querySelectorAll('.channel-item[data-type="voice"]').forEach(i => {
    i.classList.toggle('active', i.dataset.channel === channelName);
  });

  updateSidebarChannelUsers(channelName);

  emptyState.style.display = 'none';
  participantsGrid.style.display = 'grid';
  voiceFloatingBar.style.removeProperty('display');
  connectionBadge.style.display = 'flex';

  if (voiceConnectionPanel) {
    voiceConnectionPanel.style.display = 'flex';
    const activeSrv = servers.find(s => s.id === activeServerId);
    if (vcChannelText) {
      vcChannelText.textContent = `${channelName} / ${activeSrv?.name || 'Servidor'}`;
    }
  }
  startPingMonitor();
  renderVoiceParticipants();

  try {
    const room = await connectToLiveKitRoom(channelName);
    if (!room || room.state !== 'connected') throw new Error('Não foi possível conectar ao canal de voz.');
    void measurePing();
    const microphoneTrack = await publishMicToLiveKit();
    if (microphoneTrack?.mediaStreamTrack) {
      localAudioTrack = microphoneTrack.mediaStreamTrack;
      await setupAudioLevelMeter(new MediaStream([localAudioTrack]));
    } else if (localVoiceCanPublish) {
      throw new Error('Não foi possível ativar o microfone.');
    } else {
      isMuted = true;
      updateControlsUI();
      showToast('Você pode ouvir o canal, mas está silenciado neste servidor.', '🔇');
    }
    if (localVoiceCanPublish) await publishSoundboardTrack();
    refreshVoiceParticipantViews();
    if (localVoiceCanPublish) showToast(`Conectado a ${channelName}; microfone ${isMuted ? 'mutado' : 'ativo'}.`, '🎧');
  } catch (err) {
    console.warn('Microfone não acessível ou sem permissão:', err);
    isMuted = true;
    updateControlsUI();
    await disconnectVoice(false);
    showToast(err.message || 'Não foi possível conectar ao canal de voz.', '⚠️');
  }
}

// ==========================================
// CHAT DE TEXTO & CONVERSAS DIRETAS (DMs)
// ==========================================
let currentDmFriend = null;
let channelMessagesPollingTimer = null;
let channelMessagesLoadGeneration = 0;
let channelMessagesSince = '';
let directMessagesSince = '';

function openTextChannel(channelName) {
  currentDmFriend = null;
  currentTextChannel = channelName;
  switchView('chat');

  if (chatChannelTitle) chatChannelTitle.textContent = channelName;
  if (chatWelcomeTitle) chatWelcomeTitle.textContent = `Bem-vindo a #${channelName}!`;
  if (chatWelcomeDesc) chatWelcomeDesc.textContent = `Este é o início do canal #${channelName}. Envie mensagens e compartilhe com os amigos.`;
  if (chatInputText) chatInputText.placeholder = `Conversar em #${channelName}`;

  document.querySelectorAll('.channel-item[data-type="text"]').forEach(el => {
    el.classList.toggle('active', el.dataset.channel === channelName);
  });
  document.querySelectorAll('.dm-conversation-item').forEach(el => el.classList.remove('active'));

  const membersSidebar = document.getElementById('membersSidebar');
  if (membersSidebar) membersSidebar.style.display = '';

  loadAndRenderMessages(activeServerId, channelName);
  renderServerMembers();
}

function openDirectMessage(friend) {
  clearInterval(channelMessagesPollingTimer);
  channelMessagesPollingTimer = null;
  channelMessagesLoadGeneration += 1;
  currentDmFriend = friend;
  switchView('chat');

  const titleText = `${friend.name} #${friend.tag}`;
  if (chatChannelTitle) chatChannelTitle.textContent = `@${friend.name}`;
  if (chatWelcomeTitle) chatWelcomeTitle.textContent = `@${friend.fullTag || titleText}`;
  if (chatWelcomeDesc) chatWelcomeDesc.textContent = `Este é o início da sua mensagem direta com @${friend.fullTag || titleText}. Envie uma mensagem ou convide para jogar!`;
  if (chatInputText) chatInputText.placeholder = `Conversar com @${friend.name}`;

  document.querySelectorAll('.channel-item').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.dm-conversation-item').forEach(el => {
    el.classList.toggle('active', el.dataset.friendId === friend.id);
  });

  // Em DM oculta lista de membros do servidor
  const membersSidebar = document.getElementById('membersSidebar');
  if (membersSidebar) membersSidebar.style.display = 'none';

  loadAndRenderDMMessages(friend);
}

function getChatStorageKey(srvId, chanName) {
  return `badiscord_messages_${authenticatedAccount?.id || 'guest'}_${srvId}_${chanName}`;
}

function getDirectMessagesStorageKey(friendId) {
  return `badiscord_dm_messages_${authenticatedAccount?.id || 'guest'}_${friendId}`;
}

function getStoredMessages(srvId, chanName) {
  const key = getChatStorageKey(srvId, chanName);
  if (channelMessagesCache.has(key)) return channelMessagesCache.get(key);
  try {
    const raw = localStorage.getItem(key);
    if (raw) {
      const parsed = JSON.parse(raw);
      // Remove mensagens mockadas antigas se existirem
      const clean = parsed.filter(m => m.author !== 'BADISCORD Bot' && m.id !== 2);
      if (clean.length !== parsed.length) {
        localStorage.setItem(key, JSON.stringify(clean));
      }
      channelMessagesCache.set(key, clean);
      return clean;
    }
  } catch (e) {}
  // O chat começa limpo por padrão (sem mensagens falsas)
  return [];
}

function getStoredDMMessages(friendId, friend) {
  const key = getDirectMessagesStorageKey(friendId);
  if (directMessagesCache.has(key)) return directMessagesCache.get(key);
  try {
    const raw = localStorage.getItem(key);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        directMessagesCache.set(key, parsed);
        return parsed;
      }
    }
  } catch (e) {}
  return [];
}

function renderChannelMessages(messages, shouldScroll = true) {
  if (!messagesList) return;
  const wasAtBottom = !chatMessagesScroll ||
    chatMessagesScroll.scrollHeight - chatMessagesScroll.scrollTop - chatMessagesScroll.clientHeight < 100;
  messagesList.innerHTML = '';
  messages.forEach((msg) => messagesList.appendChild(createMessageElement(msg)));
  if (shouldScroll && wasAtBottom) scrollChatToBottom();
}

function channelMessagesUrl(srvId, chanName) {
  return `/api/servers/${encodeURIComponent(srvId)}/channels/${encodeURIComponent(chanName)}/messages`;
}

async function requestChannelMessages(srvId, chanName, options = {}) {
  const response = await fetch(options.url || channelMessagesUrl(srvId, chanName), {
    method: options.method || 'GET',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    ...(options.body ? { body: JSON.stringify(options.body) } : {})
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || 'Não foi possível sincronizar as mensagens do canal.');
  return payload;
}

function cacheChannelMessages(srvId, chanName, messages) {
  const key = getChatStorageKey(srvId, chanName);
  channelMessagesCache.set(key, messages);
  try {
    localStorage.setItem(key, JSON.stringify(messages));
  } catch (error) {
    console.error('Não foi possível atualizar o cache local das mensagens:', error);
  }
}

async function syncChannelMessages(srvId, chanName, generation, showError = false) {
  if (!authenticatedAccount) return;
  try {
    const since = channelMessagesSince;
    const url = `${channelMessagesUrl(srvId, chanName)}${since ? `?since=${encodeURIComponent(since)}` : ''}`;
    const payload = await requestChannelMessages(srvId, chanName, { url });
    if (generation !== channelMessagesLoadGeneration ||
      currentDmFriend || activeServerId !== srvId || currentTextChannel !== chanName) return;
    const changedMessages = Array.isArray(payload.messages) ? payload.messages : [];
    if (!payload.full && changedMessages.length === 0) return;
    const cachedMessages = getStoredMessages(srvId, chanName);
    const messages = payload.full
      ? changedMessages
      : changedMessages.reduce((current, changed) => {
        const index = current.findIndex((message) => message.id === changed.id);
        if (index === -1) current.push(changed);
        else current[index] = changed;
        return current;
      }, cachedMessages).slice(-200);
    const latestUpdatedAt = messages.reduce((latest, message) => (
      Date.parse(message.updatedAt || '') > Date.parse(latest || '')
        ? message.updatedAt
        : latest
    ), '');
    if (latestUpdatedAt) channelMessagesSince = latestUpdatedAt;
    if (JSON.stringify(cachedMessages) === JSON.stringify(messages)) return;
    cacheChannelMessages(srvId, chanName, messages);
    renderChannelMessages(messages);
  } catch (error) {
    console.error('Falha ao sincronizar mensagens do canal:', error);
    if (showError) showToast(error.message || 'Não foi possível carregar as mensagens deste canal.', '⚠️');
  }
}

function directMessagesUrl(friendId) {
  return `/api/dms/${encodeURIComponent(friendId)}/messages`;
}

function cacheDirectMessages(friendId, messages) {
  const key = getDirectMessagesStorageKey(friendId);
  directMessagesCache.set(key, messages);
  try {
    localStorage.setItem(key, JSON.stringify(messages));
  } catch (error) {
    console.error('Não foi possível atualizar o cache local das mensagens diretas:', error);
  }
}

async function syncDirectMessages(friendId, generation, showError = false) {
  if (!authenticatedAccount) return;
  try {
    const since = directMessagesSince;
    const url = `${directMessagesUrl(friendId)}${since ? `?since=${encodeURIComponent(since)}` : ''}`;
    const payload = await requestChannelMessages('', '', { url });
    if (generation !== channelMessagesLoadGeneration || currentDmFriend?.id !== friendId) return;
    const changedMessages = Array.isArray(payload.messages) ? payload.messages : [];
    if (!payload.full && changedMessages.length === 0) return;
    const cachedMessages = getStoredDMMessages(friendId, currentDmFriend);
    const messages = payload.full
      ? changedMessages
      : changedMessages.reduce((current, changed) => {
        const index = current.findIndex((message) => message.id === changed.id);
        if (index === -1) current.push(changed);
        else current[index] = changed;
        return current;
      }, cachedMessages).slice(-200);
    const latestUpdatedAt = messages.reduce((latest, message) => (
      Date.parse(message.updatedAt || '') > Date.parse(latest || '')
        ? message.updatedAt
        : latest
    ), '');
    if (latestUpdatedAt) directMessagesSince = latestUpdatedAt;
    if (JSON.stringify(cachedMessages) === JSON.stringify(messages)) return;
    cacheDirectMessages(friendId, messages);
    renderChannelMessages(messages);
  } catch (error) {
    console.error('Falha ao sincronizar mensagens diretas:', error);
    if (showError) showToast(error.message || 'Não foi possível carregar esta conversa.', '⚠️');
  }
}

function loadAndRenderMessages(srvId, chanName) {
  if (!messagesList) return;
  clearInterval(channelMessagesPollingTimer);
  const generation = ++channelMessagesLoadGeneration;
  channelMessagesSince = '';
  renderChannelMessages(getStoredMessages(srvId, chanName), false);
  scrollChatToBottom();
  syncChannelMessages(srvId, chanName, generation, true);
  channelMessagesPollingTimer = setInterval(() => {
    syncChannelMessages(srvId, chanName, generation);
  }, 4000);
}

function loadAndRenderDMMessages(friend) {
  if (!messagesList) return;
  clearInterval(channelMessagesPollingTimer);
  const generation = ++channelMessagesLoadGeneration;
  directMessagesSince = '';
  const msgs = getStoredDMMessages(friend.id, friend);
  renderChannelMessages(msgs, false);
  scrollChatToBottom();
  syncDirectMessages(friend.id, generation, true);
  channelMessagesPollingTimer = setInterval(() => {
    syncDirectMessages(friend.id, generation);
  }, 4000);
}

function getActiveChatMessages() {
  if (currentDmFriend) return getStoredDMMessages(currentDmFriend.id, currentDmFriend);
  if (!activeServerId || !currentTextChannel) return [];
  return getStoredMessages(activeServerId, currentTextChannel);
}

function saveDirectMessages(messages) {
  try {
    if (!currentDmFriend) return false;
    const key = `badiscord_dm_messages_${currentDmFriend.id}`;
    localStorage.setItem(key, JSON.stringify(messages));
    return true;
  } catch (error) {
    console.error('Não foi possível salvar a mensagem no armazenamento local:', error);
    showToast('Não foi possível salvar. O armazenamento do app pode estar cheio.', '⚠️');
    return false;
  }
}

function createChatMessage(content = {}) {
  return {
    id: `message-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    author: userProfile.displayName || 'Bads',
    avatar: userProfile.avatarUrl || '',
    role: 'MEMBRO',
    time: `Hoje às ${formatTimeNow()}`,
    ...content
  };
}

async function saveActiveChatMessage(message) {
  if (currentDmFriend) {
    const friendId = currentDmFriend.id;
    try {
      const payload = await requestChannelMessages('', '', {
        method: 'POST',
        url: directMessagesUrl(friendId),
        body: { message }
      });
      const savedMessage = payload.message;
      const messages = getStoredDMMessages(friendId, currentDmFriend);
      if (!messages.some((item) => item.id === savedMessage.id)) messages.push(savedMessage);
      cacheDirectMessages(friendId, messages);
      if (currentDmFriend?.id === friendId && messagesList) renderChannelMessages(messages);
      return savedMessage;
    } catch (error) {
      console.error('Falha ao enviar mensagem direta:', error);
      showToast(error.message || 'Não foi possível enviar a mensagem direta.', '⚠️');
      return null;
    }
  }
  if (!activeServerId || !currentTextChannel) {
    showToast('Selecione um canal de texto antes de enviar.', '⚠️');
    return null;
  }
  const serverId = activeServerId;
  const channelName = currentTextChannel;
  try {
    const payload = await requestChannelMessages(serverId, channelName, {
      method: 'POST',
      body: { message },
      url: channelMessagesUrl(serverId, channelName)
    });
    const savedMessage = payload.message;
    const currentMessages = getStoredMessages(serverId, channelName);
    if (!currentMessages.some((item) => item.id === savedMessage.id)) currentMessages.push(savedMessage);
    cacheChannelMessages(serverId, channelName, currentMessages);
    if (!currentDmFriend && activeServerId === serverId && currentTextChannel === channelName && messagesList) {
      renderChannelMessages(currentMessages);
    }
    return savedMessage;
  } catch (error) {
    console.error('Falha ao enviar mensagem para o canal:', error);
    showToast(error.message || 'Não foi possível enviar a mensagem para o canal.', '⚠️');
    return null;
  }
}

async function updateActiveChatMessage(messageId, action, value) {
  if (currentDmFriend) {
    const friendId = currentDmFriend.id;
    const generation = channelMessagesLoadGeneration;
    try {
      const url = `${directMessagesUrl(friendId)}/${encodeURIComponent(messageId)}/${action}`;
      await requestChannelMessages('', '', {
        method: 'POST',
        url,
        body: action === 'votes' ? { optionIndex: value } : { text: value }
      });
      await syncDirectMessages(friendId, generation, true);
      return true;
    } catch (error) {
      console.error('Falha ao atualizar a mensagem direta:', error);
      showToast(error.message || 'Não foi possível atualizar esta mensagem.', '⚠️');
      return false;
    }
  }
  if (!activeServerId || !currentTextChannel) return false;
  const serverId = activeServerId;
  const channelName = currentTextChannel;
  const generation = channelMessagesLoadGeneration;
  try {
    const url = `${channelMessagesUrl(serverId, channelName)}/${encodeURIComponent(messageId)}/${action}`;
    await requestChannelMessages(serverId, channelName, {
      method: 'POST',
      url,
      body: action === 'votes' ? { optionIndex: value } : { text: value }
    });
    await syncChannelMessages(serverId, channelName, generation, true);
    return true;
  } catch (error) {
    console.error('Falha ao atualizar a mensagem do canal:', error);
    showToast(error.message || 'Não foi possível atualizar esta mensagem.', '⚠️');
    return false;
  }
}

function renderMessageAttachments(attachments = []) {
  const list = document.createElement('div');
  list.className = 'chat-attachment-list';
  attachments.forEach((attachment) => {
    if (!attachment || typeof attachment.data !== 'string') return;
    if (attachment.type?.startsWith('image/')) {
      const image = document.createElement('img');
      image.className = 'chat-attachment-image';
      image.src = attachment.data;
      image.alt = attachment.name || 'Imagem enviada';
      image.loading = 'lazy';
      list.appendChild(image);
      return;
    }
    const link = document.createElement('a');
    link.className = 'chat-attachment-file';
    link.href = attachment.data;
    link.download = attachment.name || 'arquivo';
    link.textContent = `📎 ${attachment.name || 'Baixar arquivo'}`;
    list.appendChild(link);
  });
  return list;
}

function renderPollCard(message) {
  const poll = message.poll;
  const card = document.createElement('div');
  card.className = 'chat-poll-card';
  const question = document.createElement('strong');
  question.className = 'chat-poll-question';
  question.textContent = `📊 ${poll.question}`;
  card.appendChild(question);

  const options = document.createElement('div');
  options.className = 'chat-poll-options';
  const votes = poll.votes && typeof poll.votes === 'object' ? poll.votes : {};
  const voterId = authenticatedAccount?.id || 'local-user';
  const selectedOption = votes[voterId];
  poll.options.forEach((option, index) => {
    const optionButton = document.createElement('button');
    optionButton.type = 'button';
    optionButton.className = `chat-poll-option ${selectedOption === index ? 'selected' : ''}`;
    const label = document.createElement('span');
    label.textContent = option;
    const count = Object.values(votes).filter((vote) => vote === index).length;
    const countLabel = document.createElement('span');
    countLabel.className = 'chat-poll-count';
    countLabel.textContent = `${count} voto${count === 1 ? '' : 's'}`;
    optionButton.append(label, countLabel);
    optionButton.addEventListener('click', async () => {
      await updateActiveChatMessage(message.id, 'votes', index);
    });
    options.appendChild(optionButton);
  });
  card.appendChild(options);
  return card;
}

function renderTopicCard(message) {
  const topic = message.topic;
  const card = document.createElement('div');
  card.className = 'chat-topic-card';
  const title = document.createElement('strong');
  title.className = 'chat-topic-title';
  title.textContent = `🧵 ${topic.title}`;
  card.appendChild(title);

  if (topic.description) {
    const description = document.createElement('p');
    description.className = 'chat-topic-description';
    description.textContent = topic.description;
    card.appendChild(description);
  }

  const replies = document.createElement('div');
  replies.className = 'chat-thread-replies';
  (Array.isArray(topic.replies) ? topic.replies : []).forEach((reply) => {
    const item = document.createElement('div');
    item.className = 'chat-thread-reply';
    item.textContent = `${reply.author}: ${reply.text}`;
    replies.appendChild(item);
  });
  card.appendChild(replies);

  const replyForm = document.createElement('form');
  replyForm.className = 'chat-thread-form';
  const replyInput = document.createElement('input');
  replyInput.type = 'text';
  replyInput.maxLength = 500;
  replyInput.placeholder = 'Responder no tópico...';
  const replyButton = document.createElement('button');
  replyButton.type = 'submit';
  replyButton.textContent = 'Responder';
  replyForm.append(replyInput, replyButton);
  replyForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const text = replyInput.value.trim();
    if (!text) return;
    if (await updateActiveChatMessage(message.id, 'replies', text)) {
      replyInput.value = '';
      playPopSound();
    }
  });
  card.appendChild(replyForm);
  return card;
}

function createMessageElement(msg) {
  const div = document.createElement('div');
  div.className = 'chat-message';

  const avatar = document.createElement('div');
  avatar.className = 'message-avatar';
  avatar.style.cursor = 'pointer';
  if (msg.avatar) {
    const image = document.createElement('img');
    image.src = msg.avatar;
    image.alt = '';
    image.style.cssText = 'width:100%;height:100%;border-radius:50%;object-fit:cover;';
    avatar.appendChild(image);
  } else {
    avatar.textContent = (msg.author || 'U')[0].toUpperCase();
  }

  avatar.addEventListener('click', (event) => {
    openMemberProfilePopover({
      name: msg.author,
      tag: '0001',
      fullTag: `${msg.author}#0001`,
      avatarUrl: msg.avatar,
      color: '#5865F2',
      game: detectedGame ? detectedGame.name : '',
      detail: 'Online no canal',
      role: msg.role || 'Membro'
    }, event);
  });

  const content = document.createElement('div');
  content.className = 'message-content';

  const header = document.createElement('div');
  header.className = 'message-header';

  const author = document.createElement('span');
  author.className = 'message-author';
  author.textContent = msg.author;
  author.style.cursor = 'pointer';
  author.addEventListener('click', (event) => {
    openMemberProfilePopover({
      name: msg.author,
      tag: '0001',
      fullTag: `${msg.author}#0001`,
      avatarUrl: msg.avatar,
      color: '#5865F2',
      game: detectedGame ? detectedGame.name : '',
      detail: 'Online no canal',
      role: msg.role || 'Membro'
    }, event);
  });

  header.appendChild(author);

  if (msg.role) {
    const roleBadge = document.createElement('span');
    roleBadge.className = 'message-badge';
    roleBadge.textContent = msg.role;
    header.appendChild(roleBadge);
  }

  const time = document.createElement('span');
  time.className = 'message-timestamp';
  time.textContent = msg.time || `Hoje às ${formatTimeNow()}`;
  header.appendChild(time);

  const text = document.createElement('div');
  text.className = 'message-text';
  text.textContent = msg.text || '';

  content.appendChild(header);
  if (msg.text) content.appendChild(text);
  if (Array.isArray(msg.attachments) && msg.attachments.length) {
    content.appendChild(renderMessageAttachments(msg.attachments));
  }
  if (msg.poll) content.appendChild(renderPollCard(msg));
  if (msg.topic) content.appendChild(renderTopicCard(msg));

  // Botão de Fixar Mensagem
  const btnPin = document.createElement('button');
  btnPin.className = 'chat-msg-pin-btn';
  btnPin.title = 'Fixar esta mensagem';
  btnPin.textContent = '📌';
  btnPin.style.cssText = 'background:none; border:none; color:#949ba4; cursor:pointer; opacity:0; transition:opacity 0.15s; font-size:12px; margin-left:auto;';
  
  div.addEventListener('mouseenter', () => btnPin.style.opacity = '1');
  div.addEventListener('mouseleave', () => btnPin.style.opacity = '0');

  btnPin.addEventListener('click', (e) => {
    e.stopPropagation();
    togglePinMessage(msg);
  });

  content.appendChild(btnPin);

  div.appendChild(avatar);
  div.appendChild(content);

  return div;
}

// ==========================================
// MENSAGENS FIXADAS & NOTIFICAÇÕES DO CANAL
// ==========================================
function getPinnedStorageKey() {
  if (currentDmFriend) {
    return `badiscord_pinned_dm_${currentDmFriend.id}`;
  }
  return `badiscord_pinned_${activeServerId}_${currentTextChannel}`;
}

function getPinnedMessages() {
  try {
    const raw = localStorage.getItem(getPinnedStorageKey());
    if (raw) return JSON.parse(raw);
  } catch (e) {}
  return [];
}

function togglePinMessage(msg) {
  const list = getPinnedMessages();
  const idx = list.findIndex(m => m.id === msg.id || (m.text === msg.text && m.author === msg.author));
  if (idx >= 0) {
    list.splice(idx, 1);
    showToast('Mensagem desafixada do canal.', '📌');
  } else {
    list.push(msg);
    showToast('Mensagem fixada com sucesso!', '📌');
  }
  localStorage.setItem(getPinnedStorageKey(), JSON.stringify(list));
}

const btnChatPinned = document.getElementById('btnChatPinned');
const pinnedMessagesModal = document.getElementById('pinnedMessagesModal');
const btnClosePinnedModal = document.getElementById('btnClosePinnedModal');
const pinnedMessagesList = document.getElementById('pinnedMessagesList');

function openPinnedModal() {
  if (!pinnedMessagesModal || !pinnedMessagesList) return;
  pinnedMessagesList.innerHTML = '';

  const list = getPinnedMessages();
  if (list.length === 0) {
    pinnedMessagesList.innerHTML = `
      <div style="padding:24px; text-align:center; color:#949ba4;">
        <div style="font-size:32px; margin-bottom:8px;">📌</div>
        <p style="margin:0; font-weight:600; color:#fff;">Nenhuma mensagem fixada</p>
        <p style="margin:4px 0 0 0; font-size:12px;">Passe o mouse sobre qualquer mensagem do chat e clique em 📌 para fixá-la aqui.</p>
      </div>
    `;
  } else {
    list.forEach(msg => {
      const item = document.createElement('div');
      item.className = 'pinned-msg-item';

      const body = document.createElement('div');
      body.className = 'pinned-msg-body';

      const author = document.createElement('span');
      author.className = 'pinned-msg-author';
      author.textContent = `${msg.author} • ${msg.time || 'Hoje'}`;

      const text = document.createElement('span');
      text.className = 'pinned-msg-text';
      text.textContent = msg.text;

      body.appendChild(author);
      body.appendChild(text);

      const btnUnpin = document.createElement('button');
      btnUnpin.className = 'btn-unpin-msg';
      btnUnpin.title = 'Desafixar';
      btnUnpin.textContent = '✕';
      btnUnpin.addEventListener('click', () => {
        togglePinMessage(msg);
        openPinnedModal();
      });

      item.appendChild(body);
      item.appendChild(btnUnpin);
      pinnedMessagesList.appendChild(item);
    });
  }

  pinnedMessagesModal.style.display = 'flex';
}

if (btnChatPinned) btnChatPinned.addEventListener('click', openPinnedModal);
if (btnClosePinnedModal) btnClosePinnedModal.addEventListener('click', () => {
  if (pinnedMessagesModal) pinnedMessagesModal.style.display = 'none';
});

// Botão de Notificações do Canal (🔔)
let channelNotificationMode = 'all'; // 'all', 'mentions', 'none'
const btnChatNotifications = document.getElementById('btnChatNotifications');

if (btnChatNotifications) {
  btnChatNotifications.addEventListener('click', () => {
    if (channelNotificationMode === 'all') {
      channelNotificationMode = 'mentions';
      btnChatNotifications.textContent = '🔔';
      btnChatNotifications.title = 'Notificações: Apenas menções (@)';
      showToast('Notificações ajustadas para: Apenas @menções.', '🔔');
    } else if (channelNotificationMode === 'mentions') {
      channelNotificationMode = 'none';
      btnChatNotifications.textContent = '🔕';
      btnChatNotifications.title = 'Notificações: Silenciado';
      showToast('Canal silenciado temporariamente.', '🔕');
    } else {
      channelNotificationMode = 'all';
      btnChatNotifications.textContent = '🔔';
      btnChatNotifications.title = 'Notificações: Todas as mensagens';
      showToast('Notificações ativadas para todas as mensagens!', '🔔');
    }
  });
}

function formatTimeNow() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function scrollChatToBottom() {
  if (chatMessagesScroll) {
    setTimeout(() => {
      chatMessagesScroll.scrollTop = chatMessagesScroll.scrollHeight;
    }, 20);
  }
}

if (chatInputForm && chatInputText) {
  chatInputForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = chatInputText.value.trim();
    if (!text) return;

    const newMsg = createChatMessage({ text });
    const wasDm = Boolean(currentDmFriend);
    const savedMessage = await saveActiveChatMessage(newMsg);
    if (!savedMessage) return;
    if (wasDm && messagesList) {
      messagesList.appendChild(createMessageElement(savedMessage));
      scrollChatToBottom();
    }
    chatInputText.value = '';
    playPopSound();
  });
}

function sendChatFile(file) {
  if (!file) return;
  if (file.size > 1024 * 1024) {
    showToast('O arquivo deve ter no máximo 1 MB para ser salvo no chat.', '⚠️');
    return;
  }
  const reader = new FileReader();
  reader.addEventListener('load', async () => {
    if (typeof reader.result !== 'string') {
      showToast('Não foi possível ler este arquivo.', '⚠️');
      return;
    }
    const attachment = {
      name: file.name,
      type: file.type || 'application/octet-stream',
      size: file.size,
      data: reader.result
    };
    const text = chatInputText?.value.trim() || '';
    const message = createChatMessage({ text, attachments: [attachment] });
    const wasDm = Boolean(currentDmFriend);
    const savedMessage = await saveActiveChatMessage(message);
    if (!savedMessage) return;
    if (wasDm && messagesList) messagesList.appendChild(createMessageElement(savedMessage));
    if (chatInputText) chatInputText.value = '';
    scrollChatToBottom();
    playPopSound();
  });
  reader.addEventListener('error', () => {
    showToast('Não foi possível ler este arquivo.', '⚠️');
  });
  reader.readAsDataURL(file);
}

async function createChatPoll() {
  const question = window.prompt('Qual é a pergunta da enquete?');
  if (question === null) return;
  const normalizedQuestion = question.trim().slice(0, 200);
  if (!normalizedQuestion) {
    showToast('Digite uma pergunta para a enquete.', '⚠️');
    return;
  }
  const optionsInput = window.prompt('Digite de 2 a 6 opções separadas por vírgula:');
  if (optionsInput === null) return;
  const options = [...new Set(optionsInput.split(',').map((option) => option.trim()).filter(Boolean))].slice(0, 6);
  if (options.length < 2) {
    showToast('A enquete precisa ter pelo menos duas opções diferentes.', '⚠️');
    return;
  }

  const message = createChatMessage({
    text: '',
    poll: { question: normalizedQuestion, options, votes: {} }
  });
  const wasDm = Boolean(currentDmFriend);
  const savedMessage = await saveActiveChatMessage(message);
  if (!savedMessage) return;
  if (wasDm && messagesList) messagesList.appendChild(createMessageElement(savedMessage));
  scrollChatToBottom();
  playPopSound();
}

async function createChatTopic() {
  const title = window.prompt('Qual será o título do tópico?');
  if (title === null) return;
  const normalizedTitle = title.trim().slice(0, 120);
  if (!normalizedTitle) {
    showToast('Digite um título para o tópico.', '⚠️');
    return;
  }
  const description = window.prompt('Adicione uma descrição (opcional):') || '';
  const message = createChatMessage({
    text: '',
    topic: { title: normalizedTitle, description: description.trim().slice(0, 1000), replies: [] }
  });
  const wasDm = Boolean(currentDmFriend);
  const savedMessage = await saveActiveChatMessage(message);
  if (!savedMessage) return;
  if (wasDm && messagesList) messagesList.appendChild(createMessageElement(savedMessage));
  scrollChatToBottom();
  playPopSound();
}

if (chatAttachButton && chatAttachMenu) {
  chatAttachButton.addEventListener('click', (event) => {
    event.stopPropagation();
    chatAttachMenu.style.display = chatAttachMenu.style.display === 'none' ? 'flex' : 'none';
  });
  chatAttachMenu.addEventListener('click', (event) => event.stopPropagation());
  document.addEventListener('click', () => {
    chatAttachMenu.style.display = 'none';
  });
  chatAttachMenu.querySelectorAll('[data-chat-action]').forEach((button) => {
    button.addEventListener('click', () => {
      chatAttachMenu.style.display = 'none';
      switch (button.dataset.chatAction) {
        case 'image':
          chatImageInput?.click();
          break;
        case 'file':
          chatFileInput?.click();
          break;
        case 'poll':
          createChatPoll();
          break;
        case 'topic':
          createChatTopic();
          break;
        default:
          console.warn('Ação de anexo de chat desconhecida:', button.dataset.chatAction);
      }
    });
  });
}

if (chatImageInput) {
  chatImageInput.addEventListener('change', () => {
    Array.from(chatImageInput.files || []).forEach(sendChatFile);
    chatImageInput.value = '';
  });
}

if (chatFileInput) {
  chatFileInput.addEventListener('change', () => {
    Array.from(chatFileInput.files || []).forEach(sendChatFile);
    chatFileInput.value = '';
  });
}

if (btnChatEmoji && chatInputText) {
  btnChatEmoji.addEventListener('click', () => {
    const emojis = ['😀', '🔥', '🎮', '🎧', '🚀', '😎', '🏆', '💯'];
    const randomEmoji = emojis[Math.floor(Math.random() * emojis.length)];
    chatInputText.value += ` ${randomEmoji} `;
    chatInputText.focus();
  });
}

if (btnJumpToVoice) {
  btnJumpToVoice.addEventListener('click', () => {
    switchView('voice');
  });
}

// ==========================================
// CRIAÇÃO DE CANAIS (Texto ou Voz)
// ==========================================
function openCreateChannelModal(type = 'text') {
  selectedChannelType = type;
  if (!createChannelModal) return;

  const currentSrv = servers.find(s => s.id === activeServerId);
  if (createChannelSubtitle) {
    createChannelSubtitle.textContent = `em ${currentSrv?.name || 'Servidor'}`;
  }

  setChannelTypeOption(type);
  if (inputNewChannelName) {
    inputNewChannelName.value = '';
    inputNewChannelName.placeholder = type === 'text' ? 'novo-canal-texto' : 'Novo Canal de Voz';
  }

  createChannelModal.style.display = 'flex';
  if (inputNewChannelName) inputNewChannelName.focus();
}

function closeCreateChannelModal() {
  if (createChannelModal) createChannelModal.style.display = 'none';
}

function setChannelTypeOption(type) {
  selectedChannelType = type;
  if (optTypeText) optTypeText.classList.toggle('active', type === 'text');
  if (optTypeVoice) optTypeVoice.classList.toggle('active', type === 'voice');

  const radioText = document.querySelector('input[name="channelTypeRadio"][value="text"]');
  const radioVoice = document.querySelector('input[name="channelTypeRadio"][value="voice"]');
  if (radioText && type === 'text') radioText.checked = true;
  if (radioVoice && type === 'voice') radioVoice.checked = true;

  if (channelInputPrefix) {
    channelInputPrefix.textContent = type === 'text' ? '#' : '🔊';
  }
}

if (btnAddTextChannel) {
  btnAddTextChannel.addEventListener('click', (e) => {
    e.stopPropagation();
    openCreateChannelModal('text');
  });
}

if (btnAddVoiceChannel) {
  btnAddVoiceChannel.addEventListener('click', (e) => {
    e.stopPropagation();
    openCreateChannelModal('voice');
  });
}

if (optTypeText) optTypeText.addEventListener('click', () => setChannelTypeOption('text'));
if (optTypeVoice) optTypeVoice.addEventListener('click', () => setChannelTypeOption('voice'));

if (btnCloseChannelModal) btnCloseChannelModal.addEventListener('click', closeCreateChannelModal);
if (btnCancelCreateChannel) btnCancelCreateChannel.addEventListener('click', closeCreateChannelModal);

if (btnConfirmCreateChannel) {
  btnConfirmCreateChannel.addEventListener('click', confirmCreateChannel);
}
if (inputNewChannelName) {
  inputNewChannelName.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') confirmCreateChannel();
    if (e.key === 'Escape') closeCreateChannelModal();
  });
}

function confirmCreateChannel() {
  const currentSrv = servers.find(s => s.id === activeServerId);
  if (!currentSrv) return;

  let rawName = (inputNewChannelName.value || '').trim();
  if (selectedChannelType === 'text') {
    let chanName = rawName
      .toLowerCase()
      .replace(/[^a-z0-9\s-_]/g, '')
      .replace(/\s+/g, '-');
    if (!chanName) chanName = `chat-${Date.now().toString().slice(-4)}`;

    if (!currentSrv.textChannels) currentSrv.textChannels = [];
    if (!currentSrv.textChannels.includes(chanName)) {
      currentSrv.textChannels.push(chanName);
    }
    saveServers();
    closeCreateChannelModal();
    renderChannels(currentSrv);
    openTextChannel(chanName);
    showToast(`Canal #${chanName} criado com sucesso!`, '💬');
  } else {
    let chanName = rawName || `Voz ${Date.now().toString().slice(-4)}`;
    if (!currentSrv.voiceChannels) currentSrv.voiceChannels = [];
    if (!currentSrv.voiceChannels.includes(chanName)) {
      currentSrv.voiceChannels.push(chanName);
    }
    saveServers();
    closeCreateChannelModal();
    renderChannels(currentSrv);
    showToast(`Canal de voz 🔊 ${chanName} criado!`, '🔊');
    joinVoiceChannel(chanName);
  }
}

// ==========================================
// MENU SUSPENSO DO SERVIDOR (Foto 1)
// ==========================================
if (guildHeader) {
  guildHeader.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleServerDropdown();
  });
}

function toggleServerDropdown() {
  if (!serverDropdownMenu) return;
  const isShown = serverDropdownMenu.style.display !== 'none';
  serverDropdownMenu.style.display = isShown ? 'none' : 'block';
  if (guildDropdownIcon) {
    guildDropdownIcon.textContent = isShown ? '▼' : '▲';
  }
}

function closeServerDropdown() {
  if (serverDropdownMenu) serverDropdownMenu.style.display = 'none';
  if (guildDropdownIcon) guildDropdownIcon.textContent = '▼';
}

window.addEventListener('click', (e) => {
  if (serverDropdownMenu && !serverDropdownMenu.contains(e.target) && e.target !== guildHeader && !guildHeader.contains(e.target)) {
    closeServerDropdown();
  }
  if (soundboardQuickPopup && !soundboardQuickPopup.contains(e.target) && e.target !== dockBtnSoundboard && !dockBtnSoundboard?.contains(e.target) && e.target !== btnStageSoundboard && !btnStageSoundboard?.contains(e.target)) {
    soundboardQuickPopup.style.display = 'none';
  }
});

const menuItemBoost = document.getElementById('menuItemBoost');
const menuItemInvite = document.getElementById('menuItemInvite');
const menuItemCreateChannel = document.getElementById('menuItemCreateChannel');
const menuItemApps = document.getElementById('menuItemApps');
const menuItemNotifications = document.getElementById('menuItemNotifications');
const menuItemPrivacy = document.getElementById('menuItemPrivacy');
const menuItemEditProfile = document.getElementById('menuItemEditProfile');
const menuItemLeave = document.getElementById('menuItemLeave');

if (menuItemBoost) {
  menuItemBoost.addEventListener('click', () => {
    closeServerDropdown();
    openSettingsTab('decorations');
  });
}

if (menuItemInvite) {
  menuItemInvite.addEventListener('click', () => {
    closeServerDropdown();
    openInviteModal();
  });
}

if (menuItemCreateChannel) {
  menuItemCreateChannel.addEventListener('click', () => {
    closeServerDropdown();
    openCreateChannelModal('text');
  });
}

if (menuItemApps) {
  menuItemApps.addEventListener('click', () => {
    closeServerDropdown();
    showToast('🧩 Diretório de Apps: Bots de Música e Moderação ativos!', '🧩');
  });
}

if (menuItemNotifications) {
  menuItemNotifications.addEventListener('click', () => {
    closeServerDropdown();
    showToast('🔔 Notificações ativadas para todas as mensagens.', '🔔');
  });
}

if (menuItemPrivacy) {
  menuItemPrivacy.addEventListener('click', () => {
    closeServerDropdown();
    showToast('🔒 Configurações de privacidade salvas com sucesso.', '🔒');
  });
}

if (menuItemLeave) {
  menuItemLeave.addEventListener('click', () => {
    closeServerDropdown();
    showToast('Você é o proprietário desta comunidade.', '👑');
  });
}

// ==========================================
// ATALHOS RÁPIDOS DA DOCK E CONTROLES (Fotos 1 & 2)
// ==========================================
if (btnQuickDisconnect) {
  btnQuickDisconnect.addEventListener('click', () => {
    disconnectVoice(true);
  });
}

if (btnConfirmVoiceSwitch) {
  btnConfirmVoiceSwitch.addEventListener('click', () => {
    if (chkDontAskVoiceSwitch && chkDontAskVoiceSwitch.checked) {
      suppressVoiceSwitchPrompt = true;
    }

    closeVoiceSwitchConfirmation();
    if (resolveVoiceSwitchPrompt) {
      resolveVoiceSwitchPrompt(true);
    }
  });
}

if (btnCancelVoiceSwitch || btnCloseVoiceSwitchModal) {
  const cancelVoiceSwitch = () => {
    closeVoiceSwitchConfirmation();
    if (resolveVoiceSwitchPrompt) {
      resolveVoiceSwitchPrompt(false);
    }
  };

  if (btnCancelVoiceSwitch) btnCancelVoiceSwitch.addEventListener('click', cancelVoiceSwitch);
  if (btnCloseVoiceSwitchModal) btnCloseVoiceSwitchModal.addEventListener('click', cancelVoiceSwitch);
}

if (voiceSwitchModal) {
  voiceSwitchModal.addEventListener('click', (event) => {
    if (event.target === voiceSwitchModal) {
      closeVoiceSwitchConfirmation();
      if (resolveVoiceSwitchPrompt) {
        resolveVoiceSwitchPrompt(false);
      }
    }
  });
}

async function toggleCamera() {
  if (!currentChannel || !livekitRoom || livekitRoom.state !== 'connected') {
    showToast('Entre em um canal de voz antes de ativar a câmera.', '⚠️');
    return;
  }
  if (isCamActive) {
    if (localCamTrack) {
      try {
        const cameraSource = window.LivekitClient?.Track?.Source?.Camera;
        const publication = cameraSource
          ? livekitRoom.localParticipant.getTrackPublication(cameraSource)
          : null;
        if (publication?.track) await livekitRoom.localParticipant.unpublishTrack(publication.track);
        localCamTrack.stop();
        localCamTrack.detach();
      } catch (error) {
        console.error('Não foi possível encerrar a câmera:', error);
        showToast('Não foi possível desligar a câmera.', '⚠️');
        return;
      }
      localCamTrack = null;
    }
    isCamActive = false;
    showToast('📹 Câmera desativada', '📹');
  } else {
    try {
      const accepted = window.confirm('O BADISCORD precisa da sua permissão para acessar a câmera e transmitir seu vídeo aos participantes. Deseja permitir?');
      if (!accepted) return;
      if (window.electronAPI?.grantCameraPermission) {
        await window.electronAPI.grantCameraPermission();
      }
      if (!window.LivekitClient?.createLocalVideoTrack) {
        throw new Error('A câmera não está disponível neste navegador.');
      }
      localCamTrack = await window.LivekitClient.createLocalVideoTrack({
        facingMode: 'user',
        resolution: { width: 640, height: 360, frameRate: 24 }
      });
      await livekitRoom.localParticipant.publishTrack(localCamTrack, {
        source: window.LivekitClient.Track.Source.Camera
      });
      isCamActive = true;
      showToast('📹 Câmera ativada!', '📹');
    } catch (error) {
      if (localCamTrack) {
        localCamTrack.stop();
        localCamTrack = null;
      }
      console.error('Não foi possível publicar a câmera:', error);
      showToast(error.message || 'Não foi possível acessar a câmera.', '⚠️');
    }
  }

  if (dockBtnCam) dockBtnCam.classList.toggle('active', isCamActive);
  if (btnShareCam) btnShareCam.classList.toggle('active', isCamActive);
  refreshVoiceParticipantViews();
}

if (dockBtnCam) dockBtnCam.addEventListener('click', toggleCamera);
if (btnShareCam) btnShareCam.addEventListener('click', toggleCamera);

if (dockBtnStream) {
  dockBtnStream.addEventListener('click', () => {
    if (btnShareScreen) btnShareScreen.click();
  });
}

function openActivitiesToast() {
  playSoundEffect('bell');
  showToast('🚀 Atividades BADISCORD: Watch Together e Mini-jogos ativos na sala!', '🚀');
}
if (dockBtnActivities) dockBtnActivities.addEventListener('click', openActivitiesToast);
if (btnStageActivities) btnStageActivities.addEventListener('click', openActivitiesToast);

function toggleQuickSoundboard() {
  if (!soundboardQuickPopup) return;
  const isShown = soundboardQuickPopup.style.display !== 'none';
  soundboardQuickPopup.style.display = isShown ? 'none' : 'block';
}
if (dockBtnSoundboard) dockBtnSoundboard.addEventListener('click', toggleQuickSoundboard);
if (btnStageSoundboard) btnStageSoundboard.addEventListener('click', toggleQuickSoundboard);
if (btnCloseSoundboardQuick) {
  btnCloseSoundboardQuick.addEventListener('click', () => {
    if (soundboardQuickPopup) soundboardQuickPopup.style.display = 'none';
  });
}

document.querySelectorAll('.sb-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const sound = btn.dataset.sound;
    if (sound) playSoundEffect(sound);
  });
});

if (btnStageMic) {
  btnStageMic.addEventListener('click', () => {
    btnToggleMic.click();
  });
}

// ==========================================
// DETECÇÃO DE JOGOS EM TEMPO REAL
// ==========================================
let detectedGame = null;

async function checkRunningGame() {
  if (!window.electronAPI || !window.electronAPI.getDetectedGame) return;
  try {
    const game = await window.electronAPI.getDetectedGame();
    const previousGameName = detectedGame?.name || '';
    detectedGame = game;
    if ((game?.name || '') !== previousGameName) {
      publishPresenceStatus();
      renderServerMembers();
    }

    const panel = document.getElementById('gameActivityPanel');
    const titleEl = document.getElementById('gameActivityTitle');
    const statusEl = document.getElementById('gameActivityStatus');
    const iconBox = document.getElementById('gameActivityIconBox');
    const btnQuick = document.getElementById('btnGameQuickStream');

    if (localScreenTrack || isNativeMobileStreamer) {
      if (panel) panel.classList.add('is-live');
      const configuredResolution = isNativeMobileStreamer ? '1080' : (localStreamResolution || localStorage.getItem('badiscord_stream_res') || '1080');
      const resolutionLabel = configuredResolution === '1440' ? '2K (1440p)' : `${configuredResolution}p`;
      const configuredFps = isNativeMobileStreamer ? '30' : (localStreamFps || localStorage.getItem('badiscord_stream_fps') || '60');
      if (statusEl) statusEl.textContent = `AO VIVO em ${resolutionLabel} ${configuredFps}FPS`;
      if (btnQuick) {
        btnQuick.innerHTML = '⏹️';
        btnQuick.title = 'Parar Transmissão';
      }
      return;
    }

    if (panel) panel.classList.remove('is-live');

    if (game && game.name) {
      if (titleEl) titleEl.textContent = game.name;
      if (statusEl) statusEl.textContent = game.isGame ? 'Detectado • Pronto para transmitir' : 'Não Compartilhando';
      if (btnQuick) {
        btnQuick.innerHTML = '🖥️';
        const configuredResolution = localStorage.getItem('badiscord_stream_res') || '1080';
        btnQuick.title = `Selecionar ${game.name} para transmitir em ${configuredResolution === '1440' ? '2K' : `${configuredResolution}p`}`;
      }
      if (iconBox) {
        if (game.appIcon) {
          iconBox.innerHTML = `<img src="${game.appIcon}" alt="Icon">`;
        } else {
          iconBox.innerHTML = '🎮';
        }
      }
    } else {
      if (titleEl) titleEl.textContent = 'Nenhum jogo detectado';
      if (statusEl) statusEl.textContent = 'Abra um jogo para transmitir';
      if (btnQuick) {
        btnQuick.innerHTML = '🖥️';
        btnQuick.title = 'Escolher janela do jogo para transmitir';
      }
      if (iconBox) iconBox.innerHTML = '🎮';
    }
  } catch (err) {
    console.warn('Erro ao verificar jogo em execução:', err);
  }
}

// Verificação de jogo em segundo plano com menor custo para evitar lag no canal de voz
setInterval(checkRunningGame, 10000);
setTimeout(checkRunningGame, 600);

if (btnGameQuickStream) {
  btnGameQuickStream.addEventListener('click', async () => {
    if (localScreenTrack || isNativeMobileStreamer) {
      stopCurrentStream();
      return;
    }

    const savedRes = localStorage.getItem('badiscord_stream_res') || '1080';
    const savedFps = localStorage.getItem('badiscord_stream_fps') || '60';
    if (selectResolution) selectResolution.value = savedRes;
    if (selectFps) selectFps.value = savedFps;

    if (!window.electronAPI) {
      await startBrowserDisplayStream();
      return;
    }

    setCaptureTab('games');
    if (inputSearchSources) inputSearchSources.value = '';
    sourceSearchQuery = '';

    screenShareModal.style.display = 'flex';
    await fetchAndRenderSources();
  });
}

// ==========================================
// VISÃO DE INÍCIO / AMIGOS / DMS (Foto 2)
// ==========================================
// ==========================================
// VISÃO DE INÍCIO / AMIGOS / DMS COM TAGS (#0000)
// ==========================================
const FRIEND_COLORS = ['#5865F2','#57F287','#1DB954','#FEE75C','#EB459E','#ED4245','#E67E22','#9B59B6','#E91E63','#00BCD4'];

let friendsList = [];
let friendRequests = [];
let friendsPollingTimer = null;
let presenceHeartbeatTimer = null;
let incomingFriendRequestIds = null;
let friendsLoadInProgress = false;
const desktopNotifsToggle = document.getElementById('desktopNotifsToggle');

if (desktopNotifsToggle) {
  desktopNotifsToggle.checked = localStorage.getItem('badiscord_desktop_friend_notifications') === 'true';
  desktopNotifsToggle.addEventListener('change', async () => {
    if (desktopNotifsToggle.checked) {
      if (!('Notification' in window)) {
        desktopNotifsToggle.checked = false;
        showToast('Notificações do sistema não estão disponíveis neste dispositivo.', '⚠️');
        return;
      }
      try {
        const permission = Notification.permission === 'default'
          ? await Notification.requestPermission()
          : Notification.permission;
        if (permission !== 'granted') {
          desktopNotifsToggle.checked = false;
          localStorage.setItem('badiscord_desktop_friend_notifications', 'false');
          showToast('Permita as notificações nas configurações do navegador ou sistema.', '⚠️');
          return;
        }
      } catch (error) {
        desktopNotifsToggle.checked = false;
        localStorage.setItem('badiscord_desktop_friend_notifications', 'false');
        console.error('Não foi possível habilitar notificações do sistema:', error);
        showToast('Não foi possível habilitar as notificações do sistema.', '⚠️');
        return;
      }
    }
    localStorage.setItem('badiscord_desktop_friend_notifications', String(desktopNotifsToggle.checked));
  });
}

function decorateFriend(user) {
  return {
    ...user,
    initial: (user.name || 'U')[0].toUpperCase(),
    color: FRIEND_COLORS[Math.abs(String(user.id || '').length) % FRIEND_COLORS.length]
  };
}

function notifyFriendRequest(request) {
  const displayName = request.fullTag || `${request.name}#${request.tag}`;
  showToast(`Nova solicitação de amizade de ${displayName}!`, '📩');

  if (!desktopNotifsToggle?.checked || !('Notification' in window) || Notification.permission !== 'granted') return;
  try {
    const notification = new Notification('Nova solicitação de amizade', {
      body: `${displayName} quer adicionar você.`,
      tag: `friend-request-${request.requestId}`
    });
    notification.addEventListener('click', () => {
      window.focus();
      openHomeFriendsView();
      switchFriendsTab('pending');
      notification.close();
    });
  } catch (error) {
    console.warn('Não foi possível exibir a notificação do sistema:', error);
  }
}

async function loadFriendsFromServer({ notifyNew = false } = {}) {
  if (!hasAuthenticatedSession() || friendsLoadInProgress) return;
  friendsLoadInProgress = true;
  try {
    const response = await fetch('/api/friends', { credentials: 'include', headers: { Accept: 'application/json' } });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || 'Não foi possível carregar seus amigos.');
    friendsList = (Array.isArray(payload.friends) ? payload.friends : []).map(decorateFriend);
    friendRequests = (Array.isArray(payload.requests) ? payload.requests : []).map((request) => ({
      ...decorateFriend(request),
      type: request.type === 'outgoing' ? 'outgoing' : 'incoming',
      date: request.createdAt || ''
    }));
    const currentIncomingIds = new Set(friendRequests
      .filter((request) => request.type === 'incoming')
      .map((request) => request.requestId));
    if (notifyNew && incomingFriendRequestIds) {
      friendRequests
        .filter((request) => request.type === 'incoming' && !incomingFriendRequestIds.has(request.requestId))
        .forEach(notifyFriendRequest);
    }
    incomingFriendRequestIds = currentIncomingIds;
    if (currentFriendsTab === 'pending') renderPendingRequests();
    else if (currentFriendsTab !== 'add') renderFriendsList(inputFriendsSearch?.value.trim() || '');
    renderDMList();
    renderActiveNowCards();
    updateDMBadge();
    updateRequestsBadge();
  } catch (error) {
    console.warn('Não foi possível carregar amigos:', error);
  } finally {
    friendsLoadInProgress = false;
  }
}

function startFriendRequestPolling() {
  clearInterval(friendsPollingTimer);
  clearInterval(presenceHeartbeatTimer);
  friendsPollingTimer = setInterval(() => loadFriendsFromServer({ notifyNew: true }), 12000);
  presenceHeartbeatTimer = setInterval(publishPresenceStatus, 20000);
}

// Analisa entrada do usuário com ou sem tag (ex: bads#0000 ou bads)
function parseFriendInput(raw) {
  if (!raw) return null;
  const str = raw.trim();
  if (!str) return null;

  const parts = str.split('#');
  if (parts.length > 2) return null;
  const name = parts[0].trim();
  const tag = parts.length === 2 ? parts[1].trim() : '';
  if (!name || (parts.length === 2 && !/^[a-zA-Z0-9]{4}$/.test(tag))) return null;

  return {
    name,
    tag,
    fullTag: tag ? `${name}#${tag}` : name
  };
}

async function sendFriendRequest(rawInput) {
  const parsed = parseFriendInput(rawInput);
  if (!parsed) {
    showToast('Informe o nome de usuário ou o nome com uma tag válida de quatro caracteres.', '⚠️');
    return null;
  }
  try {
    const response = await fetch('/api/friends/requests', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ handle: parsed.fullTag })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || 'Não foi possível enviar o pedido.');
    await loadFriendsFromServer();
    showToast(`Pedido enviado para ${payload.user?.fullTag || parsed.fullTag}!`, '✅');
    return payload.user;
  } catch (error) {
    showToast(error.message || 'Não foi possível enviar o pedido.', '⚠️');
    return null;
  }
}

async function acceptFriendRequest(reqId) {
  const response = await fetch(`/api/friends/requests/${encodeURIComponent(reqId)}/accept`, { method: 'POST', credentials: 'include' });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    showToast(payload.error || 'Não foi possível aceitar a solicitação.', '⚠️');
    return false;
  }
  await loadFriendsFromServer();
  showToast('Solicitação aceita! 🎉', '✅');
  return true;
}

async function rejectFriendRequest(reqId) {
  const response = await fetch(`/api/friends/requests/${encodeURIComponent(reqId)}`, { method: 'DELETE', credentials: 'include' });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    showToast(payload.error || 'Não foi possível recusar ou cancelar o pedido.', '⚠️');
    return false;
  }
  await loadFriendsFromServer();
  showToast('Solicitação recusada/cancelada.', 'ℹ️');
  return true;
}

function removeFriend(friendId) {
  const friend = friendsList.find(f => f.id === friendId);
  fetch(`/api/friends/${encodeURIComponent(friendId)}`, { method: 'DELETE', credentials: 'include' })
    .then(async (response) => {
      if (!response.ok) throw new Error('Não foi possível remover este amigo.');
      await loadFriendsFromServer();
    })
    .then(() => {
      if (friend) showToast(`${friend.fullTag || friend.name} foi removido.`, '🗑️');
    })
    .catch((error) => showToast(error.message || 'Não foi possível remover este amigo.', '⚠️'));
}

// Gera lista de DMs a partir dos amigos
function getDMList() {
  return friendsList.map(f => ({
    id: 'dm-' + f.id,
    friendId: f.id,
    name: f.name,
    tag: f.tag,
    fullTag: f.fullTag || `${f.name}#${f.tag}`,
    lastMsg: f.detail || 'Disponível',
    unread: 0,
    initial: f.initial,
    color: f.color
  }));
}

function updateDMBadge() {
  const badge = document.getElementById('dmBadgeCount');
  if (badge) {
    if (friendsList.length > 0) {
      badge.textContent = friendsList.length;
      badge.style.display = '';
    } else {
      badge.style.display = 'none';
    }
  }
}

function updateRequestsBadge() {
  const count = friendRequests.filter((request) => request.type === 'incoming').length;
  const requestsBadge = document.getElementById('requestsBadgeCount');
  const pendingTabBadge = document.getElementById('pendingTabBadge');

  if (requestsBadge) {
    if (count > 0) {
      requestsBadge.textContent = count;
      requestsBadge.style.display = '';
    } else {
      requestsBadge.style.display = 'none';
    }
  }

  if (pendingTabBadge) {
    if (count > 0) {
      pendingTabBadge.textContent = count;
      pendingTabBadge.style.display = '';
    } else {
      pendingTabBadge.style.display = 'none';
    }
  }
}

// Aba de amigos atualmente ativa
let currentFriendsTab = 'online';

function openHomeFriendsView() {
  inHomeView = true;
  switchView('friends');

  document.querySelectorAll('.guild-icon').forEach(el => el.classList.remove('active'));
  if (btnHomeDM) btnHomeDM.classList.add('active');

  if (serverHeaderWrapper) serverHeaderWrapper.style.display = 'none';
  if (channelsScroll) channelsScroll.style.display = 'none';
  if (dmNavWrapper) dmNavWrapper.style.display = 'block';

  switchFriendsTab(currentFriendsTab || 'online');
  renderFriendsList();
  renderActiveNowCards();
  renderDMList();
  updateDMBadge();
  updateRequestsBadge();
}

if (btnHomeDM) {
  btnHomeDM.addEventListener('click', openHomeFriendsView);
}

function restoreServerView(srvId) {
  inHomeView = false;
  currentDmFriend = null;
  if (btnHomeDM) btnHomeDM.classList.remove('active');
  if (serverHeaderWrapper) serverHeaderWrapper.style.display = 'block';
  if (channelsScroll) channelsScroll.style.display = 'block';
  if (dmNavWrapper) dmNavWrapper.style.display = 'none';

  selectServer(srvId);
  if (currentChannel) {
    switchView('voice');
  } else {
    const srv = servers.find(s => s.id === srvId);
    const firstText = srv?.textChannels?.[0] || 'geral';
    openTextChannel(firstText);
  }
}

function renderFriendsList(filter = '') {
  if (!friendsCardsList) return;
  friendsCardsList.innerHTML = '';

  const statusFilteredFriends = friendsList.filter((friend) => {
    const isOnline = (friend.status || 'online') !== 'offline';
    if (currentFriendsTab === 'online') return isOnline;
    if (currentFriendsTab === 'offline') return !isOnline;
    return true;
  });
  const filtered = statusFilteredFriends.filter(f => {
    if (!filter) return true;
    const q = filter.toLowerCase();
    return f.name.toLowerCase().includes(q) || 
           (f.tag && f.tag.includes(q)) || 
           (f.fullTag && f.fullTag.toLowerCase().includes(q)) || 
           (f.game || '').toLowerCase().includes(q);
  });

  if (friendsCountLabel) {
    const sectionName = currentFriendsTab === 'offline' ? 'OFFLINE' : (currentFriendsTab === 'all' ? 'TODOS' : 'ONLINE');
    friendsCountLabel.textContent = `${sectionName} — ${filtered.length}`;
  }

  if (filtered.length === 0) {
    const noStatusMatches = friendsList.length > 0 && !filter && currentFriendsTab !== 'all';
    const empty = document.createElement('div');
    empty.className = 'friends-empty-state';
    empty.innerHTML = `
      <div class="friends-empty-icon">👋</div>
      <div class="friends-empty-title">${friendsList.length === 0 ? 'Nenhum amigo adicionado ainda' : 'Nenhum resultado encontrado'}</div>
      <div class="friends-empty-desc">${friendsList.length === 0 ? 'Clique em "Adicionar amigo" e informe um nome com tag (ex: bads#0000) para começar!' : 'Tente buscar com outro nome ou tag.'}</div>
    `;
    if (noStatusMatches) {
      empty.querySelector('.friends-empty-title').textContent = `Nenhum amigo ${currentFriendsTab === 'offline' ? 'offline' : 'online'}`;
      empty.querySelector('.friends-empty-desc').textContent = `Os amigos ${currentFriendsTab === 'offline' ? 'offline' : 'online'} aparecerão aqui.`;
    }
    friendsCardsList.appendChild(empty);
    return;
  }

  filtered.forEach(friend => {
    const card = document.createElement('div');
    card.className = 'friend-item-card';

    const left = document.createElement('div');
    left.className = 'friend-card-left';

    const avatar = document.createElement('div');
    avatar.className = 'friend-card-avatar';
    avatar.style.backgroundColor = friend.color;
    avatar.textContent = friend.initial;
    if (friend.avatarUrl) {
      const image = document.createElement('img');
      image.src = friend.avatarUrl;
      image.alt = '';
      image.addEventListener('error', () => image.remove(), { once: true });
      avatar.appendChild(image);
    }

    const dot = document.createElement('div');
    dot.className = `friend-card-avatar-dot${(friend.status || 'online') === 'offline' ? ' offline' : ''}`;
    avatar.appendChild(dot);

    const info = document.createElement('div');
    info.className = 'friend-card-info';

    const name = document.createElement('div');
    name.className = 'friend-card-name';
    name.append(document.createTextNode(friend.name));
    const tag = document.createElement('span');
    tag.className = 'friend-card-tag';
    tag.textContent = `#${friend.tag}`;
    name.appendChild(tag);

    const status = document.createElement('div');
    status.className = 'friend-card-status';
    status.textContent = friend.game ? `${friend.game} • ${friend.detail}` : (friend.detail || 'Disponível');

    info.appendChild(name);
    info.appendChild(status);

    left.appendChild(avatar);
    left.appendChild(info);

    const actions = document.createElement('div');
    actions.className = 'friend-card-actions';

    const btnMsg = document.createElement('button');
    btnMsg.className = 'friend-action-btn';
    btnMsg.title = 'Enviar Mensagem Direta';
    btnMsg.textContent = '💬';
    btnMsg.addEventListener('click', (e) => {
      e.stopPropagation();
      openDirectMessage(friend);
    });

    const btnRemove = document.createElement('button');
    btnRemove.className = 'friend-action-btn';
    btnRemove.title = 'Remover Amigo';
    btnRemove.textContent = '✖';
    btnRemove.addEventListener('click', (e) => {
      e.stopPropagation();
      if (confirm(`Remover ${friend.fullTag || friend.name} dos amigos?`)) {
        removeFriend(friend.id);
      }
    });

    actions.appendChild(btnMsg);
    actions.appendChild(btnRemove);

    card.appendChild(left);
    card.appendChild(actions);

    card.addEventListener('click', (event) => {
      openMemberProfilePopover({ ...friend, isOwner: false }, event);
    });

    friendsCardsList.appendChild(card);
  });
}

// Renderiza a lista de solicitações de amizades pendentes
function renderPendingRequests() {
  if (!friendsCardsList) return;
  friendsCardsList.innerHTML = '';

  if (friendsCountLabel) {
    const incomingCount = friendRequests.filter((request) => request.type === 'incoming').length;
    friendsCountLabel.textContent = `SOLICITAÇÕES PENDENTES — ${friendRequests.length} (${incomingCount} recebida${incomingCount === 1 ? '' : 's'})`;
  }

  const topActions = document.createElement('div');
  topActions.style.cssText = 'display:flex; justify-content:space-between; align-items:center; margin-bottom:12px; padding:0 4px;';
  topActions.innerHTML = '<span style="font-size:12px; color:#949ba4;">Gerencie quem pode conversar e jogar com você.</span>';
  friendsCardsList.appendChild(topActions);


  if (friendRequests.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'friends-empty-state';
    empty.innerHTML = `
      <div class="friends-empty-icon">📩</div>
      <div class="friends-empty-title">Nenhuma solicitação de amizade pendente</div>
      <div class="friends-empty-desc">Quando alguém te enviar um pedido usando sua tag ou você enviar para alguém, ela aparecerá aqui!</div>
    `;
    friendsCardsList.appendChild(empty);
    return;
  }

  let lastRequestType = '';
  const orderedRequests = [
    ...friendRequests.filter((request) => request.type === 'incoming'),
    ...friendRequests.filter((request) => request.type === 'outgoing')
  ];
  orderedRequests.forEach(req => {
    if (req.type !== lastRequestType) {
      lastRequestType = req.type;
      const section = document.createElement('div');
      section.className = 'pending-requests-section-title';
      section.textContent = req.type === 'incoming' ? 'Recebidos' : 'Enviados';
      friendsCardsList.appendChild(section);
    }
    const item = document.createElement('div');
    item.className = 'pending-req-item';

    const left = document.createElement('div');
    left.className = 'pending-req-left';

    const avatar = document.createElement('div');
    avatar.className = 'pending-req-avatar';
    avatar.style.backgroundColor = req.color;
    avatar.textContent = req.initial;

    const info = document.createElement('div');
    info.className = 'pending-req-info';

    const name = document.createElement('div');
    name.className = 'pending-req-name';
    name.append(document.createTextNode(req.name));
    const tag = document.createElement('span');
    tag.className = 'friend-card-tag';
    tag.textContent = `#${req.tag}`;
    name.appendChild(tag);

    const typeDesc = document.createElement('div');
    typeDesc.className = 'pending-req-type';
    typeDesc.textContent = req.type === 'incoming' 
      ? 'Pedido de amizade recebido' 
      : 'Pedido de amizade enviado';

    info.appendChild(name);
    info.appendChild(typeDesc);
    left.appendChild(avatar);
    left.appendChild(info);

    const actions = document.createElement('div');
    actions.className = 'pending-req-actions';

    if (req.type === 'incoming') {
      const btnAccept = document.createElement('button');
      btnAccept.className = 'btn-accept-req';
      btnAccept.title = 'Aceitar Pedido de Amizade';
      btnAccept.textContent = '✔';
      btnAccept.addEventListener('click', () => acceptFriendRequest(req.requestId));

      const btnReject = document.createElement('button');
      btnReject.className = 'btn-reject-req';
      btnReject.title = 'Recusar Pedido';
      btnReject.textContent = '✖';
      btnReject.addEventListener('click', () => rejectFriendRequest(req.requestId));

      actions.appendChild(btnAccept);
      actions.appendChild(btnReject);
    } else {
      const btnCancel = document.createElement('button');
      btnCancel.className = 'btn-cancel-req';
      btnCancel.title = 'Cancelar Pedido';
      btnCancel.textContent = '✖';
      btnCancel.addEventListener('click', () => rejectFriendRequest(req.requestId));

      actions.appendChild(btnCancel);
    }

    item.appendChild(left);
    item.appendChild(actions);
    friendsCardsList.appendChild(item);
  });
}

function renderActiveNowCards() {
  if (!activeNowList) return;
  activeNowList.innerHTML = '';

  const onlineFriends = (Array.isArray(friendsList) ? friendsList : [])
    .filter((friend) => friend.status && friend.status !== 'offline');

  if (onlineFriends.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'active-now-empty';
    empty.innerHTML = `
      <span class="active-now-empty-icon">👥</span>
      <span>Nenhum amigo está online no momento. Quando alguém ficar online, aparecerá aqui.</span>
    `;
    activeNowList.appendChild(empty);
    return;
  }

  onlineFriends.forEach((friend) => {
    const card = document.createElement('div');
    card.className = 'active-now-card';
    card.tabIndex = 0;
    card.setAttribute('role', 'button');
    card.setAttribute('aria-label', `Ver perfil de ${friend.name}`);

    const header = document.createElement('div');
    header.className = 'active-now-header';

    const avatar = document.createElement('div');
    avatar.className = 'active-now-avatar';
    avatar.style.backgroundColor = friend.color || '#5865F2';
    if (friend.avatarUrl) {
      const image = document.createElement('img');
      image.src = friend.avatarUrl;
      image.alt = '';
      avatar.appendChild(image);
    } else {
      avatar.textContent = friend.initial || friend.name[0].toUpperCase();
    }

    const userMeta = document.createElement('div');
    userMeta.className = 'active-now-usermeta';

    const userName = document.createElement('strong');
    userName.textContent = friend.name;

    const userGame = document.createElement('span');
    const activityType = friend.activityType || (friend.game ? 'game' : '');
    const activityText = friend.activityText || friend.game || '';
    userGame.textContent = activityText
      ? `${activityType === 'music' ? 'Ouvindo' : 'Jogando'} ${activityText}`
      : 'Online';

    userMeta.appendChild(userName);
    userMeta.appendChild(userGame);

    header.appendChild(avatar);
    header.appendChild(userMeta);
    card.appendChild(header);

    card.addEventListener('click', (event) => openMemberProfilePopover({ ...friend, isOwner: false }, event));
    card.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      openMemberProfilePopover({ ...friend, isOwner: false }, event);
    });

    activeNowList.appendChild(card);
  });
}

function renderDMList() {
  if (!dmConversationsList) return;
  dmConversationsList.innerHTML = '';

  const dmList = getDMList();

  if (dmList.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'dm-empty-state';
    empty.textContent = 'Suas conversas aparecerão aqui.';
    dmConversationsList.appendChild(empty);
    return;
  }

  dmList.forEach(dm => {
    const item = document.createElement('div');
    item.className = 'dm-conversation-item';
    item.dataset.friendId = dm.friendId;

    if (currentDmFriend && currentDmFriend.id === dm.friendId) {
      item.classList.add('active');
    }

    const avatar = document.createElement('div');
    avatar.className = 'dm-avatar';
    avatar.style.backgroundColor = dm.color;
    avatar.textContent = dm.initial;

    const dot = document.createElement('div');
    dot.className = 'dm-avatar-dot';
    avatar.appendChild(dot);

    const info = document.createElement('div');
    info.className = 'dm-info';

    const name = document.createElement('span');
    name.className = 'dm-name';
    name.textContent = dm.name;

    const msg = document.createElement('span');
    msg.className = 'dm-last-msg';
    msg.textContent = dm.lastMsg;

    info.appendChild(name);
    info.appendChild(msg);

    item.appendChild(avatar);
    item.appendChild(info);

    item.addEventListener('click', () => {
      const friend = friendsList.find(f => f.id === dm.friendId);
      if (friend) openDirectMessage(friend);
    });

    dmConversationsList.appendChild(item);
  });
}

if (inputFriendsSearch) {
  inputFriendsSearch.addEventListener('input', (e) => {
    if (currentFriendsTab === 'pending') {
      renderPendingRequests();
    } else {
      renderFriendsList(e.target.value.trim());
    }
  });
}

// ==========================================
// SISTEMA DE ABAS DE AMIGOS E SOLICITAÇÕES
// ==========================================
function switchFriendsTab(tab) {
  currentFriendsTab = tab;
  const tabBtns = document.querySelectorAll('.friends-tab-btn');
  tabBtns.forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('data-tab') === tab);
  });

  const searchBox = document.getElementById('friendsSearchBox');
  const countLabel = document.getElementById('friendsCountLabel');
  const cardsList = document.getElementById('friendsCardsList');
  const addPanel = document.getElementById('addFriendPanel');

  if (tab === 'add') {
    if (searchBox) searchBox.style.display = 'none';
    if (countLabel) countLabel.style.display = 'none';
    if (cardsList) cardsList.style.display = 'none';
    if (addPanel) addPanel.style.display = 'flex';

    // Exibe seu nome com a tag no help text
    const myNameEl = document.getElementById('myUsernameDisplay');
    const myTag = userProfile.tag || '0001';
    const myName = userProfile.username || userProfile.displayName || 'bads';
    if (myNameEl) myNameEl.textContent = `${myName}#${myTag}`;
  } else if (tab === 'pending') {
    if (searchBox) searchBox.style.display = 'none';
    if (countLabel) countLabel.style.display = '';
    if (cardsList) cardsList.style.display = '';
    if (addPanel) addPanel.style.display = 'none';
    renderPendingRequests();
  } else {
    // 'online' ou 'all'
    if (searchBox) searchBox.style.display = '';
    if (countLabel) countLabel.style.display = '';
    if (cardsList) cardsList.style.display = '';
    if (addPanel) addPanel.style.display = 'none';
    renderFriendsList();
  }
}

// Listeners das abas superiores de amigos
document.querySelectorAll('.friends-tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const tab = btn.getAttribute('data-tab');
    switchFriendsTab(tab);
  });
});

// Botão Solicitações de Mensagens no menu lateral DM
const dmMenuRequests = document.getElementById('dmMenuRequests');
if (dmMenuRequests) {
  dmMenuRequests.addEventListener('click', () => {
    openHomeFriendsView();
    switchFriendsTab('pending');
  });
}

const dmMenuFriends = document.getElementById('dmMenuFriends');
if (dmMenuFriends) {
  dmMenuFriends.addEventListener('click', () => {
    openHomeFriendsView();
    switchFriendsTab('online');
  });
}

// Handler do formulário de adicionar amigo (com suporte a tags bads#0000)
const formAddFriend = document.getElementById('formAddFriend');
if (formAddFriend) {
  formAddFriend.addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = document.getElementById('inputAddFriendName');
    if (!input) return;
    const rawVal = input.value.trim();
    if (!rawVal) return;

    const friend = await sendFriendRequest(rawVal);
    if (friend) {
      input.value = '';
      switchFriendsTab('pending');
    }
  });
}

// ==========================================
// MODAL DE NOVA DM (BOTÃO + E BUSCA DE CONVERSAS)
// ==========================================
const btnAddDM = document.getElementById('btnAddDM');
const btnFindConversation = document.getElementById('btnFindConversation');
const newDmModal = document.getElementById('newDmModal');
const btnCloseNewDmModal = document.getElementById('btnCloseNewDmModal');
const btnCancelNewDm = document.getElementById('btnCancelNewDm');
const btnStartDmChat = document.getElementById('btnStartDmChat');
const inputSearchDmFriends = document.getElementById('inputSearchDmFriends');
const newDmFriendsList = document.getElementById('newDmFriendsList');

let selectedDmFriendId = null;

function openNewDmModal() {
  if (!newDmModal) return;
  selectedDmFriendId = null;
  if (btnStartDmChat) btnStartDmChat.disabled = true;
  if (inputSearchDmFriends) inputSearchDmFriends.value = '';

  renderNewDmFriendsList();
  newDmModal.style.display = 'flex';
}

function closeNewDmModal() {
  if (newDmModal) newDmModal.style.display = 'none';
}

function renderNewDmFriendsList(query = '') {
  if (!newDmFriendsList) return;
  newDmFriendsList.innerHTML = '';

  const filtered = friendsList.filter(f => {
    if (!query) return true;
    const q = query.toLowerCase();
    return f.name.toLowerCase().includes(q) || 
           (f.tag && f.tag.includes(q)) || 
           (f.fullTag && f.fullTag.toLowerCase().includes(q));
  });

  if (friendsList.length === 0) {
    const empty = document.createElement('div');
    empty.style.cssText = 'padding: 24px 12px; text-align: center; color: #949ba4; font-size: 13px;';
    empty.innerHTML = `
      <div style="font-size:32px; margin-bottom:8px;">👥</div>
      <p style="margin:0 0 10px 0; color:#dbdee1; font-weight:600;">Você ainda não tem amigos adicionados</p>
      <p style="margin:0 0 14px 0; font-size:12px;">Adicione amigos usando a tag deles (ex: bads#0000) para conversar!</p>
      <button id="btnGoAddFriendFromModal" class="btn-send-friend-req" style="margin:0 auto;">
        + Adicionar Amigo
      </button>
    `;
    newDmFriendsList.appendChild(empty);

    const btnGo = empty.querySelector('#btnGoAddFriendFromModal');
    if (btnGo) {
      btnGo.addEventListener('click', () => {
        closeNewDmModal();
        openHomeFriendsView();
        switchFriendsTab('add');
      });
    }
    return;
  }

  if (filtered.length === 0) {
    const empty = document.createElement('div');
    empty.style.cssText = 'padding: 20px; text-align: center; color: #949ba4; font-size: 13px;';
    empty.textContent = 'Nenhum amigo encontrado com essa busca.';
    newDmFriendsList.appendChild(empty);
    return;
  }

  filtered.forEach(friend => {
    const item = document.createElement('div');
    item.className = 'new-dm-friend-item';
    if (selectedDmFriendId === friend.id) item.classList.add('selected');

    const left = document.createElement('div');
    left.className = 'new-dm-friend-left';

    const avatar = document.createElement('div');
    avatar.className = 'new-dm-avatar';
    avatar.style.backgroundColor = friend.color;
    avatar.textContent = friend.initial;

    const name = document.createElement('span');
    name.className = 'new-dm-name';
    name.innerHTML = `${friend.name} <span class="new-dm-tag">#${friend.tag}</span>`;

    left.appendChild(avatar);
    left.appendChild(name);

    const check = document.createElement('div');
    check.className = 'new-dm-check';
    check.innerHTML = selectedDmFriendId === friend.id ? '✔' : '';

    item.appendChild(left);
    item.appendChild(check);

    item.addEventListener('click', () => {
      selectedDmFriendId = friend.id;
      document.querySelectorAll('.new-dm-friend-item').forEach(el => {
        el.classList.remove('selected');
        const c = el.querySelector('.new-dm-check');
        if (c) c.innerHTML = '';
      });
      item.classList.add('selected');
      check.innerHTML = '✔';

      if (btnStartDmChat) {
        btnStartDmChat.disabled = false;
        btnStartDmChat.textContent = `Conversar com @${friend.name}`;
      }
    });

    // Duplo clique já abre a DM direto
    item.addEventListener('dblclick', () => {
      closeNewDmModal();
      openDirectMessage(friend);
    });

    newDmFriendsList.appendChild(item);
  });
}

if (btnAddDM) btnAddDM.addEventListener('click', openNewDmModal);
if (btnFindConversation) btnFindConversation.addEventListener('click', openNewDmModal);
if (btnCloseNewDmModal) btnCloseNewDmModal.addEventListener('click', closeNewDmModal);
if (btnCancelNewDm) btnCancelNewDm.addEventListener('click', closeNewDmModal);

if (inputSearchDmFriends) {
  inputSearchDmFriends.addEventListener('input', (e) => {
    renderNewDmFriendsList(e.target.value.trim());
  });
}

if (btnStartDmChat) {
  btnStartDmChat.addEventListener('click', () => {
    if (!selectedDmFriendId) return;
    const friend = friendsList.find(f => f.id === selectedDmFriendId);
    if (friend) {
      closeNewDmModal();
      openDirectMessage(friend);
    }
  });
}
// ==========================================
// LISTA DE MEMBROS DO SERVIDOR COM ATIVIDADES & MODERAÇÃO (Foto 1)
// ==========================================
let currentInspectedMember = null;
const serverMembersByServer = new Map();
const serverRolesByServer = new Map();
const serverMembersLoadInFlight = new Set();
let memberRoleTarget = null;
let serverMembersPollingTimer = null;

async function loadServerMembers(serverId = activeServerId) {
  if (!serverId || !authenticatedAccount) return;
  if (serverMembersLoadInFlight.has(serverId)) return;
  serverMembersLoadInFlight.add(serverId);
  try {
    const [membersResponse, rolesResponse] = await Promise.all([
      fetch(`/api/servers/${encodeURIComponent(serverId)}/members`, { credentials: 'include', headers: { Accept: 'application/json' } }),
      fetch(`/api/servers/${encodeURIComponent(serverId)}/roles`, { credentials: 'include', headers: { Accept: 'application/json' } })
    ]);
    const membersPayload = await membersResponse.json().catch(() => ({}));
    const rolesPayload = await rolesResponse.json().catch(() => ({}));
    if (!membersResponse.ok) throw new Error(membersPayload.error || 'Não foi possível carregar os membros.');
    if (!rolesResponse.ok) throw new Error(rolesPayload.error || 'Não foi possível carregar os cargos.');
    serverMembersByServer.set(serverId, Array.isArray(membersPayload.members) ? membersPayload.members : []);
    serverRolesByServer.set(serverId, Array.isArray(rolesPayload.roles) ? rolesPayload.roles : []);
    if (serverId === activeServerId && currentChannel) {
      const self = serverMembersByServer.get(serverId).find((member) => member.id === authenticatedAccount.id);
      if (self?.isMuted) {
        localVoiceCanPublish = false;
        setMuteState(true, false);
      } else if (self) {
        localVoiceCanPublish = true;
      }
    }
    renderServerMembers();
  } catch (error) {
    console.warn('Não foi possível atualizar os membros do servidor:', error);
    if (!serverMembersByServer.has(serverId) && membersScroll) {
      membersScroll.replaceChildren();
      const errorText = document.createElement('div');
      errorText.className = 'members-empty';
      errorText.textContent = error.message || 'Não foi possível carregar os membros.';
      membersScroll.appendChild(errorText);
    }
  } finally {
    serverMembersLoadInFlight.delete(serverId);
  }
}

function startServerMembersPolling() {
  clearInterval(serverMembersPollingTimer);
  serverMembersPollingTimer = setInterval(() => loadServerMembers(activeServerId), 15_000);
}

async function refreshSpotifyConnectionStatus() {
  const button = document.getElementById('btnSpotifyConnect');
  try {
    const response = await fetch('/api/spotify/status', { credentials: 'include', headers: { Accept: 'application/json' } });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || 'Não foi possível verificar a conexão do Spotify.');
    spotifyConnected = Boolean(payload.connected);
    if (button) {
      button.title = spotifyConnected ? 'Desconectar Spotify' : (payload.configured ? 'Conectar Spotify' : 'Spotify ainda não configurado no servidor');
      button.setAttribute('aria-label', button.title);
      button.textContent = spotifyConnected ? '♫✓' : '♫';
    }
    const query = new URLSearchParams(window.location.search);
    const spotifyResult = query.get('spotify');
    if (spotifyResult) {
      query.delete('spotify');
      const nextUrl = `${window.location.pathname}${query.toString() ? `?${query}` : ''}${window.location.hash}`;
      window.history.replaceState({}, '', nextUrl);
      showToast(spotifyResult === 'connected' ? 'Spotify conectado.' : 'Não foi possível conectar o Spotify.', spotifyResult === 'connected' ? '✅' : '⚠️');
    }
  } catch (error) {
    console.warn('Não foi possível verificar a conexão do Spotify:', error);
    if (button) button.title = error.message || 'Erro ao verificar Spotify';
  }
}

async function refreshSpotifyActivity() {
  if (!spotifyConnected || !authenticatedAccount) return;
  try {
    const response = await fetch('/api/spotify/now-playing', { credentials: 'include', headers: { Accept: 'application/json' } });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || 'Não foi possível atualizar a atividade do Spotify.');
    spotifyActivity = payload.playing
      ? { text: payload.text, artwork: payload.artwork || '', url: payload.url || '' }
      : null;
    await publishPresenceStatus();
    loadServerMembers(activeServerId);
  } catch (error) {
    console.warn('Não foi possível atualizar a atividade do Spotify:', error);
  }
}

function startSpotifyActivityPolling() {
  clearInterval(spotifyPollingTimer);
  if (!spotifyConnected) return;
  refreshSpotifyActivity();
  spotifyPollingTimer = setInterval(refreshSpotifyActivity, 20_000);
}

document.getElementById('btnSpotifyConnect')?.addEventListener('click', async () => {
  try {
    if (spotifyConnected) {
      const response = await fetch('/api/spotify/connection', {
        method: 'DELETE', credentials: 'include', headers: { Accept: 'application/json' }
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Não foi possível desconectar o Spotify.');
      spotifyConnected = false;
      spotifyActivity = null;
      clearInterval(spotifyPollingTimer);
      spotifyPollingTimer = null;
      await publishPresenceStatus();
      await refreshSpotifyConnectionStatus();
      await loadServerMembers(activeServerId);
      showToast('Spotify desconectado.', '✅');
      return;
    }
    const response = await fetch('/api/spotify/connect', { credentials: 'include', headers: { Accept: 'application/json' } });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || 'Não foi possível iniciar a conexão com o Spotify.');
    window.location.assign(payload.url);
  } catch (error) {
    showToast(error.message || 'Não foi possível conectar o Spotify.', '⚠️');
  }
});

function canManageActiveServerMembers() {
  const server = servers.find((entry) => entry.id === activeServerId);
  if (!server) return false;
  if (server.isOwner || server.role === 'owner' || server.role === 'admin') return true;
  return (serverRolesByServer.get(activeServerId) || []).some((role) => (
    role.id === server.roleId && role.canManageMembers
  ));
}

function renderServerMembers() {
  if (!membersScroll) return;
  const members = serverMembersByServer.get(activeServerId);
  membersScroll.replaceChildren();
  const onlineCount = (members || []).filter((member) => member.status !== 'offline').length;
  const totalCount = members?.length || 0;
  const countLabel = document.getElementById('availableMemberCount');
  if (countLabel) countLabel.textContent = `${onlineCount}/${totalCount}`;
  const createRoleButton = document.getElementById('btnCreateMemberRole');
  if (createRoleButton) {
    createRoleButton.hidden = !canManageActiveServerMembers();
  }
  if (!members) {
    const loading = document.createElement('div');
    loading.className = 'members-loading';
    loading.textContent = 'Carregando membros…';
    membersScroll.appendChild(loading);
    loadServerMembers();
    return;
  }
  if (members.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'members-empty';
    empty.textContent = 'Ainda não há membros neste servidor.';
    membersScroll.appendChild(empty);
    return;
  }

  const groups = new Map();
  members.forEach((member) => {
    const groupName = member.groupName || 'Disponíveis';
    if (!groups.has(groupName)) groups.set(groupName, []);
    groups.get(groupName).push(member);
  });
  const canManage = canManageActiveServerMembers();
  groups.forEach((groupMembers, groupName) => {
    const online = groupMembers.filter((member) => member.status !== 'offline');
    const offline = groupMembers.filter((member) => member.status === 'offline');
    const header = document.createElement('div');
    header.className = 'member-group-title';
    header.textContent = `${groupName} — ${online.length}/${groupMembers.length}`;
    membersScroll.appendChild(header);

    [...online, ...offline].forEach((member) => {
      const item = document.createElement('div');
      item.className = `member-item${member.status === 'offline' ? ' is-offline' : ''}`;
      item.dataset.participantIdentity = member.id;
      item.tabIndex = 0;
      item.setAttribute('role', 'button');

      const avatar = document.createElement('div');
      avatar.className = 'member-avatar';
      avatar.style.backgroundColor = member.color || '#5865F2';
      avatar.textContent = (member.name || 'U')[0].toUpperCase();
      if (member.avatarUrl) {
        const image = document.createElement('img');
        image.src = member.avatarUrl;
        image.alt = '';
        image.addEventListener('error', () => image.remove(), { once: true });
        avatar.appendChild(image);
      }
      const dot = document.createElement('span');
      dot.className = `member-status-dot ${member.status === 'offline' ? 'offline' : member.status}`;
      avatar.appendChild(dot);

      const info = document.createElement('div');
      info.className = 'member-info';
      const name = document.createElement('div');
      name.className = 'member-name';
      name.append(document.createTextNode(member.name || 'Usuário'));
      if (member.role && member.role !== 'Membro' && member.role !== 'Dono') {
        const roleBadge = document.createElement('span');
        roleBadge.className = 'member-role-badge';
        roleBadge.style.color = member.roleColor || '#949ba4';
        roleBadge.textContent = member.role;
        name.appendChild(roleBadge);
      }
      if (member.role === 'Dono') {
        const crown = document.createElement('span');
        crown.className = 'member-crown';
        crown.textContent = ' 👑';
        crown.title = 'Dono do servidor';
        name.appendChild(crown);
      }

      const activity = document.createElement('div');
      activity.className = 'member-activity member-activity-line';
      if (member.status === 'offline') {
        activity.textContent = 'Offline';
      } else if (member.activityType === 'game' && member.activityText) {
        appendMemberActivityIcon(activity, member.activityArtwork, '🎮');
        activity.appendChild(document.createTextNode(`Jogando ${member.activityText}`));
      } else if (member.activityType === 'music' && member.activityText) {
        appendMemberActivityIcon(activity, member.activityArtwork, '♫');
        activity.appendChild(document.createTextNode(`Ouvindo ${member.activityText}`));
      } else {
        activity.textContent = member.detail || 'Disponível';
      }
      info.append(name, activity);
      item.append(avatar, info);
      const profileMember = {
        ...member,
        initial: (member.name || 'U')[0].toUpperCase(),
        isOwner: member.role === 'Dono',
        isSelf: member.id === authenticatedAccount?.id
      };
      item.addEventListener('click', (event) => {
        if (event.target.closest('.member-manage-button')) return;
        openMemberProfilePopover(profileMember, event);
      });
      item.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          openMemberProfilePopover(profileMember, event);
        }
      });
      if (canManage && member.id !== authenticatedAccount?.id && member.role !== 'Dono') {
        const manageButton = document.createElement('button');
        manageButton.type = 'button';
        manageButton.className = 'member-manage-button';
        manageButton.textContent = '⋯';
        manageButton.title = 'Definir cargo e seção';
        manageButton.setAttribute('aria-label', `Definir cargo e seção para ${member.name}`);
        manageButton.addEventListener('click', (event) => {
          event.stopPropagation();
          openMemberRoleDialog(profileMember);
        });
        item.appendChild(manageButton);
      }
      membersScroll.appendChild(item);
    });
  });
}

function appendMemberActivityIcon(container, artwork, fallback) {
  if (artwork) {
    const image = document.createElement('img');
    image.className = 'member-activity-icon';
    image.src = artwork;
    image.alt = '';
    image.onerror = () => image.replaceWith(createActivityFallback(fallback));
    container.appendChild(image);
  } else {
    container.appendChild(createActivityFallback(fallback));
  }
}

function createActivityFallback(icon) {
  const fallback = document.createElement('span');
  fallback.className = 'member-activity-icon-fallback';
  fallback.textContent = icon;
  return fallback;
}

function openMemberRoleDialog(member) {
  const modal = document.getElementById('memberRoleModal');
  const select = document.getElementById('memberRoleSelect');
  const groupInput = document.getElementById('memberGroupInput');
  const title = document.getElementById('memberRoleModalTitle');
  if (!modal || !select || !groupInput || !member) return;
  memberRoleTarget = member;
  if (title) title.textContent = `Cargo e seção — ${member.name}`;
  select.replaceChildren();
  const memberOption = document.createElement('option');
  memberOption.value = '';
  memberOption.textContent = 'Membro (sem cargo personalizado)';
  select.appendChild(memberOption);
  (serverRolesByServer.get(activeServerId) || []).forEach((role) => {
    const option = document.createElement('option');
    option.value = role.id;
    option.textContent = role.name;
    select.appendChild(option);
  });
  select.value = member.roleId || '';
  groupInput.value = member.groupName || 'Disponíveis';
  modal.style.display = 'flex';
}

function closeMemberRoleDialog() {
  const modal = document.getElementById('memberRoleModal');
  if (modal) modal.style.display = 'none';
  memberRoleTarget = null;
}

document.getElementById('btnCloseMemberRoleModal')?.addEventListener('click', closeMemberRoleDialog);
document.getElementById('btnCancelMemberRole')?.addEventListener('click', closeMemberRoleDialog);
document.getElementById('btnSaveMemberRole')?.addEventListener('click', async () => {
  if (!memberRoleTarget) return;
  const roleId = document.getElementById('memberRoleSelect')?.value || '';
  const groupName = document.getElementById('memberGroupInput')?.value.trim() || 'Disponíveis';
  const member = memberRoleTarget;
  try {
    const response = await fetch(`/api/servers/${encodeURIComponent(activeServerId)}/members/${encodeURIComponent(member.id)}`, {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ roleId, groupName })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || 'Não foi possível atualizar o membro.');
    closeMemberRoleDialog();
    await loadServerMembers(activeServerId);
    showToast(`Cargo e seção de ${member.name} atualizados.`, '✅');
  } catch (error) {
    showToast(error.message || 'Não foi possível atualizar o membro.', '⚠️');
  }
});

document.getElementById('btnCreateMemberRole')?.addEventListener('click', async () => {
  const name = prompt('Nome do novo cargo:')?.trim();
  if (!name) return;
  const color = prompt('Cor do cargo em hexadecimal:', '#5865F2')?.trim() || '#949ba4';
  const server = servers.find((entry) => entry.id === activeServerId);
  const canManageMembers = Boolean(server?.isOwner && confirm('Este cargo poderá gerenciar membros e cargos?'));
  try {
    const response = await fetch(`/api/servers/${encodeURIComponent(activeServerId)}/roles`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ name, color, canManageMembers })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || 'Não foi possível criar o cargo.');
    await loadServerMembers(activeServerId);
    showToast(`Cargo "${payload.role.name}" criado.`, '✅');
  } catch (error) {
    showToast(error.message || 'Não foi possível criar o cargo.', '⚠️');
  }
});

// ==========================================
// POPOVER DE PERFIL DO USUÁRIO COM MODERAÇÃO (Foto 1)
// ==========================================
const userProfilePopover = document.getElementById('userProfilePopover');
const btnCloseUserPopover = document.getElementById('btnCloseUserPopover');
const userPopoverBanner = document.getElementById('userPopoverBanner');
const userPopoverAvatar = document.getElementById('userPopoverAvatar');
const userPopoverName = document.getElementById('userPopoverName');
const userPopoverTag = document.getElementById('userPopoverTag');
const userPopoverProfileTags = document.getElementById('userPopoverProfileTags');
const userPopoverAbout = document.getElementById('userPopoverAbout');
const userPopoverVolume = document.getElementById('userPopoverVolume');
const userPopoverVolumeSlider = document.getElementById('userPopoverVolumeSlider');
const userPopoverVolumeValue = document.getElementById('userPopoverVolumeValue');
const userPopoverSoundboardVolume = document.getElementById('userPopoverSoundboardVolume');
const userPopoverSoundboardVolumeSlider = document.getElementById('userPopoverSoundboardVolumeSlider');
const userPopoverSoundboardVolumeValue = document.getElementById('userPopoverSoundboardVolumeValue');
const btnMuteUserSoundboard = document.getElementById('btnMuteUserSoundboard');
const userPopoverActivity = document.getElementById('userPopoverActivity');
const userActivityType = document.getElementById('userActivityType');
const userActivityIcon = document.getElementById('userActivityIcon');
const userActivityTitle = document.getElementById('userActivityTitle');
const userActivityDetail = document.getElementById('userActivityDetail');
const btnUserActivityAction = document.getElementById('btnUserActivityAction');
const btnListenTogether = document.getElementById('btnListenTogether');
const btnProfileAddFriend = document.getElementById('btnProfileAddFriend');
const btnProfileCall = document.getElementById('btnProfileCall');
const btnProfileMessage = document.getElementById('btnProfileMessage');
const userPopoverModActions = document.getElementById('userPopoverModActions');
const btnOpenBanModal = document.getElementById('btnOpenBanModal');
const btnKickMember = document.getElementById('btnKickMember');
const btnMuteMember = document.getElementById('btnMuteMember');
const inputPopoverQuickChat = document.getElementById('inputPopoverQuickChat');
const btnSendPopoverQuickChat = document.getElementById('btnSendPopoverQuickChat');

function getProfileFriendRequestHandle(member) {
  const memberId = String(member?.id || '');
  const knownMember = (serverMembersByServer.get(activeServerId) || [])
    .find((entry) => String(entry.id) === memberId);
  const knownFriend = friendsList.find((entry) => String(entry.id) === memberId);
  const username = member?.username || knownMember?.username || knownFriend?.username;
  const tag = member?.tag || knownMember?.tag || knownFriend?.tag;
  const handle = username && tag
    ? `${username}#${tag}`
    : (member?.fullTag || '');
  return /^[a-zA-Z0-9_]{3,24}#[a-zA-Z0-9]{4}$/.test(handle) ? handle : '';
}

function updateProfileFriendAction(member) {
  if (!btnProfileAddFriend) return;
  const isSelf = member?.isSelf || String(member?.id || '') === String(authenticatedAccount?.id || '');
  const isFriend = friendsList.some((friend) => String(friend.id) === String(member?.id || ''));
  const pendingRequest = friendRequests.find((request) => String(request.id) === String(member?.id || ''));
  const handle = getProfileFriendRequestHandle(member);
  const shouldShow = !isSelf && !isFriend && Boolean(handle);
  if (btnProfileCall) btnProfileCall.style.display = isFriend && !isSelf ? '' : 'none';
  if (btnProfileMessage) btnProfileMessage.style.display = isFriend && !isSelf ? '' : 'none';
  btnProfileAddFriend.style.display = shouldShow ? '' : 'none';
  btnProfileAddFriend.disabled = pendingRequest?.type === 'outgoing';
  btnProfileAddFriend.textContent = pendingRequest?.type === 'incoming'
    ? 'Aceitar solicitação'
    : (pendingRequest?.type === 'outgoing' ? 'Pedido enviado' : '➕ Adicionar amigo');
}

function openMemberProfilePopover(member, triggerEvent) {
  if (!userProfilePopover) return;
  triggerEvent?.stopPropagation();
  currentInspectedMember = member;

  if (userPopoverName) userPopoverName.textContent = member.name;
  if (userPopoverTag) userPopoverTag.textContent = `#${member.tag || '0001'}`;
  renderProfileTags(userPopoverProfileTags, member.profileTags);
  if (userPopoverAbout) userPopoverAbout.textContent = member.detail || member.aboutMe || 'Usando o BADISCORD!';

  if (userPopoverBanner) {
    userPopoverBanner.style.background = member.bannerColor 
      ? `linear-gradient(135deg, ${member.bannerColor}, #1e1f22)` 
      : `linear-gradient(135deg, ${member.color || '#5865F2'}, #111214)`;
  }

  if (userPopoverAvatar) {
    userPopoverAvatar.replaceChildren();
    if (member.avatarUrl) {
      const image = document.createElement('img');
      image.src = member.avatarUrl;
      image.alt = '';
      image.style.cssText = 'width:100%;height:100%;border-radius:50%;object-fit:cover;';
      userPopoverAvatar.appendChild(image);
    } else {
      userPopoverAvatar.style.backgroundColor = member.color || member.bannerColor || '#5865F2';
      userPopoverAvatar.textContent = (member.name || 'U')[0].toUpperCase();
    }
  }

  const activityType = member.activityType || (member.game ? 'game' : '');
  const activityText = member.activityText || member.game || '';
  if (activityType && activityText) {
    if (userPopoverActivity) userPopoverActivity.style.display = 'block';
    const isPlayingGame = activityType === 'game';
    if (userActivityType) userActivityType.textContent = isPlayingGame ? 'JOGANDO' : 'OUVINDO NO SPOTIFY';
    if (userActivityTitle) userActivityTitle.textContent = activityText;
    if (userActivityDetail) userActivityDetail.textContent = isPlayingGame ? 'Atividade atual' : 'Spotify • faixa atual';
    if (userActivityIcon) {
      userActivityIcon.replaceChildren();
      if (member.activityArtwork) {
        const image = document.createElement('img');
        image.src = member.activityArtwork;
        image.alt = '';
        image.onerror = () => {
          userActivityIcon.replaceChildren();
          userActivityIcon.textContent = isPlayingGame ? '🎮' : '♫';
        };
        userActivityIcon.appendChild(image);
      } else {
        userActivityIcon.textContent = isPlayingGame ? '🎮' : '♫';
      }
    }
    if (btnUserActivityAction) {
      btnUserActivityAction.style.display = isPlayingGame ? '' : 'none';
      btnUserActivityAction.textContent = '🎮 Convidar para jogar';
    }
    if (btnListenTogether) {
      btnListenTogether.style.display = isPlayingGame ? 'none' : '';
    }
  } else {
    if (userPopoverActivity) userPopoverActivity.style.display = 'none';
  }

  const isSelf = member.isSelf || member.id === authenticatedAccount?.id
    || String(member.name || '').toLowerCase() === (userProfile.displayName || '').toLowerCase();
  if (userPopoverVolume) {
    const canAdjustVolume = !isSelf && typeof member.id === 'string' && Boolean(member.id);
    userPopoverVolume.style.display = canAdjustVolume ? 'block' : 'none';
    if (canAdjustVolume && userPopoverVolumeSlider) {
      userPopoverVolumeSlider.dataset.participantIdentity = member.id;
      userPopoverVolumeSlider.value = String(getUserVolume(member.id));
      if (userPopoverVolumeValue) userPopoverVolumeValue.value = `${userPopoverVolumeSlider.value}%`;
    }
  }
  const canAdjustSoundboard = !isSelf && typeof member.id === 'string' && Boolean(member.id);
  if (userPopoverSoundboardVolume) {
    userPopoverSoundboardVolume.style.display = canAdjustSoundboard ? 'block' : 'none';
  }
  if (canAdjustSoundboard && userPopoverSoundboardVolumeSlider) {
    userPopoverSoundboardVolumeSlider.dataset.participantIdentity = member.id;
    userPopoverSoundboardVolumeSlider.value = String(getSoundboardUserVolume(member.id));
    if (userPopoverSoundboardVolumeValue) {
      userPopoverSoundboardVolumeValue.value = `${userPopoverSoundboardVolumeSlider.value}%`;
    }
  }
  if (canAdjustSoundboard && btnMuteUserSoundboard) {
    const muted = isSoundboardUserMuted(member.id);
    btnMuteUserSoundboard.setAttribute('aria-pressed', String(muted));
    btnMuteUserSoundboard.textContent = muted ? '🔊 Ativar efeitos sonoros' : '🔇 Mutar efeitos sonoros';
  }
  if (userPopoverModActions) {
    userPopoverModActions.style.display = isSelf || !canManageActiveServerMembers() ? 'none' : 'flex';
  }
  updateProfileFriendAction(member);

  let anchorX;
  let anchorY;
  if (Number.isFinite(triggerEvent?.clientX) && Number.isFinite(triggerEvent?.clientY)
    && (triggerEvent.clientX || triggerEvent.clientY)) {
    anchorX = triggerEvent.clientX;
    anchorY = triggerEvent.clientY;
  } else if (triggerEvent?.currentTarget?.getBoundingClientRect) {
    const triggerRect = triggerEvent.currentTarget.getBoundingClientRect();
    anchorX = triggerRect.left + triggerRect.width / 2;
    anchorY = triggerRect.top + triggerRect.height / 2;
  }
  userProfilePopover.style.right = 'auto';
  userProfilePopover.style.left = '8px';
  userProfilePopover.style.top = '8px';
  userProfilePopover.style.display = 'block';
  positionUserPopover(anchorX, anchorY);
}

function positionUserPopover(anchorX = window.innerWidth / 2, anchorY = 120) {
  if (!userProfilePopover || userProfilePopover.style.display === 'none') return;
  const rect = userProfilePopover.getBoundingClientRect();
  const margin = 8;
  const gap = 12;
  let left = anchorX + gap;
  let top = anchorY + gap;
  if (left + rect.width > window.innerWidth - margin) left = anchorX - rect.width - gap;
  if (top + rect.height > window.innerHeight - margin) top = anchorY - rect.height - gap;
  userProfilePopover.style.right = 'auto';
  userProfilePopover.style.left = `${Math.max(margin, Math.min(window.innerWidth - rect.width - margin, left))}px`;
  userProfilePopover.style.top = `${Math.max(margin, Math.min(window.innerHeight - rect.height - margin, top))}px`;
}

btnProfileAddFriend?.addEventListener('click', async () => {
  const member = currentInspectedMember;
  if (!member) return;
  const request = friendRequests.find((entry) => String(entry.id) === String(member.id || ''));
  if (request?.type === 'incoming') {
    if (await acceptFriendRequest(request.requestId)) updateProfileFriendAction(member);
    return;
  }
  const handle = getProfileFriendRequestHandle(member);
  if (!handle) {
    showToast('Não foi possível identificar o nome de usuário para enviar o pedido.', '⚠️');
    return;
  }
  const sent = await sendFriendRequest(handle);
  if (sent) updateProfileFriendAction(member);
});

async function sendActivityInvite(member, type) {
  if (!member || !friendsList.some((friend) => friend.id === member.id)) {
    showToast('Adicione esta pessoa como amiga para enviar um convite.', '⚠️');
    return;
  }
  let text = '';
  if (type === 'game') {
    const game = member.activityText || member.game || 'um jogo';
    text = `🎮 ${userProfile.displayName} convidou você para jogar ${game}.`;
  } else {
    if (!member.activityUrl || !/^https:\/\/open\.spotify\.com\//i.test(member.activityUrl)) {
      showToast('Não há um link do Spotify disponível para esta atividade.', '⚠️');
      return;
    }
    text = `♫ ${userProfile.displayName} convidou você para ouvir: ${member.activityText}\n${member.activityUrl}`;
  }
  const friend = friendsList.find((entry) => entry.id === member.id);
  openDirectMessage(friend);
  if (chatInputText) chatInputText.value = text;
  if (chatInputForm) chatInputForm.requestSubmit();
}

btnUserActivityAction?.addEventListener('click', () => sendActivityInvite(currentInspectedMember, 'game'));
btnListenTogether?.addEventListener('click', () => sendActivityInvite(currentInspectedMember, 'music'));
btnProfileMessage?.addEventListener('click', () => {
  const friend = friendsList.find((entry) => entry.id === currentInspectedMember?.id);
  if (!friend) return showToast('Adicione esta pessoa como amiga para enviar mensagens.', '⚠️');
  if (userProfilePopover) userProfilePopover.style.display = 'none';
  openDirectMessage(friend);
});
btnProfileCall?.addEventListener('click', () => startPrivateCall(currentInspectedMember));

if (userPopoverVolumeSlider) {
  userPopoverVolumeSlider.addEventListener('input', () => {
    const volume = Number(userPopoverVolumeSlider.value);
    const identity = userPopoverVolumeSlider.dataset.participantIdentity;
    setUserVolume(identity, volume);
    if (userPopoverVolumeValue) userPopoverVolumeValue.value = `${volume}%`;
  });
}

if (userPopoverSoundboardVolumeSlider) {
  userPopoverSoundboardVolumeSlider.addEventListener('input', () => {
    const volume = Number(userPopoverSoundboardVolumeSlider.value);
    const identity = userPopoverSoundboardVolumeSlider.dataset.participantIdentity;
    setSoundboardUserVolume(identity, volume);
    if (userPopoverSoundboardVolumeValue) {
      userPopoverSoundboardVolumeValue.value = `${volume}%`;
    }
  });
}

btnMuteUserSoundboard?.addEventListener('click', () => {
  const identity = userPopoverSoundboardVolumeSlider?.dataset.participantIdentity;
  if (!identity) return;
  const muted = !isSoundboardUserMuted(identity);
  setSoundboardUserMuted(identity, muted);
  btnMuteUserSoundboard.setAttribute('aria-pressed', String(muted));
  btnMuteUserSoundboard.textContent = muted ? '🔊 Ativar efeitos sonoros' : '🔇 Mutar efeitos sonoros';
});

if (btnCloseUserPopover) {
  btnCloseUserPopover.addEventListener('click', () => {
    if (userProfilePopover) userProfilePopover.style.display = 'none';
  });
}

// Envio rápido de DM a partir do popover
if (btnSendPopoverQuickChat && inputPopoverQuickChat) {
  const sendQuick = async () => {
    const text = inputPopoverQuickChat.value.trim();
    if (!text || !currentInspectedMember) return;
    const friend = friendsList.find((entry) => entry.id === currentInspectedMember.id);
    if (!friend) {
      showToast('Adicione esta pessoa como amiga para enviar mensagens.', '⚠️');
      return;
    }
    const newMessage = createChatMessage({ text });
    openDirectMessage(friend);
    const savedMessage = await saveActiveChatMessage(newMessage);
    if (!savedMessage) return;
    if (messagesList) {
      messagesList.appendChild(createMessageElement(savedMessage));
      scrollChatToBottom();
    }
    inputPopoverQuickChat.value = '';
    if (userProfilePopover) userProfilePopover.style.display = 'none';
    showToast(`Mensagem enviada para ${friend.name}.`, '💬');
  };
  btnSendPopoverQuickChat.addEventListener('click', sendQuick);
  inputPopoverQuickChat.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') sendQuick();
  });
}

// Expulsar e Silenciar
if (btnKickMember) {
  btnKickMember.addEventListener('click', async () => {
    if (!currentInspectedMember) return;
    if (confirm(`Expulsar ${currentInspectedMember.fullTag || currentInspectedMember.name} do servidor?`)) {
      try {
        const response = await fetch(`/api/servers/${encodeURIComponent(activeServerId)}/members/${encodeURIComponent(currentInspectedMember.id)}`, {
          method: 'DELETE', credentials: 'include', headers: { Accept: 'application/json' }
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error || 'Não foi possível expulsar este membro.');
        if (userProfilePopover) userProfilePopover.style.display = 'none';
        await loadServerMembers(activeServerId);
        showToast(`${currentInspectedMember.name} foi expulso do servidor.`, '🚪');
      } catch (error) {
        showToast(error.message || 'Não foi possível expulsar este membro.', '⚠️');
      }
    }
  });
}

if (btnMuteMember) {
  btnMuteMember.addEventListener('click', async () => {
    if (!currentInspectedMember) return;
    const muted = !currentInspectedMember.isMuted;
    try {
      const response = await fetch(`/api/servers/${encodeURIComponent(activeServerId)}/members/${encodeURIComponent(currentInspectedMember.id)}/mute`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ muted })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Não foi possível silenciar este membro.');
      currentInspectedMember.isMuted = muted;
      btnMuteMember.textContent = muted ? '🔊 Remover silêncio' : '🔇 Silenciar';
      await loadServerMembers(activeServerId);
      showToast(muted ? `${currentInspectedMember.name} foi silenciado no servidor.` : `${currentInspectedMember.name} pode falar novamente.`, muted ? '🔇' : '🔊');
    } catch (error) {
      showToast(error.message || 'Não foi possível alterar o silêncio.', '⚠️');
    }
  });
}

// ==========================================
// MODAL DE BANIMENTO (1h, 24h, 7d, Permanente)
// ==========================================
const banMemberModal = document.getElementById('banMemberModal');
const btnCloseBanModal = document.getElementById('btnCloseBanModal');
const btnCancelBan = document.getElementById('btnCancelBan');
const btnConfirmBan = document.getElementById('btnConfirmBan');
const banModalTitle = document.getElementById('banModalTitle');
const banModalDesc = document.getElementById('banModalDesc');
const inputBanReason = document.getElementById('inputBanReason');

if (btnOpenBanModal) {
  btnOpenBanModal.addEventListener('click', () => {
    if (!currentInspectedMember) return;
    if (userProfilePopover) userProfilePopover.style.display = 'none';
    if (banModalTitle) banModalTitle.textContent = `🔨 Banir ${currentInspectedMember.name}`;
    if (banModalDesc) banModalDesc.textContent = `Escolha por quanto tempo ${currentInspectedMember.fullTag || currentInspectedMember.name} ficará banido deste servidor:`;
    if (banMemberModal) banMemberModal.style.display = 'flex';
  });
}

function closeBanModal() {
  if (banMemberModal) banMemberModal.style.display = 'none';
}
if (btnCloseBanModal) btnCloseBanModal.addEventListener('click', closeBanModal);
if (btnCancelBan) btnCancelBan.addEventListener('click', closeBanModal);

if (btnConfirmBan) {
btnConfirmBan.addEventListener('click', async () => {
  if (!currentInspectedMember) return;
  const selectedDur = document.querySelector('input[name="banDuration"]:checked')?.value || '1h';
  const reason = inputBanReason?.value.trim() || 'Violação das regras';
  try {
    const response = await fetch(`/api/servers/${encodeURIComponent(activeServerId)}/members/${encodeURIComponent(currentInspectedMember.id)}/ban`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ duration: selectedDur, reason })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || 'Não foi possível banir este membro.');
    const name = currentInspectedMember.name;
    closeBanModal();
    await loadServerMembers(activeServerId);
    showToast(`${name} foi banido do servidor.`, '⛔');
  } catch (error) {
    showToast(error.message || 'Não foi possível banir este membro.', '⚠️');
  }
});
}

// ==========================================
// MENU DE CONTEXTO DO SERVIDOR (Foto 3)
// ==========================================
const serverContextMenu = document.getElementById('serverContextMenu');
let contextTargetServer = null;

function openServerContextMenu(x, y, server) {
  if (!serverContextMenu) return;
  contextTargetServer = server;

  // Ajusta a posição na tela
  const maxX = window.innerWidth - 220;
  const maxY = window.innerHeight - 300;
  serverContextMenu.style.left = `${Math.min(x, maxX)}px`;
  serverContextMenu.style.top = `${Math.min(y, maxY)}px`;
  serverContextMenu.style.display = 'block';
}

function closeServerContextMenu() {
  if (serverContextMenu) serverContextMenu.style.display = 'none';
}

document.addEventListener('click', (e) => {
  if (serverContextMenu && !serverContextMenu.contains(e.target)) {
    closeServerContextMenu();
  }
  if (userProfilePopover && !userProfilePopover.contains(e.target) && !e.target.closest('.member-item') && !e.target.closest('.message-avatar')) {
    userProfilePopover.style.display = 'none';
  }
});

// Ações do Menu de Contexto
const ctxMarkAsRead = document.getElementById('ctxMarkAsRead');
if (ctxMarkAsRead) {
  ctxMarkAsRead.addEventListener('click', () => {
    closeServerContextMenu();
    showToast('Servidor marcado como lido.', '✅');
  });
}

const ctxInvitePeople = document.getElementById('ctxInvitePeople');
if (ctxInvitePeople) {
  ctxInvitePeople.addEventListener('click', () => {
    closeServerContextMenu();
    openInviteModal();
  });
}

const ctxMuteServer = document.getElementById('ctxMuteServer');
if (ctxMuteServer) {
  ctxMuteServer.addEventListener('click', () => {
    closeServerContextMenu();
    if (!contextTargetServer) return;
    contextTargetServer.isMuted = !contextTargetServer.isMuted;
    saveServers();
    showToast(contextTargetServer.isMuted ? 'Servidor silenciado.' : 'Notificações do servidor ativadas!', '🔕');
    renderGuilds();
  });
}

const ctxNotificationSettings = document.getElementById('ctxNotificationSettings');
if (ctxNotificationSettings) {
  ctxNotificationSettings.addEventListener('click', () => {
    closeServerContextMenu();
    showToast('Configurações de notificação salvas para este servidor.', '🔔');
  });
}

const ctxCreateChannel = document.getElementById('ctxCreateChannel');
if (ctxCreateChannel) {
  ctxCreateChannel.addEventListener('click', () => {
    closeServerContextMenu();
    const btnAdd = document.getElementById('btnAddTextChannel');
    if (btnAdd) btnAdd.click();
  });
}

const ctxLeaveServer = document.getElementById('ctxLeaveServer');
if (ctxLeaveServer) {
  ctxLeaveServer.addEventListener('click', () => {
    closeServerContextMenu();
    if (!contextTargetServer) return;
    if (servers.length <= 1) {
      showToast('Você não pode sair do seu único servidor!', '⚠️');
      return;
    }
    if (confirm(`Deseja realmente sair de "${contextTargetServer.name}"?`)) {
      servers = servers.filter(s => s.id !== contextTargetServer.id);
      saveServers();
      showToast(`Você saiu de ${contextTargetServer.name}.`, '🚪');
      restoreServerView(servers[0].id);
    }
  });
}

const ctxDeleteServer = document.getElementById('ctxDeleteServer');
if (ctxDeleteServer) {
  ctxDeleteServer.addEventListener('click', () => {
    closeServerContextMenu();
    if (!contextTargetServer) return;
    if (servers.length <= 1) {
      showToast('Você precisa manter pelo menos 1 servidor criado!', '⚠️');
      return;
    }
    if (confirm(`Excluir permanentemente o servidor "${contextTargetServer.name}"? Essa ação não pode ser desfeita.`)) {
      servers = servers.filter(s => s.id !== contextTargetServer.id);
      saveServers();
      showToast(`Servidor "${contextTargetServer.name}" foi excluído.`, '🗑️');
      restoreServerView(servers[0].id);
    }
  });
}

// Conectar também ao menu suspenso do topo do servidor (#serverDropdownMenu)
if (menuItemLeave) {
  menuItemLeave.addEventListener('click', () => {
    closeServerDropdown();
    const srv = servers.find(s => s.id === activeServerId);
    if (srv) {
      openServerContextMenu(window.innerWidth / 2 - 100, 180, srv);
    }
  });
}

// ==========================================
// MODAL DE CONVITE PARA O SERVIDOR
// ==========================================
const inviteToServerModal = document.getElementById('inviteToServerModal');
const btnCloseInviteModal = document.getElementById('btnCloseInviteModal');
const btnCopyInviteLink = document.getElementById('btnCopyInviteLink');
const inputInviteLink = document.getElementById('inputInviteLink');
const inviteFriendsList = document.getElementById('inviteFriendsList');
const inputInviteFriendSearch = document.getElementById('inputInviteFriendSearch');
const inviteServerName = document.getElementById('inviteServerName');
let inviteServerContext = null;

function renderInviteFriends(query = '') {
  if (!inviteFriendsList) return;
  inviteFriendsList.innerHTML = '';
  const normalizedQuery = query.trim().toLowerCase();
  const visibleFriends = friendsList.filter((friend) => {
    const label = `${friend.name} ${friend.username || ''} ${friend.fullTag || ''}`.toLowerCase();
    return !normalizedQuery || label.includes(normalizedQuery);
  });

  if (visibleFriends.length === 0) {
    inviteFriendsList.innerHTML = '<span class="invite-empty-state">Nenhum amigo encontrado para convidar.</span>';
    return;
  }

  visibleFriends.forEach((friend) => {
    const row = document.createElement('div');
    row.className = 'invite-friend-row';
    row.innerHTML = `
      <div class="invite-friend-person">
        <div class="invite-friend-avatar" style="background:${friend.color || '#5865F2'}">${friend.initial || friend.name[0].toUpperCase()}</div>
        <div class="invite-friend-meta">
          <strong>${friend.name}</strong>
          <span>${friend.username || friend.fullTag || ''}</span>
        </div>
        <span class="invite-online-dot ${friend.status === 'offline' ? 'offline' : ''}"></span>
      </div>
      <button class="btn-send-friend-req invite-action-button">Convidar</button>
    `;
    const button = row.querySelector('button');
    button.addEventListener('click', async () => {
      button.disabled = true;
      button.textContent = 'Enviando...';
      try {
        const response = await fetch('/api/server-invites', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({
            receiverId: friend.id,
            serverId: inviteServerContext.id,
            serverName: inviteServerContext.name,
            inviteUrl: inputInviteLink.value
          })
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error || 'Não foi possível enviar o convite.');
        button.textContent = 'Enviado ✓';
        button.classList.add('invite-sent');
        showToast(`Convite enviado para ${friend.fullTag || friend.name}!`, '📩');
      } catch (error) {
        button.disabled = false;
        button.textContent = 'Convidar';
        showToast(error.message || 'Não foi possível enviar o convite.', '⚠️');
      }
    });
    inviteFriendsList.appendChild(row);
  });
}

function openInviteModal() {
  if (!inviteToServerModal) return;
  const srv = servers.find(s => s.id === activeServerId) || servers[0];
  if (!srv) {
    showToast('Selecione um servidor para criar um convite.', '⚠️');
    return;
  }
  inviteServerContext = srv;
  if (inviteServerName) inviteServerName.textContent = srv.name;
  if (inputInviteLink) inputInviteLink.value = 'Gerando link de convite...';
  fetch('/api/server-invite-links', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ serverId: srv.id })
  }).then(async (response) => {
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || 'Não foi possível criar o link de convite.');
    if (inviteServerContext?.id === srv.id && inputInviteLink) inputInviteLink.value = payload.inviteUrl;
  }).catch((error) => {
    if (inviteServerContext?.id === srv.id && inputInviteLink) inputInviteLink.value = '';
    showToast(error.message || 'Não foi possível criar o link de convite.', '⚠️');
    console.warn('Não foi possível criar link de convite:', error);
  });
  if (inputInviteFriendSearch) inputInviteFriendSearch.value = '';
  renderInviteFriends();
  inviteToServerModal.style.display = 'flex';
}

if (btnCloseInviteModal) btnCloseInviteModal.addEventListener('click', () => {
  if (inviteToServerModal) inviteToServerModal.style.display = 'none';
});
if (btnCopyInviteLink) {
  btnCopyInviteLink.addEventListener('click', async () => {
    const inviteLink = inputInviteLink?.value || '';
    if (!inviteLink || inviteLink === 'Gerando link de convite...') {
      showToast('Aguarde a criação do link de convite.', '⚠️');
      return;
    }
    try {
      await navigator.clipboard.writeText(inviteLink);
      showToast('Link de convite copiado para a área de transferência!', '📋');
    } catch (error) {
      console.warn('Não foi possível copiar o link de convite:', error);
      showToast('Não foi possível copiar o link. Selecione e copie o texto manualmente.', '⚠️');
    }
  });
}
if (inputInviteFriendSearch) {
  inputInviteFriendSearch.addEventListener('input', () => renderInviteFriends(inputInviteFriendSearch.value));
}

// ==========================================
// CRIAR & EXPLORAR SERVIDORES (Botão + da Barra Lateral)
// ==========================================
const tabCreateServerMode = document.getElementById('tabCreateServerMode');
const tabExploreServersMode = document.getElementById('tabExploreServersMode');
const paneCreateServer = document.getElementById('paneCreateServer');
const paneExploreServers = document.getElementById('paneExploreServers');
const exploreServersList = document.getElementById('exploreServersList');

let selectedServerIcon = '🎮';

if (btnAddGuild) {
  btnAddGuild.addEventListener('click', () => {
    if (createServerModal) {
      if (inputServerName) inputServerName.value = '';
      switchServerWizardTab('create');
      createServerModal.style.display = 'flex';
    }
  });
}

function switchServerWizardTab(tab) {
  if (tab === 'create') {
    if (tabCreateServerMode) tabCreateServerMode.classList.add('active');
    if (tabExploreServersMode) tabExploreServersMode.classList.remove('active');
    if (paneCreateServer) paneCreateServer.style.display = 'block';
    if (paneExploreServers) paneExploreServers.style.display = 'none';
  } else {
    if (tabCreateServerMode) tabCreateServerMode.classList.remove('active');
    if (tabExploreServersMode) tabExploreServersMode.classList.add('active');
    if (paneCreateServer) paneCreateServer.style.display = 'none';
    if (paneExploreServers) paneExploreServers.style.display = 'block';
    renderExploreServers();
  }
}

if (tabCreateServerMode) tabCreateServerMode.addEventListener('click', () => switchServerWizardTab('create'));
if (tabExploreServersMode) tabExploreServersMode.addEventListener('click', () => switchServerWizardTab('explore'));

function closeCreateServerModal() {
  if (createServerModal) createServerModal.style.display = 'none';
}
if (btnCloseServerModal) btnCloseServerModal.addEventListener('click', closeCreateServerModal);
if (btnCancelServer) btnCancelServer.addEventListener('click', closeCreateServerModal);

// Seletor de ícone do servidor
document.querySelectorAll('.server-icon-choice').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.server-icon-choice').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    selectedServerIcon = btn.dataset.icon || '🎮';
  });
});

// Criar Servidor
if (btnConfirmServer) {
  btnConfirmServer.addEventListener('click', async () => {
    const name = inputServerName ? inputServerName.value.trim() : '';
    if (!name) {
      showToast('Por favor, informe o nome do seu servidor!', '⚠️');
      return;
    }

    btnConfirmServer.disabled = true;
    try {
      const response = await fetch('/api/servers', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ name, icon: selectedServerIcon })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Não foi possível criar o servidor.');
      const newSrv = {
        ...payload.server,
        textChannels: ['geral', 'clipes', 'comandos'],
        voiceChannels: ['Lounge 🔊', 'Call do Jogo']
      };
      servers.push(newSrv);
      saveServers();
      closeCreateServerModal();
      await syncLocalServersWithBackend(newSrv.id);
      showToast(`Servidor "${name}" criado com sucesso! 🎉`, '✅');
      restoreServerView(newSrv.id);
    } catch (error) {
      showToast(error.message || 'Não foi possível criar o servidor.', '⚠️');
    } finally {
      btnConfirmServer.disabled = false;
    }
  });
}

// Lista de Servidores Públicos da Comunidade
const PUBLIC_SERVERS = [];

async function renderExploreServers() {
  if (!exploreServersList) return;
  exploreServersList.innerHTML = '';

  let publicServers = PUBLIC_SERVERS;
  let serverListLoadFailed = false;
  try {
    const response = await fetch('/api/servers/public', { headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    if (!Array.isArray(payload.servers)) throw new Error('Resposta de servidores públicos inválida.');
    publicServers = payload.servers
      .filter((server) => !HIDDEN_SAMPLE_SERVER_IDS.has(server.id))
      .map((server) => ({
        ...server,
        desc: server.description || ''
      }));
  } catch (error) {
    console.warn('Não foi possível carregar servidores públicos:', error);
    serverListLoadFailed = true;
  }

  publicServers.forEach(pub => {
    const alreadyIn = servers.some(s => s.id === pub.id);
    const card = document.createElement('div');
    card.className = 'explore-server-card';

    const left = document.createElement('div');
    left.className = 'explore-card-left';

    const icon = document.createElement('div');
    icon.className = 'explore-card-icon';
    icon.textContent = pub.icon;

    const meta = document.createElement('div');
    const title = document.createElement('div');
    title.className = 'explore-card-title';
    title.textContent = pub.name;

    const desc = document.createElement('div');
    desc.className = 'explore-card-desc';
    desc.textContent = pub.desc;

    meta.appendChild(title);
    meta.appendChild(desc);
    left.appendChild(icon);
    left.appendChild(meta);

    const btnJoin = document.createElement('button');
    btnJoin.className = 'btn-join-explore';
    btnJoin.textContent = alreadyIn ? 'Já Participa ✔' : 'Entrar';
    btnJoin.disabled = alreadyIn;
    if (alreadyIn) btnJoin.style.opacity = '0.5';

    btnJoin.addEventListener('click', async () => {
      if (!hasAuthenticatedSession()) {
        showAuthOverlay();
        openAuthView('viewAuthLogin');
        showToast('Faça login para entrar em um servidor.', '🔒');
        return;
      }
      const newSrv = {
        ...pub,
        id: pub.id,
        name: pub.name,
        icon: pub.icon,
        isPublic: true,
        textChannels: pub.textChannels?.length ? pub.textChannels : ['geral', 'apresentacao', 'midia'],
        voiceChannels: pub.voiceChannels?.length ? pub.voiceChannels : ['Bate-Papo 🔊', 'Call Geral']
      };
      btnJoin.disabled = true;
      btnJoin.textContent = 'Entrando...';
      const previousServerId = activeServerId;
      const wasInHomeView = inHomeView;
      servers = servers.filter((server) => server.id !== newSrv.id);
      servers.push(newSrv);
      closeCreateServerModal();
      selectServer(newSrv.id);
      openTextChannel(newSrv.textChannels[0] || 'geral');
      try {
        const response = await fetch(`/api/servers/${encodeURIComponent(newSrv.id)}/join`, {
          method: 'POST',
          credentials: 'include',
          headers: { Accept: 'application/json' }
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error || 'Não foi possível entrar neste servidor.');

        saveServers();
        btnJoin.disabled = true;
        btnJoin.textContent = 'Já Participa ✔';
        if (activeServerId === newSrv.id) openTextChannel(newSrv.textChannels[0] || 'geral');
        showToast(`Você entrou na comunidade "${pub.name}"! 🎉`, '✅');
      } catch (error) {
        servers = servers.filter((server) => server.id !== newSrv.id);
        saveServers();
        btnJoin.disabled = false;
        btnJoin.textContent = 'Entrar';
        if (activeServerId === newSrv.id) {
          if (wasInHomeView) openHomeFriendsView();
          else if (servers.some((server) => server.id === previousServerId)) restoreServerView(previousServerId);
          else openHomeFriendsView();
        }
        showToast(error.message || 'Não foi possível entrar neste servidor.', '⚠️');
      }
    });

    card.appendChild(left);
    card.appendChild(btnJoin);
    exploreServersList.appendChild(card);
  });
  if (publicServers.length === 0) {
    const emptyState = document.createElement('div');
    emptyState.className = 'explore-empty-state';
    emptyState.textContent = serverListLoadFailed
      ? 'Não foi possível carregar os servidores públicos. Tente novamente mais tarde.'
      : 'Nenhum servidor público disponível no momento.';
    exploreServersList.appendChild(emptyState);
  }
}

// ==========================================
// SELETOR DE EMOJIS (Estilo Discord)
// ==========================================
const emojiPickerPopup = document.getElementById('emojiPickerPopup');
const emojiSearchInput = document.getElementById('emojiSearchInput');
const emojiPickerCategories = document.getElementById('emojiPickerCategories');
const emojiPickerBody = document.getElementById('emojiPickerBody');

const EMOJI_DATABASE = {
  faces: [
    '😀', '😃', '😄', '😁', '😆', '😅', '😂', '🤣', '😊', '😇',
    '🙂', '🙃', '😉', '😌', '😍', '🥰', '😘', '😗', '😙', '😚',
    '😋', '😛', '😜', '🤪', '😝', '🤑', '🤗', '🤭', '🤫', '🤔',
    '🤐', '🤨', '😐', '😑', '😶', '😏', '😒', '🙄', '😬', '🤥',
    '😌', '😔', '😪', '🤤', '😴', '😷', '🤒', '🤕', '🤢', '🤮',
    '🤧', '🥵', '🥶', '🥴', '😵', '🤯', '🤠', '🥳', '🥸', '😎',
    '🤓', '🧐', '😕', '😟', '🙁', '😮', '😯', '😲', '😳', '🥺',
    '😦', '😧', '😨', '😰', '😥', '😢', '😭', '😱', '😖', '😣',
    '😞', '😓', '😩', '😫', '🥱', '😤', '😡', '😠', '🤬', '😈',
    '👿', '💀', '☠️', '💩', '🤡', '👹', '👺', '👻', '👽', '👾', '🤖'
  ],
  games: [
    '🎮', '🕹️', '🎲', '👾', '🏆', '🥇', '🥈', '🥉', '👑', '⚔️',
    '🛡️', '🏹', '💣', '💥', '🎯', '🚀', '🔥', '⚡', '💯', '🧨',
    '✨', '🌟', '💫', '🦾', '🎧', '🖥️', '💻', '📱', '⌨️', '🖱️',
    '🧠', '👁️', '🍕', '🍿', '🥤', '🍺', '🍻', '🥂', '☕', '🕶️'
  ],
  hands: [
    '👋', '🤚', '🖐️', '✋', '🖖', '👌', '🤌', '🤏', '✌️', '🤞',
    '🤟', '🤘', '🤙', '👈', '👉', '👆', '🖕', '👇', '☝️', '👍',
    '👎', '✊', '👊', '🤛', '🤜', '👏', '🙌', '👐', '🤲', '🤝',
    '🙏', '✍️', '💅', '🤳', '💪'
  ],
  symbols: [
    '❤️', '🧡', '💛', '💚', '💙', '💜', '🤎', '🖤', '🤍', '💔',
    '❣️', '💕', '💞', '💓', '💗', '💖', '💘', '💝', '💟', '☮️',
    '✝️', '☯️', '🟢', '🔴', '🔵', '🟡', '🟣', '🟠', '🟤', '⚫',
    '⚪', '🟥', '🟧', '🟨', '🟩', '🟦', '🟪', '🟫', '⬛', '⬜'
  ]
};

let currentEmojiCategory = 'all';

function renderEmojis(filter = '', category = 'all') {
  if (!emojiPickerBody) return;
  emojiPickerBody.innerHTML = '';

  let list = [];
  if (category === 'all') {
    list = [
      ...EMOJI_DATABASE.faces,
      ...EMOJI_DATABASE.games,
      ...EMOJI_DATABASE.hands,
      ...EMOJI_DATABASE.symbols
    ];
  } else {
    list = EMOJI_DATABASE[category] || [];
  }

  if (filter) {
    list = list.filter(e => e.includes(filter));
  }

  list.forEach(emoji => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'emoji-btn-item';
    btn.textContent = emoji;

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      insertEmojiToChat(emoji);
    });

    emojiPickerBody.appendChild(btn);
  });
}

function insertEmojiToChat(emoji) {
  if (!chatInputText) return;
  const start = chatInputText.selectionStart !== null ? chatInputText.selectionStart : chatInputText.value.length;
  const end = chatInputText.selectionEnd !== null ? chatInputText.selectionEnd : chatInputText.value.length;
  const text = chatInputText.value;
  chatInputText.value = text.substring(0, start) + emoji + ' ' + text.substring(end);
  chatInputText.focus();
  const nextPos = start + emoji.length + 1;
  chatInputText.setSelectionRange(nextPos, nextPos);
}

function toggleEmojiPicker() {
  if (!emojiPickerPopup) return;
  const isShown = emojiPickerPopup.style.display !== 'none';
  if (isShown) {
    emojiPickerPopup.style.display = 'none';
  } else {
    emojiPickerPopup.style.display = 'flex';
    currentEmojiCategory = 'all';
    if (emojiSearchInput) emojiSearchInput.value = '';
    document.querySelectorAll('.emoji-cat-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.category === 'all');
    });
    renderEmojis('', 'all');
    if (emojiSearchInput) emojiSearchInput.focus();
  }
}

if (btnChatEmoji) {
  btnChatEmoji.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleEmojiPicker();
  });
}

document.querySelectorAll('.emoji-cat-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.emoji-cat-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentEmojiCategory = btn.dataset.category || 'all';
    renderEmojis(emojiSearchInput ? emojiSearchInput.value.trim() : '', currentEmojiCategory);
  });
});

if (emojiSearchInput) {
  emojiSearchInput.addEventListener('input', (e) => {
    renderEmojis(e.target.value.trim(), currentEmojiCategory);
  });
}

// Fechar popup de emojis ao clicar fora
window.addEventListener('click', (e) => {
  if (emojiPickerPopup && emojiPickerPopup.style.display !== 'none') {
    if (!emojiPickerPopup.contains(e.target) && e.target !== btnChatEmoji) {
      emojiPickerPopup.style.display = 'none';
    }
  }
});

const toggleMembersSidebar = () => {
  if (!membersSidebar) return;
  if (window.matchMedia('(max-width: 700px)').matches) {
    const isOpen = membersSidebar.classList.toggle('is-open');
    [btnToggleMembers, btnToggleVoiceMembers].filter(Boolean).forEach((button) => {
      button.setAttribute('aria-expanded', String(isOpen));
    });
    return;
  }
  const isShown = membersSidebar.style.display !== 'none';
  const shouldShow = !isShown;
  membersSidebar.style.display = shouldShow ? 'flex' : 'none';
  [btnToggleMembers, btnToggleVoiceMembers].filter(Boolean).forEach((button) => {
    button.setAttribute('aria-expanded', String(shouldShow));
  });
};

[btnToggleMembers, btnToggleVoiceMembers].filter(Boolean).forEach((button) => {
  button.addEventListener('click', toggleMembersSidebar);
});

if (btnCloseMembers) {
  btnCloseMembers.addEventListener('click', () => {
    if (!membersSidebar) return;
    membersSidebar.classList.remove('is-open');
    [btnToggleMembers, btnToggleVoiceMembers].filter(Boolean).forEach((button) => {
      button.setAttribute('aria-expanded', 'false');
    });
  });
}



// Detecção de voz (ilumina borda verde)
async function setupAudioLevelMeter(stream) {
  const audioContext = new (window.AudioContext || window.webkitAudioContext)();
  if (audioContext.state === 'suspended') {
    await audioContext.resume().catch(() => {});
  }
  const mediaStreamSource = audioContext.createMediaStreamSource(stream);
  const analyser = audioContext.createAnalyser();
  analyser.fftSize = 512;
  mediaStreamSource.connect(analyser);

  const bufferLength = analyser.fftSize;
  const dataArray = new Uint8Array(bufferLength);
  let isSpeaking = false;

  function checkSpeaking() {
    if (!currentChannel) {
      updateLocalSpeakingState(false);
      return;
    }
    analyser.getByteTimeDomainData(dataArray);
    let sumSquares = 0;
    for (let i = 0; i < bufferLength; i++) {
      const sample = (dataArray[i] - 128) / 128;
      sumSquares += sample * sample;
    }
    const rms = Math.sqrt(sumSquares / bufferLength);

    if (isMuted || isDeafened) {
      isSpeaking = false;
    } else if (isSpeaking ? rms < 0.018 : rms > 0.035) {
      isSpeaking = !isSpeaking;
    }
    updateLocalSpeakingState(isSpeaking);

    requestAnimationFrame(checkSpeaking);
  }
  checkSpeaking();
}

// Funções de Mudo e Ensurdecer (Deafen)
function setMuteState(muted, playSound = true) {
  if (!muted && currentChannel && !localVoiceCanPublish) {
    showToast('Você está silenciado neste servidor.', '🔇');
    return;
  }
  isMuted = muted;
  if (localAudioTrack) {
    localAudioTrack.enabled = !isMuted;
  }
  if (livekitAudioTrack && livekitRoom?.state === 'connected') {
    const muteOperation = isMuted ? livekitAudioTrack.mute() : livekitAudioTrack.unmute();
    muteOperation.catch((error) => {
      console.error('Não foi possível atualizar o microfone no LiveKit:', error);
      showToast('Não foi possível alterar o estado do microfone.', '⚠️');
    });
  }
  if (privateCallAudioTrack && privateCallRoom?.state === 'connected') {
    const muteOperation = isMuted ? privateCallAudioTrack.mute() : privateCallAudioTrack.unmute();
    muteOperation.catch((error) => {
      console.error('Não foi possível atualizar o microfone da chamada:', error);
      showToast('Não foi possível alterar o microfone da chamada.', '⚠️');
    });
  }
  if (playSound) {
    playMuteSound(isMuted);
  }
  updateControlsUI();
}

function setDeafenState(deafened) {
  isDeafened = deafened;
  remoteAudioElements.forEach((element) => {
    element.muted = isDeafened;
    if (!isDeafened) {
      element.play().catch((error) => {
        console.warn('Reprodução de áudio remoto bloqueada pelo navegador:', error);
      });
    }
  });
  playDeafenSound(isDeafened);

  if (isDeafened) {
    wasMutedBeforeDeafen = isMuted;
    if (!isMuted) {
      setMuteState(true, false);
    }
    if (streamGainNode) {
      try { streamGainNode.gain.value = 0; } catch (e) {}
    }
  } else {
    if (streamGainNode) {
      updateStreamVolume(streamPlayerVolume, false);
    }
    if (!wasMutedBeforeDeafen) {
      setMuteState(false, false);
    }
  }
  updateControlsUI();
}

function updateControlsUI() {
  const micCombo = document.getElementById('btnToggleMicCombo');
  const deafCombo = document.getElementById('btnToggleDeafCombo');

  if (micCombo) micCombo.classList.toggle('muted', isMuted);
  if (deafCombo) deafCombo.classList.toggle('muted', isDeafened);

  if (btnToggleMic) {
    btnToggleMic.title = isMuted ? 'Microfone Mutado (Clique para ativar)' : 'Microfone Ativo (Clique para mutar)';
  }
  if (btnToggleDeaf) {
    btnToggleDeaf.title = isDeafened ? 'Áudio Ensurdecido (Clique para ativar)' : 'Áudio Ativo (Clique para ensurdecer)';
  }

  if (btnStageMic) {
    btnStageMic.classList.toggle('muted', isMuted);
  }
  if (stageMicIcon) {
    stageMicIcon.textContent = isMuted ? '🔇' : '🎙️';
  }

  const sidebarMic = document.getElementById('sidebarUserMic');
  if (sidebarMic) {
    if (isDeafened) {
      sidebarMic.textContent = '🔇 🚫🎧';
    } else if (isMuted) {
      sidebarMic.textContent = '🔇';
    } else {
      sidebarMic.textContent = '🎤';
    }
  }

  const participantMic = document.getElementById('participantMicIcon');
  if (participantMic) {
    participantMic.textContent = isMuted ? '🔇' : (isDeafened ? '🚫🎧' : '🎤');
  }
}

// Event Listeners dos Botões de Mudo e Fone
btnToggleMic.addEventListener('click', () => {
  if (isDeafened) {
    setDeafenState(false);
    setMuteState(false, true);
  } else {
    setMuteState(!isMuted, true);
  }
});

btnToggleDeaf.addEventListener('click', () => {
  setDeafenState(!isDeafened);
});

const btnMicChevron = document.getElementById('btnMicChevron');
if (btnMicChevron) {
  btnMicChevron.addEventListener('click', (e) => {
    e.stopPropagation();
    openSettings();
    switchSettingsTab('voice');
    showToast('Configurações de Dispositivo de Entrada (Microfone)', '🎙️');
  });
}

const btnDeafChevron = document.getElementById('btnDeafChevron');
if (btnDeafChevron) {
  btnDeafChevron.addEventListener('click', (e) => {
    e.stopPropagation();
    openSettings();
    switchSettingsTab('voice');
    showToast('Configurações de Dispositivo de Saída (Alto-falantes / Fone)', '🎧');
  });
}

// Desconectar da chamada
btnDisconnectVoice.addEventListener('click', () => disconnectVoice(true));

async function disconnectVoice(playSound = true) {
  if (playSound) {
    playDisconnectSound();
  }

  if (isNativeMobileStreamer || isNativeMobileSharePending) await stopCurrentStream();
  await disconnectLiveKitRoom();

  if (localAudioTrack) {
    try { localAudioTrack.stop(); } catch (e) {}
    localAudioTrack = null;
  }
  if (localCamTrack) {
    try { localCamTrack.stop(); } catch (e) {}
    localCamTrack = null;
    isCamActive = false;
    if (dockBtnCam) dockBtnCam.classList.remove('active');
    if (btnShareCam) btnShareCam.classList.remove('active');
  }
  if (localScreenTrack) {
    await stopCurrentStream();
  }

  currentChannel = null;
  updateVoiceSelfCard();
  currentChannelTitle.textContent = 'Nenhum canal conectado';
  connectionBadge.style.display = 'none';
  emptyState.style.display = 'flex';
  participantsGrid.style.display = 'none';
  participantsGrid.innerHTML = '';
  streamViewerWrapper.style.display = 'none';
  voiceFloatingBar.style.display = 'none';
  document.querySelectorAll('.channel-item[data-type="voice"]').forEach(i => i.classList.remove('active'));

  updateSidebarChannelUsers(null);

  // Ocultar painel de ping e faixa de conexão
  if (voiceConnectionPanel) {
    voiceConnectionPanel.style.display = 'none';
  }
  if (voiceConnectedStrip) {
    voiceConnectedStrip.style.display = 'none';
  }
  stopPingMonitor();
}

// Monitoramento de Ping e Latência RTC
let pingInterval = null;

function startPingMonitor() {
  stopPingMonitor();
  measurePing();
  pingInterval = setInterval(measurePing, 5000);
}

function stopPingMonitor() {
  if (pingInterval) {
    clearInterval(pingInterval);
    pingInterval = null;
  }
  currentVoiceRttMs = null;
  voiceRttByIdentity.clear();
  updatePingUI(null);
}

async function measurePing() {
  if (!currentChannel || !livekitRoom || livekitRoom.state !== 'connected' || pingMeasurementInProgress) {
    updatePingUI(null);
    return;
  }
  pingMeasurementInProgress = true;
  const room = livekitRoom;
  const channel = currentChannel;
  try {
    const pcManager = room.engine?.pcManager;
    const peerConnections = [pcManager?.subscriber, pcManager?.publisher]
      .filter((peerConnection) => typeof peerConnection?.getStats === 'function');
    let rttMs = null;

    for (const peerConnection of peerConnections) {
      let stats;
      try {
        stats = await peerConnection.getStats();
      } catch (error) {
        console.warn('Não foi possível consultar as estatísticas da conexão de voz:', error);
        continue;
      }
      if (room !== livekitRoom || room.state !== 'connected' || channel !== currentChannel) return;
      if (!stats) continue;
      const reports = Array.from(stats.values());
      const transports = reports.filter((report) => report.type === 'transport');
      const candidatePairs = reports.filter((report) => report.type === 'candidate-pair');
      const selectedPairIds = new Set(transports.map((transport) => transport.selectedCandidatePairId).filter(Boolean));
      const selectedPair = candidatePairs.find((pair) => selectedPairIds.has(pair.id)) ||
        candidatePairs.find((pair) => pair.selected && pair.state === 'succeeded');
      if (typeof selectedPair?.currentRoundTripTime === 'number' && Number.isFinite(selectedPair.currentRoundTripTime)) {
        rttMs = Math.round(selectedPair.currentRoundTripTime * 1000);
        break;
      }
    }

    currentVoiceRttMs = rttMs;
    updatePingUI(rttMs);
    if (rttMs !== null) {
      const identity = room.localParticipant.identity;
      voiceRttByIdentity.set(identity, { rttMs, receivedAt: Date.now() });
      updateParticipantRttBadge('self', rttMs);
      try {
        await room.localParticipant.publishData(
          new TextEncoder().encode(JSON.stringify({
            type: 'badiscord-voice-rtt',
            rttMs,
            sentAt: Date.now()
          })),
          { reliable: false, topic: 'badiscord-voice-rtt' }
        );
      } catch (error) {
        console.warn('Não foi possível compartilhar a medição de latência com o canal:', error);
      }
    }
  } catch (error) {
    currentVoiceRttMs = null;
    updatePingUI(null);
    console.warn('Não foi possível medir o RTT da conexão de voz:', error);
  } finally {
    if (room === livekitRoom && room.state === 'connected') {
      const staleBefore = Date.now() - 15000;
      voiceRttByIdentity.forEach((report, identity) => {
        if (report.receivedAt < staleBefore) {
          voiceRttByIdentity.delete(identity);
          if (identity !== room.localParticipant.identity) updateParticipantRttBadge(identity, null);
        }
      });
    }
    pingMeasurementInProgress = false;
  }
}

function updateParticipantRttBadge(identity, ms) {
  const badges = document.querySelectorAll('.participant-rtt');
  const quality = ms === null ? 'ping-unavailable' : ms > 120 ? 'ping-bad' : ms > 60 ? 'ping-medium' : 'ping-good';
  badges.forEach((badge) => {
    if (badge.dataset.participantIdentity !== identity) return;
    badge.textContent = ms === null ? '-- ms' : `${ms} ms`;
    badge.className = `participant-rtt ${quality}`;
    badge.title = ms === null
      ? 'Aguardando medição do RTT deste participante'
      : 'RTT deste participante até o servidor de voz';
  });
}

function createParticipantRttBadge(member) {
  const ms = typeof member.pingMs === 'number' ? member.pingMs : null;
  const quality = ms === null ? 'ping-unavailable' : ms > 120 ? 'ping-bad' : ms > 60 ? 'ping-medium' : 'ping-good';
  const badge = document.createElement('span');
  badge.className = `participant-rtt ${quality}`;
  badge.dataset.participantIdentity = member.id;
  badge.textContent = ms === null ? '-- ms' : `${ms} ms`;
  badge.title = ms === null
    ? 'Aguardando medição do RTT deste participante'
    : 'RTT deste participante até o servidor de voz';
  return badge;
}

function updatePingUI(ms) {
  const displayValue = ms === null ? '--' : String(ms);
  if (vcPingValue) vcPingValue.textContent = displayValue;
  if (stagePingPill) stagePingPill.textContent = `📶 ${displayValue} ms`;

  const vcPingTooltipText = document.getElementById('vcPingTooltipText');
  if (vcPingTooltipText) {
    vcPingTooltipText.textContent = ms === null ? 'RTT do servidor de voz indisponível' : `${ms} ms até o servidor de voz`;
  }

  let quality = ms === null ? 'ping-unavailable' : 'ping-good';
  let icon = '📶';

  if (ms !== null && ms > 120) {
    quality = 'ping-bad';
    icon = '⚠️';
  } else if (ms !== null && ms > 60) {
    quality = 'ping-medium';
    icon = '📶';
  }

  if (vcPingBadge) vcPingBadge.className = `vc-ping-badge ${quality}`;
  if (stagePingPill) stagePingPill.className = `ping-pill ${quality}`;
  if (pingDot) pingDot.className = `status-dot ${quality}`;
  if (vcSignalIcon) vcSignalIcon.textContent = icon;
  if (participantsGrid) updateParticipantRttBadge('self', ms);
}

// ==========================================
// MODAL DE TRANSMISSÃO DE JOGOS & JANELAS (ESTILO DISCORD)
// ==========================================
const tabWindows = document.getElementById('tabWindows');
const tabGames = document.getElementById('tabGames');
const btnRefreshSources = document.getElementById('btnRefreshSources');
const inputSearchSources = document.getElementById('inputSearchSources');
const gamePrivacyBanner = document.getElementById('gamePrivacyBanner');
const selectedTargetName = document.getElementById('selectedTargetName');
const chkStreamAudio = document.getElementById('chkStreamAudio');

let cachedSources = [];
let currentCaptureTab = 'games';
let sourceSearchQuery = '';
let sourceLoadError = '';

function setCaptureTab(tab) {
  currentCaptureTab = tab;
  tabGames?.classList.toggle('active', tab === 'games');
  tabWindows?.classList.toggle('active', tab === 'windows');
  if (gamePrivacyBanner) {
    gamePrivacyBanner.className = 'game-privacy-banner';
    gamePrivacyBanner.innerHTML = tab === 'games'
      ? '<span class="privacy-shield-icon">🛡️</span><div class="privacy-text"><strong>Detecção privada:</strong> jogos reconhecidos aparecem automaticamente. Se seu jogo não for reconhecido, procure-o manualmente em <strong>Outras janelas</strong>; navegadores não aparecem nesta aba.</div>'
      : '<span class="privacy-shield-icon">🛡️</span><div class="privacy-text"><strong>Escolha manual:</strong> selecione uma janela específica, como seu navegador para transmitir um vídeo do YouTube. O monitor inteiro nunca é compartilhado.</div>';
  }
  renderSourcesFiltered();
}

if (tabGames) tabGames.addEventListener('click', () => setCaptureTab('games'));
if (tabWindows) tabWindows.addEventListener('click', () => setCaptureTab('windows'));

if (inputSearchSources) {
  inputSearchSources.addEventListener('input', (e) => {
    sourceSearchQuery = (e.target.value || '').toLowerCase().trim();
    renderSourcesFiltered();
  });
}

if (btnRefreshSources) {
  btnRefreshSources.addEventListener('click', async () => {
    btnRefreshSources.innerHTML = '<span class="refresh-icon">⏳</span> Buscando...';
    await fetchAndRenderSources();
    btnRefreshSources.innerHTML = '<span class="refresh-icon">🔄</span> Atualizar';
  });
}

async function fetchAndRenderSources() {
  if (!window.electronAPI) return;
  try {
    cachedSources = (await window.electronAPI.getScreenSources()) || [];
    sourceLoadError = '';
  } catch (err) {
    console.error('Erro ao buscar janelas e telas:', err);
    cachedSources = [];
    sourceLoadError = err.message || 'Não foi possível buscar as janelas e telas.';
  }
  renderSourcesFiltered();
}

function resetSelectedTarget() {
  selectedSourceId = null;
  btnConfirmShare.disabled = true;
  btnConfirmShare.innerHTML = '<span class="live-dot-pulse"></span> Iniciar Transmissão do Jogo';
  if (selectedTargetName) {
    selectedTargetName.textContent = 'Nenhuma janela escolhida ainda';
  }
  const dot = document.querySelector('.target-indicator-dot');
  if (dot) dot.classList.remove('active');
}

function renderSourcesFiltered() {
  sourcesGrid.innerHTML = '';
  resetSelectedTarget();

  if (sourceLoadError) {
    const errorDiv = document.createElement('div');
    errorDiv.className = 'sources-empty sources-error';
    const message = document.createElement('p');
    message.textContent = `Falha ao carregar janelas e telas: ${sourceLoadError}`;
    const retry = document.createElement('small');
    retry.textContent = 'Clique em Atualizar para tentar novamente.';
    errorDiv.append(message, retry);
    sourcesGrid.appendChild(errorDiv);
    return;
  }

  let filtered = cachedSources.filter(source => {
    if (source.isScreen) return false;
    const isSelfWindow = (source.name || '').trim().toLowerCase() === 'badiscord';
    if (isSelfWindow) return false;
    if (currentCaptureTab === 'games' && !source.isGame) return false;
    if (currentCaptureTab === 'windows' && source.isGame) return false;

    if (sourceSearchQuery) {
      const name = (source.name || '').toLowerCase();
      return name.includes(sourceSearchQuery);
    }
    return true;
  });

  // Ordenar jogos detectados no topo da lista
  filtered.sort((a, b) => {
    if (a.isGame && !b.isGame) return -1;
    if (!a.isGame && b.isGame) return 1;
    return a.name.localeCompare(b.name);
  });

  if (filtered.length === 0) {
    const emptyDiv = document.createElement('div');
    emptyDiv.className = 'sources-empty';
    emptyDiv.innerHTML = currentCaptureTab === 'games'
      ? `<p>🎮 Nenhum jogo detectado ${sourceSearchQuery ? 'para essa busca' : 'no momento'}.</p><small>Abra o jogo e clique em 🔄 <strong>Atualizar</strong>. Se o título não for reconhecido, procure-o em <strong>Outras janelas</strong>. Navegadores só aparecem na escolha manual.</small>`
      : `<p>🪟 Nenhuma outra janela encontrada ${sourceSearchQuery ? 'para essa busca' : 'no momento'}.</p><small>Use esta aba para escolher manualmente um navegador ou aplicativo específico. A janela só será transmitida depois que você a selecionar.</small>`;
    sourcesGrid.appendChild(emptyDiv);
    return;
  }

  filtered.forEach(source => {
    const item = document.createElement('div');
    item.className = 'source-item';
    item.dataset.id = source.id;
    item.setAttribute('role', 'button');
    item.tabIndex = 0;

    // Container do Thumbnail
    const thumbContainer = document.createElement('div');
    thumbContainer.className = 'source-thumb-container';

    const img = document.createElement('img');
    img.className = 'source-thumb';
    img.src = source.thumbnail;
    img.alt = source.name;

    // Badge de Tipo (Jogo, Janela ou Monitor)
    const badge = document.createElement('span');
    badge.className = 'source-badge';
    if (source.isGame) {
      badge.classList.add('source-badge-game');
      badge.textContent = '🎮 Jogo';
    } else {
      badge.classList.add('source-badge-app');
      badge.textContent = 'Janela';
    }

    thumbContainer.appendChild(img);
    thumbContainer.appendChild(badge);

    // Metadados (Ícone do App + Nome da Janela)
    const meta = document.createElement('div');
    meta.className = 'source-meta';

    if (source.appIcon) {
      const appIcon = document.createElement('img');
      appIcon.className = 'source-app-icon';
      appIcon.src = source.appIcon;
      meta.appendChild(appIcon);
    } else {
      const placeholderIcon = document.createElement('span');
      placeholderIcon.style.fontSize = '14px';
      placeholderIcon.textContent = source.isGame ? '🎮' : '🪟';
      meta.appendChild(placeholderIcon);
    }

    const title = document.createElement('div');
    title.className = 'source-title';
    title.textContent = source.name;
    title.title = source.name;
    meta.appendChild(title);

    item.appendChild(thumbContainer);
    item.appendChild(meta);

    item.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      document.querySelectorAll('.source-item').forEach(i => {
        i.classList.remove('selected');
        const selBadge = i.querySelector('.source-selected-badge');
        if (selBadge) selBadge.remove();
      });

      item.classList.add('selected');
      const selBadge = document.createElement('span');
      selBadge.className = 'source-selected-badge';
      selBadge.textContent = '✓';
      thumbContainer.appendChild(selBadge);

      selectedSourceId = source.id;
      btnConfirmShare.disabled = false;

      const shortName = source.name.length > 22 ? source.name.substring(0, 20) + '...' : source.name;
      btnConfirmShare.innerHTML = `<span class="live-dot-pulse"></span> Transmitir ${shortName}`;

      if (selectedTargetName) {
        selectedTargetName.textContent = source.name;
      }
      const dot = document.querySelector('.target-indicator-dot');
      if (dot) dot.classList.add('active');
    });
    item.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        item.click();
      }
    });

    sourcesGrid.appendChild(item);
  });
}

// Elementos dos Controles de Live e Volume
const streamVolumeSlider = document.getElementById('streamVolumeSlider');
const streamVolumePercent = document.getElementById('streamVolumePercent');
const btnStreamAudioMute = document.getElementById('btnStreamAudioMute');
const streamMuteIcon = document.getElementById('streamMuteIcon');
const btnStreamFullscreen = document.getElementById('btnStreamFullscreen');
const btnStopStreamDirect = document.getElementById('btnStopStreamDirect');
const streamVolumeHud = document.getElementById('streamVolumeHud');
const streamVolumeHudIcon = document.getElementById('streamVolumeHudIcon');
const streamVolumeHudVal = document.getElementById('streamVolumeHudVal');
const streamLoopbackBadge = document.getElementById('streamLoopbackBadge');

let streamPlayerVolume = parseInt(localStorage.getItem('badiscord_stream_player_vol') || '100', 10);
let isStreamAudioMuted = false;
let hudTimeout = null;
let streamAudioCtx = null;
let streamGainNode = null;
let streamSourceNode = null;
let removeProcessAudioChunkListener = null;
let removeProcessAudioErrorListener = null;
let isProcessAudioCaptureActive = false;

async function createProcessAudioTrack(sourceId) {
  if (!window.electronAPI?.startProcessAudioCapture) {
    throw new Error('A captura isolada de áudio não está disponível neste aplicativo.');
  }

  const captureOptions = await window.electronAPI.startProcessAudioCapture(sourceId);
  let audioContext;
  let workletUrl = '';
  let workletNode = null;

  try {
    audioContext = new (window.AudioContext || window.webkitAudioContext)({
      sampleRate: captureOptions.sampleRate
    });
    await audioContext.resume();
    if (audioContext.state !== 'running') {
      throw new Error('O navegador não iniciou o processador de áudio da transmissão.');
    }
    const workletSource = `
      class BadiscordProcessAudio extends AudioWorkletProcessor {
        constructor() {
          super();
          this.chunks = [];
          this.currentChunk = null;
          this.frameOffset = 0;
          this.port.onmessage = (event) => {
            this.chunks.push(new Float32Array(event.data));
            if (this.chunks.length > 20) this.chunks.shift();
          };
        }
        process(inputs, outputs) {
          const channels = outputs[0];
          const left = channels[0];
          const right = channels[1] || channels[0];
          for (let frame = 0; frame < left.length; frame += 1) {
            if (!this.currentChunk || this.frameOffset >= this.currentChunk.length / 2) {
              this.currentChunk = this.chunks.shift() || null;
              this.frameOffset = 0;
            }
            if (this.currentChunk) {
              left[frame] = this.currentChunk[this.frameOffset * 2];
              right[frame] = this.currentChunk[this.frameOffset * 2 + 1];
              this.frameOffset += 1;
            } else {
              left[frame] = 0;
              right[frame] = 0;
            }
          }
          return true;
        }
      }
      registerProcessor('badiscord-process-audio', BadiscordProcessAudio);
    `;
    workletUrl = URL.createObjectURL(new Blob([workletSource], { type: 'application/javascript' }));
    await audioContext.audioWorklet.addModule(workletUrl);
    workletNode = new AudioWorkletNode(audioContext, 'badiscord-process-audio', {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [2]
    });
    const destination = audioContext.createMediaStreamDestination();
    workletNode.connect(destination);
    streamSourceNode = audioContext.createMediaStreamSource(destination.stream);
    streamGainNode = audioContext.createGain();
    streamGainNode.gain.value = 0;
    streamSourceNode.connect(streamGainNode);
    streamGainNode.connect(audioContext.destination);

    removeProcessAudioChunkListener = window.electronAPI.onProcessAudioChunk((chunk) => {
      const view = chunk instanceof ArrayBuffer
        ? new Uint8Array(chunk)
        : (ArrayBuffer.isView(chunk) ? new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength) : null);
      if (!view) {
        console.error('O processo principal enviou um bloco de áudio inválido.');
        return;
      }
      const alignedLength = view.length - (view.length % 8);
      if (!alignedLength) return;
      const audioData = view.slice(0, alignedLength).buffer;
      workletNode.port.postMessage(audioData, [audioData]);
    });
    removeProcessAudioErrorListener = window.electronAPI.onProcessAudioError((message) => {
      showToast(`A captura isolada de áudio foi interrompida: ${message}`, '⚠️');
      stopCurrentStream();
    });

    streamAudioCtx = audioContext;
    isProcessAudioCaptureActive = true;
    await window.electronAPI.resumeProcessAudioCapture();
    const audioTrack = destination.stream.getAudioTracks()[0];
    if (!audioTrack) throw new Error('O processador não criou uma faixa de áudio para a transmissão.');
    return audioTrack;
  } catch (error) {
    if (removeProcessAudioChunkListener) removeProcessAudioChunkListener();
    if (removeProcessAudioErrorListener) removeProcessAudioErrorListener();
    removeProcessAudioChunkListener = null;
    removeProcessAudioErrorListener = null;
    isProcessAudioCaptureActive = false;
    try { workletNode?.disconnect(); } catch (cleanupError) {
      console.warn('Não foi possível desconectar o processador de áudio:', cleanupError);
    }
    if (audioContext && audioContext.state !== 'closed') {
      try { await audioContext.close(); } catch (cleanupError) {
        console.warn('Não foi possível fechar a captura de áudio:', cleanupError);
      }
    }
    try { await window.electronAPI.stopProcessAudioCapture(); } catch (cleanupError) {
      console.warn('Não foi possível interromper o processo de captura de áudio:', cleanupError);
    }
    streamAudioCtx = null;
    streamGainNode = null;
    streamSourceNode = null;
    throw error;
  } finally {
    if (workletUrl) URL.revokeObjectURL(workletUrl);
  }
}

function updateStreamVolume(val, showHud = false) {
  val = Math.max(0, Math.min(100, Math.round(val)));
  streamPlayerVolume = val;
  localStorage.setItem('badiscord_stream_player_vol', val);

  if (streamVolumeSlider) streamVolumeSlider.value = val;
  if (streamVolumePercent) streamVolumePercent.textContent = `${val}%`;

  // The captured game audio is sent to LiveKit only; never monitor it locally.
  if (streamGainNode) {
    streamGainNode.gain.value = 0;
  }
  remoteScreenAudioElements.forEach((element) => {
    element.volume = val / 100;
    element.muted = isStreamAudioMuted || val === 0;
  });

  // Ícone dinâmico do som
  let icon = '🔊';
  if (val === 0 || isStreamAudioMuted) {
    icon = '🔇';
  } else if (val < 50) {
    icon = '🔉';
  }
  if (streamMuteIcon) streamMuteIcon.textContent = icon;

  // Exibir HUD visual central caso solicitado (ex: ao rolar com a rodinha do mouse)
  if (showHud && streamVolumeHud) {
    if (streamVolumeHudIcon) streamVolumeHudIcon.textContent = icon;
    if (streamVolumeHudVal) streamVolumeHudVal.textContent = `${val}%`;
    streamVolumeHud.classList.add('visible');
    if (hudTimeout) clearTimeout(hudTimeout);
    hudTimeout = setTimeout(() => {
      streamVolumeHud.classList.remove('visible');
    }, 1000);
  }
}

// Parar Transmissão Atual com Limpeza Completa
function stopNativeMobileShare() {
  if (!isNativeMobileStreamer && !isNativeMobileSharePending) return;
  isNativeMobileStreamer = false;
  isNativeMobileSharePending = false;
  window.AndroidScreenShare?.stopScreenShare();
}

async function stopCurrentStream() {
  stopNativeMobileShare();
  if (localScreenTrack) localScreenTrack.onended = null;
  const screenShareSource = window.LivekitClient?.Track?.Source?.ScreenShare;
  const screenShareAudioSource = window.LivekitClient?.Track?.Source?.ScreenShareAudio;
  if (livekitRoom?.state === 'connected' && livekitRoom.localParticipant) {
    const videoPublication = screenShareSource
      ? livekitRoom.localParticipant.getTrackPublication(screenShareSource)
      : null;
    const audioPublication = screenShareAudioSource
      ? livekitRoom.localParticipant.getTrackPublication(screenShareAudioSource)
      : null;
    try {
      if (videoPublication?.track) await livekitRoom.localParticipant.unpublishTrack(videoPublication.track);
      if (audioPublication?.track) await livekitRoom.localParticipant.unpublishTrack(audioPublication.track);
    } catch (error) {
      console.warn('Não foi possível encerrar a transmissão no LiveKit:', error);
    }
  }

  if (streamGainNode) {
    try { streamGainNode.gain.value = 0; } catch (e) {}
  }
  if (removeProcessAudioChunkListener) removeProcessAudioChunkListener();
  if (removeProcessAudioErrorListener) removeProcessAudioErrorListener();
  removeProcessAudioChunkListener = null;
  removeProcessAudioErrorListener = null;
  if (isProcessAudioCaptureActive && window.electronAPI?.stopProcessAudioCapture) {
    try {
      await window.electronAPI.stopProcessAudioCapture();
    } catch (error) {
      console.warn('Não foi possível encerrar o processo de captura isolada:', error);
    }
  }
  isProcessAudioCaptureActive = false;
  if (streamAudioCtx) {
    try { streamAudioCtx.close(); } catch (e) {}
    streamAudioCtx = null;
    streamGainNode = null;
    streamSourceNode = null;
  }
  if (localScreenTrack) {
    try { localScreenTrack.stop(); } catch (e) {}
    localScreenTrack = null;
  }
  if (localScreenAudioTrack) {
    try { localScreenAudioTrack.stop(); } catch (e) {}
    localScreenAudioTrack = null;
  }
  if (remoteVideoPlayer) {
    remoteVideoPlayer.srcObject = null;
    remoteVideoPlayer.muted = true;
  }
  watchingLiveParticipantId = '';
  if (streamViewerWrapper) {
    streamViewerWrapper.style.display = 'none';
  }
  if (participantsGrid && currentChannel) {
    participantsGrid.style.display = 'grid';
  }
  isLocalStreamer = false;
  localStreamResolution = null;
  localStreamFps = null;
  const resolutionBadge = document.querySelector('.res-pill');
  if (resolutionBadge) {
    const configuredResolution = localStorage.getItem('badiscord_stream_res') || '1080';
    const configuredFps = localStorage.getItem('badiscord_stream_fps') || '60';
    resolutionBadge.textContent = `${configuredResolution === '1440' ? '2K (1440p)' : `${configuredResolution}p`} ${configuredFps}FPS`;
  }
  const liveViewerCount = document.getElementById('liveViewerCount');
  if (liveViewerCount) liveViewerCount.textContent = '👁 0';
  if (btnStopStreamDirect) btnStopStreamDirect.style.display = '';
  const localIdentity = livekitRoom?.localParticipant?.identity;
  if (localIdentity) remoteScreenTracks.delete(localIdentity);
  refreshVoiceParticipantViews();

  if (btnShareScreen) {
    btnShareScreen.classList.remove('live-active');
    const configuredResolution = localStorage.getItem('badiscord_stream_res') || '1080';
    btnShareScreen.innerHTML = `<span>🖥️</span> Transmitir Tela (${configuredResolution === '1440' ? '2K' : `${configuredResolution}p`})`;
  }

  const panel = document.getElementById('gameActivityPanel');
  if (panel) panel.classList.remove('is-live');
  if (btnGameQuickStream) {
    btnGameQuickStream.innerHTML = '🖥️';
    const configuredResolution = localStorage.getItem('badiscord_stream_res') || '1080';
    const resolutionLabel = configuredResolution === '1440' ? '2K' : `${configuredResolution}p`;
    btnGameQuickStream.title = `Transmitir Jogo em ${resolutionLabel}`;
  }
  if (gameActivityStatus) {
    gameActivityStatus.textContent = 'Não Compartilhando';
  }
  if (streamLoopbackBadge) streamLoopbackBadge.style.display = 'none';
  checkRunningGame();
}

window.onAndroidScreenShareStateChanged = (active, message = '') => {
  if (!active) {
    const wasActive = isNativeMobileStreamer;
    isNativeMobileStreamer = false;
    isNativeMobileSharePending = false;
    if (wasActive) void stopCurrentStream();
    if (message) showToast(message, '⚠️');
    return;
  }

  isNativeMobileStreamer = true;
  isNativeMobileSharePending = false;
  isLocalStreamer = true;
  localStreamResolution = '1080';
  localStreamFps = '30';
  if (btnShareScreen) {
    btnShareScreen.classList.add('live-active');
    btnShareScreen.innerHTML = '<span>⏹️</span> Parar Transmissão';
  }
  if (btnStopStreamDirect) btnStopStreamDirect.style.display = 'inline-flex';
  if (btnGameQuickStream) {
    btnGameQuickStream.innerHTML = '⏹️';
    btnGameQuickStream.title = 'Parar Transmissão';
  }
  const panel = document.getElementById('gameActivityPanel');
  if (panel) panel.classList.add('is-live');
  if (gameActivityStatus) gameActivityStatus.textContent = 'AO VIVO • Tela do celular';
  if (streamLoopbackBadge) streamLoopbackBadge.style.display = 'none';
  refreshVoiceParticipantViews();
};

// Slider de Volume da Live
if (streamVolumeSlider) {
  streamVolumeSlider.addEventListener('input', (e) => {
    const val = parseInt(e.target.value, 10);
    updateStreamVolume(val, false);
  });
}

// Ajuste Rápido de Volume com o Scroll do Mouse sobre o Player
if (streamViewerWrapper) {
  streamViewerWrapper.addEventListener('wheel', (e) => {
    e.preventDefault();
    const step = 5;
    const nextVal = e.deltaY < 0 ? streamPlayerVolume + step : streamPlayerVolume - step;
    updateStreamVolume(nextVal, true);
  }, { passive: false });
}

// Botão de Mutar / Desmutar
if (btnStreamAudioMute) {
  btnStreamAudioMute.addEventListener('click', () => {
    if (isStreamAudioMuted) {
      isStreamAudioMuted = false;
      const restoreVol = streamPlayerVolume === 0 ? 80 : streamPlayerVolume;
      updateStreamVolume(restoreVol, true);
    } else {
      isStreamAudioMuted = true;
      updateStreamVolume(0, true);
    }
  });
}

// Tela Cheia da Live
if (btnStreamFullscreen) {
  btnStreamFullscreen.addEventListener('click', () => {
    if (!document.fullscreenElement) {
      streamViewerWrapper.requestFullscreen().catch(err => {
        console.error('Erro ao expandir tela cheia:', err);
      });
    } else {
      document.exitFullscreen();
    }
  });
}

// Botão Parar Live Direto no Player
if (btnStopStreamDirect) {
  btnStopStreamDirect.addEventListener('click', () => {
    stopCurrentStream();
  });
}

async function startBrowserDisplayStream() {
  const mobilePublisher = isMobileStreamDevice();
  if (mobilePublisher && window.AndroidScreenShare) {
    if (isNativeMobileSharePending || isNativeMobileStreamer) return;
    if (!hasAuthenticatedSession()) {
      showToast('Faça login antes de iniciar uma transmissão.', '⚠️');
      return;
    }
    if (!currentChannel) {
      showToast('Entre em um canal de voz antes de iniciar uma transmissão.', '⚠️');
      return;
    }

    isNativeMobileSharePending = true;
    try {
      showToast('A live compartilhará a tela inteira do celular após sua confirmação no Android.', '🔒');
      const roomName = getLiveKitRoomName(currentChannel);
      const [livekitUrl, credentials] = await Promise.all([
        fetchLiveKitConfig(),
        requestLiveKitToken(roomName, userProfile.displayName || 'Usuário', true)
      ]);
      if (!isNativeMobileSharePending) return;
      if (
        !hasAuthenticatedSession() ||
        !currentChannel ||
        getLiveKitRoomName(currentChannel) !== roomName
      ) {
        isNativeMobileSharePending = false;
        return;
      }
      if (!credentials.participantIdentity) {
        throw new Error('O servidor não retornou a identidade de transmissão mobile.');
      }
      const started = window.AndroidScreenShare.startScreenShare(
        livekitUrl,
        credentials.token,
        credentials.participantIdentity,
        'Tela do celular'
      );
      if (!started) throw new Error('O Android não conseguiu iniciar a captura da tela.');
    } catch (error) {
      isNativeMobileSharePending = false;
      console.error('Não foi possível iniciar a transmissão nativa do Android:', error);
      showToast(error.message || 'Não foi possível iniciar a transmissão no Android.', '⚠️');
    }
    return;
  }
  if (!navigator.mediaDevices?.getDisplayMedia) {
    showToast(
      mobilePublisher
        ? 'Este navegador não oferece compartilhamento de tela. Atualize o navegador ou use outro compatível.'
        : 'Este navegador não oferece compartilhamento de tela. Você ainda pode assistir às lives.',
      '⚠️'
    );
    return;
  }

  if (mobilePublisher) {
    showToast('A live mostrará a tela inteira do celular, inclusive notificações. Confirme o compartilhamento na tela do sistema.', '🔒');
  }
  await startStreamWithSourceId(
    '__browser_display__',
    mobilePublisher ? 'Tela do celular' : 'Compartilhamento de tela'
  );
}

btnShareScreen.addEventListener('click', async () => {
  // Se já estiver transmitindo, clicar no botão encerra a transmissão
  if (localScreenTrack || isNativeMobileStreamer) {
    stopCurrentStream();
    return;
  }

  if (!window.electronAPI) {
    await startBrowserDisplayStream();
    return;
  }

  // Garantir que a aba Janelas & Jogos esteja ativa por padrão
  setCaptureTab('games');
  if (inputSearchSources) inputSearchSources.value = '';
  sourceSearchQuery = '';

  screenShareModal.style.display = 'flex';
  await fetchAndRenderSources();
});

btnCloseModal.addEventListener('click', () => screenShareModal.style.display = 'none');
btnCancelShare.addEventListener('click', () => screenShareModal.style.display = 'none');

// Iniciar Live do Jogo (1080p 60FPS) - Função Modular Unificada
async function startStreamWithSourceId(sourceId, sourceTitle) {
  if (!sourceId) return;
  if (window.electronAPI && !sourceId.startsWith('window:')) {
    showToast('Por segurança, o app só transmite janelas individuais. Selecione a janela do jogo.', '⚠️');
    return;
  }
  if (!hasAuthenticatedSession()) {
    showToast('Faça login antes de iniciar uma transmissão.', '⚠️');
    return;
  }
  if (!currentChannel) {
    showToast('Entre em um canal de voz antes de iniciar uma transmissão.', '⚠️');
    return;
  }

  const requestedRes = parseInt((selectResolution && selectResolution.value) || localStorage.getItem('badiscord_stream_res') || '1080', 10);
  const requestedFps = parseInt((selectFps && selectFps.value) || localStorage.getItem('badiscord_stream_fps') || '60', 10);
  const mobilePublisher = isMobileStreamDevice();
  const targetRes = mobilePublisher && requestedRes > 1080 ? 1080 : requestedRes;
  const targetFps = mobilePublisher ? Math.min(requestedFps, 30) : requestedFps;
  const includeAudio = chkStreamAudio ? chkStreamAudio.checked : true;

  localStorage.setItem('badiscord_stream_res', String(requestedRes));
  localStorage.setItem('badiscord_stream_fps', String(requestedFps));
  if (screenShareModal) screenShareModal.style.display = 'none';
  if (mobilePublisher && (targetRes !== requestedRes || targetFps !== requestedFps)) {
    showToast(`Modo otimizado para celular: transmissão em ${targetRes}p ${targetFps} FPS para reduzir travamentos.`, '⚡');
  }

  let capturedStream = null;
  try {
    let captureProcessAudio = false;
    if (sourceId === '__browser_display__') {
      const width = targetRes === 1440 ? 2560 : (targetRes === 1080 ? 1920 : 1280);
      capturedStream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          ...(!mobilePublisher ? { displaySurface: 'window' } : {}),
          width: { ideal: width },
          height: { ideal: targetRes },
          frameRate: { ideal: targetFps, max: targetFps }
        },
        audio: includeAudio,
        systemAudio: includeAudio ? 'include' : 'exclude',
        windowAudio: includeAudio ? 'system' : 'exclude'
      });
      const displaySurface = capturedStream.getVideoTracks()[0]?.getSettings().displaySurface;
      if (!mobilePublisher && !['window', 'browser'].includes(displaySurface)) {
        throw new Error('A transmissão foi cancelada para proteger sua privacidade. Selecione somente a janela ou a aba do jogo, não a tela inteira.');
      }
    } else {
      const isWindowSource = sourceId.startsWith('window:');
      captureProcessAudio = includeAudio && isWindowSource && Boolean(window.electronAPI?.startProcessAudioCapture);
      if (includeAudio && !captureProcessAudio) {
        showToast('Para transmitir áudio exclusivo do jogo, selecione uma janela no aplicativo desktop Windows. A live continuará somente com vídeo.', '⚠️');
      }
      const videoConstraints = {
        mandatory: {
          chromeMediaSource: 'desktop',
          chromeMediaSourceId: sourceId,
          maxWidth: targetRes === 1440 ? 2560 : (targetRes === 1080 ? 1920 : 1280),
          maxHeight: targetRes,
          maxFrameRate: targetFps
        }
      };

      capturedStream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: videoConstraints
      });
    }

    localScreenTrack = capturedStream.getVideoTracks()[0];
    if (!localScreenTrack) throw new Error('O navegador não retornou uma faixa de vídeo para compartilhar.');
    if (sourceId === '__browser_display__') {
      localScreenAudioTrack = includeAudio ? (capturedStream.getAudioTracks()[0] || null) : null;
      if (includeAudio && !localScreenAudioTrack) {
        showToast('O navegador ou a fonte selecionada não forneceu áudio. Se disponível, habilite "Compartilhar áudio do sistema" no seletor. O áudio pode incluir outros sons do computador.', '⚠️');
      }
    } else if (!window.electronAPI) {
      localScreenAudioTrack = null;
    } else if (captureProcessAudio) {
      try {
        localScreenAudioTrack = await createProcessAudioTrack(sourceId);
      } catch (audioError) {
        console.error('Não foi possível capturar o áudio exclusivo da janela:', audioError);
        showToast(`${audioError.message || 'Falha ao capturar o áudio do jogo.'} A live continuará somente com vídeo.`, '⚠️');
      }
    }
    if (localScreenTrack.contentHint !== undefined) localScreenTrack.contentHint = 'motion';
    const room = await connectToLiveKitRoom(currentChannel);
    if (!room || room.state !== 'connected') throw new Error('Não foi possível conectar ao canal de voz para transmitir.');
    const screenShareSource = window.LivekitClient.Track.Source.ScreenShare;
    const screenShareAudioSource = window.LivekitClient.Track.Source.ScreenShareAudio;
    await room.localParticipant.publishTrack(localScreenTrack, {
      source: screenShareSource,
      name: sourceTitle || 'BADISCORD Live',
      stream: `screen-share-${authenticatedAccount.id}`,
      screenShareEncoding: {
        maxBitrate: targetRes === 1440 ? 12000000 : (targetRes === 1080 ? 8000000 : 4000000),
        maxFramerate: targetFps
      },
      screenShareSimulcastLayers: [
        window.LivekitClient.VideoPresets.h720,
        window.LivekitClient.VideoPresets.h360
      ],
      degradationPreference: 'balanced'
    });
    localStreamResolution = targetRes;
    localStreamFps = targetFps;
    if (localScreenAudioTrack) {
      await room.localParticipant.publishTrack(localScreenAudioTrack, {
        source: screenShareAudioSource,
        name: sourceTitle ? `${sourceTitle} Audio` : 'BADISCORD Live Audio',
        stream: `screen-share-${authenticatedAccount.id}`
      });
    }
    isLocalStreamer = true;
    refreshVoiceParticipantViews();
    const liveViewerCount = document.getElementById('liveViewerCount');
    if (liveViewerCount) liveViewerCount.textContent = `👁 ${getVoiceViewerCount(room)}`;

    // PREVENÇÃO DE ECO / LOOPBACK:
    // O elemento de vídeo local recebe APENAS a faixa de vídeo.
    const previewOnlyStream = new MediaStream([localScreenTrack]);
    remoteVideoPlayer.srcObject = previewOnlyStream;
    remoteVideoPlayer.muted = true;
    remoteVideoPlayer.defaultMuted = true;
    streamViewerWrapper.style.display = 'flex';

    // Oculta temporariamente o grid de participantes enquanto transmite para focar a live centralizada
    if (participantsGrid) {
      participantsGrid.style.display = 'none';
    }

    if (btnShareScreen) {
      btnShareScreen.classList.add('live-active');
      btnShareScreen.innerHTML = `<span>⏹️</span> Parar Transmissão (${targetRes === 1440 ? '2K' : `${targetRes}p`})`;
    }

    const panel = document.getElementById('gameActivityPanel');
    if (panel) panel.classList.add('is-live');

    if (gameActivityStatus) {
      gameActivityStatus.textContent = `AO VIVO em ${targetRes === 1440 ? '2K (1440p)' : `${targetRes}p`} ${targetFps}FPS`;
    }
    const resolutionBadge = document.querySelector('.res-pill');
    if (resolutionBadge) {
      resolutionBadge.textContent = `${targetRes === 1440 ? '2K (1440p)' : `${targetRes}p`} ${targetFps}FPS`;
    }

    if (btnGameQuickStream) {
      btnGameQuickStream.innerHTML = '⏹️';
      btnGameQuickStream.title = 'Parar Transmissão';
    }

    if (streamLoopbackBadge) streamLoopbackBadge.style.display = 'inline-flex';
    updateStreamVolume(streamPlayerVolume, false);

    const streamerName = document.getElementById('streamerName');
    if (streamerName) {
      streamerName.textContent = sourceTitle ? `🎮 Ao Vivo: ${sourceTitle}` : 'Transmitindo Janela de Jogo';
    }

    localScreenTrack.onended = () => {
      stopCurrentStream();
    };

    if (!mobilePublisher) showToast('Transmissão iniciada!', '📡');
  } catch (err) {
    await stopCurrentStream();
    capturedStream?.getTracks().forEach((track) => track.stop());
    console.error('Falha ao iniciar captura da tela:', err);
    showToast(err.message || 'Não foi possível iniciar o compartilhamento de tela.', '⚠️');
  }
}

btnConfirmShare.addEventListener('click', async () => {
  if (!selectedSourceId) return;
  const sel = cachedSources.find(s => s.id === selectedSourceId);
  const title = sel ? sel.name : 'Jogo';
  await startStreamWithSourceId(selectedSourceId, title);
});

// Integrações da aba de Configurações de Transmissão
const btnTestGameSelect = document.getElementById('btnTestGameSelect');
if (btnTestGameSelect) {
  btnTestGameSelect.addEventListener('click', async () => {
    closeSettings();
    if (!window.electronAPI) return;
    setCaptureTab('games');
    if (inputSearchSources) inputSearchSources.value = '';
    sourceSearchQuery = '';
    screenShareModal.style.display = 'flex';
    await fetchAndRenderSources();
  });
}

const prefResolution = document.getElementById('prefResolution');
const prefFps = document.getElementById('prefFps');
if (prefResolution) {
  prefResolution.value = localStorage.getItem('badiscord_stream_res') || '1080';
  prefResolution.addEventListener('change', () => {
    localStorage.setItem('badiscord_stream_res', prefResolution.value);
    if (selectResolution) selectResolution.value = prefResolution.value;
  });
}
if (prefFps) {
  prefFps.value = localStorage.getItem('badiscord_stream_fps') || '60';
  prefFps.addEventListener('change', () => {
    localStorage.setItem('badiscord_stream_fps', prefFps.value);
    if (selectFps) selectFps.value = prefFps.value;
  });
}

// Inicialização da UI
selectServer(activeServerId);
updateControlsUI();
const initialServer = servers.find(s => s.id === activeServerId) || servers[0];
if (initialServer && initialServer.textChannels && initialServer.textChannels.length > 0) {
  openTextChannel(initialServer.textChannels[0]);
}

showAuthOverlay();
openAuthView('viewAuthLogin');
initializeRecaptcha();
initializePasswordToggles();
initializeAuthForms();

// ==========================================
// CONFIGURAÇÕES DE VOZ E VÍDEO (ESTILO DISCORD)
// ==========================================
const btnOpenSettings = document.getElementById('btnOpenSettings');
const settingsOverlay = document.getElementById('settingsOverlay');
const btnCloseSettings = document.getElementById('btnCloseSettings');
const selectMicDevice = document.getElementById('selectMicDevice');
const selectSpeakerDevice = document.getElementById('selectSpeakerDevice');
const micVolumeSlider = document.getElementById('micVolumeSlider');
const speakerVolumeSlider = document.getElementById('speakerVolumeSlider');
const micVolPercent = document.getElementById('micVolPercent');
const speakerVolPercent = document.getElementById('speakerVolPercent');
const btnTestMic = document.getElementById('btnTestMic');
const micMeterBars = document.getElementById('micMeterBars');
const sensitivityMeterFill = document.getElementById('sensitivityMeterFill');

let isTestingMic = false;
let testAudioContext = null;
let testAudioStream = null;
let testAnimFrame = null;

// Criar barras do medidor de microfone
if (micMeterBars) {
  micMeterBars.innerHTML = '';
  for (let i = 0; i < 36; i++) {
    const bar = document.createElement('div');
    bar.className = 'mic-bar';
    micMeterBars.appendChild(bar);
  }
}

// Abrir e fechar configurações
if (btnOpenSettings) {
  btnOpenSettings.addEventListener('click', openSettings);
}
if (btnCloseSettings) {
  btnCloseSettings.addEventListener('click', closeSettings);
}

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && settingsOverlay && settingsOverlay.style.display !== 'none') {
    closeSettings();
  }
});

async function openSettings() {
  if (!settingsOverlay) return;
  settingsOverlay.style.display = 'flex';
  await populateAudioDevices();
}

function closeSettings() {
  if (!settingsOverlay) return;
  settingsOverlay.style.display = 'none';
  if (isTestingMic) {
    stopMicTest();
  }
}

// Listar microfones e alto-falantes reais do Windows
async function populateAudioDevices() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return;

  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    
    // Preencher microfones
    if (selectMicDevice) {
      selectMicDevice.innerHTML = '';
      const mics = devices.filter(d => d.kind === 'audioinput');
      if (mics.length === 0) {
        selectMicDevice.innerHTML = '<option value="default">Padrão do Windows (Microfone)</option>';
      } else {
        mics.forEach((mic, index) => {
          const opt = document.createElement('option');
          opt.value = mic.deviceId;
          opt.textContent = mic.label || `Microfone ${index + 1}`;
          selectMicDevice.appendChild(opt);
        });
      }
    }

    // Preencher alto-falantes
    if (selectSpeakerDevice) {
      selectSpeakerDevice.innerHTML = '';
      const speakers = devices.filter(d => d.kind === 'audiooutput');
      if (speakers.length === 0) {
        selectSpeakerDevice.innerHTML = '<option value="default">Padrão do Windows (Alto-falante)</option>';
      } else {
        speakers.forEach((spk, index) => {
          const opt = document.createElement('option');
          opt.value = spk.deviceId;
          opt.textContent = spk.label || `Alto-falante ${index + 1}`;
          selectSpeakerDevice.appendChild(opt);
        });
      }
    }
  } catch (err) {
    console.error('Erro ao listar dispositivos de áudio:', err);
  }
}

// Sliders de Volume
if (micVolumeSlider) {
  micVolumeSlider.addEventListener('input', () => {
    micVolPercent.textContent = `${micVolumeSlider.value}%`;
  });
}

if (speakerVolumeSlider) {
  speakerVolumeSlider.addEventListener('input', () => {
    speakerVolPercent.textContent = `${speakerVolumeSlider.value}%`;
    const vol = parseInt(speakerVolumeSlider.value, 10) / 100;
    if (remoteVideoPlayer) remoteVideoPlayer.volume = vol;
  });
}

// Teste do Microfone com Visualizador em Tempo Real
if (btnTestMic) {
  btnTestMic.addEventListener('click', () => {
    if (isTestingMic) {
      stopMicTest();
    } else {
      startMicTest();
    }
  });
}

async function startMicTest() {
  isTestingMic = true;
  btnTestMic.textContent = 'Parar teste';
  btnTestMic.classList.add('testing');

  try {
    const deviceId = selectMicDevice ? selectMicDevice.value : undefined;
    const constraints = {
      audio: deviceId ? { deviceId: { exact: deviceId } } : true,
      video: false
    };

    testAudioStream = await navigator.mediaDevices.getUserMedia(constraints);
    testAudioContext = new (window.AudioContext || window.webkitAudioContext)();
    const source = testAudioContext.createMediaStreamSource(testAudioStream);
    const analyser = testAudioContext.createAnalyser();
    analyser.fftSize = 64;
    source.connect(analyser);

    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    const bars = micMeterBars ? Array.from(micMeterBars.children) : [];

    function animateTest() {
      if (!isTestingMic) return;
      analyser.getByteFrequencyData(dataArray);

      let sum = 0;
      for (let i = 0; i < bufferLength; i++) {
        sum += dataArray[i];
      }
      const avg = sum / bufferLength;
      const activeBarCount = Math.min(bars.length, Math.round((avg / 120) * bars.length));

      bars.forEach((bar, index) => {
        if (index < activeBarCount) {
          bar.classList.add('active');
        } else {
          bar.classList.remove('active');
        }
      });

      if (sensitivityMeterFill) {
        const percent = Math.min(100, Math.round((avg / 100) * 100));
        sensitivityMeterFill.style.width = `${percent}%`;
      }

      testAnimFrame = requestAnimationFrame(animateTest);
    }
    animateTest();
  } catch (err) {
    alert(`Não foi possível acessar o microfone para teste: ${err.message}`);
    stopMicTest();
  }
}

function stopMicTest() {
  isTestingMic = false;
  btnTestMic.textContent = 'Teste do microfone';
  btnTestMic.classList.remove('testing');

  if (testAnimFrame) {
    cancelAnimationFrame(testAnimFrame);
    testAnimFrame = null;
  }
  if (testAudioStream) {
    testAudioStream.getTracks().forEach(t => t.stop());
    testAudioStream = null;
  }
  if (testAudioContext) {
    testAudioContext.close();
    testAudioContext = null;
  }

  if (micMeterBars) {
    Array.from(micMeterBars.children).forEach(b => b.classList.remove('active'));
  }
  if (sensitivityMeterFill) {
    sensitivityMeterFill.style.width = '0%';
  }
}

// ==========================================
// GERENCIAMENTO DE PERFIL DO USUÁRIO & FOTO
// ==========================================
const btnChangeAvatar = document.getElementById('btnChangeAvatar');
const inputAvatarFile = document.getElementById('inputAvatarFile');
const btnSaveProfile = document.getElementById('btnSaveProfile');
const saveStatusMsg = document.getElementById('saveStatusMsg');
const inputBannerColor = document.getElementById('inputBannerColor');

const profileTagIcons = { server: '🛡️', friend: '👤', community: '🌐' };

function renderProfileTags(container, tags, removable = false) {
  if (!container) return;
  container.replaceChildren();
  (Array.isArray(tags) ? tags : []).forEach((tag, index) => {
    if (!tag || !tag.label) return;
    const chip = document.createElement(removable ? 'button' : 'span');
    chip.className = 'profile-tag-chip';
    if (removable) {
      chip.type = 'button';
      chip.title = 'Remover tag';
      chip.setAttribute('aria-label', `Remover tag ${tag.label}`);
    } else {
      chip.title = `${tag.type === 'friend' ? 'Amigo' : tag.type === 'community' ? 'Comunidade' : 'Servidor'}: ${tag.label}`;
    }
    const icon = document.createElement('span');
    icon.textContent = profileTagIcons[tag.type] || profileTagIcons.server;
    const text = document.createElement('span');
    text.textContent = tag.label;
    chip.append(icon, text);
    if (removable) {
      const remove = document.createElement('span');
      remove.className = 'profile-tag-remove';
      remove.setAttribute('aria-hidden', 'true');
      remove.textContent = '×';
      chip.appendChild(remove);
      chip.addEventListener('click', () => {
        userProfile.profileTags.splice(index, 1);
        saveUserProfile();
        applyUserProfile();
        publishPresenceStatus();
      });
    }
    container.appendChild(chip);
  });
}

function applyUserProfile() {
  const myUsername = document.getElementById('myUsername');
  const myStatusText = document.getElementById('myStatusText');
  const myAvatar = document.getElementById('myAvatar');
  const myTag = userProfile.tag || '0001';
  const statusLabels = {
    online: 'Disponível',
    idle: 'Ausente',
    dnd: 'Ocupado',
    invisible: 'Invisível'
  };

  if (myUsername) {
    myUsername.textContent = userProfile.displayName || 'Bads';
  }
  if (myStatusText) {
    myStatusText.textContent = statusLabels[userProfile.presenceStatus] || 'Invisível';
  }
  if (myAvatar) {
    if (userProfile.avatarUrl) {
      myAvatar.innerHTML = `<img src="${userProfile.avatarUrl}" style="width:100%;height:100%;border-radius:50%;object-fit:cover;">`;
    } else {
      myAvatar.textContent = (userProfile.displayName || 'B')[0].toUpperCase();
    }
  }

  const myUsernameDisplay = document.getElementById('myUsernameDisplay');
  if (myUsernameDisplay) {
    const name = userProfile.username || userProfile.displayName || 'bads';
    myUsernameDisplay.textContent = `${name}#${myTag}`;
  }

  const settingsUserName = document.getElementById('settingsUserName');
  const settingsAvatarInitial = document.getElementById('settingsAvatarInitial');
  const settingsAvatarImg = document.getElementById('settingsAvatarImg');

  if (settingsUserName) settingsUserName.textContent = userProfile.displayName;
  if (settingsAvatarInitial && settingsAvatarImg) {
    if (userProfile.avatarUrl) {
      settingsAvatarImg.src = userProfile.avatarUrl;
      settingsAvatarImg.style.display = 'block';
      settingsAvatarInitial.style.display = 'none';
    } else {
      settingsAvatarImg.style.display = 'none';
      settingsAvatarInitial.style.display = 'block';
      settingsAvatarInitial.textContent = (userProfile.displayName || 'B')[0].toUpperCase();
    }
  }

  const previewDisplayName = document.getElementById('previewDisplayName');
  const previewUsername = document.getElementById('previewUsername');
  const profileAvatarInitial = document.getElementById('profileAvatarInitial');
  const profileAvatarImg = document.getElementById('profileAvatarImg');
  const profileBannerPreview = document.getElementById('profileBannerPreview');

  if (previewDisplayName) previewDisplayName.textContent = userProfile.displayName;
  if (previewUsername) previewUsername.textContent = `@${userProfile.username}`;
  if (profileBannerPreview) profileBannerPreview.style.backgroundColor = userProfile.bannerColor;

  if (profileAvatarInitial && profileAvatarImg) {
    if (userProfile.avatarUrl) {
      profileAvatarImg.src = userProfile.avatarUrl;
      profileAvatarImg.style.display = 'block';
      profileAvatarInitial.style.display = 'none';
    } else {
      profileAvatarImg.style.display = 'none';
      profileAvatarInitial.style.display = 'block';
      profileAvatarInitial.textContent = (userProfile.displayName || 'B')[0].toUpperCase();
    }
  }

  const inputDisplayName = document.getElementById('inputDisplayName');
  const inputUsername = document.getElementById('inputUsername');
  const inputAboutMe = document.getElementById('inputAboutMe');

  if (inputDisplayName) inputDisplayName.value = userProfile.displayName;
  if (inputUsername) inputUsername.value = userProfile.username;
  if (inputAboutMe) inputAboutMe.value = userProfile.aboutMe;
  if (inputBannerColor) inputBannerColor.value = userProfile.bannerColor;
  renderProfileTags(document.getElementById('profileTagPreview'), userProfile.profileTags);
  renderProfileTags(document.getElementById('profileTagEditorList'), userProfile.profileTags, true);
  renderProfileTags(document.getElementById('presenceClanBadges'), userProfile.profileTags);

  if (currentChannel) {
    updateSidebarChannelUsers(currentChannel);
  }
  updateVoiceSelfCard();
}

// Upload de Foto de Perfil (Escolher imagem do PC)
if (btnChangeAvatar && inputAvatarFile) {
  btnChangeAvatar.addEventListener('click', () => {
    inputAvatarFile.click();
  });

  inputAvatarFile.addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      userProfile.avatarUrl = event.target.result;
      applyUserProfile();
    };
    reader.readAsDataURL(file);
  });
}

// Alterar cor do Banner ao vivo
if (inputBannerColor) {
  inputBannerColor.addEventListener('input', () => {
    const profileBannerPreview = document.getElementById('profileBannerPreview');
    if (profileBannerPreview) {
      profileBannerPreview.style.backgroundColor = inputBannerColor.value;
    }
  });
}

// Salvar Perfil
if (btnSaveProfile) {
  btnSaveProfile.addEventListener('click', () => {
    const inputDisplayName = document.getElementById('inputDisplayName');
    const inputUsername = document.getElementById('inputUsername');
    const inputAboutMe = document.getElementById('inputAboutMe');

    if (inputDisplayName && inputDisplayName.value.trim()) {
      userProfile.displayName = inputDisplayName.value.trim();
    }
    if (inputUsername && inputUsername.value.trim()) {
      userProfile.username = inputUsername.value.trim().replace(/^@/, '');
    }
    if (inputAboutMe) {
      userProfile.aboutMe = inputAboutMe.value;
    }
    if (inputBannerColor) {
      userProfile.bannerColor = inputBannerColor.value;
    }

    saveUserProfile();
    applyUserProfile();
    publishPresenceStatus();
    playConnectSound();

    if (saveStatusMsg) {
      saveStatusMsg.textContent = '✓ Perfil atualizado com sucesso!';
      setTimeout(() => {
        saveStatusMsg.textContent = '';
      }, 3000);
    }
  });
}

const inputProfileTag = document.getElementById('inputProfileTag');
const selectProfileTagType = document.getElementById('selectProfileTagType');
const btnAddProfileTag = document.getElementById('btnAddProfileTag');
function addProfileTag() {
  const label = inputProfileTag?.value.trim().slice(0, 24);
  const type = selectProfileTagType?.value;
  if (!label || !['server', 'friend', 'community'].includes(type)) return;
  if (userProfile.profileTags.length >= 5) {
    showToast('Você pode adicionar até 5 tags ao perfil.', '⚠️');
    return;
  }
  if (userProfile.profileTags.some((tag) => tag.type === type && tag.label.toLowerCase() === label.toLowerCase())) {
    showToast('Essa tag já está no seu perfil.', '⚠️');
    return;
  }
  userProfile.profileTags.push({ type, label });
  if (inputProfileTag) inputProfileTag.value = '';
  saveUserProfile();
  applyUserProfile();
  publishPresenceStatus();
}
btnAddProfileTag?.addEventListener('click', addProfileTag);
inputProfileTag?.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    addProfileTag();
  }
});

// ==========================================
// NAVEGAÇÃO ENTRE ABAS DAS CONFIGURAÇÕES
// ==========================================
function switchSettingsTab(tabName) {
  document.querySelectorAll('.settings-nav-item, .settings-subnav-item').forEach(el => {
    el.classList.toggle('active', el.dataset.tab === tabName);
  });

  document.querySelectorAll('.settings-tab-pane').forEach(pane => {
    pane.style.display = 'none';
  });

  const targetPane = document.getElementById(`pane-${tabName}`);
  if (targetPane) {
    targetPane.style.display = 'block';
  }

  const categoryTitles = {
    account: 'Perfil do Usuário',
    decorations: 'Decorações de perfil',
    voice: 'Voz e vídeo',
    stream: 'Transmissão e Lives',
    sounds: 'Sons do Sistema',
    soundboard: 'Painel de Efeitos Sonoros',
    appearance: 'Aparência',
    notifications: 'Notificações',
    nitro: 'Personalização BADISCORD',
    subscriptions: 'Loja gratuita',
    advanced: 'Avançado'
  };

  const settingsHeaderCategory = document.getElementById('settingsHeaderCategory');
  if (settingsHeaderCategory) {
    settingsHeaderCategory.textContent = categoryTitles[tabName] || 'Configurações';
  }
}

function applyProfileCustomization() {
  const decoration = userProfile.profileDecoration || 'none';
  const widget = userProfile.profileWidget || 'none';
  const targets = [
    document.querySelector('.user-avatar-wrapper'),
    document.getElementById('voiceSelfAvatarFrame'),
    document.getElementById('presenceAvatarImg'),
    document.getElementById('profileAvatarPreview')
  ].filter(Boolean);
  targets.forEach((target) => {
    target.classList.remove('profile-decoration-none', 'profile-decoration-neon', 'profile-decoration-galaxy', 'profile-decoration-fire');
    target.classList.remove('profile-widget-none', 'profile-widget-pulse', 'profile-widget-orbit', 'profile-widget-spark');
    target.classList.add(`profile-decoration-${decoration}`, `profile-widget-${widget}`);
  });
}

function initializeFreeProfileCustomization() {
  let selectedDecoration = userProfile.profileDecoration || 'none';
  let selectedWidget = userProfile.profileWidget || 'none';
  const decorationOptions = document.querySelectorAll('#profileDecorationOptions [data-decoration]');
  const widgetOptions = document.querySelectorAll('#profileWidgetOptions [data-widget]');

  const markSelected = () => {
    decorationOptions.forEach((option) => option.classList.toggle('active', option.dataset.decoration === selectedDecoration));
    widgetOptions.forEach((option) => option.classList.toggle('active', option.dataset.widget === selectedWidget));
  };

  decorationOptions.forEach((option) => option.addEventListener('click', () => {
    selectedDecoration = option.dataset.decoration;
    markSelected();
  }));
  widgetOptions.forEach((option) => option.addEventListener('click', () => {
    selectedWidget = option.dataset.widget;
    markSelected();
  }));

  document.getElementById('btnSaveDecorations')?.addEventListener('click', () => {
    userProfile.profileDecoration = selectedDecoration;
    userProfile.profileWidget = selectedWidget;
    saveUserProfile();
    applyProfileCustomization();
    const status = document.getElementById('decorationsSaveStatus');
    if (status) {
      status.textContent = '✓ Personalização salva';
      setTimeout(() => { status.textContent = ''; }, 2500);
    }
    showToast('Decoração e widget aplicados gratuitamente!', '✨');
  });
  markSelected();
}

document.querySelectorAll('.settings-nav-item, .settings-subnav-item').forEach(el => {
  el.addEventListener('click', () => {
    const tab = el.dataset.tab;
    if (tab) {
      switchSettingsTab(tab);
    }
  });
});

function openSettingsTab(tabName) {
  if (typeof openSettings === 'function') openSettings();
  switchSettingsTab(tabName);
}

document.getElementById('dmMenuNitro')?.addEventListener('click', () => openSettingsTab('nitro'));
document.getElementById('dmMenuShop')?.addEventListener('click', () => openSettingsTab('subscriptions'));
document.getElementById('btnOpenFreeDecorations')?.addEventListener('click', () => openSettingsTab('decorations'));
document.getElementById('btnOpenShopDecorations')?.addEventListener('click', () => openSettingsTab('decorations'));

const btnEditProfileLink = document.getElementById('btnEditProfileLink');
const btnSidebarProfileHeader = document.getElementById('btnSidebarProfileHeader');

if (btnEditProfileLink) {
  btnEditProfileLink.addEventListener('click', (e) => {
    e.stopPropagation();
    switchSettingsTab('account');
  });
}
if (btnSidebarProfileHeader) {
  btnSidebarProfileHeader.addEventListener('click', () => {
    switchSettingsTab('account');
  });
}

// ==========================================
// SOUNDBOARD: EFEITOS SONOROS INTERATIVOS
// ==========================================
let soundboardVolume = 100;
let soundboardMuted = false;
let soundboardAudioContext = null;
let soundboardMasterGain = null;
let soundboardBroadcastGain = null;
let soundboardBroadcastDestination = null;
let soundboardPublishErrorShown = false;
let customSoundboardSounds = [];
let customSoundboardServerId = '';
const activeCustomSoundPlayers = new Set();

try {
  const savedVolume = Number.parseInt(localStorage.getItem('badiscord_soundboard_volume'), 10);
  if (Number.isFinite(savedVolume)) soundboardVolume = Math.max(0, Math.min(100, savedVolume));
  soundboardMuted = localStorage.getItem('badiscord_soundboard_muted') === 'true';
} catch (error) {}

function getSoundboardAudioContext() {
  if (!soundboardAudioContext) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return null;
    soundboardAudioContext = new AudioContextClass();
    soundboardMasterGain = soundboardAudioContext.createGain();
    soundboardMasterGain.gain.value = soundboardMuted ? 0 : soundboardVolume / 100;
    soundboardMasterGain.connect(soundboardAudioContext.destination);
    soundboardBroadcastGain = soundboardAudioContext.createGain();
    soundboardBroadcastGain.gain.value = 1;
  }
  if (soundboardAudioContext.state === 'suspended') {
    soundboardAudioContext.resume().catch(() => {});
  }
  return soundboardAudioContext;
}

function connectSoundboardSource(sourceNode) {
  sourceNode.connect(soundboardMasterGain);
  sourceNode.connect(soundboardBroadcastGain);
}

function updateSoundboardControls() {
  if (soundboardMasterGain && soundboardAudioContext) {
    const outputVolume = soundboardMuted ? 0 : soundboardVolume / 100;
    soundboardMasterGain.gain.setTargetAtTime(outputVolume, soundboardAudioContext.currentTime, 0.015);
  }
  activeCustomSoundPlayers.forEach((audio) => {
    audio.volume = 1;
    audio.muted = false;
  });
  remoteSoundboardAudioElements.forEach((audio) => {
    const identity = audio.dataset.participantIdentity;
    audio.volume = soundboardMuted || isUserMuted(identity) || isSoundboardUserMuted(identity)
      ? 0
      : (soundboardVolume / 100) * (getSoundboardUserVolume(identity) / 100);
  });
  ['btnSoundboardMute', 'btnSoundboardQuickMute'].forEach((id) => {
    const button = document.getElementById(id);
    if (!button) return;
    button.setAttribute('aria-pressed', String(soundboardMuted));
    button.title = soundboardMuted ? 'Ativar sons para você' : 'Mutar sons só para você';
    if (id === 'btnSoundboardQuickMute') {
      const icon = document.getElementById('soundboardQuickMuteIcon');
      if (icon) icon.textContent = soundboardMuted ? '🔇' : '🔊';
      button.setAttribute('aria-label', soundboardMuted ? 'Ativar efeitos para mim' : 'Mutar efeitos para mim');
    }
  });
  const muteIcon = document.getElementById('soundboardMuteIcon');
  const muteLabel = document.getElementById('soundboardMuteLabel');
  if (muteIcon) muteIcon.textContent = soundboardMuted ? '🔇' : '🔊';
  if (muteLabel) muteLabel.textContent = soundboardMuted ? 'Ativar só para mim' : 'Mutar só para mim';
  ['soundboardVolume', 'soundboardQuickVolume'].forEach((id) => {
    const slider = document.getElementById(id);
    if (slider) slider.value = String(soundboardVolume);
  });
  ['soundboardVolumeValue', 'soundboardQuickVolumeValue'].forEach((id) => {
    const output = document.getElementById(id);
    if (output) output.textContent = `${soundboardVolume}%`;
  });
}

function initializeSoundboardControls() {
  ['btnSoundboardMute', 'btnSoundboardQuickMute'].forEach((id) => {
    const button = document.getElementById(id);
    if (button) {
      button.addEventListener('click', () => {
        soundboardMuted = !soundboardMuted;
        localStorage.setItem('badiscord_soundboard_muted', String(soundboardMuted));
        updateSoundboardControls();
      });
    }
  });
  ['soundboardVolume', 'soundboardQuickVolume'].forEach((id) => {
    const slider = document.getElementById(id);
    if (slider) {
      slider.addEventListener('input', () => {
        soundboardVolume = Number(slider.value);
        localStorage.setItem('badiscord_soundboard_volume', String(soundboardVolume));
        updateSoundboardControls();
      });
    }
  });
  updateSoundboardControls();
}

initializeSoundboardControls();

async function playSoundEffect(type) {
  try {
    const ctx = getSoundboardAudioContext();
    if (!ctx) return;
    if (livekitRoom?.state === 'connected' && localVoiceCanPublish) {
      await publishSoundboardTrack();
    }
    const now = ctx.currentTime;

    if (type === 'airhorn') {
      [466.16, 466.16, 466.16].forEach((f, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(f, now + idx * 0.12);
        gain.gain.setValueAtTime(0.25, now + idx * 0.12);
        gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.12 + 0.1);
        osc.connect(gain);
        connectSoundboardSource(gain);
        osc.start(now + idx * 0.12);
        osc.stop(now + idx * 0.12 + 0.1);
      });
    } else if (type === 'quack') {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(320, now);
      osc.frequency.linearRampToValueAtTime(160, now + 0.18);
      gain.gain.setValueAtTime(0.25, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
      osc.connect(gain);
      connectSoundboardSource(gain);
      osc.start(now);
      osc.stop(now + 0.22);
    } else if (type === 'bell') {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(1174.66, now);
      gain.gain.setValueAtTime(0.3, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.65);
      osc.connect(gain);
      connectSoundboardSource(gain);
      osc.start(now);
      osc.stop(now + 0.65);
    } else if (type === 'gameover') {
      [392, 349.23, 329.63, 261.63].forEach((f, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'square';
        osc.frequency.setValueAtTime(f, now + idx * 0.14);
        gain.gain.setValueAtTime(0.18, now + idx * 0.14);
        gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.14 + 0.12);
        osc.connect(gain);
        connectSoundboardSource(gain);
        osc.start(now + idx * 0.14);
        osc.stop(now + idx * 0.14 + 0.12);
      });
    } else if (type === 'laser') {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(990, now);
      osc.frequency.exponentialRampToValueAtTime(120, now + 0.15);
      gain.gain.setValueAtTime(0.25, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
      osc.connect(gain);
      connectSoundboardSource(gain);
      osc.start(now);
      osc.stop(now + 0.15);
    } else {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(523.25, now);
      osc.frequency.exponentialRampToValueAtTime(1046.50, now + 0.15);
      gain.gain.setValueAtTime(0.25, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
      osc.connect(gain);
      connectSoundboardSource(gain);
      osc.start(now);
      osc.stop(now + 0.25);
    }
  } catch (error) {
    console.warn('Não foi possível reproduzir o efeito sonoro:', error);
  }
}

document.querySelectorAll('.soundboard-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    playSoundEffect(btn.dataset.sound);
  });
});

async function playCustomSound(sound) {
  let audio;
  let source;
  try {
    const ctx = getSoundboardAudioContext();
    if (!ctx) throw new Error('O áudio não está disponível neste dispositivo.');
    if (livekitRoom?.state === 'connected' && localVoiceCanPublish) {
      await publishSoundboardTrack();
    }
    audio = new Audio(`/api/soundboard/${encodeURIComponent(sound.id)}/audio?serverId=${encodeURIComponent(sound.serverId || activeServerId)}`);
    source = ctx.createMediaElementSource(audio);
    connectSoundboardSource(source);
    audio.volume = 1;
    activeCustomSoundPlayers.add(audio);
    const releasePlayer = () => {
      activeCustomSoundPlayers.delete(audio);
      source.disconnect();
    };
    audio.addEventListener('ended', releasePlayer, { once: true });
    audio.addEventListener('error', () => {
      releasePlayer();
      showToast('Não foi possível reproduzir esse áudio.', '⚠️');
    }, { once: true });
    await audio.play();
  } catch (error) {
    if (audio) activeCustomSoundPlayers.delete(audio);
    source?.disconnect();
    console.warn('Não foi possível reproduzir o áudio personalizado:', error);
    showToast(error.message || 'Não foi possível reproduzir esse áudio.', '⚠️');
  }
}

function renderCustomSoundboard() {
  const settingsGrid = document.getElementById('customSoundboardGrid');
  const quickGrid = customSoundboardQuickGrid;
  if (settingsGrid) settingsGrid.replaceChildren();
  if (quickGrid) {
    quickGrid.replaceChildren();
    quickGrid.style.display = customSoundboardSounds.length ? 'grid' : 'none';
  }

  customSoundboardSounds.forEach((sound) => {
    if (settingsGrid) {
      const item = document.createElement('div');
      item.className = 'custom-soundboard-item';

      const playButton = document.createElement('button');
      playButton.type = 'button';
      playButton.className = 'soundboard-btn';
      playButton.textContent = `🔊 ${sound.name}`;
      playButton.title = `Reproduzir ${sound.name}${sound.ownerUsername ? ` • enviado por @${sound.ownerUsername}` : ''}`;
      playButton.addEventListener('click', () => playCustomSound(sound));

      item.appendChild(playButton);
      if (sound.isOwner) {
        const deleteButton = document.createElement('button');
        deleteButton.type = 'button';
        deleteButton.className = 'custom-soundboard-delete';
        deleteButton.textContent = '✕';
        deleteButton.title = `Remover ${sound.name}`;
        deleteButton.setAttribute('aria-label', `Remover ${sound.name}`);
        deleteButton.addEventListener('click', () => deleteCustomSound(sound));
        item.appendChild(deleteButton);
      }
      settingsGrid.appendChild(item);
    }

    if (quickGrid) {
      const quickButton = document.createElement('button');
      quickButton.type = 'button';
      quickButton.className = 'sb-btn';
      quickButton.textContent = `🔊 ${sound.name}`;
      quickButton.title = `Reproduzir ${sound.name}${sound.ownerUsername ? ` • enviado por @${sound.ownerUsername}` : ''}`;
      quickButton.addEventListener('click', () => playCustomSound(sound));
      quickGrid.appendChild(quickButton);
    }
  });
}

async function syncLocalServersWithBackend(preferredServerId = '', selectHomeServer = false) {
  if (!authenticatedAccount) return false;
  try {
    const response = await fetch('/api/servers/sync', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        servers: servers.map(({ id, name, icon, iconUrl, bannerColor, description, traits, serverTag, serverTagBadge, serverTagColor, voiceSettings, textChannels, voiceChannels }) => ({
          id, name, icon, iconUrl, bannerColor, description, traits, serverTag, serverTagBadge, serverTagColor, voiceSettings, textChannels, voiceChannels
        }))
      })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || 'Não foi possível sincronizar os servidores.');
    const localServersById = new Map(servers.map((server) => [server.id, server]));
    const accessibleServers = Array.isArray(payload.servers)
      ? payload.servers.filter((server) => !HIDDEN_SAMPLE_SERVER_IDS.has(server.id))
      : [];
    servers = accessibleServers.map((server) => {
      const localServer = localServersById.get(server.id) || {};
      return {
        ...localServer,
        ...server,
        isPublic: Boolean(server.isPublic),
        textChannels: server.textChannels?.length ? server.textChannels : (localServer.textChannels || ['geral']),
        voiceChannels: server.voiceChannels?.length ? server.voiceChannels : (localServer.voiceChannels || ['Geral 🔊'])
      };
    });
    if (payload.homeServerId) {
      try {
        localStorage.setItem('badiscord_home_server_id', payload.homeServerId);
      } catch (error) {}
    }
    const nextServerId = [preferredServerId, selectHomeServer ? payload.homeServerId : '', activeServerId, payload.homeServerId, servers[0]?.id]
      .find((id) => id && servers.some((server) => server.id === id));
    if (!nextServerId) throw new Error('Nenhum servidor acessível para esta conta.');
    activeServerId = nextServerId;
    try {
      localStorage.setItem('badiscord_servers', JSON.stringify(servers));
    } catch (error) {}
    renderGuilds();
    selectServer(activeServerId);
    return true;
  } catch (error) {
    console.warn('Não foi possível sincronizar os servidores:', error);
    showToast(error.message || 'Não foi possível sincronizar os servidores.', '⚠️');
    return false;
  }
}

async function loadServerInvites() {
  try {
    const response = await fetch('/api/server-invites', {
      credentials: 'include',
      headers: { Accept: 'application/json' }
    });
    if (!response.ok) return;
    const payload = await response.json();
    for (const invite of (Array.isArray(payload.invites) ? payload.invites : [])) {
      const serverName = invite.server_name || 'Servidor';
      if (!window.confirm(`@${invite.sender_username} convidou você para "${serverName}". Entrar no servidor?`)) continue;

      const acceptResponse = await fetch(`/api/server-invites/${encodeURIComponent(invite.id)}/accept`, {
        method: 'POST',
        credentials: 'include',
        headers: { Accept: 'application/json' }
      });
      const acceptPayload = await acceptResponse.json().catch(() => ({}));
      if (!acceptResponse.ok) {
        showToast(acceptPayload.error || 'Não foi possível aceitar o convite.', '⚠️');
        continue;
      }

      const server = acceptPayload.server;
      if (server && !servers.some((item) => item.id === server.id)) {
        servers.push({
          ...server,
          id: server.id,
          name: server.name,
          icon: server.icon || '🎮',
          textChannels: server.textChannels?.length ? server.textChannels : ['geral', 'clipes-e-jogos'],
          voiceChannels: server.voiceChannels?.length ? server.voiceChannels : ['Geral 🔊']
        });
        saveServers();
        renderGuilds();
      }
      showToast(`Você entrou em ${server?.name || serverName}.`, '✅');
    }
  } catch (error) {
    console.warn('Não foi possível carregar convites de servidor:', error);
  }
}

async function acceptPendingServerInvite() {
  const token = new URLSearchParams(window.location.search).get('invite');
  if (!token || !authenticatedAccount) return;

  try {
    const response = await fetch(`/api/server-invite-links/${encodeURIComponent(token)}/accept`, {
      method: 'POST',
      credentials: 'include',
      headers: { Accept: 'application/json' }
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 404) {
        const inviteUrl = new URL(window.location.href);
        inviteUrl.searchParams.delete('invite');
        window.history.replaceState({}, '', `${inviteUrl.pathname}${inviteUrl.search}${inviteUrl.hash}`);
      }
      showToast(payload.error || 'Não foi possível aceitar este convite.', '⚠️');
      return;
    }

    const server = payload.server;
    if (!server?.id) throw new Error('O convite foi aceito, mas o servidor não foi retornado.');
    const normalizedServer = {
      ...server,
      icon: server.icon || '🎮',
      textChannels: server.textChannels?.length ? server.textChannels : ['geral', 'clipes-e-jogos'],
      voiceChannels: server.voiceChannels?.length ? server.voiceChannels : ['Geral 🔊']
    };
    const existingIndex = servers.findIndex((item) => item.id === normalizedServer.id);
    if (existingIndex >= 0) servers[existingIndex] = { ...servers[existingIndex], ...normalizedServer };
    else servers.push(normalizedServer);
    saveServers();
    renderGuilds();

    const inviteUrl = new URL(window.location.href);
    inviteUrl.searchParams.delete('invite');
    window.history.replaceState({}, '', `${inviteUrl.pathname}${inviteUrl.search}${inviteUrl.hash}`);
    activeServerId = normalizedServer.id;
    restoreServerView(activeServerId);
    showToast(`Você entrou em ${normalizedServer.name}.`, '✅');
  } catch (error) {
    console.warn('Não foi possível aceitar o link de convite:', error);
    showToast(error.message || 'Não foi possível aceitar este convite.', '⚠️');
  }
}

async function loadCustomSoundboard() {
  if (!authenticatedAccount) return;
  const serverId = activeServerId;
  if (!serverId) return;
  if (customSoundboardServerId !== serverId) {
    customSoundboardServerId = serverId;
    customSoundboardSounds = [];
    renderCustomSoundboard();
  }
  try {
    const response = await fetch(`/api/soundboard?serverId=${encodeURIComponent(serverId)}`, {
      credentials: 'include',
      headers: { Accept: 'application/json' }
    });
    if (!response.ok) throw new Error('Não foi possível carregar os áudios deste servidor.');
    const payload = await response.json();
    if (serverId !== activeServerId) return;
    customSoundboardSounds = Array.isArray(payload.sounds) ? payload.sounds : [];
    renderCustomSoundboard();
  } catch (error) {
    if (serverId === activeServerId) showToast(error.message || 'Não foi possível carregar os áudios deste servidor.', '⚠️');
  }
}

async function deleteCustomSound(sound) {
  if (!window.confirm(`Remover o áudio "${sound.name}"?`)) return;
  try {
    const response = await fetch(`/api/soundboard/${encodeURIComponent(sound.id)}`, {
      method: 'DELETE',
      credentials: 'include',
      headers: { Accept: 'application/json' }
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || 'Não foi possível remover o áudio.');
    customSoundboardSounds = customSoundboardSounds.filter((item) => item.id !== sound.id);
    renderCustomSoundboard();
    showToast('Áudio removido.', '✅');
  } catch (error) {
    showToast(error.message || 'Não foi possível remover o áudio.', '⚠️');
  }
}

const soundboardUploadButton = document.getElementById('btnSoundboardUpload');
if (soundboardUploadButton) {
  soundboardUploadButton.addEventListener('click', async () => {
    const fileInput = document.getElementById('soundboardAudioFile');
    const nameInput = document.getElementById('soundboardAudioName');
    const status = document.getElementById('soundboardUploadStatus');
    const file = fileInput?.files?.[0];
    if (!file) {
      if (status) status.textContent = 'Selecione um arquivo de áudio.';
      return;
    }
    const extension = file.name.split('.').pop()?.toLowerCase();
    const fallbackTypes = {
      aac: 'audio/aac', flac: 'audio/flac', m4a: 'audio/x-m4a', mp3: 'audio/mpeg',
      mp4: 'audio/mp4', oga: 'audio/ogg', ogg: 'audio/ogg', opus: 'audio/ogg',
      wav: 'audio/wav', webm: 'audio/webm'
    };
    const mimeType = file.type.startsWith('audio/') ? file.type : (fallbackTypes[extension] || '');
    if (!mimeType) {
      if (status) status.textContent = 'Escolha um arquivo de áudio compatível.';
      return;
    }
    if (file.size > 4 * 1024 * 1024) {
      if (status) status.textContent = 'O arquivo ultrapassa o limite de 4 MB.';
      return;
    }

    soundboardUploadButton.disabled = true;
    soundboardUploadButton.textContent = 'Enviando...';
    if (status) status.textContent = '';
    try {
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('Não foi possível ler o arquivo.'));
        reader.readAsDataURL(file);
      });
      const audioBase64 = String(dataUrl).split(',')[1] || '';
      const fallbackName = file.name.replace(/\.[^.]+$/, '');
      const response = await fetch('/api/soundboard', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          name: nameInput?.value.trim() || fallbackName,
          serverId: activeServerId,
          mimeType,
          audioBase64
        })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Não foi possível adicionar o áudio.');
      if (fileInput) fileInput.value = '';
      if (nameInput) nameInput.value = '';
      await loadCustomSoundboard();
      if (status) status.textContent = 'Áudio adicionado.';
      showToast('Áudio adicionado ao soundboard deste servidor.', '✅');
    } catch (error) {
      if (status) status.textContent = error.message || 'Não foi possível adicionar o áudio.';
    } finally {
      soundboardUploadButton.disabled = false;
      soundboardUploadButton.textContent = 'Adicionar áudio';
    }
  });
}

// ==========================================
// SELETOR DE TEMAS DE APARÊNCIA (COM PERSISTÊNCIA)
// ==========================================
function applyTheme(theme) {
  const themes = {
    dark: {
      '--bg-primary': '#313338',
      '--bg-secondary': '#2b2d31',
      '--bg-tertiary': '#1e1f22',
      '--bg-modifier-hover': 'rgba(255, 255, 255, 0.07)',
      '--header-primary': '#f2f3f5',
      '--text-normal': '#dbdee1',
      '--text-muted': '#949ba4',
      '--brand-primary': '#56d7b5',
      '--brand-hover': '#36b995',
      '--brand-soft': 'rgba(86, 215, 181, 0.16)',
      '--status-green': '#71dba5'
    },
    midnight: {
      '--bg-primary': '#000000',
      '--bg-secondary': '#0e0e10',
      '--bg-tertiary': '#000000',
      '--bg-modifier-hover': 'rgba(255, 255, 255, 0.07)',
      '--header-primary': '#f2f3f5',
      '--text-normal': '#dbdee1',
      '--text-muted': '#949ba4',
      '--brand-primary': '#56d7b5',
      '--brand-hover': '#36b995',
      '--brand-soft': 'rgba(86, 215, 181, 0.16)',
      '--status-green': '#71dba5'
    },
    aurora: {
      '--bg-primary': '#1c3030',
      '--bg-secondary': '#162728',
      '--bg-tertiary': '#101a1b',
      '--bg-modifier-hover': 'rgba(170, 247, 224, 0.08)',
      '--header-primary': '#f0faf6',
      '--text-normal': '#d3e7df',
      '--text-muted': '#91aaa1',
      '--brand-primary': '#56d7b5',
      '--brand-hover': '#36b995',
      '--brand-soft': 'rgba(86, 215, 181, 0.16)',
      '--status-green': '#71dba5'
    },
    light: {
      '--bg-primary': '#ffffff',
      '--bg-secondary': '#f2f3f5',
      '--bg-tertiary': '#e3e5e8',
      '--bg-modifier-hover': 'rgba(0, 0, 0, 0.06)',
      '--header-primary': '#060607',
      '--text-normal': '#2e3338',
      '--text-muted': '#5c6370',
      '--brand-primary': '#16876f',
      '--brand-hover': '#0f6d59',
      '--brand-soft': 'rgba(22, 135, 111, 0.13)',
      '--status-green': '#16834d'
    }
  };

  const vars = themes[theme] || themes.aurora;
  Object.entries(vars).forEach(([key, val]) => {
    document.documentElement.style.setProperty(key, val);
  });

  document.querySelectorAll('.theme-card').forEach(c => {
    c.classList.toggle('active', c.dataset.theme === theme);
  });

  localStorage.setItem('badiscord_theme', theme);
}

// Carregar tema salvo
const savedTheme = localStorage.getItem('badiscord_theme') || 'aurora';
applyTheme(savedTheme);

document.querySelectorAll('.theme-card').forEach(card => {
  card.addEventListener('click', () => {
    applyTheme(card.dataset.theme);
    showToast(`Tema "${card.querySelector('span')?.textContent || card.dataset.theme}" aplicado!`, '🎨');
  });
});

// Aplicar perfil na inicialização
applyUserProfile();
initializeFreeProfileCustomization();


// ==========================================
// MENU DE PRESENÇA DO USUÁRIO
// ==========================================
(function() {
  const userPanelLeft = document.getElementById('userPanelLeft');
  const userPresenceMenu = document.getElementById('userPresenceMenu');
  const presenceStatusSubmenu = document.getElementById('presenceStatusSubmenu');

  if (!userPanelLeft || !userPresenceMenu) return;

  // Toggle menu
  userPanelLeft.addEventListener('click', (e) => {
    e.stopPropagation();
    const isOpen = userPresenceMenu.style.display !== 'none';
    if (isOpen) {
      userPresenceMenu.style.display = 'none';
      if (presenceStatusSubmenu) presenceStatusSubmenu.style.display = 'none';
    } else {
      userPresenceMenu.style.display = 'block';
      populatePresenceMenu();
    }
  });

  // Close on outside click
  document.addEventListener('click', (e) => {
    if (!userPresenceMenu.contains(e.target) && !userPanelLeft.contains(e.target)) {
      userPresenceMenu.style.display = 'none';
      if (presenceStatusSubmenu) presenceStatusSubmenu.style.display = 'none';
    }
  });

  const statusLabels = {
    online: 'Disponível',
    idle: 'Ausente',
    dnd: 'Ocupado',
    invisible: 'Invisível'
  };

  function populatePresenceMenu() {
    const presenceAvatarImg = document.getElementById('presenceAvatarImg');
    const presenceDisplayName = document.getElementById('presenceDisplayName');
    const presenceHandle = document.getElementById('presenceHandle');
    const presencePronouns = document.getElementById('presencePronouns');
    const presenceClanBadges = document.getElementById('presenceClanBadges');
    const presenceStatusIndicator = document.getElementById('presenceStatusIndicator');
    const menuCurrentStatusDot = document.getElementById('menuCurrentStatusDot');
    const menuCurrentStatusText = document.getElementById('menuCurrentStatusText');

    // Avatar
    if (presenceAvatarImg) {
      if (userProfile.avatarUrl) {
        presenceAvatarImg.innerHTML = '<img src="' + userProfile.avatarUrl + '" alt="avatar">';
      } else {
        presenceAvatarImg.innerHTML = '';
        presenceAvatarImg.textContent = (userProfile.displayName || 'B')[0].toUpperCase();
        presenceAvatarImg.style.backgroundColor = userProfile.bannerColor || '#5865F2';
      }
    }

    if (presenceDisplayName) presenceDisplayName.textContent = userProfile.displayName || 'Bads';
    if (presenceHandle) presenceHandle.textContent = userProfile.username || 'bads';
    if (presencePronouns) presencePronouns.textContent = userProfile.pronouns || '';
    renderProfileTags(presenceClanBadges, userProfile.profileTags);

    const customStatus = document.getElementById('presenceCustomStatus');
    if (customStatus) {
      customStatus.textContent = userProfile.customStatus || '';
      customStatus.style.display = userProfile.customStatus ? 'block' : 'none';
    }

    // Status
    const status = userProfile.presenceStatus || 'invisible';
    if (presenceStatusIndicator) {
      presenceStatusIndicator.className = 'user-status-indicator ' + status;
    }
    if (menuCurrentStatusDot) {
      menuCurrentStatusDot.className = 'status-bubble ' + status;
    }
    if (menuCurrentStatusText) {
      menuCurrentStatusText.textContent = statusLabels[status] || 'Invisível';
    }

    // Mark active in submenu
    document.querySelectorAll('.submenu-status-item').forEach(item => {
      item.classList.toggle('active', item.dataset.status === status);
    });

    // Warning icon visibility
    const warningIcon = document.querySelector('.status-warning-icon');
    if (warningIcon) {
      warningIcon.style.display = (status === 'invisible' || status === 'dnd') ? 'inline' : 'none';
    }
  }

  // Status submenu trigger
  const menuItemStatusTrigger = document.getElementById('menuItemStatusTrigger');
  function positionPresenceSubmenu() {
    if (!menuItemStatusTrigger || !presenceStatusSubmenu) return;

    const triggerRect = menuItemStatusTrigger.getBoundingClientRect();
    const submenuRect = presenceStatusSubmenu.getBoundingClientRect();
    const edge = 8;
    const gap = 8;
    const left = triggerRect.right + submenuRect.width + gap <= window.innerWidth - edge
      ? triggerRect.right + gap
      : Math.max(edge, triggerRect.left);
    const top = Math.max(edge, Math.min(triggerRect.top, window.innerHeight - submenuRect.height - edge));

    presenceStatusSubmenu.style.left = `${left}px`;
    presenceStatusSubmenu.style.top = `${top}px`;
  }

  if (menuItemStatusTrigger) {
    menuItemStatusTrigger.addEventListener('click', (e) => {
      e.stopPropagation();
      if (presenceStatusSubmenu) {
        const isOpen = presenceStatusSubmenu.style.display !== 'none';
        presenceStatusSubmenu.style.display = isOpen ? 'none' : 'block';
        if (!isOpen) positionPresenceSubmenu();
      }
    });
  }

  window.addEventListener('resize', () => {
    if (presenceStatusSubmenu && presenceStatusSubmenu.style.display !== 'none') {
      positionPresenceSubmenu();
    }
  });

  // Status option selection
  document.querySelectorAll('.submenu-status-item').forEach(item => {
    item.addEventListener('click', (e) => {
      e.stopPropagation();
      const status = item.dataset.status;
      if (!status) return;

      userProfile.presenceStatus = status;
      saveUserProfile();
      syncPresenceRoster(authenticatedAccount);

      const statusText = statusLabels[status] || 'Invisível';

      // Update user panel indicators
      const myStatusText = document.getElementById('myStatusText');
      const myStatusIndicator = document.getElementById('myStatusIndicator');
      if (myStatusText) myStatusText.textContent = statusText;
      if (myStatusIndicator) myStatusIndicator.className = 'user-status-indicator ' + status;
      applyUserProfile();
      renderServerMembers();
      renderVoiceParticipants();

      // Mark active
      document.querySelectorAll('.submenu-status-item').forEach(i => i.classList.remove('active'));
      item.classList.add('active');

      // Close menus
      if (presenceStatusSubmenu) presenceStatusSubmenu.style.display = 'none';
      userPresenceMenu.style.display = 'none';

      const icons = { online: '🟢', idle: '🟡', dnd: '🔴', invisible: '⚫' };
      showToast('Status alterado para: ' + statusText, icons[status] || '⚫');
    });
  });

  // Edit profile
  document.getElementById('menuItemPresenceEditProfile')?.addEventListener('click', () => {
    userPresenceMenu.style.display = 'none';
    openSettingsTab('account');
  });

  // Custom status
  document.getElementById('btnAddCustomStatus')?.addEventListener('click', () => {
    const currentStatus = userProfile.customStatus || '';
    const nextStatus = window.prompt('Digite seu status personalizado:', currentStatus);
    if (nextStatus === null) return;

    userProfile.customStatus = nextStatus.trim().slice(0, 128);
    saveUserProfile();
    populatePresenceMenu();
    applyUserProfile();
    showToast(userProfile.customStatus ? 'Status personalizado atualizado.' : 'Status personalizado removido.', '✏️');
  });

  // Free profile customization
  document.getElementById('btnPromoNitro')?.addEventListener('click', () => {
    userPresenceMenu.style.display = 'none';
    if (typeof openSettings === 'function') openSettings();
    if (typeof switchSettingsTab === 'function') switchSettingsTab('nitro');
  });

  // Shop
  document.getElementById('btnPromoShop')?.addEventListener('click', () => {
    userPresenceMenu.style.display = 'none';
    if (typeof openSettings === 'function') openSettings();
    if (typeof switchSettingsTab === 'function') switchSettingsTab('subscriptions');
  });

  // Close promo
  document.getElementById('btnClosePresencePromo')?.addEventListener('click', (e) => {
    e.stopPropagation();
    const promo = document.querySelector('.presence-nitro-promo');
    if (promo) promo.style.display = 'none';
  });

  // Badges
  document.getElementById('menuItemBadges')?.addEventListener('click', () => {
    userPresenceMenu.style.display = 'none';
    if (typeof openSettings === 'function') openSettings();
    if (typeof switchSettingsTab === 'function') switchSettingsTab('account');
    showToast('Insígnias disponíveis no seu perfil.', '🎖️');
  });

  // Initialize status on load
  if (!userProfile.presenceStatus) {
    userProfile.presenceStatus = 'online';
  }
  const myStatusText = document.getElementById('myStatusText');
  const myStatusIndicator = document.getElementById('myStatusIndicator');
  if (myStatusText) myStatusText.textContent = statusLabels[userProfile.presenceStatus] || 'Invisível';
  if (myStatusIndicator) myStatusIndicator.className = 'user-status-indicator ' + userProfile.presenceStatus;
})();


// ==========================================
// MENU DE CONTEXTO DO USUÁRIO NO CANAL DE VOZ
// ==========================================
(function() {
  const voiceUserContextMenu = document.getElementById('voiceUserContextMenu');
  if (!voiceUserContextMenu) return;

  let vctxTargetUser = null; // { name, tag, ... }

  function openVoiceUserContextMenu(x, y, userData) {
    vctxTargetUser = userData;

    voiceUserContextMenu.style.left = '8px';
    voiceUserContextMenu.style.top = '8px';
    voiceUserContextMenu.style.display = 'block';
    const menuRect = voiceUserContextMenu.getBoundingClientRect();
    const maxX = Math.max(8, window.innerWidth - menuRect.width - 8);
    const maxY = Math.max(8, window.innerHeight - menuRect.height - 8);
    voiceUserContextMenu.style.left = `${Math.min(Math.max(x, 8), maxX)}px`;
    voiceUserContextMenu.style.top = `${Math.min(Math.max(y, 8), maxY)}px`;

    // Info
    const infoValue = document.getElementById('vctxInfoValue');
    if (infoValue) {
      infoValue.textContent = currentChannel || 'Canal de Voz';
    }

    const volumeSection = voiceUserContextMenu.querySelector('.vctx-volume-section');
    const volumeSlider = document.getElementById('vctxVolumeSlider');
    const volumeValue = document.getElementById('vctxVolumeValue');
    const canAdjustVolume = !userData.isOwner
      && userData.id !== authenticatedAccount?.id
      && typeof userData.id === 'string'
      && Boolean(userData.id);
    if (volumeSection) volumeSection.style.display = canAdjustVolume ? 'block' : 'none';
    if (canAdjustVolume && volumeSlider) {
      volumeSlider.dataset.participantIdentity = userData.id;
      volumeSlider.value = String(getUserVolume(userData.id));
      if (volumeValue) volumeValue.value = `${volumeSlider.value}%`;
      volumeSlider.dispatchEvent(new Event('input'));
    }

    const muteCheckbox = document.getElementById('vctxCheckMute');
    if (muteCheckbox) muteCheckbox.classList.toggle('checked', isUserMuted(userData.id));
    const videoCheckbox = document.getElementById('vctxCheckVideo');
    if (videoCheckbox) videoCheckbox.classList.toggle('checked', locallyDisabledVideoIdentities.has(userData.id));
    const videoItem = voiceUserContextMenu.querySelector('[data-action="disable-video"]');
    const participant = livekitRoom?.remoteParticipants?.get(userData.id);
    const cameraPublication = participant && Array.from(participant.videoTrackPublications.values()).find(
      (publication) => publication.source === window.LivekitClient?.Track?.Source?.Camera
    );
    if (videoItem) videoItem.style.display = cameraPublication ? '' : 'none';
    const isFriend = friendsList.some((friend) => friend.id === userData.id);
    const messageItem = voiceUserContextMenu.querySelector('[data-action="message"]');
    if (messageItem) messageItem.style.display = isFriend ? '' : 'none';
    const callItem = voiceUserContextMenu.querySelector('[data-action="call"]');
    if (callItem) callItem.style.display = isFriend ? '' : 'none';
    const unfriendItem = voiceUserContextMenu.querySelector('[data-action="unfriend"]');
    if (unfriendItem) unfriendItem.style.display = isFriend ? '' : 'none';
    const blockItem = voiceUserContextMenu.querySelector('[data-action="block"]');
    if (blockItem) blockItem.style.display = userData.id && userData.id !== 'self' ? '' : 'none';
    const nicknameItem = voiceUserContextMenu.querySelector('[data-action="nickname"]');
    if (nicknameItem) nicknameItem.style.display = canAdjustVolume ? '' : 'none';
  }

  // Close on outside click
  document.addEventListener('click', (e) => {
    if (voiceUserContextMenu.style.display !== 'none' && !voiceUserContextMenu.contains(e.target)) {
      voiceUserContextMenu.style.display = 'none';
    }
  });

  // Close on Escape
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && voiceUserContextMenu.style.display !== 'none') {
      voiceUserContextMenu.style.display = 'none';
    }
  });

  // Handle context menu items
  voiceUserContextMenu.addEventListener('click', async (e) => {
    const item = e.target.closest('.vctx-item');
    if (!item) return;

    const action = item.dataset.action;
    if (!action) return;

    const userName = vctxTargetUser ? vctxTargetUser.name : 'Usuário';

    switch (action) {
      case 'profile':
        voiceUserContextMenu.style.display = 'none';
        if (vctxTargetUser && typeof openMemberProfilePopover === 'function') {
          openMemberProfilePopover(vctxTargetUser, e);
        }
        break;

      case 'mention':
        voiceUserContextMenu.style.display = 'none';
        const mentionText = '@' + userName;
        const chatInput = document.getElementById('chatInput');
        if (chatInput) {
          chatInput.value += mentionText + ' ';
          chatInput.focus();
          showToast('Menção adicionada à mensagem.', '💬');
        } else {
          showToast('Abra um canal de texto para mencionar alguém.', '⚠️');
        }
        break;

      case 'message':
        voiceUserContextMenu.style.display = 'none';
        if (vctxTargetUser && vctxTargetUser.id && vctxTargetUser.id !== 'self') {
          openDirectMessage(vctxTargetUser);
        } else {
          showToast('Não é possível abrir uma conversa com este usuário.', '⚠️');
        }
        break;

      case 'call':
        voiceUserContextMenu.style.display = 'none';
        startPrivateCall(vctxTargetUser);
        break;

      case 'note':
        voiceUserContextMenu.style.display = 'none';
        const noteKey = 'badiscord_note_' + (vctxTargetUser?.id || vctxTargetUser?.name || 'unknown');
        const existingNote = localStorage.getItem(noteKey) || '';
        const newNote = prompt('Nota para ' + userName + ' (visível apenas para você):', existingNote);
        if (newNote !== null) {
          try {
            localStorage.setItem(noteKey, newNote);
            showToast(newNote ? 'Nota salva!' : 'Nota removida!', '📝');
          } catch (error) {
            console.warn('Não foi possível salvar a nota:', error);
            showToast('Não foi possível salvar a nota.', '⚠️');
          }
        }
        break;

      case 'nickname':
        voiceUserContextMenu.style.display = 'none';
        if (!vctxTargetUser?.id || vctxTargetUser.id === 'self') break;
        const newNick = prompt('Apelido para ' + userName + ':', getUserNickname(vctxTargetUser.id));
        if (newNick !== null) {
          const nickname = newNick.trim().slice(0, 32);
          if (nickname) userNicknames[vctxTargetUser.id] = nickname;
          else delete userNicknames[vctxTargetUser.id];
          try {
            localStorage.setItem(USER_NICKNAMES_STORAGE_KEY, JSON.stringify(userNicknames));
          } catch (error) {
            console.warn('Não foi possível salvar o apelido:', error);
            showToast('Não foi possível salvar o apelido.', '⚠️');
            break;
          }
          renderServerMembers();
          renderVoiceParticipants();
          showToast(nickname ? 'Apelido atualizado.' : 'Apelido removido.', '✏️');
        }
        break;

      case 'mute-user': {
        if (!vctxTargetUser?.id || vctxTargetUser.id === 'self') break;
        const cb = document.getElementById('vctxCheckMute');
        const muted = !isUserMuted(vctxTargetUser.id);
        setUserMuted(vctxTargetUser.id, muted);
        if (cb) cb.classList.toggle('checked', muted);
        showToast(muted ? userName + ' foi silenciado para você.' : userName + ' foi dessilenciado.', muted ? '🔇' : '🔊');
        return; // Don't close
      }

      case 'disable-video': {
        if (!vctxTargetUser?.id || !livekitRoom) break;
        const participant = livekitRoom.remoteParticipants.get(vctxTargetUser.id);
        const cameraPublication = participant && Array.from(participant.videoTrackPublications.values()).find(
          (publication) => publication.source === window.LivekitClient?.Track?.Source?.Camera
        );
        if (!cameraPublication) {
          showToast('O usuário não tem uma câmera ativa.', '⚠️');
          break;
        }
        const cb = document.getElementById('vctxCheckVideo');
        const hideVideo = !locallyDisabledVideoIdentities.has(vctxTargetUser.id);
        try {
          cameraPublication.setSubscribed(!hideVideo);
          if (hideVideo) locallyDisabledVideoIdentities.add(vctxTargetUser.id);
          else locallyDisabledVideoIdentities.delete(vctxTargetUser.id);
        } catch (error) {
          console.warn('Não foi possível alterar a exibição do vídeo:', error);
          showToast('Não foi possível alterar a exibição do vídeo.', '⚠️');
          break;
        }
        if (cb) cb.classList.toggle('checked', hideVideo);
        showToast(hideVideo ? 'Vídeo ocultado para você.' : 'Vídeo habilitado para você.', hideVideo ? '📵' : '📹');
        return;
      }

      case 'invite-server':
        voiceUserContextMenu.style.display = 'none';
        openInviteModal();
        break;

      case 'unfriend':
        voiceUserContextMenu.style.display = 'none';
        if (confirm('Deseja desfazer amizade com ' + userName + '?')) {
          const friend = friendsList.find((entry) => entry.id === vctxTargetUser?.id);
          if (friend) {
            removeFriend(friend.id);
          } else {
            showToast('Este usuário não está na sua lista de amigos.', '⚠️');
          }
        }
        break;

      case 'block':
        voiceUserContextMenu.style.display = 'none';
        if (!vctxTargetUser?.id || vctxTargetUser.id === 'self') break;
        if (!confirm(`Bloquear ${userName}? Isso também remove a amizade e impede mensagens e chamadas.`)) break;
        try {
          const response = await fetch(`/api/users/${encodeURIComponent(vctxTargetUser.id)}/block`, {
            method: 'POST',
            credentials: 'include',
            headers: { Accept: 'application/json' }
          });
          const payload = await response.json().catch(() => ({}));
          if (!response.ok) throw new Error(payload.error || 'Não foi possível bloquear este usuário.');
          await loadFriendsFromServer();
          showToast(`${userName} foi bloqueado.`, '🚫');
        } catch (error) {
          showToast(error.message || 'Não foi possível bloquear este usuário.', '⚠️');
        }
        break;
    }
  });

  // Volume slider
  const vctxVolumeSlider = document.getElementById('vctxVolumeSlider');
  if (vctxVolumeSlider) {
    vctxVolumeSlider.addEventListener('input', () => {
      const val = Number(vctxVolumeSlider.value);
      const pct = val;
      const identity = vctxVolumeSlider.dataset.participantIdentity;
      if (identity) setUserVolume(identity, val);
      const volumeValue = document.getElementById('vctxVolumeValue');
      if (volumeValue) volumeValue.value = `${val}%`;
      vctxVolumeSlider.style.background = `linear-gradient(to right, #5865F2 0%, #5865F2 ${pct}%, #4e5058 ${pct}%, #4e5058 100%)`;
    });
    // Initialize track color
    vctxVolumeSlider.dispatchEvent(new Event('input'));
  }

  // Expose globally so participant cards and member items can use it
  window.openVoiceUserContextMenu = openVoiceUserContextMenu;

  // Add right-click to participant cards in the voice stage
  document.getElementById('participantsGrid')?.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const card = e.target.closest('.participant-card');
    if (!card) return;
    const member = getVoiceChannelParticipants().find((participant) => participant.id === card.dataset.participantIdentity);
    if (member) openVoiceUserContextMenu(e.clientX, e.clientY, member);
  });

  // Add right-click to sidebar channel user items
  document.addEventListener('contextmenu', (e) => {
    const channelUser = e.target.closest('.channel-user-item');
    if (!channelUser) return;
    e.preventDefault();
    const members = getVoiceChannelParticipants(channelUser.dataset.channelName, channelUser.dataset.serverId);
    const member = members.find((participant) => participant.id === channelUser.dataset.participantIdentity);
    if (member) openVoiceUserContextMenu(e.clientX, e.clientY, member);
  });

  // Add right-click to member-items in the members sidebar
  document.addEventListener('contextmenu', (e) => {
    const memberItem = e.target.closest('.member-item');
    if (!memberItem) return;
    e.preventDefault();
    const id = memberItem.dataset.participantIdentity;
    const member = (serverMembersByServer.get(activeServerId) || []).find((entry) => entry.id === id)
      || friendsList.find((entry) => entry.id === id);
    if (member) {
      openVoiceUserContextMenu(e.clientX, e.clientY, {
        ...member,
        isOwner: member.role === 'Dono' || member.id === authenticatedAccount?.id
      });
    }
  });

  let touchContextTimer = 0;
  let touchStartPoint = null;
  let suppressTouchContextClick = false;
  let suppressTouchClickTarget = null;
  let suppressTouchClickTimer = 0;
  document.addEventListener('pointerdown', (event) => {
    if (event.pointerType !== 'touch' || !event.isPrimary) return;
    const target = event.target.closest('.participant-card, .channel-user-item, .member-item');
    if (!target) return;
    touchStartPoint = { x: event.clientX, y: event.clientY };
    touchContextTimer = window.setTimeout(() => {
      touchContextTimer = 0;
      suppressTouchContextClick = true;
      suppressTouchClickTarget = target;
      window.clearTimeout(suppressTouchClickTimer);
      suppressTouchClickTimer = window.setTimeout(() => {
        suppressTouchContextClick = false;
        suppressTouchClickTarget = null;
      }, 400);
      target.dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        clientX: touchStartPoint.x,
        clientY: touchStartPoint.y
      }));
    }, 500);
  }, { passive: true });
  document.addEventListener('pointermove', (event) => {
    if (!touchContextTimer || event.pointerType !== 'touch' || !touchStartPoint) return;
    if (Math.hypot(event.clientX - touchStartPoint.x, event.clientY - touchStartPoint.y) > 12) {
      window.clearTimeout(touchContextTimer);
      touchContextTimer = 0;
    }
  }, { passive: true });
  const cancelTouchContextTimer = (event) => {
    if (event.pointerType !== 'touch') return;
    if (touchContextTimer) window.clearTimeout(touchContextTimer);
    touchContextTimer = 0;
    touchStartPoint = null;
  };
  document.addEventListener('pointerup', cancelTouchContextTimer, { passive: true });
  document.addEventListener('pointercancel', cancelTouchContextTimer, { passive: true });
  document.addEventListener('click', (event) => {
    if (!suppressTouchContextClick || !suppressTouchClickTarget?.contains(event.target)) return;
    suppressTouchContextClick = false;
    suppressTouchClickTarget = null;
    window.clearTimeout(suppressTouchClickTimer);
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);
})();


// ==========================================
// TELA DE CONFIGURAÇÕES DO SERVIDOR (ESTILO DISCORD)
// ==========================================
(function() {
  const serverSettingsOverlay = document.getElementById('serverSettingsOverlay');
  const btnCloseServerSettings = document.getElementById('btnCloseServerSettings');
  const srvSettingsTitle = document.getElementById('srvSettingsTitle');
  const srvPreviewName = document.getElementById('srvPreviewName');
  const srvPreviewBanner = document.getElementById('srvPreviewBanner');
  const srvPreviewAvatar = document.getElementById('srvPreviewAvatar');
  const srvPreviewInitial = document.getElementById('srvPreviewInitial');
  const srvPreviewImg = document.getElementById('srvPreviewImg');
  const srvDescriptionInput = document.getElementById('srvDescriptionInput');
  const srvNameInput = document.getElementById('srvNameInput');
  const srvPublicToggle = document.getElementById('srvPublicToggle');
  const srvBannerPalette = document.getElementById('srvBannerPalette');
  const btnChangeServerIcon = document.getElementById('btnChangeServerIcon');
  const btnRemoveServerIcon = document.getElementById('btnRemoveServerIcon');
  const inputServerIconFile = document.getElementById('inputServerIconFile');
  const srvSaveBar = document.getElementById('srvSaveBar');
  const btnSaveServerSettings = document.getElementById('btnSaveServerSettings');
  const btnResetServerSettings = document.getElementById('btnResetServerSettings');
  const srvSettingsBtnDelete = document.getElementById('srvSettingsBtnDelete');

  let currentSrvEditing = null;
  let tempServerState = {};

  function openServerSettings(server) {
    if (!serverSettingsOverlay) return;
    const target = server || servers.find(s => s.id === activeServerId) || servers[0];
    currentSrvEditing = target;
    tempServerState = {
      name: target.name,
      iconUrl: target.iconUrl || '',
      bannerColor: target.bannerColor || '#eab308',
      description: target.description || '',
      traits: [...(target.traits || ['', '', '', '', ''])],
      isPublic: Boolean(target.isPublic)
    };

    if (srvSettingsTitle) srvSettingsTitle.textContent = target.name;
    if (srvPreviewName) srvPreviewName.textContent = target.name;
    if (srvNameInput) srvNameInput.value = target.name;
    if (srvPublicToggle) srvPublicToggle.checked = tempServerState.isPublic;
    if (srvDescriptionInput) srvDescriptionInput.value = tempServerState.description;
    if (btnSaveServerSettings) btnSaveServerSettings.disabled = target.isOwner === false;

    // Traits
    for (let i = 1; i <= 5; i++) {
      const traitInput = document.getElementById(`trait${i}`);
      if (traitInput) traitInput.value = tempServerState.traits[i - 1] || '';
    }

    updateServerPreview();
    switchServerSettingsTab('profile');
    if (srvSaveBar) srvSaveBar.style.display = 'none';
    serverSettingsOverlay.style.display = 'flex';
  }

  function closeServerSettings() {
    if (serverSettingsOverlay) serverSettingsOverlay.style.display = 'none';
    if (srvSaveBar) srvSaveBar.style.display = 'none';
  }

  function updateServerPreview() {
    if (srvSettingsTitle) srvSettingsTitle.textContent = tempServerState.name || 'Servidor';
    if (srvPreviewName) srvPreviewName.textContent = tempServerState.name || 'Servidor';
    if (srvPreviewBanner) {
      srvPreviewBanner.style.background = tempServerState.bannerColor;
    }
    if (srvPreviewImg && srvPreviewInitial) {
      if (tempServerState.iconUrl) {
        srvPreviewImg.src = tempServerState.iconUrl;
        srvPreviewImg.style.display = 'block';
        srvPreviewInitial.style.display = 'none';
      } else {
        srvPreviewImg.style.display = 'none';
        srvPreviewInitial.style.display = 'block';
        srvPreviewInitial.textContent = (tempServerState.name || 'S')[0].toUpperCase();
      }
    }
    // Update active swatch
    document.querySelectorAll('.srv-color-swatch').forEach(sw => {
      sw.classList.toggle('active', sw.dataset.color === tempServerState.bannerColor);
    });
  }

  function createServerIconDataUrl(file) {
    return new Promise((resolve, reject) => {
      if (!file.type.startsWith('image/')) {
        reject(new Error('Selecione um arquivo de imagem.'));
        return;
      }
      if (file.size > 10 * 1024 * 1024) {
        reject(new Error('A imagem deve ter no máximo 10 MB.'));
        return;
      }

      const image = new Image();
      const objectUrl = URL.createObjectURL(file);
      image.onload = () => {
        URL.revokeObjectURL(objectUrl);
        try {
          const scale = Math.min(1, 512 / Math.max(image.naturalWidth, image.naturalHeight));
          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
          canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
          const context = canvas.getContext('2d');
          if (!context) {
            reject(new Error('Não foi possível processar esta imagem.'));
            return;
          }
          context.drawImage(image, 0, 0, canvas.width, canvas.height);
          const dataUrl = canvas.toDataURL('image/jpeg', 0.82);
          if (dataUrl.length > 5 * 1024 * 1024) {
            reject(new Error('A imagem otimizada excede o limite permitido pelo servidor.'));
            return;
          }
          resolve(dataUrl);
        } catch (error) {
          reject(new Error(error.message || 'Não foi possível processar esta imagem.'));
        }
      };
      image.onerror = () => {
        URL.revokeObjectURL(objectUrl);
        reject(new Error('Não foi possível abrir esta imagem.'));
      };
      image.src = objectUrl;
    });
  }

  function markUnsavedChanges() {
    if (srvSaveBar) srvSaveBar.style.display = 'flex';
  }

  // Event Listeners
  if (btnCloseServerSettings) {
    btnCloseServerSettings.addEventListener('click', closeServerSettings);
  }

  if (srvNameInput) {
    srvNameInput.addEventListener('input', () => {
      tempServerState.name = srvNameInput.value.trim();
      updateServerPreview();
      markUnsavedChanges();
    });
  }

  if (srvPublicToggle) {
    srvPublicToggle.addEventListener('change', () => {
      tempServerState.isPublic = srvPublicToggle.checked;
      markUnsavedChanges();
    });
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && serverSettingsOverlay && serverSettingsOverlay.style.display !== 'none') {
      closeServerSettings();
    }
  });

  // Conectar aos botões de abrir configurações do servidor
  const menuItemEditProfile = document.getElementById('menuItemEditProfile');
  if (menuItemEditProfile) {
    menuItemEditProfile.addEventListener('click', () => {
      closeServerDropdown();
      const current = servers.find(s => s.id === activeServerId);
      openServerSettings(current);
    });
  }

  const ctxServerSettings = document.getElementById('ctxServerSettings');
  if (ctxServerSettings) {
    ctxServerSettings.addEventListener('click', () => {
      closeServerContextMenu();
      const current = servers.find(s => s.id === activeServerId);
      openServerSettings(current);
    });
  }

  // Paleta de Cores
  if (srvBannerPalette) {
    srvBannerPalette.addEventListener('click', (e) => {
      const swatch = e.target.closest('.srv-color-swatch');
      if (!swatch) return;
      tempServerState.bannerColor = swatch.dataset.color;
      updateServerPreview();
      markUnsavedChanges();
    });
  }

  // Ícone Upload & Remoção
  if (btnChangeServerIcon && inputServerIconFile) {
    btnChangeServerIcon.addEventListener('click', () => {
      inputServerIconFile.click();
    });
    inputServerIconFile.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      inputServerIconFile.value = '';
      if (!file) return;
      try {
        tempServerState.iconUrl = await createServerIconDataUrl(file);
        updateServerPreview();
        markUnsavedChanges();
      } catch (error) {
        showToast(error.message || 'Não foi possível carregar a imagem.', '⚠️');
      }
    });
  }

  if (btnRemoveServerIcon) {
    btnRemoveServerIcon.addEventListener('click', () => {
      tempServerState.iconUrl = '';
      updateServerPreview();
      markUnsavedChanges();
    });
  }

  // Descrição & Traits
  if (srvDescriptionInput) {
    srvDescriptionInput.addEventListener('input', () => {
      tempServerState.description = srvDescriptionInput.value;
      markUnsavedChanges();
    });
  }

  for (let i = 1; i <= 5; i++) {
    const traitInput = document.getElementById(`trait${i}`);
    if (traitInput) {
      traitInput.addEventListener('input', () => {
        tempServerState.traits[i - 1] = traitInput.value;
        markUnsavedChanges();
      });
    }
  }

  function switchServerSettingsTab(tabName) {
    document.querySelectorAll('.srv-nav-item').forEach(item => {
      item.classList.toggle('active', item.dataset.srvTab === tabName);
    });

    const paneProfile = document.getElementById('paneSrvProfile');
    const paneTag = document.getElementById('paneSrvTag');

    if (paneProfile) paneProfile.style.display = tabName === 'profile' ? 'flex' : 'none';
    if (paneTag) paneTag.style.display = tabName === 'tag' ? 'flex' : 'none';
  }

  document.querySelectorAll('.srv-nav-item').forEach(item => {
    item.addEventListener('click', () => {
      const tab = item.dataset.srvTab;
      if (tab) switchServerSettingsTab(tab);
    });
  });

  // Tag do Servidor — Lógica Interativa Desbloqueada
  const inputServerTagText = document.getElementById('inputServerTagText');
  const previewTagText = document.getElementById('previewTagText');
  const previewTagIcon = document.getElementById('previewTagIcon');
  const tagBadgeIconDisplay = document.getElementById('tagBadgeIconDisplay');
  const srvBadgesGrid = document.getElementById('srvBadgesGrid');
  const srvBadgeColorsRow = document.getElementById('srvBadgeColorsRow');
  const srvChatTagPill = document.getElementById('srvChatTagPill');

  if (inputServerTagText) {
    inputServerTagText.addEventListener('input', () => {
      const val = inputServerTagText.value.toUpperCase();
      inputServerTagText.value = val;
      if (previewTagText) previewTagText.textContent = val || 'TAG';
      tempServerState.serverTag = val;
      markUnsavedChanges();
    });
  }

  if (srvBadgesGrid) {
    srvBadgesGrid.addEventListener('click', (e) => {
      const item = e.target.closest('.srv-badge-select-item');
      if (!item) return;
      document.querySelectorAll('.srv-badge-select-item').forEach(el => el.classList.remove('active'));
      item.classList.add('active');
      const badge = item.dataset.badge;
      if (tagBadgeIconDisplay) tagBadgeIconDisplay.textContent = badge;
      if (previewTagIcon) previewTagIcon.textContent = badge;
      tempServerState.serverTagBadge = badge;
      markUnsavedChanges();
    });
  }

  if (srvBadgeColorsRow) {
    srvBadgeColorsRow.addEventListener('click', (e) => {
      const item = e.target.closest('.srv-badge-color-item');
      if (!item) return;
      document.querySelectorAll('.srv-badge-color-item').forEach(el => el.classList.remove('active'));
      item.classList.add('active');
      const color = item.dataset.color;
      if (srvChatTagPill) {
        srvChatTagPill.style.borderColor = color;
      }
      tempServerState.serverTagColor = color;
      markUnsavedChanges();
    });
  }

  // Salvar
  if (btnSaveServerSettings) {
    btnSaveServerSettings.addEventListener('click', async () => {
      if (!currentSrvEditing || currentSrvEditing.isOwner === false) return;
      const name = tempServerState.name.trim();
      if (!name) {
        showToast('Informe um nome para o servidor.', '⚠️');
        return;
      }
      btnSaveServerSettings.disabled = true;
      try {
        const response = await fetch(`/api/servers/${encodeURIComponent(currentSrvEditing.id)}`, {
          method: 'PATCH',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({
            name,
            icon: currentSrvEditing.icon,
            iconUrl: tempServerState.iconUrl,
            bannerColor: tempServerState.bannerColor,
            description: tempServerState.description,
            traits: tempServerState.traits,
            serverTag: tempServerState.serverTag,
            serverTagBadge: tempServerState.serverTagBadge,
            serverTagColor: tempServerState.serverTagColor,
            textChannels: currentSrvEditing.textChannels,
            voiceChannels: currentSrvEditing.voiceChannels,
            isPublic: srvPublicToggle?.checked || false
          })
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error || 'Não foi possível salvar o servidor.');

        Object.assign(currentSrvEditing, payload.server, {
          serverTag: tempServerState.serverTag || 'KBM!',
          serverTagBadge: tempServerState.serverTagBadge || '🗡️',
          serverTagColor: tempServerState.serverTagColor || '#eb459e'
        });
        saveServers();
        renderGuilds();
        selectServer(activeServerId);
        closeServerSettings();
        showToast('Configurações do servidor salvas.', '✅');
      } catch (error) {
        showToast(error.message || 'Não foi possível salvar o servidor.', '⚠️');
      } finally {
        btnSaveServerSettings.disabled = currentSrvEditing?.isOwner === false;
      }
    });
  }

  // Redefinir
  if (btnResetServerSettings) {
    btnResetServerSettings.addEventListener('click', () => {
      openServerSettings(currentSrvEditing);
    });
  }

  // Excluir Servidor
  if (srvSettingsBtnDelete) {
    srvSettingsBtnDelete.addEventListener('click', async () => {
      if (!currentSrvEditing || currentSrvEditing.isOwner === false) return;
      if (!confirm(`Tem certeza que deseja excluir permanentemente o servidor "${currentSrvEditing.name}"?`)) return;
      try {
        const response = await fetch(`/api/servers/${encodeURIComponent(currentSrvEditing.id)}`, {
          method: 'DELETE',
          credentials: 'include',
          headers: { Accept: 'application/json' }
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error || 'Não foi possível excluir o servidor.');
        const deletedServerId = currentSrvEditing.id;
        servers = servers.filter((server) => server.id !== deletedServerId);
        closeServerSettings();
        saveServers();
        renderServersBar();
        if (deletedServerId === activeServerId) {
          const homeServerId = localStorage.getItem('badiscord_home_server_id');
          const nextServer = servers.find((server) => server.id === homeServerId) || servers[0];
          if (nextServer) restoreServerView(nextServer.id);
        }
        showToast('Servidor excluído.', '🗑️');
      } catch (error) {
        showToast(error.message || 'Não foi possível excluir o servidor.', '⚠️');
      }
    });
  }

  // Expor globalmente para atalhos
  window.openServerSettings = openServerSettings;
  window.changeServerIcon = (server) => {
    if (server?.isOwner === false) return;
    openServerSettings(server);
    inputServerIconFile?.click();
  };
})();


// ==========================================
// SISTEMA DE AUTENTICAÇÃO: LOGIN, REGISTRO E CONTROLE DE ACESSO
// ==========================================
(function() {
  const authOverlay = document.getElementById('authOverlay');
  const viewAuthLogin = document.getElementById('viewAuthLogin');
  const viewAuthRegister = document.getElementById('viewAuthRegister');
  const viewAuthForgot = document.getElementById('viewAuthForgot');
  const viewAuth2FA = document.getElementById('viewAuth2FA');

  const btnGoToRegister = document.getElementById('btnGoToRegister');
  const btnGoToLoginFromReg = document.getElementById('btnGoToLoginFromReg');
  const btnGoToForgot = document.getElementById('btnGoToForgot');
  const btnBackToLoginFromForgot = document.getElementById('btnBackToLoginFromForgot');
  const btnBackToLoginFrom2FA = document.getElementById('btnBackToLoginFrom2FA');

  const loginEmail = document.getElementById('loginEmail');
  const loginPassword = document.getElementById('loginPassword');
  const btnLoginSubmit = document.getElementById('btnLoginSubmit');

  const regEmail = document.getElementById('regEmail');
  const regUsername = document.getElementById('regUsername');
  const regPassword = document.getElementById('regPassword');
  const regPasswordConfirm = document.getElementById('regPasswordConfirm');
  const btnRegisterSubmit = document.getElementById('btnRegisterSubmit');

  const forgotEmail = document.getElementById('forgotEmail');
  const btnSend2FACode = document.getElementById('btnSend2FACode');
  const authGenerated2FACode = document.getElementById('authGenerated2FACode');
  const input2FACode = document.getElementById('input2FACode');
  const inputNewPassword2FA = document.getElementById('inputNewPassword2FA');
  const btnConfirm2FAReset = document.getElementById('btnConfirm2FAReset');

  let active2FACode = null;
  let targetRecoveryEmail = null;

  function switchAuthView(viewName) {
    if (viewAuthLogin) viewAuthLogin.style.display = viewName === 'login' ? 'block' : 'none';
    if (viewAuthRegister) viewAuthRegister.style.display = viewName === 'register' ? 'block' : 'none';
    if (viewAuthForgot) viewAuthForgot.style.display = viewName === 'forgot' ? 'block' : 'none';
    if (viewAuth2FA) viewAuth2FA.style.display = viewName === '2fa' ? 'block' : 'none';
  }

  if (btnGoToRegister) btnGoToRegister.addEventListener('click', () => switchAuthView('register'));
  if (btnGoToLoginFromReg) btnGoToLoginFromReg.addEventListener('click', () => switchAuthView('login'));
  if (btnGoToForgot) btnGoToForgot.addEventListener('click', () => switchAuthView('forgot'));
  if (btnBackToLoginFromForgot) btnBackToLoginFromForgot.addEventListener('click', () => switchAuthView('login'));
  if (btnBackToLoginFrom2FA) btnBackToLoginFrom2FA.addEventListener('click', () => switchAuthView('login'));

  if (btnLoginSubmit) {
    btnLoginSubmit.addEventListener('click', async () => {
      const email = loginEmail ? loginEmail.value.trim() : '';
      const password = loginPassword ? loginPassword.value : '';

      if (!email || !password) {
        showToast('Preencha seu e-mail e senha.', '⚠️');
        return;
      }

      const recaptchaToken = getRecaptchaToken('login');
      if (recaptchaSiteKey && !recaptchaToken) {
        showToast('Confirme que você não é um robô.', '⚠️');
        return;
      }

      try {
        const account = await loginAccount(email, password, recaptchaToken);
        await finalizeAuthSession(account);
        showToast(`Bem-vindo de volta, ${account.displayName}!`, '👋');
      } catch (error) {
        resetRecaptcha('login');
        showToast(error.message || 'Não foi possível entrar.', '❌');
      }
    });
  }

  if (btnRegisterSubmit) {
    btnRegisterSubmit.addEventListener('click', async () => {
      const email = regEmail ? regEmail.value.trim() : '';
      const username = regUsername ? regUsername.value.trim() : '';
      const password = regPassword ? regPassword.value : '';

      if (!email || !username || !password) {
        showToast('Preencha os campos obrigatórios (*).', '⚠️');
        return;
      }
      if (!regPasswordConfirm || password !== regPasswordConfirm.value) {
        showToast('As senhas não conferem.', '⚠️');
        return;
      }

      const recaptchaToken = getRecaptchaToken('register');
      if (recaptchaSiteKey && !recaptchaToken) {
        showToast('Confirme que você não é um robô.', '⚠️');
        return;
      }

      try {
        const account = await registerAccount({ email, username, password, recaptchaToken });
        await finalizeAuthSession(account);
        showToast(`Conta criada com sucesso! Olá, ${account.displayName}#${account.tag}!`, '🎉');
      } catch (error) {
        resetRecaptcha('register');
        showToast(error.message || 'Não foi possível criar a conta.', '⚠️');
      }
    });
  }

  if (btnSend2FACode) {
    btnSend2FACode.addEventListener('click', async () => {
      const email = forgotEmail ? forgotEmail.value.trim() : '';
      if (!email) {
        showToast('Informe o seu e-mail cadastrado.', '⚠️');
        return;
      }

      targetRecoveryEmail = email;
      try {
        const response = await fetch('/api/auth/recovery/request', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ email })
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error || 'Não foi possível iniciar a recuperação.');
        active2FACode = payload.recoveryId;
        if (authGenerated2FACode) authGenerated2FACode.textContent = payload.demoCode || 'enviado para seu e-mail';
        switchAuthView('2fa');
        showToast(`Código 2FA enviado para ${email}!`, '📩');
      } catch (error) {
        showToast(error.message || 'Não foi possível iniciar a recuperação.', '❌');
      }
    });
  }

  if (btnConfirm2FAReset) {
    btnConfirm2FAReset.addEventListener('click', async () => {
      const codeTyped = input2FACode ? input2FACode.value.trim() : '';
      const newPass = inputNewPassword2FA ? inputNewPassword2FA.value : '';

      try {
        const response = await fetch('/api/auth/recovery/reset', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ recoveryId: active2FACode, code: codeTyped, newPassword: newPass })
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error || 'Não foi possível redefinir a senha.');
        await finalizeAuthSession(payload.user);
        showToast('Senha redefinida com sucesso via 2FA! Conectado.', '🔐');
      } catch (error) {
        showToast(error.message || 'Não foi possível redefinir a senha.', '❌');
      }
    });
  }

  window.logoutBADISCORD = function() {
    logoutAccount();
  };

  const menuItemSwitchAccount = document.getElementById('menuItemSwitchAccount');
  if (menuItemSwitchAccount) {
    menuItemSwitchAccount.addEventListener('click', () => {
      window.logoutBADISCORD();
    });
  }
})();

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    ensureAuthState();
  });
} else {
  ensureAuthState();
}
