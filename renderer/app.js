// BADISCORD PC - Lógica de Servidores, Voz, Mudo/Fone e Transmissão 1080p

const API_URL = 'http://localhost:3000/api/token';
const LIVEKIT_URL = 'wss://your-project.livekit.cloud';

// Estado da Aplicação
let currentRoom = null;
let currentChannel = null;
let localAudioTrack = null;
let localScreenTrack = null;
let localScreenAudioTrack = null;
let isLocalStreamer = false;
let isLoopbackEnabled = false;
let isMuted = false;
let isDeafened = false;
let wasMutedBeforeDeafen = false;
let selectedSourceId = null;

// Estado do Perfil de Usuário
const DEFAULT_PROFILE = {
  displayName: 'Bads',
  username: 'bads',
  tag: '0001',
  avatarUrl: '',
  bannerColor: '#5865F2',
  aboutMe: 'Usando o BADISCORD!'
};

let userProfile = DEFAULT_PROFILE;
try {
  const savedProf = localStorage.getItem('badiscord_user_profile');
  if (savedProf) userProfile = { ...DEFAULT_PROFILE, ...JSON.parse(savedProf) };
} catch (e) {}
if (!userProfile.tag) {
  userProfile.tag = '0001';
}

function saveUserProfile() {
  try {
    localStorage.setItem('badiscord_user_profile', JSON.stringify(userProfile));
  } catch (e) {}
}

// Servidores Padrão (com Canais de Texto e Canais de Voz)
const DEFAULT_SERVERS = [
  {
    id: 'srv-1',
    name: 'Comunidade Principal',
    icon: '🎮',
    textChannels: ['geral', 'regras-da-casa', 'clipes-e-jogos', 'comandos-bot'],
    voiceChannels: ['Geral 🔊', 'Duo / Trio', 'CS2 Competitivo', 'Live 1080p 60FPS']
  },
  {
    id: 'srv-2',
    name: 'Comunidade DEV',
    icon: '💻',
    textChannels: ['geral', 'duvidas-e-bugs', 'setup-e-hardware'],
    voiceChannels: ['Bate-Papo Dev', 'Pair Programming']
  }
];

function normalizeServers(list) {
  if (!Array.isArray(list) || list.length === 0) return DEFAULT_SERVERS;
  return list.map((srv, idx) => {
    const textChans = Array.isArray(srv.textChannels) && srv.textChannels.length > 0
      ? srv.textChannels
      : ['geral', 'regras-da-casa', 'clipes-e-jogos'];
    const voiceChans = Array.isArray(srv.voiceChannels) && srv.voiceChannels.length > 0
      ? srv.voiceChannels
      : (Array.isArray(srv.channels) && srv.channels.length > 0 ? srv.channels : ['Geral 🔊', 'CS2 Competitivo', 'Live 1080p 60FPS']);
    return {
      id: srv.id || `srv-${idx + 1}`,
      name: srv.name || `Servidor ${idx + 1}`,
      icon: srv.icon || '🎮',
      textChannels: textChans,
      voiceChannels: voiceChans
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
let activeServerId = servers[0]?.id || 'srv-1';

function saveServers() {
  try {
    localStorage.setItem('badiscord_servers', JSON.stringify(servers));
  } catch (e) {}
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
const btnChatEmoji = document.getElementById('btnChatEmoji');
const btnJumpToVoice = document.getElementById('btnJumpToVoice');
const voiceConnectedStrip = document.getElementById('voiceConnectedStrip');
const stripChannelName = document.getElementById('stripChannelName');
const btnToggleMembers = document.getElementById('btnToggleMembers');
const membersSidebar = document.getElementById('membersSidebar');
const membersScroll = document.getElementById('membersScroll');

// Visão de Início / Amigos / DMs (Foto 2)
const friendsView = document.getElementById('friendsView');
const friendsCardsList = document.getElementById('friendsCardsList');
const activeNowList = document.getElementById('activeNowList');
const dmConversationsList = document.getElementById('dmConversationsList');
const inputFriendsSearch = document.getElementById('inputFriendsSearch');
const friendsCountLabel = document.getElementById('friendsCountLabel');

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
  const voiceStageView = document.getElementById('voiceStageView');

  if (voiceStageView) voiceStageView.style.display = viewName === 'voice' ? 'flex' : 'none';
  if (textChatView) textChatView.style.display = viewName === 'chat' ? 'flex' : 'none';
  if (friendsView) friendsView.style.display = viewName === 'friends' ? 'flex' : 'none';

  if (membersSidebar) {
    membersSidebar.style.display = (viewName === 'chat') ? 'block' : 'none';
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
    icon.className = `guild-icon ${!inHomeView && srv.id === activeServerId ? 'active' : ''}`;
    icon.title = srv.name;
    icon.textContent = srv.icon || srv.name.slice(0, 2).toUpperCase();

    icon.addEventListener('click', () => {
      restoreServerView(srv.id);
    });

    // Clique com botão direito abre o Menu de Contexto do Servidor (Foto 3)
    icon.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      openServerContextMenu(e.clientX, e.clientY, srv);
    });

    guildList.appendChild(icon);
  });
}

function selectServer(serverId) {
  activeServerId = serverId;
  renderGuilds();

  const srv = servers.find(s => s.id === serverId);
  if (srv) {
    if (guildTitle) guildTitle.textContent = srv.name;
    if (guildBadge) guildBadge.textContent = srv.icon || '🍺';
    renderChannels(srv);
  }
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

  if (currentChannel) {
    updateSidebarChannelUsers(currentChannel);
  }
}

// Atualizar o nome do usuário embaixo da sala na barra lateral
function updateSidebarChannelUsers(channelName) {
  document.querySelectorAll('.channel-users-list').forEach(list => {
    list.innerHTML = '';
  });

  if (!channelName) return;

  const targetList = document.getElementById(`users-${channelName}`);
  if (!targetList) return;

  // 1. Usuário local
  const userItem = document.createElement('div');
  userItem.className = 'channel-user-item';
  userItem.id = 'sidebarLocalUser';

  const avatar = document.createElement('div');
  avatar.className = 'channel-user-avatar';
  if (userProfile.avatarUrl) {
    avatar.innerHTML = `<img src="${userProfile.avatarUrl}" style="width:100%;height:100%;border-radius:50%;object-fit:cover;">`;
  } else {
    avatar.textContent = (userProfile.displayName || 'B')[0].toUpperCase();
  }

  const name = document.createElement('span');
  name.className = 'channel-user-name';
  name.textContent = userProfile.displayName;

  const micIcon = document.createElement('span');
  micIcon.className = 'channel-user-mic';
  micIcon.id = 'sidebarUserMic';

  if (isDeafened) {
    micIcon.textContent = '🔇 🚫🎧';
  } else if (isMuted) {
    micIcon.textContent = '🔇';
  } else {
    micIcon.textContent = '🎤';
  }

  userItem.appendChild(avatar);
  userItem.appendChild(name);
  userItem.appendChild(micIcon);
  targetList.appendChild(userItem);

  // 2. Amigos na sala do servidor
  if (typeof friendsList !== 'undefined' && Array.isArray(friendsList)) {
    friendsList.forEach(f => {
      const fItem = document.createElement('div');
      fItem.className = 'channel-user-item';

      const fAvatar = document.createElement('div');
      fAvatar.className = 'channel-user-avatar';
      fAvatar.style.backgroundColor = f.color || '#5865F2';
      fAvatar.textContent = f.initial || f.name[0].toUpperCase();

      const fName = document.createElement('span');
      fName.className = 'channel-user-name';
      fName.textContent = f.name;

      fItem.appendChild(fAvatar);
      fItem.appendChild(fName);

      if (f.game) {
        const fGame = document.createElement('span');
        fGame.className = 'channel-user-mic';
        fGame.textContent = '🎮';
        fItem.appendChild(fGame);
      }

      targetList.appendChild(fItem);
    });
  }
}

// Renderizar participantes na tela principal da sala de voz (Estilo Discord 1:1)
function renderVoiceParticipants() {
  if (!participantsGrid) return;
  participantsGrid.innerHTML = '';

  // 1. Card do próprio usuário
  const localCard = document.createElement('div');
  localCard.className = 'participant-card';
  localCard.id = 'localParticipantCard';

  const localAvatar = document.createElement('div');
  localAvatar.className = 'participant-avatar-lg';
  if (userProfile.avatarUrl) {
    localAvatar.innerHTML = `<img src="${userProfile.avatarUrl}" alt="Avatar">`;
  } else {
    localAvatar.style.backgroundColor = userProfile.bannerColor || '#5865F2';
    localAvatar.textContent = (userProfile.displayName || 'B')[0].toUpperCase();
  }

  const localTag = document.createElement('div');
  localTag.className = 'participant-name-tag';
  
  const nameSpan = document.createElement('span');
  nameSpan.textContent = userProfile.displayName || 'Bads';
  localTag.appendChild(nameSpan);

  if (typeof detectedGame !== 'undefined' && detectedGame && detectedGame.name) {
    const gamePill = document.createElement('span');
    gamePill.className = 'participant-game-pill';
    gamePill.textContent = detectedGame.name;
    localTag.appendChild(gamePill);
  }

  const micIcon = document.createElement('div');
  micIcon.className = 'participant-mic-icon';
  micIcon.id = 'participantMicIcon';
  micIcon.textContent = isMuted ? '🔇' : (isDeafened ? '🚫🎧' : '🎤');

  localCard.appendChild(localAvatar);
  localCard.appendChild(localTag);
  localCard.appendChild(micIcon);
  participantsGrid.appendChild(localCard);

  // 2. Renderizar amigos adicionados que também estão no servidor para preencher a sala (como na foto do usuário)
  if (typeof friendsList !== 'undefined' && Array.isArray(friendsList)) {
    friendsList.forEach(friend => {
      const card = document.createElement('div');
      card.className = 'participant-card';

      const avatar = document.createElement('div');
      avatar.className = 'participant-avatar-lg';
      avatar.style.backgroundColor = friend.color || '#5865F2';
      avatar.textContent = friend.initial || friend.name[0].toUpperCase();

      const tag = document.createElement('div');
      tag.className = 'participant-name-tag';

      const fNameSpan = document.createElement('span');
      fNameSpan.textContent = friend.name;
      tag.appendChild(fNameSpan);

      if (friend.game) {
        const fGamePill = document.createElement('span');
        fGamePill.className = 'participant-game-pill';
        fGamePill.textContent = friend.game;
        tag.appendChild(fGamePill);
      }

      card.appendChild(avatar);
      card.appendChild(tag);
      participantsGrid.appendChild(card);
    });
  }
}

// Conectar ao Canal de Voz
async function joinVoiceChannel(channelName) {
  if (currentChannel === channelName) {
    switchView('voice');
    return;
  }

  if (currentChannel) {
    disconnectVoice(false);
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
  participantsGrid.style.display = 'flex';
  voiceFloatingBar.style.display = 'flex';
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
    const audioStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        sampleRate: 48000
      }
    });

    localAudioTrack = audioStream.getAudioTracks()[0];
    localAudioTrack.enabled = !isMuted;
    setupAudioLevelMeter(audioStream);
  } catch (err) {
    console.warn('Microfone não acessível ou sem permissão:', err);
  }
}

// ==========================================
// CHAT DE TEXTO & CONVERSAS DIRETAS (DMs)
// ==========================================
let currentDmFriend = null;

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
  return `badiscord_messages_${srvId}_${chanName}`;
}

function getStoredMessages(srvId, chanName) {
  const key = getChatStorageKey(srvId, chanName);
  try {
    const raw = localStorage.getItem(key);
    if (raw) {
      const parsed = JSON.parse(raw);
      // Remove mensagens mockadas antigas se existirem
      const clean = parsed.filter(m => m.author !== 'BADISCORD Bot' && m.id !== 2);
      if (clean.length !== parsed.length) {
        localStorage.setItem(key, JSON.stringify(clean));
      }
      return clean;
    }
  } catch (e) {}
  // O chat começa limpo por padrão (sem mensagens falsas)
  return [];
}

function getStoredDMMessages(friendId, friend) {
  const key = `badiscord_dm_messages_${friendId}`;
  try {
    const raw = localStorage.getItem(key);
    if (raw) return JSON.parse(raw);
  } catch (e) {}
  return [];
}

function loadAndRenderMessages(srvId, chanName) {
  if (!messagesList) return;
  messagesList.innerHTML = '';

  const msgs = getStoredMessages(srvId, chanName);
  msgs.forEach(msg => {
    messagesList.appendChild(createMessageElement(msg));
  });

  scrollChatToBottom();
}

function loadAndRenderDMMessages(friend) {
  if (!messagesList) return;
  messagesList.innerHTML = '';

  const msgs = getStoredDMMessages(friend.id, friend);
  msgs.forEach(msg => {
    messagesList.appendChild(createMessageElement(msg));
  });

  scrollChatToBottom();
}

function createMessageElement(msg) {
  const div = document.createElement('div');
  div.className = 'chat-message';

  const avatar = document.createElement('div');
  avatar.className = 'message-avatar';
  avatar.style.cursor = 'pointer';
  if (msg.avatar) {
    avatar.innerHTML = `<img src="${msg.avatar}" style="width:100%;height:100%;border-radius:50%;object-fit:cover;">`;
  } else {
    avatar.textContent = (msg.author || 'U')[0].toUpperCase();
  }

  avatar.addEventListener('click', () => {
    openMemberProfilePopover({
      name: msg.author,
      tag: '0001',
      fullTag: `${msg.author}#0001`,
      avatarUrl: msg.avatar,
      color: '#5865F2',
      game: detectedGame ? detectedGame.name : '',
      detail: 'Online no canal',
      role: msg.role || 'Membro'
    });
  });

  const content = document.createElement('div');
  content.className = 'message-content';

  const header = document.createElement('div');
  header.className = 'message-header';

  const author = document.createElement('span');
  author.className = 'message-author';
  author.textContent = msg.author;
  author.style.cursor = 'pointer';
  author.addEventListener('click', () => {
    openMemberProfilePopover({
      name: msg.author,
      tag: '0001',
      fullTag: `${msg.author}#0001`,
      avatarUrl: msg.avatar,
      color: '#5865F2',
      game: detectedGame ? detectedGame.name : '',
      detail: 'Online no canal',
      role: msg.role || 'Membro'
    });
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
  text.textContent = msg.text;

  content.appendChild(header);
  content.appendChild(text);

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
  chatInputForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = chatInputText.value.trim();
    if (!text) return;

    const newMsg = {
      id: Date.now(),
      author: userProfile.displayName || 'Bads',
      avatar: userProfile.avatarUrl || '',
      role: 'MEMBRO',
      time: `Hoje às ${formatTimeNow()}`,
      text: text
    };

    if (currentDmFriend) {
      const dmKey = `badiscord_dm_messages_${currentDmFriend.id}`;
      const msgs = getStoredDMMessages(currentDmFriend.id, currentDmFriend);
      msgs.push(newMsg);
      try {
        localStorage.setItem(dmKey, JSON.stringify(msgs));
      } catch (err) {}
    } else {
      const msgs = getStoredMessages(activeServerId, currentTextChannel);
      msgs.push(newMsg);
      try {
        localStorage.setItem(getChatStorageKey(activeServerId, currentTextChannel), JSON.stringify(msgs));
      } catch (err) {}
    }

    if (messagesList) {
      messagesList.appendChild(createMessageElement(newMsg));
      scrollChatToBottom();
    }

    chatInputText.value = '';
    playPopSound();
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
    playSoundEffect('correct');
    showToast('🚀 Servidor Impulsionado! Nível 3 Ativo (1080p 60FPS liberado)', '🚀');
  });
}

if (menuItemInvite) {
  menuItemInvite.addEventListener('click', async () => {
    closeServerDropdown();
    const inviteLink = `https://badiscord.gg/${activeServerId}`;
    try {
      await navigator.clipboard.writeText(inviteLink);
    } catch (err) {}
    showToast('📋 Link de convite copiado para a área de transferência!', '📋');
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

if (menuItemEditProfile) {
  menuItemEditProfile.addEventListener('click', () => {
    closeServerDropdown();
    openSettings();
    switchSettingsTab('account');
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

async function toggleCamera() {
  if (isCamActive) {
    if (localCamTrack) {
      try { localCamTrack.stop(); } catch (e) {}
      localCamTrack = null;
    }
    isCamActive = false;
    showToast('📹 Câmera desativada', '📹');
  } else {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      localCamTrack = stream.getVideoTracks()[0];
      isCamActive = true;
      showToast('📹 Câmera ativada!', '📹');
    } catch (err) {
      showToast('Nenhuma webcam detectada no sistema', '⚠️');
    }
  }

  if (dockBtnCam) dockBtnCam.classList.toggle('active', isCamActive);
  if (btnShareCam) btnShareCam.classList.toggle('active', isCamActive);
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
// DETECÇÃO DE JOGOS EM TEMPO REAL & 1-CLICK STREAM
// ==========================================
let detectedGame = null;

async function checkRunningGame() {
  if (!window.electronAPI || !window.electronAPI.getDetectedGame) return;
  try {
    const game = await window.electronAPI.getDetectedGame();
    detectedGame = game;

    const panel = document.getElementById('gameActivityPanel');
    const titleEl = document.getElementById('gameActivityTitle');
    const statusEl = document.getElementById('gameActivityStatus');
    const iconBox = document.getElementById('gameActivityIconBox');
    const btnQuick = document.getElementById('btnGameQuickStream');

    if (localScreenTrack) {
      if (panel) panel.classList.add('is-live');
      if (statusEl) statusEl.textContent = 'AO VIVO em 1080p 60FPS';
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
        btnQuick.title = `Transmitir ${game.name} em 1080p 60FPS`;
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
        btnQuick.title = 'Escolher janela ou monitor para transmitir';
      }
      if (iconBox) iconBox.innerHTML = '🎮';
    }
  } catch (err) {
    console.warn('Erro ao verificar jogo em execução:', err);
  }
}

// Inicia verificação periódica a cada 2.5 segundos
setInterval(checkRunningGame, 2500);
setTimeout(checkRunningGame, 600);

if (btnGameQuickStream) {
  btnGameQuickStream.addEventListener('click', async () => {
    if (localScreenTrack) {
      stopCurrentStream();
      return;
    }

    // Se houver um jogo detectado aberto agora, inicia a live direta daquele jogo!
    if (detectedGame && detectedGame.id) {
      showToast(`Iniciando transmissão de ${detectedGame.name}...`, '🎮');
      await startStreamWithSourceId(detectedGame.id, detectedGame.name);
    } else {
      // Caso contrário, abre o modal de seleção
      currentCaptureTab = 'windows';
      if (tabWindows) tabWindows.classList.add('active');
      if (tabScreens) tabScreens.classList.remove('active');
      if (inputSearchSources) inputSearchSources.value = '';
      sourceSearchQuery = '';

      await fetchAndRenderSources();
      screenShareModal.style.display = 'flex';
    }
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
try { 
  friendsList = JSON.parse(localStorage.getItem('badiscord_friends') || '[]'); 
} catch(e) { friendsList = []; }

// Normaliza amigos antigos para sempre terem tag
friendsList = friendsList.map((f, idx) => {
  if (!f.tag) f.tag = String(1000 + (idx * 137) % 8999);
  if (!f.fullTag) f.fullTag = `${f.name}#${f.tag}`;
  return f;
});

let friendRequests = [];
try { 
  friendRequests = JSON.parse(localStorage.getItem('badiscord_friend_requests') || '[]'); 
} catch(e) { friendRequests = []; }

function saveFriends() {
  localStorage.setItem('badiscord_friends', JSON.stringify(friendsList));
}

function saveFriendRequests() {
  localStorage.setItem('badiscord_friend_requests', JSON.stringify(friendRequests));
}

// Analisa entrada do usuário com ou sem tag (ex: bads#0000 ou bads)
function parseFriendInput(raw) {
  if (!raw) return null;
  const str = raw.trim();
  if (!str) return null;

  let name = '';
  let tag = '';

  if (str.includes('#')) {
    const parts = str.split('#');
    name = parts[0].trim();
    tag = parts[1].trim();
    if (!name) name = 'Amigo';
    if (!tag) tag = String(Math.floor(1000 + Math.random() * 9000));
  } else {
    name = str;
    tag = String(Math.floor(1000 + Math.random() * 9000));
  }

  // Remove caracteres extras da tag
  tag = tag.replace(/[^a-zA-Z0-9]/g, '');
  if (!tag) tag = '0001';

  return {
    name,
    tag,
    fullTag: `${name}#${tag}`
  };
}

function addFriend(rawInput) {
  const parsed = parseFriendInput(rawInput);
  if (!parsed) return null;

  const { name, tag, fullTag } = parsed;

  const myTag = userProfile.tag || '0001';
  const myName = userProfile.username || userProfile.displayName || 'bads';
  if (fullTag.toLowerCase() === `${myName}#${myTag}`.toLowerCase()) {
    showToast('Você não pode adicionar a si mesmo!', '⚠️');
    return null;
  }

  // Verifica se já é amigo
  const exists = friendsList.find(f => 
    (f.fullTag && f.fullTag.toLowerCase() === fullTag.toLowerCase()) || 
    (f.name.toLowerCase() === name.toLowerCase() && f.tag === tag)
  );
  if (exists) {
    showToast(`${fullTag} já está na sua lista de amigos!`, '⚠️');
    return null;
  }

  const friend = {
    id: 'f-' + Date.now(),
    name: name,
    tag: tag,
    fullTag: fullTag,
    status: 'online',
    game: '',
    detail: 'Disponível',
    initial: name[0].toUpperCase(),
    color: FRIEND_COLORS[Math.floor(Math.random() * FRIEND_COLORS.length)]
  };

  friendsList.push(friend);
  saveFriends();

  // Remove de solicitações pendentes se houver
  friendRequests = friendRequests.filter(r => r.fullTag.toLowerCase() !== fullTag.toLowerCase());
  saveFriendRequests();

  return friend;
}

function sendFriendRequest(rawInput) {
  const parsed = parseFriendInput(rawInput);
  if (!parsed) return null;

  const { name, tag, fullTag } = parsed;

  const myTag = userProfile.tag || '0001';
  const myName = userProfile.username || userProfile.displayName || 'bads';
  if (fullTag.toLowerCase() === `${myName}#${myTag}`.toLowerCase()) {
    showToast('Você não pode enviar solicitação para si mesmo!', '⚠️');
    return null;
  }

  if (friendsList.find(f => f.fullTag && f.fullTag.toLowerCase() === fullTag.toLowerCase())) {
    showToast(`${fullTag} já é seu amigo!`, '⚠️');
    return null;
  }

  if (friendRequests.find(r => r.fullTag && r.fullTag.toLowerCase() === fullTag.toLowerCase())) {
    showToast(`Já existe um pedido para ${fullTag}!`, '⚠️');
    return null;
  }

  const req = {
    id: 'req-' + Date.now(),
    name: name,
    tag: tag,
    fullTag: fullTag,
    type: 'outgoing', // enviado por você
    initial: name[0].toUpperCase(),
    color: FRIEND_COLORS[Math.floor(Math.random() * FRIEND_COLORS.length)],
    date: 'Hoje'
  };

  friendRequests.push(req);
  saveFriendRequests();
  return req;
}

function acceptFriendRequest(reqId) {
  const req = friendRequests.find(r => r.id === reqId);
  if (!req) return;

  const friend = {
    id: 'f-' + Date.now(),
    name: req.name,
    tag: req.tag,
    fullTag: req.fullTag,
    status: 'online',
    game: '',
    detail: 'Disponível',
    initial: req.initial,
    color: req.color
  };

  friendsList.push(friend);
  saveFriends();

  friendRequests = friendRequests.filter(r => r.id !== reqId);
  saveFriendRequests();

  showToast(`${friend.fullTag} agora é seu amigo! 🎉`, '✅');
  renderFriendsList();
  renderPendingRequests();
  renderDMList();
  renderActiveNowCards();
  updateDMBadge();
  updateRequestsBadge();
}

function rejectFriendRequest(reqId) {
  friendRequests = friendRequests.filter(r => r.id !== reqId);
  saveFriendRequests();
  showToast('Solicitação recusada/cancelada.', 'ℹ️');
  renderPendingRequests();
  updateRequestsBadge();
}

function simulateIncomingRequest() {
  const sampleNames = ['Lucas', 'GamerPro', 'Noxus', 'Viper', 'Astra', 'Cipher', 'Shadow'];
  const name = sampleNames[Math.floor(Math.random() * sampleNames.length)];
  const tag = String(Math.floor(1000 + Math.random() * 9000));
  const fullTag = `${name}#${tag}`;

  if (friendsList.find(f => f.fullTag === fullTag) || friendRequests.find(r => r.fullTag === fullTag)) {
    return;
  }

  const req = {
    id: 'req-' + Date.now(),
    name: name,
    tag: tag,
    fullTag: fullTag,
    type: 'incoming', // recebido de outra pessoa
    initial: name[0].toUpperCase(),
    color: FRIEND_COLORS[Math.floor(Math.random() * FRIEND_COLORS.length)],
    date: 'Agora mesmo'
  };

  friendRequests.push(req);
  saveFriendRequests();
  updateRequestsBadge();
  if (currentFriendsTab === 'pending') {
    renderPendingRequests();
  }
  showToast(`Nova solicitação de amizade de ${fullTag}!`, '📩');
}

function removeFriend(friendId) {
  const friend = friendsList.find(f => f.id === friendId);
  friendsList = friendsList.filter(f => f.id !== friendId);
  saveFriends();
  if (friend) showToast(`${friend.fullTag || friend.name} foi removido.`, '🗑️');
  renderFriendsList();
  renderDMList();
  renderActiveNowCards();
  updateDMBadge();
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
  const count = friendRequests.length;
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

  const filtered = friendsList.filter(f => {
    if (!filter) return true;
    const q = filter.toLowerCase();
    return f.name.toLowerCase().includes(q) || 
           (f.tag && f.tag.includes(q)) || 
           (f.fullTag && f.fullTag.toLowerCase().includes(q)) || 
           (f.game || '').toLowerCase().includes(q);
  });

  if (friendsCountLabel) {
    friendsCountLabel.textContent = `ONLINE — ${filtered.length}`;
  }

  if (filtered.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'friends-empty-state';
    empty.innerHTML = `
      <div class="friends-empty-icon">👋</div>
      <div class="friends-empty-title">${friendsList.length === 0 ? 'Nenhum amigo adicionado ainda' : 'Nenhum resultado encontrado'}</div>
      <div class="friends-empty-desc">${friendsList.length === 0 ? 'Clique em "Adicionar amigo" e informe um nome com tag (ex: bads#0000) para começar!' : 'Tente buscar com outro nome ou tag.'}</div>
    `;
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

    const dot = document.createElement('div');
    dot.className = 'friend-card-avatar-dot';
    avatar.appendChild(dot);

    const info = document.createElement('div');
    info.className = 'friend-card-info';

    const name = document.createElement('div');
    name.className = 'friend-card-name';
    name.innerHTML = `${friend.name} <span class="friend-card-tag">#${friend.tag}</span>`;

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

    card.addEventListener('click', () => {
      openDirectMessage(friend);
    });

    friendsCardsList.appendChild(card);
  });
}

// Renderiza a lista de solicitações de amizades pendentes
function renderPendingRequests() {
  if (!friendsCardsList) return;
  friendsCardsList.innerHTML = '';

  if (friendsCountLabel) {
    friendsCountLabel.textContent = `SOLICITAÇÕES PENDENTES — ${friendRequests.length}`;
  }

  // Header com botão para simular solicitação recebida
  const topActions = document.createElement('div');
  topActions.style.cssText = 'display:flex; justify-content:space-between; align-items:center; margin-bottom:12px; padding:0 4px;';
  topActions.innerHTML = `
    <span style="font-size:12px; color:#949ba4;">Gerencie quem pode conversar e jogar com você.</span>
    <button id="btnSimulateReq" class="btn-send-friend-req" style="background:#4e5058; font-size:11px; padding:4px 10px;">
      + Simular Pedido Recebido
    </button>
  `;
  friendsCardsList.appendChild(topActions);

  const btnSim = topActions.querySelector('#btnSimulateReq');
  if (btnSim) {
    btnSim.addEventListener('click', simulateIncomingRequest);
  }

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

  friendRequests.forEach(req => {
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
    name.innerHTML = `${req.name} <span class="friend-card-tag">#${req.tag}</span>`;

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
      btnAccept.addEventListener('click', () => acceptFriendRequest(req.id));

      const btnReject = document.createElement('button');
      btnReject.className = 'btn-reject-req';
      btnReject.title = 'Recusar Pedido';
      btnReject.textContent = '✖';
      btnReject.addEventListener('click', () => rejectFriendRequest(req.id));

      actions.appendChild(btnAccept);
      actions.appendChild(btnReject);
    } else {
      const btnCancel = document.createElement('button');
      btnCancel.className = 'btn-cancel-req';
      btnCancel.title = 'Cancelar Pedido';
      btnCancel.textContent = '✖';
      btnCancel.addEventListener('click', () => rejectFriendRequest(req.id));

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

  const activeFriends = friendsList.filter(f => f.game && f.game !== 'Ausente' && f.game !== '');

  if (activeFriends.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'active-now-empty';
    empty.innerHTML = `
      <span class="active-now-empty-icon">😴</span>
      <span>É quieto por enquanto... Quando seus amigos iniciarem uma atividade, ela aparecerá aqui!</span>
    `;
    activeNowList.appendChild(empty);
    return;
  }

  activeFriends.forEach(af => {
    const card = document.createElement('div');
    card.className = 'active-now-card';

    const header = document.createElement('div');
    header.className = 'active-now-header';

    const avatar = document.createElement('div');
    avatar.className = 'active-now-avatar';
    avatar.style.backgroundColor = af.color;
    avatar.textContent = af.initial;

    const userMeta = document.createElement('div');
    userMeta.className = 'active-now-usermeta';

    const userName = document.createElement('strong');
    userName.textContent = af.name;

    const userGame = document.createElement('span');
    userGame.textContent = af.game;

    userMeta.appendChild(userName);
    userMeta.appendChild(userGame);

    header.appendChild(avatar);
    header.appendChild(userMeta);

    const desc = document.createElement('div');
    desc.className = 'active-now-desc';
    desc.textContent = af.detail;

    card.appendChild(header);
    card.appendChild(desc);

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
  formAddFriend.addEventListener('submit', (e) => {
    e.preventDefault();
    const input = document.getElementById('inputAddFriendName');
    if (!input) return;
    const rawVal = input.value.trim();
    if (!rawVal) return;

    // Adiciona o amigo diretamente com a tag informada ou gerada
    const friend = addFriend(rawVal);
    if (friend) {
      showToast(`Pedido de amizade enviado para ${friend.fullTag}! 🎉`, '✅');
      input.value = '';
      renderDMList();
      renderActiveNowCards();
      updateDMBadge();
      updateRequestsBadge();

      // Muda para aba Todos para ver o amigo adicionado
      setTimeout(() => {
        switchFriendsTab('all');
      }, 700);
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
let bannedMembers = {}; // { serverId: [ { name, fullTag, until, reason } ] }

try {
  bannedMembers = JSON.parse(localStorage.getItem('badiscord_banned_members') || '{}');
} catch(e) { bannedMembers = {}; }

function saveBannedMembers() {
  localStorage.setItem('badiscord_banned_members', JSON.stringify(bannedMembers));
}

function isMemberBanned(srvId, memberName) {
  const list = bannedMembers[srvId] || [];
  const now = Date.now();
  const ban = list.find(b => b.name.toLowerCase() === memberName.toLowerCase());
  if (!ban) return false;
  if (ban.until === 'perm') return true;
  return now < ban.until;
}

function renderServerMembers() {
  if (!membersScroll) return;
  membersScroll.innerHTML = '';

  const activeSrv = servers.find(s => s.id === activeServerId) || servers[0];

  // 1. Bloco de Atividade no topo da barra de membros (Foto 1)
  const isPlayingGame = detectedGame && detectedGame.name;
  if (isPlayingGame) {
    const actHeader = document.createElement('div');
    actHeader.className = 'members-activity-header';
    actHeader.innerHTML = `<span>Atividade — 1</span> <span style="cursor:pointer;" title="Configurações de Atividade">⚙️</span>`;
    membersScroll.appendChild(actHeader);

    const actCard = document.createElement('div');
    actCard.style.cssText = 'background:#1e1f22; margin:4px 8px 12px 8px; padding:8px 10px; border-radius:8px; display:flex; align-items:center; gap:8px; border:1px solid rgba(255,255,255,0.06); cursor:pointer;';
    actCard.innerHTML = `
      <div style="font-size:20px;">🎮</div>
      <div style="display:flex; flex-direction:column; overflow:hidden;">
        <span style="font-size:12px; font-weight:700; color:#fff; white-space:nowrap; text-overflow:ellipsis; overflow:hidden;">${detectedGame.name}</span>
        <span style="font-size:11px; color:#23a55a; font-weight:600;">Ao vivo agora</span>
      </div>
    `;
    actCard.addEventListener('click', () => {
      openMemberProfilePopover({
        name: userProfile.displayName || 'Bads',
        tag: userProfile.tag || '0001',
        fullTag: `${userProfile.displayName || 'Bads'}#${userProfile.tag || '0001'}`,
        avatarUrl: userProfile.avatarUrl,
        bannerColor: userProfile.bannerColor || '#5865F2',
        game: detectedGame.name,
        detail: 'Ao vivo em 1080p 60FPS',
        isOwner: true
      });
    });
    membersScroll.appendChild(actCard);
  }

  // 2. Categoria: DONO DO SERVIDOR
  const catOwner = document.createElement('div');
  catOwner.className = 'members-category';
  catOwner.textContent = 'DONO DO SERVIDOR — 1';
  membersScroll.appendChild(catOwner);

  // Usuário Atual (Você / Dono)
  const myItem = document.createElement('div');
  myItem.className = 'member-item';

  const myAvatar = document.createElement('div');
  myAvatar.className = 'member-avatar';
  if (userProfile.avatarUrl) {
    myAvatar.innerHTML = `<img src="${userProfile.avatarUrl}" style="width:100%;height:100%;border-radius:50%;object-fit:cover;">`;
  } else {
    myAvatar.style.backgroundColor = userProfile.bannerColor || '#5865F2';
    myAvatar.textContent = (userProfile.displayName || 'B')[0].toUpperCase();
  }

  const dot = document.createElement('span');
  dot.className = 'member-status-dot online';
  myAvatar.appendChild(dot);

  const myInfo = document.createElement('div');
  myInfo.className = 'member-info';

  const myName = document.createElement('div');
  myName.className = 'member-name';
  myName.textContent = userProfile.displayName || 'Bads';

  const myCrown = document.createElement('span');
  myCrown.className = 'member-crown';
  myCrown.textContent = ' 👑';
  myCrown.title = 'Proprietário do Servidor';
  myName.appendChild(myCrown);

  const myStatus = document.createElement('div');
  myStatus.className = 'member-activity';
  if (detectedGame && detectedGame.name) {
    myStatus.innerHTML = `<span class="member-activity-badge">🎮 ${detectedGame.name}</span>`;
  } else {
    myStatus.textContent = userProfile.aboutMe || 'Online';
  }

  myInfo.appendChild(myName);
  myInfo.appendChild(myStatus);
  myItem.appendChild(myAvatar);
  myItem.appendChild(myInfo);

  myItem.addEventListener('click', () => {
    openMemberProfilePopover({
      name: userProfile.displayName || 'Bads',
      tag: userProfile.tag || '0001',
      fullTag: `${userProfile.displayName || 'Bads'}#${userProfile.tag || '0001'}`,
      avatarUrl: userProfile.avatarUrl,
      bannerColor: userProfile.bannerColor || '#5865F2',
      game: detectedGame ? detectedGame.name : '',
      detail: detectedGame ? 'Transmitindo em 1080p' : (userProfile.aboutMe || 'Disponível'),
      isOwner: true
    });
  });

  membersScroll.appendChild(myItem);

  // 3. Categoria: MEMBROS DISPONÍVEIS (Amigos adicionados no servidor que não estão banidos)
  const activeFriends = friendsList.filter(f => !isMemberBanned(activeServerId, f.name));
  if (activeFriends.length > 0) {
    const catMembers = document.createElement('div');
    catMembers.className = 'members-category';
    catMembers.textContent = `MEMBROS — ${activeFriends.length}`;
    membersScroll.appendChild(catMembers);

    activeFriends.forEach(f => {
      const item = document.createElement('div');
      item.className = 'member-item';

      const avatar = document.createElement('div');
      avatar.className = 'member-avatar';
      avatar.style.backgroundColor = f.color;
      avatar.textContent = f.initial;

      const fDot = document.createElement('span');
      fDot.className = 'member-status-dot online';
      avatar.appendChild(fDot);

      const info = document.createElement('div');
      info.className = 'member-info';

      const name = document.createElement('div');
      name.className = 'member-name';
      name.innerHTML = `${f.name} <span class="friend-card-tag">#${f.tag}</span>`;

      const status = document.createElement('div');
      status.className = 'member-activity';
      if (f.game) {
        status.innerHTML = `<span class="member-activity-badge">🎮 ${f.game}</span>`;
      } else {
        status.textContent = f.detail || 'Disponível';
      }

      info.appendChild(name);
      info.appendChild(status);
      item.appendChild(avatar);
      item.appendChild(info);

      item.addEventListener('click', () => {
        openMemberProfilePopover(f);
      });

      membersScroll.appendChild(item);
    });
  }
}

// ==========================================
// POPOVER DE PERFIL DO USUÁRIO COM MODERAÇÃO (Foto 1)
// ==========================================
const userProfilePopover = document.getElementById('userProfilePopover');
const btnCloseUserPopover = document.getElementById('btnCloseUserPopover');
const userPopoverBanner = document.getElementById('userPopoverBanner');
const userPopoverAvatar = document.getElementById('userPopoverAvatar');
const userPopoverName = document.getElementById('userPopoverName');
const userPopoverTag = document.getElementById('userPopoverTag');
const userPopoverAbout = document.getElementById('userPopoverAbout');
const userPopoverActivity = document.getElementById('userPopoverActivity');
const userActivityType = document.getElementById('userActivityType');
const userActivityIcon = document.getElementById('userActivityIcon');
const userActivityTitle = document.getElementById('userActivityTitle');
const userActivityDetail = document.getElementById('userActivityDetail');
const btnUserActivityAction = document.getElementById('btnUserActivityAction');
const userPopoverModActions = document.getElementById('userPopoverModActions');
const btnOpenBanModal = document.getElementById('btnOpenBanModal');
const btnKickMember = document.getElementById('btnKickMember');
const btnMuteMember = document.getElementById('btnMuteMember');
const inputPopoverQuickChat = document.getElementById('inputPopoverQuickChat');
const btnSendPopoverQuickChat = document.getElementById('btnSendPopoverQuickChat');

function openMemberProfilePopover(member) {
  if (!userProfilePopover) return;
  currentInspectedMember = member;

  if (userPopoverName) userPopoverName.textContent = member.name;
  if (userPopoverTag) userPopoverTag.textContent = `#${member.tag || '0001'}`;
  if (userPopoverAbout) userPopoverAbout.textContent = member.detail || member.aboutMe || 'Usando o BADISCORD!';

  if (userPopoverBanner) {
    userPopoverBanner.style.background = member.bannerColor 
      ? `linear-gradient(135deg, ${member.bannerColor}, #1e1f22)` 
      : `linear-gradient(135deg, ${member.color || '#5865F2'}, #111214)`;
  }

  if (userPopoverAvatar) {
    if (member.avatarUrl) {
      userPopoverAvatar.innerHTML = `<img src="${member.avatarUrl}" style="width:100%;height:100%;border-radius:50%;object-fit:cover;">`;
    } else {
      userPopoverAvatar.style.backgroundColor = member.color || member.bannerColor || '#5865F2';
      userPopoverAvatar.textContent = (member.name || 'U')[0].toUpperCase();
    }
  }

  // Atividade (Jogando / Ouvindo Música)
  const gameName = member.game || (member.isOwner && detectedGame ? detectedGame.name : '');
  if (gameName) {
    if (userPopoverActivity) userPopoverActivity.style.display = 'block';
    if (userActivityType) userActivityType.textContent = 'JOGANDO';
    if (userActivityTitle) userActivityTitle.textContent = gameName;
    if (userActivityDetail) userActivityDetail.textContent = member.detail || 'Em partida competitiva • 36:03';
    if (userActivityIcon) userActivityIcon.textContent = '🎮';
    if (btnUserActivityAction) {
      btnUserActivityAction.textContent = '🎮 Pedir para entrar / Assistir Live';
      btnUserActivityAction.onclick = () => {
        showToast(`Solicitação enviada para jogar ${gameName} com ${member.name}!`, '🎮');
      };
    }
  } else {
    if (userPopoverActivity) userPopoverActivity.style.display = 'none';
  }

  // Moderação visível apenas para outros membros (não para si mesmo)
  const isSelf = member.isOwner || member.name.toLowerCase() === (userProfile.displayName || '').toLowerCase();
  if (userPopoverModActions) {
    userPopoverModActions.style.display = isSelf ? 'none' : 'flex';
  }

  // Posiciona o popover no centro ou à direita
  userProfilePopover.style.top = '120px';
  userProfilePopover.style.right = '260px';
  userProfilePopover.style.display = 'block';
}

if (btnCloseUserPopover) {
  btnCloseUserPopover.addEventListener('click', () => {
    if (userProfilePopover) userProfilePopover.style.display = 'none';
  });
}

// Envio rápido de DM a partir do popover
if (btnSendPopoverQuickChat && inputPopoverQuickChat) {
  const sendQuick = () => {
    const text = inputPopoverQuickChat.value.trim();
    if (!text || !currentInspectedMember) return;
    showToast(`Mensagem enviada para ${currentInspectedMember.name}!`, '💬');
    inputPopoverQuickChat.value = '';
    if (userProfilePopover) userProfilePopover.style.display = 'none';
    openDirectMessage(currentInspectedMember);
  };
  btnSendPopoverQuickChat.addEventListener('click', sendQuick);
  inputPopoverQuickChat.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') sendQuick();
  });
}

// Expulsar e Silenciar
if (btnKickMember) {
  btnKickMember.addEventListener('click', () => {
    if (!currentInspectedMember) return;
    if (confirm(`Expulsar ${currentInspectedMember.fullTag || currentInspectedMember.name} do servidor?`)) {
      showToast(`${currentInspectedMember.name} foi expulso do servidor.`, '🚪');
      if (userProfilePopover) userProfilePopover.style.display = 'none';
      renderServerMembers();
    }
  });
}

if (btnMuteMember) {
  btnMuteMember.addEventListener('click', () => {
    if (!currentInspectedMember) return;
    showToast(`${currentInspectedMember.name} foi silenciado no servidor.`, '🔇');
    if (userProfilePopover) userProfilePopover.style.display = 'none';
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
  btnConfirmBan.addEventListener('click', () => {
    if (!currentInspectedMember) return;
    const selectedDur = document.querySelector('input[name="banDuration"]:checked')?.value || '1h';
    const reason = inputBanReason?.value.trim() || 'Violação das regras';

    let untilTime;
    let labelDur = '1 hora';
    const now = Date.now();

    if (selectedDur === '1h') {
      untilTime = now + (60 * 60 * 1000);
      labelDur = '1 hora';
    } else if (selectedDur === '24h') {
      untilTime = now + (24 * 60 * 60 * 1000);
      labelDur = '24 horas';
    } else if (selectedDur === '7d') {
      untilTime = now + (7 * 24 * 60 * 60 * 1000);
      labelDur = '7 dias';
    } else {
      untilTime = 'perm';
      labelDur = 'Permanente';
    }

    if (!bannedMembers[activeServerId]) {
      bannedMembers[activeServerId] = [];
    }

    bannedMembers[activeServerId].push({
      name: currentInspectedMember.name,
      fullTag: currentInspectedMember.fullTag || currentInspectedMember.name,
      until: untilTime,
      reason: reason
    });

    saveBannedMembers();
    closeBanModal();
    renderServerMembers();

    showToast(`${currentInspectedMember.name} foi banido com sucesso (${labelDur})! 🔨`, '⛔');
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

function openInviteModal() {
  if (!inviteToServerModal) return;
  const srv = servers.find(s => s.id === activeServerId) || servers[0];
  if (inputInviteLink) {
    inputInviteLink.value = `https://badiscord.gg/${srv.id}-${encodeURIComponent(srv.name.toLowerCase().replace(/\s+/g, '-'))}`;
  }

  if (inviteFriendsList) {
    inviteFriendsList.innerHTML = '';
    if (friendsList.length === 0) {
      inviteFriendsList.innerHTML = '<span style="color:#949ba4; font-size:12px;">Nenhum amigo para convidar ainda.</span>';
    } else {
      friendsList.forEach(f => {
        const row = document.createElement('div');
        row.className = 'invite-friend-row';
        row.innerHTML = `
          <div style="display:flex; align-items:center; gap:8px;">
            <div style="width:24px; height:24px; border-radius:50%; background:${f.color}; display:flex; align-items:center; justify-content:center; color:#fff; font-size:12px; font-weight:bold;">${f.initial}</div>
            <span style="font-size:13px; color:#fff; font-weight:600;">${f.name} <span class="friend-card-tag">#${f.tag}</span></span>
          </div>
          <button class="btn-send-friend-req" style="padding:4px 10px; font-size:11px;">Convidar</button>
        `;
        const btn = row.querySelector('button');
        btn.addEventListener('click', () => {
          btn.disabled = true;
          btn.textContent = 'Enviado ✔';
          btn.style.background = '#248046';
          showToast(`Convite enviado para ${f.fullTag}!`, '📩');
        });
        inviteFriendsList.appendChild(row);
      });
    }
  }

  inviteToServerModal.style.display = 'flex';
}

if (btnCloseInviteModal) btnCloseInviteModal.addEventListener('click', () => {
  if (inviteToServerModal) inviteToServerModal.style.display = 'none';
});
if (btnCopyInviteLink) {
  btnCopyInviteLink.addEventListener('click', () => {
    if (inputInviteLink) {
      navigator.clipboard.writeText(inputInviteLink.value);
      showToast('Link de convite copiado para a área de transferência!', '📋');
    }
  });
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
  btnConfirmServer.addEventListener('click', () => {
    const name = inputServerName ? inputServerName.value.trim() : '';
    if (!name) {
      showToast('Por favor, informe o nome do seu servidor!', '⚠️');
      return;
    }

    const newSrv = {
      id: 'srv-' + Date.now(),
      name: name,
      icon: selectedServerIcon,
      textChannels: ['geral', 'clipes', 'comandos'],
      voiceChannels: ['Lounge 🔊', 'Call do Jogo']
    };

    servers.push(newSrv);
    saveServers();
    closeCreateServerModal();

    showToast(`Servidor "${name}" criado com sucesso! 🎉`, '✅');
    restoreServerView(newSrv.id);
  });
}

// Lista de Servidores Públicos da Comunidade
const PUBLIC_SERVERS = [
  { id: 'pub-1', name: 'Comunidade BADISCORD 🎮', icon: '🎮', desc: 'Espaço oficial para transmissão 1080p 60FPS e novas amizades.' },
  { id: 'pub-2', name: 'Espaço dos Devs 💻', icon: '💻', desc: 'Bate-papo de tecnologia, programação e pair programming.' },
  { id: 'pub-3', name: 'Lounge de Músicas & Clipes 🎵', icon: '🎧', desc: 'Músicas do Spotify, clipes de jogos e resenha.' },
  { id: 'pub-4', name: 'Competitivo & Scrims 🏆', icon: '🏆', desc: 'Lobbies de CS2, Valorant e campeonatos da galera.' }
];

function renderExploreServers() {
  if (!exploreServersList) return;
  exploreServersList.innerHTML = '';

  PUBLIC_SERVERS.forEach(pub => {
    const alreadyIn = servers.some(s => s.name === pub.name);
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

    btnJoin.addEventListener('click', () => {
      const newSrv = {
        id: 'srv-' + Date.now(),
        name: pub.name,
        icon: pub.icon,
        textChannels: ['geral', 'apresentacao', 'midia'],
        voiceChannels: ['Bate-Papo 🔊', 'Call Geral']
      };
      servers.push(newSrv);
      saveServers();
      closeCreateServerModal();
      showToast(`Você entrou na comunidade "${pub.name}"! 🎉`, '✅');
      restoreServerView(newSrv.id);
    });

    card.appendChild(left);
    card.appendChild(btnJoin);
    exploreServersList.appendChild(card);
  });
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

if (btnToggleMembers) {
  btnToggleMembers.addEventListener('click', () => {
    if (!membersSidebar) return;
    const isShown = membersSidebar.style.display !== 'none';
    membersSidebar.style.display = isShown ? 'none' : 'block';
  });
}



// Detecção de voz (ilumina borda verde)
function setupAudioLevelMeter(stream) {
  const audioContext = new (window.AudioContext || window.webkitAudioContext)();
  const mediaStreamSource = audioContext.createMediaStreamSource(stream);
  const analyser = audioContext.createAnalyser();
  analyser.fftSize = 256;
  mediaStreamSource.connect(analyser);

  const bufferLength = analyser.frequencyBinCount;
  const dataArray = new Uint8Array(bufferLength);

  function checkSpeaking() {
    if (!currentChannel) return;
    analyser.getByteFrequencyData(dataArray);
    let sum = 0;
    for (let i = 0; i < bufferLength; i++) {
      sum += dataArray[i];
    }
    const average = sum / bufferLength;

    const card = document.getElementById('localParticipantCard');
    const sidebarUser = document.getElementById('sidebarLocalUser');
    const isSpeaking = average > 15 && !isMuted && !isDeafened;

    if (card) {
      if (isSpeaking) {
        card.classList.add('speaking');
      } else {
        card.classList.remove('speaking');
      }
    }

    if (sidebarUser) {
      if (isSpeaking) {
        sidebarUser.classList.add('speaking');
      } else {
        sidebarUser.classList.remove('speaking');
      }
    }

    requestAnimationFrame(checkSpeaking);
  }
  checkSpeaking();
}

// Funções de Mudo e Ensurdecer (Deafen)
function setMuteState(muted, playSound = true) {
  isMuted = muted;
  if (localAudioTrack) {
    localAudioTrack.enabled = !isMuted;
  }
  if (playSound) {
    playMuteSound(isMuted);
  }
  updateControlsUI();
}

function setDeafenState(deafened) {
  isDeafened = deafened;
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

function disconnectVoice(playSound = true) {
  if (playSound) {
    playDisconnectSound();
  }

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
    stopCurrentStream();
  }

  currentChannel = null;
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
  pingInterval = setInterval(measurePing, 2000);
}

function stopPingMonitor() {
  if (pingInterval) {
    clearInterval(pingInterval);
    pingInterval = null;
  }
}

async function measurePing() {
  if (!currentChannel) return;
  const start = performance.now();
  let latency = 0;

  try {
    const res = await fetch('http://localhost:3000/health', {
      method: 'GET',
      cache: 'no-store'
    });
    if (res.ok) {
      latency = Math.round(performance.now() - start);
    } else {
      throw new Error();
    }
  } catch (e) {
    latency = Math.floor(16 + Math.random() * 14);
  }

  updatePingUI(Math.max(5, latency));
}

function updatePingUI(ms) {
  if (vcPingValue) vcPingValue.textContent = ms;
  if (stagePingPill) stagePingPill.textContent = `📶 ${ms} ms`;

  const vcPingTooltipText = document.getElementById('vcPingTooltipText');
  if (vcPingTooltipText) {
    vcPingTooltipText.textContent = `${ms} ms`;
  }

  let quality = 'ping-good';
  let icon = '📶';

  if (ms > 120) {
    quality = 'ping-bad';
    icon = '⚠️';
  } else if (ms > 60) {
    quality = 'ping-medium';
    icon = '📶';
  }

  if (vcPingBadge) vcPingBadge.className = `vc-ping-badge ${quality}`;
  if (stagePingPill) stagePingPill.className = `ping-pill ${quality}`;
  if (pingDot) pingDot.className = `status-dot ${quality}`;
  if (vcSignalIcon) vcSignalIcon.textContent = icon;
}

// ==========================================
// MODAL DE TRANSMISSÃO DE JOGOS & JANELAS (ESTILO DISCORD)
// ==========================================
const tabScreens = document.getElementById('tabScreens');
const tabWindows = document.getElementById('tabWindows');
const btnRefreshSources = document.getElementById('btnRefreshSources');
const inputSearchSources = document.getElementById('inputSearchSources');
const gamePrivacyBanner = document.getElementById('gamePrivacyBanner');
const selectedTargetName = document.getElementById('selectedTargetName');
const chkStreamAudio = document.getElementById('chkStreamAudio');

let cachedSources = [];
let currentCaptureTab = 'windows'; // Padrão: Janelas & Jogos focados
let sourceSearchQuery = '';

if (tabScreens) {
  tabScreens.addEventListener('click', () => {
    currentCaptureTab = 'screens';
    tabScreens.classList.add('active');
    tabWindows.classList.remove('active');
    if (gamePrivacyBanner) {
      gamePrivacyBanner.className = 'game-privacy-banner banner-warning';
      gamePrivacyBanner.innerHTML = `
        <span class="privacy-shield-icon">⚠️</span>
        <div class="privacy-text">
          <strong>Modo Tela Completa:</strong> Todo o seu monitor será transmitido. Outros programas e notificações do Windows poderão ficar visíveis para os espectadores.
        </div>
      `;
    }
    renderSourcesFiltered();
  });
}

if (tabWindows) {
  tabWindows.addEventListener('click', () => {
    currentCaptureTab = 'windows';
    tabWindows.classList.add('active');
    tabScreens.classList.remove('active');
    if (gamePrivacyBanner) {
      gamePrivacyBanner.className = 'game-privacy-banner';
      gamePrivacyBanner.innerHTML = `
        <span class="privacy-shield-icon">🛡️</span>
        <div class="privacy-text">
          <strong>Modo Janela Focada:</strong> Apenas a janela do jogo selecionado é enviada para os amigos na chamada. Se você minimizar o jogo, seu desktop continua 100% privado e protegido.
        </div>
      `;
    }
    renderSourcesFiltered();
  });
}

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
  } catch (err) {
    console.error('Erro ao buscar janelas e telas:', err);
    cachedSources = [];
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

  const isScreensTab = currentCaptureTab === 'screens';
  let filtered = cachedSources.filter(source => {
    const isScreen = source.isScreen;
    if (isScreensTab) {
      if (!isScreen) return false;
    } else {
      if (isScreen) return false;
      const isSelfWindow = (source.name || '').trim().toLowerCase() === 'badiscord';
      if (isSelfWindow) return false;
    }

    if (sourceSearchQuery) {
      const name = (source.name || '').toLowerCase();
      return name.includes(sourceSearchQuery);
    }
    return true;
  });

  // Ordenar jogos detectados no topo da lista
  if (!isScreensTab) {
    filtered.sort((a, b) => {
      if (a.isGame && !b.isGame) return -1;
      if (!a.isGame && b.isGame) return 1;
      return a.name.localeCompare(b.name);
    });
  }

  if (filtered.length === 0) {
    const emptyDiv = document.createElement('div');
    emptyDiv.className = 'sources-empty';
    if (isScreensTab) {
      emptyDiv.innerHTML = '<p>🖥️ Nenhum monitor detectado.</p>';
    } else {
      emptyDiv.innerHTML = `
        <p>🎮 Nenhuma janela de jogo encontrada ${sourceSearchQuery ? 'para essa busca' : 'no momento'}.</p>
        <small>1. Abra o jogo desejado e clique em 🔄 <strong>Atualizar</strong> no canto superior.<br>
        2. Se o jogo for executado com privilégios de Administrador, execute também o BADISCORD como Administrador para capturar sem restrições.<br>
        3. Caso o jogo utilize tela cheia exclusiva, você também pode alternar para a aba <strong>Telas Inteiras</strong>.</small>
      `;
    }
    sourcesGrid.appendChild(emptyDiv);
    return;
  }

  filtered.forEach(source => {
    const item = document.createElement('div');
    item.className = 'source-item';
    item.dataset.id = source.id;

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
    if (source.isScreen) {
      badge.classList.add('source-badge-screen');
      badge.textContent = '🖥️ Monitor';
    } else if (source.isGame) {
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
      placeholderIcon.textContent = source.isGame ? '🎮' : (source.isScreen ? '🖥️' : '🪟');
      meta.appendChild(placeholderIcon);
    }

    const title = document.createElement('div');
    title.className = 'source-title';
    title.textContent = source.name;
    title.title = source.name;
    meta.appendChild(title);

    item.appendChild(thumbContainer);
    item.appendChild(meta);

    item.addEventListener('click', () => {
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

    sourcesGrid.appendChild(item);
  });
}

// Elementos dos Controles de Live e Volume
const streamVolumeSlider = document.getElementById('streamVolumeSlider');
const streamVolumePercent = document.getElementById('streamVolumePercent');
const btnStreamAudioMute = document.getElementById('btnStreamAudioMute');
const streamMuteIcon = document.getElementById('streamMuteIcon');
const btnToggleLoopbackAudio = document.getElementById('btnToggleLoopbackAudio');
const loopbackBtnIcon = document.getElementById('loopbackBtnIcon');
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

function updateStreamVolume(val, showHud = false) {
  val = Math.max(0, Math.min(100, Math.round(val)));
  streamPlayerVolume = val;
  localStorage.setItem('badiscord_stream_player_vol', val);

  if (streamVolumeSlider) streamVolumeSlider.value = val;
  if (streamVolumePercent) streamVolumePercent.textContent = `${val}%`;

  // Controle de volume através do GainNode isolado do Web Audio
  if (streamGainNode) {
    if (val === 0 || isStreamAudioMuted || (isLocalStreamer && !isLoopbackEnabled)) {
      streamGainNode.gain.value = 0;
    } else {
      streamGainNode.gain.value = val / 100;
    }
  }

  // Ícone dinâmico do som
  let icon = '🔊';
  if (val === 0 || isStreamAudioMuted || (isLocalStreamer && !isLoopbackEnabled)) {
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
function stopCurrentStream() {
  if (streamGainNode) {
    try { streamGainNode.gain.value = 0; } catch (e) {}
  }
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
  }
  if (streamViewerWrapper) {
    streamViewerWrapper.style.display = 'none';
  }
  if (participantsGrid && currentChannel) {
    participantsGrid.style.display = 'grid';
  }
  isLocalStreamer = false;
  isLoopbackEnabled = false;

  if (btnShareScreen) {
    btnShareScreen.classList.remove('live-active');
    btnShareScreen.innerHTML = '<span>🖥️</span> Transmitir Tela (1080p)';
  }

  const panel = document.getElementById('gameActivityPanel');
  if (panel) panel.classList.remove('is-live');
  if (btnGameQuickStream) {
    btnGameQuickStream.innerHTML = '🖥️';
    btnGameQuickStream.title = 'Transmitir Jogo em 1080p 60FPS';
  }
  if (gameActivityStatus) {
    gameActivityStatus.textContent = 'Não Compartilhando';
  }
  if (streamLoopbackBadge) streamLoopbackBadge.style.display = 'none';
  if (btnToggleLoopbackAudio) {
    btnToggleLoopbackAudio.classList.remove('active');
    btnToggleLoopbackAudio.style.display = 'none';
  }
  checkRunningGame();
}

// Slider de Volume da Live
if (streamVolumeSlider) {
  streamVolumeSlider.addEventListener('input', (e) => {
    const val = parseInt(e.target.value, 10);
    // Se o streamer local mexer no volume para cima, ativa o retorno voluntário
    if (isLocalStreamer && !isLoopbackEnabled && val > 0) {
      isLoopbackEnabled = true;
      if (btnToggleLoopbackAudio) {
        btnToggleLoopbackAudio.classList.add('active');
        if (loopbackBtnIcon) loopbackBtnIcon.textContent = '🔊';
      }
      if (streamLoopbackBadge) streamLoopbackBadge.style.display = 'none';
    }
    updateStreamVolume(val, false);
  });
}

// Ajuste Rápido de Volume com o Scroll do Mouse sobre o Player
if (streamViewerWrapper) {
  streamViewerWrapper.addEventListener('wheel', (e) => {
    e.preventDefault();
    const step = 5;
    const nextVal = e.deltaY < 0 ? streamPlayerVolume + step : streamPlayerVolume - step;
    if (isLocalStreamer && !isLoopbackEnabled && nextVal > 0) {
      isLoopbackEnabled = true;
      if (btnToggleLoopbackAudio) {
        btnToggleLoopbackAudio.classList.add('active');
        if (loopbackBtnIcon) loopbackBtnIcon.textContent = '🔊';
      }
      if (streamLoopbackBadge) streamLoopbackBadge.style.display = 'none';
    }
    updateStreamVolume(nextVal, true);
  }, { passive: false });
}

// Botão de Mutar / Desmutar
if (btnStreamAudioMute) {
  btnStreamAudioMute.addEventListener('click', () => {
    if (isStreamAudioMuted || (isLocalStreamer && !isLoopbackEnabled)) {
      isStreamAudioMuted = false;
      if (isLocalStreamer) {
        isLoopbackEnabled = true;
        if (btnToggleLoopbackAudio) btnToggleLoopbackAudio.classList.add('active');
        if (loopbackBtnIcon) loopbackBtnIcon.textContent = '🔊';
        if (streamLoopbackBadge) streamLoopbackBadge.style.display = 'none';
      }
      const restoreVol = streamPlayerVolume === 0 ? 80 : streamPlayerVolume;
      updateStreamVolume(restoreVol, true);
    } else {
      isStreamAudioMuted = true;
      if (isLocalStreamer) {
        isLoopbackEnabled = false;
        if (btnToggleLoopbackAudio) btnToggleLoopbackAudio.classList.remove('active');
        if (loopbackBtnIcon) loopbackBtnIcon.textContent = '🔇';
        if (streamLoopbackBadge) streamLoopbackBadge.style.display = 'inline-flex';
      }
      updateStreamVolume(0, true);
    }
  });
}

// Toggle de Retorno de Áudio Local
if (btnToggleLoopbackAudio) {
  btnToggleLoopbackAudio.addEventListener('click', () => {
    isLoopbackEnabled = !isLoopbackEnabled;
    if (isLoopbackEnabled) {
      isStreamAudioMuted = false;
      btnToggleLoopbackAudio.classList.add('active');
      if (loopbackBtnIcon) loopbackBtnIcon.textContent = '🔊';
      if (streamLoopbackBadge) streamLoopbackBadge.style.display = 'none';
      updateStreamVolume(streamPlayerVolume || 50, true);
    } else {
      isStreamAudioMuted = true;
      btnToggleLoopbackAudio.classList.remove('active');
      if (loopbackBtnIcon) loopbackBtnIcon.textContent = '🔇';
      if (streamLoopbackBadge) streamLoopbackBadge.style.display = 'inline-flex';
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

btnShareScreen.addEventListener('click', async () => {
  if (!window.electronAPI) {
    alert('API do Electron necessária para capturar janelas do sistema.');
    return;
  }

  // Se já estiver transmitindo, clicar no botão encerra a transmissão
  if (localScreenTrack) {
    stopCurrentStream();
    return;
  }

  // Carregar preferências salvas de resolução e FPS
  const savedRes = localStorage.getItem('badiscord_stream_res') || '1080';
  const savedFps = localStorage.getItem('badiscord_stream_fps') || '60';
  if (selectResolution) selectResolution.value = savedRes;
  if (selectFps) selectFps.value = savedFps;

  // Garantir que a aba Janelas & Jogos esteja ativa por padrão
  currentCaptureTab = 'windows';
  if (tabWindows) tabWindows.classList.add('active');
  if (tabScreens) tabScreens.classList.remove('active');
  if (inputSearchSources) inputSearchSources.value = '';
  sourceSearchQuery = '';

  await fetchAndRenderSources();
  screenShareModal.style.display = 'flex';
});

btnCloseModal.addEventListener('click', () => screenShareModal.style.display = 'none');
btnCancelShare.addEventListener('click', () => screenShareModal.style.display = 'none');

// Iniciar Live do Jogo (1080p 60FPS) - Função Modular Unificada
async function startStreamWithSourceId(sourceId, sourceTitle) {
  if (!sourceId) return;

  const targetRes = parseInt((selectResolution && selectResolution.value) || localStorage.getItem('badiscord_stream_res') || '1080', 10);
  const targetFps = parseInt((selectFps && selectFps.value) || localStorage.getItem('badiscord_stream_fps') || '60', 10);
  const includeAudio = chkStreamAudio ? chkStreamAudio.checked : true;

  localStorage.setItem('badiscord_stream_res', String(targetRes));
  localStorage.setItem('badiscord_stream_fps', String(targetFps));

  if (screenShareModal) screenShareModal.style.display = 'none';

  try {
    let stream;
    const videoConstraints = {
      mandatory: {
        chromeMediaSource: 'desktop',
        chromeMediaSourceId: sourceId,
        maxWidth: targetRes === 1440 ? 2560 : (targetRes === 1080 ? 1920 : 1280),
        maxHeight: targetRes,
        maxFrameRate: targetFps
      }
    };

    if (includeAudio) {
      try {
        // Tenta capturar vídeo + áudio da aplicação no Windows
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            mandatory: {
              chromeMediaSource: 'desktop'
            }
          },
          video: videoConstraints
        });
      } catch (audioErr) {
        console.warn('Captura com áudio não disponível nesta fonte, prosseguindo com vídeo puro:', audioErr);
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: videoConstraints
        });
      }
    } else {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: videoConstraints
      });
    }

    localScreenTrack = stream.getVideoTracks()[0];
    localScreenAudioTrack = stream.getAudioTracks()[0] || null;
    isLocalStreamer = true;
    isLoopbackEnabled = false;

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

    // Áudio do jogo conectado via Web Audio GainNode isolado (inicia mudo localmente)
    if (localScreenAudioTrack) {
      try {
        if (streamAudioCtx) {
          try { streamAudioCtx.close(); } catch (e) {}
        }
        streamAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const audioStream = new MediaStream([localScreenAudioTrack]);
        streamSourceNode = streamAudioCtx.createMediaStreamSource(audioStream);
        streamGainNode = streamAudioCtx.createGain();
        streamGainNode.gain.value = 0;
        streamSourceNode.connect(streamGainNode);
        streamGainNode.connect(streamAudioCtx.destination);
      } catch (errAudio) {
        console.warn('Web Audio para prévia da stream:', errAudio);
      }
    }

    if (btnShareScreen) {
      btnShareScreen.classList.add('live-active');
      btnShareScreen.innerHTML = '<span>⏹️</span> Parar Transmissão';
    }

    const panel = document.getElementById('gameActivityPanel');
    if (panel) panel.classList.add('is-live');

    if (gameActivityStatus) {
      gameActivityStatus.textContent = 'AO VIVO em 1080p 60FPS';
    }

    if (btnGameQuickStream) {
      btnGameQuickStream.innerHTML = '⏹️';
      btnGameQuickStream.title = 'Parar Transmissão';
    }

    if (streamLoopbackBadge) streamLoopbackBadge.style.display = 'inline-flex';
    if (btnToggleLoopbackAudio) {
      btnToggleLoopbackAudio.style.display = 'inline-flex';
      btnToggleLoopbackAudio.classList.remove('active');
      if (loopbackBtnIcon) loopbackBtnIcon.textContent = '🔇';
    }

    updateStreamVolume(streamPlayerVolume, false);

    const streamerName = document.getElementById('streamerName');
    if (streamerName) {
      streamerName.textContent = sourceTitle ? `🎮 Ao Vivo: ${sourceTitle}` : 'Transmitindo Janela de Jogo';
    }

    localScreenTrack.onended = () => {
      stopCurrentStream();
    };

    showToast(`Transmissão iniciada em 1080p 60FPS!`, '📡');
  } catch (err) {
    alert(`Erro ao iniciar captura: ${err.message}\n\nDica: Se o jogo estiver em tela cheia exclusiva ou protegido por anti-cheat, experimente colocar o jogo em modo "Janela Sem Bordas" (Borderless Windowed) ou selecione a aba "Telas Inteiras".`);
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
    currentCaptureTab = 'windows';
    if (tabWindows) tabWindows.classList.add('active');
    if (tabScreens) tabScreens.classList.remove('active');
    await fetchAndRenderSources();
    screenShareModal.style.display = 'flex';
  });
}

const cardModeWindow = document.getElementById('cardModeWindow');
const cardModeScreen = document.getElementById('cardModeScreen');
if (cardModeWindow && cardModeScreen) {
  cardModeWindow.addEventListener('click', () => {
    cardModeWindow.classList.add('active');
    cardModeScreen.classList.remove('active');
  });
  cardModeScreen.addEventListener('click', () => {
    cardModeScreen.classList.add('active');
    cardModeWindow.classList.remove('active');
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

function applyUserProfile() {
  const myUsername = document.getElementById('myUsername');
  const myStatusText = document.getElementById('myStatusText');
  const myAvatar = document.getElementById('myAvatar');
  const myTag = userProfile.tag || '0001';

  if (myUsername) {
    myUsername.textContent = userProfile.displayName || 'Bads';
  }
  if (myStatusText) {
    myStatusText.textContent = userProfile.presenceStatus || 'Invisível';
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

  if (currentChannel) {
    updateSidebarChannelUsers(currentChannel);
  }
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
    playConnectSound();

    if (saveStatusMsg) {
      saveStatusMsg.textContent = '✓ Perfil atualizado com sucesso!';
      setTimeout(() => {
        saveStatusMsg.textContent = '';
      }, 3000);
    }
  });
}

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
    voice: 'Voz e vídeo',
    stream: 'Transmissão e Lives',
    sounds: 'Sons do Sistema',
    soundboard: 'Painel de Efeitos Sonoros',
    appearance: 'Aparência',
    notifications: 'Notificações',
    nitro: 'BADISCORD Nitro',
    advanced: 'Avançado'
  };

  const settingsHeaderCategory = document.getElementById('settingsHeaderCategory');
  if (settingsHeaderCategory) {
    settingsHeaderCategory.textContent = categoryTitles[tabName] || 'Configurações';
  }
}

document.querySelectorAll('.settings-nav-item, .settings-subnav-item').forEach(el => {
  el.addEventListener('click', () => {
    const tab = el.dataset.tab;
    if (tab) {
      switchSettingsTab(tab);
    }
  });
});

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
function playSoundEffect(type) {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
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
        gain.connect(ctx.destination);
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
      gain.connect(ctx.destination);
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
      gain.connect(ctx.destination);
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
        gain.connect(ctx.destination);
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
      gain.connect(ctx.destination);
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
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.25);
    }
  } catch (e) {}
}

document.querySelectorAll('.soundboard-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    playSoundEffect(btn.dataset.sound);
  });
});

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
      '--text-muted': '#949ba4'
    },
    midnight: {
      '--bg-primary': '#000000',
      '--bg-secondary': '#0e0e10',
      '--bg-tertiary': '#000000',
      '--bg-modifier-hover': 'rgba(255, 255, 255, 0.07)',
      '--header-primary': '#f2f3f5',
      '--text-normal': '#dbdee1',
      '--text-muted': '#949ba4'
    },
    light: {
      '--bg-primary': '#ffffff',
      '--bg-secondary': '#f2f3f5',
      '--bg-tertiary': '#e3e5e8',
      '--bg-modifier-hover': 'rgba(0, 0, 0, 0.06)',
      '--header-primary': '#060607',
      '--text-normal': '#2e3338',
      '--text-muted': '#5c6370'
    }
  };

  const vars = themes[theme] || themes.dark;
  Object.entries(vars).forEach(([key, val]) => {
    document.documentElement.style.setProperty(key, val);
  });

  document.querySelectorAll('.theme-card').forEach(c => {
    c.classList.toggle('active', c.dataset.theme === theme);
  });

  localStorage.setItem('badiscord_theme', theme);
}

// Carregar tema salvo
const savedTheme = localStorage.getItem('badiscord_theme') || 'dark';
applyTheme(savedTheme);

document.querySelectorAll('.theme-card').forEach(card => {
  card.addEventListener('click', () => {
    applyTheme(card.dataset.theme);
    showToast(`Tema "${card.querySelector('span')?.textContent || card.dataset.theme}" aplicado!`, '🎨');
  });
});

// Aplicar perfil na inicialização
applyUserProfile();


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
    dnd: 'Não perturbar',
    invisible: 'Invisível'
  };

  function populatePresenceMenu() {
    const presenceAvatarImg = document.getElementById('presenceAvatarImg');
    const presenceDisplayName = document.getElementById('presenceDisplayName');
    const presenceHandle = document.getElementById('presenceHandle');
    const presencePronouns = document.getElementById('presencePronouns');
    const presenceClanBadge = document.getElementById('presenceClanBadge');
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
  if (menuItemStatusTrigger) {
    menuItemStatusTrigger.addEventListener('click', (e) => {
      e.stopPropagation();
      if (presenceStatusSubmenu) {
        const isOpen = presenceStatusSubmenu.style.display !== 'none';
        presenceStatusSubmenu.style.display = isOpen ? 'none' : 'block';
      }
    });
  }

  // Status option selection
  document.querySelectorAll('.submenu-status-item').forEach(item => {
    item.addEventListener('click', (e) => {
      e.stopPropagation();
      const status = item.dataset.status;
      if (!status) return;

      userProfile.presenceStatus = status;
      saveUserProfile();

      const statusText = statusLabels[status] || 'Invisível';

      // Update user panel indicators
      const myStatusText = document.getElementById('myStatusText');
      const myStatusIndicator = document.getElementById('myStatusIndicator');
      if (myStatusText) myStatusText.textContent = statusText;
      if (myStatusIndicator) myStatusIndicator.className = 'user-status-indicator ' + status;

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
    if (typeof openSettings === 'function') openSettings();
    if (typeof switchSettingsTab === 'function') switchSettingsTab('account');
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

  // Nitro promo
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
    userProfile.presenceStatus = 'invisible';
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

    // Position
    const menuW = 240;
    const menuH = 600;
    const maxX = window.innerWidth - menuW - 8;
    const maxY = window.innerHeight - menuH - 8;
    voiceUserContextMenu.style.left = Math.min(x, maxX) + 'px';
    voiceUserContextMenu.style.top = Math.min(Math.max(y, 8), maxY) + 'px';
    voiceUserContextMenu.style.display = 'block';

    // Stream header
    const streamHeader = document.getElementById('vctxStreamHeader');
    const streamGame = document.getElementById('vctxStreamGame');
    if (userData.game) {
      streamHeader.style.display = 'flex';
      streamGame.textContent = 'Pedir para transmitir ' + userData.game;
    } else {
      streamHeader.style.display = 'none';
    }

    // Info
    const infoValue = document.getElementById('vctxInfoValue');
    if (infoValue) {
      infoValue.textContent = currentChannel || 'Canal de Voz';
    }

    // Reset checkboxes
    document.querySelectorAll('.vctx-checkbox').forEach(cb => cb.classList.remove('checked'));
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
  voiceUserContextMenu.addEventListener('click', (e) => {
    const item = e.target.closest('.vctx-item');
    if (!item) return;

    const action = item.dataset.action;
    if (!action) return;

    const userName = vctxTargetUser ? vctxTargetUser.name : 'Usuário';

    switch (action) {
      case 'profile':
        voiceUserContextMenu.style.display = 'none';
        if (vctxTargetUser && typeof openMemberProfilePopover === 'function') {
          openMemberProfilePopover(vctxTargetUser);
        }
        break;

      case 'mention':
        voiceUserContextMenu.style.display = 'none';
        const mentionText = '@' + userName;
        const chatInput = document.getElementById('chatInput');
        if (chatInput) {
          chatInput.value += mentionText + ' ';
          chatInput.focus();
        }
        showToast('Menção copiada: ' + mentionText, '💬');
        break;

      case 'message':
        voiceUserContextMenu.style.display = 'none';
        if (vctxTargetUser && typeof openDMWithFriend === 'function') {
          openDMWithFriend(vctxTargetUser);
        } else {
          showToast('Abrindo mensagem direta com ' + userName, '💬');
        }
        break;

      case 'call':
        voiceUserContextMenu.style.display = 'none';
        showToast('Iniciando chamada com ' + userName + '...', '📞');
        break;

      case 'note':
        voiceUserContextMenu.style.display = 'none';
        const noteKey = 'badiscord_note_' + (vctxTargetUser ? vctxTargetUser.name : 'unknown');
        const existingNote = localStorage.getItem(noteKey) || '';
        const newNote = prompt('Nota para ' + userName + ' (visível apenas para você):', existingNote);
        if (newNote !== null) {
          localStorage.setItem(noteKey, newNote);
          showToast(newNote ? 'Nota salva!' : 'Nota removida!', '📝');
        }
        break;

      case 'nickname':
        voiceUserContextMenu.style.display = 'none';
        const nickKey = 'badiscord_nickname_' + (vctxTargetUser ? vctxTargetUser.name : 'unknown');
        const existingNick = localStorage.getItem(nickKey) || '';
        const newNick = prompt('Apelido para ' + userName + ':', existingNick);
        if (newNick !== null) {
          localStorage.setItem(nickKey, newNick);
          showToast(newNick ? 'Apelido definido: ' + newNick : 'Apelido removido!', '✏️');
        }
        break;

      case 'server-mute': {
        const cb = document.getElementById('vctxCheckMute');
        if (cb) cb.classList.toggle('checked');
        const isMuted = cb && cb.classList.contains('checked');
        showToast(isMuted ? userName + ' foi silenciado no servidor' : userName + ' pode falar novamente', isMuted ? '🔇' : '🔊');
        return; // Don't close
      }

      case 'server-deaf': {
        const cb = document.getElementById('vctxCheckDeaf');
        if (cb) cb.classList.toggle('checked');
        const isDeaf = cb && cb.classList.contains('checked');
        showToast(isDeaf ? 'Efeitos sonoros silenciados para ' + userName : 'Efeitos sonoros ativados para ' + userName, isDeaf ? '🔇' : '🔊');
        return;
      }

      case 'disable-video': {
        const cb = document.getElementById('vctxCheckVideo');
        if (cb) cb.classList.toggle('checked');
        const noVideo = cb && cb.classList.contains('checked');
        showToast(noVideo ? 'Vídeo de ' + userName + ' desativado' : 'Vídeo de ' + userName + ' ativado', noVideo ? '📵' : '📹');
        return;
      }

      case 'verification':
        voiceUserContextMenu.style.display = 'none';
        showToast('Código de Verificação: ' + Math.random().toString(36).substring(2, 10).toUpperCase(), '🔐');
        break;

      case 'apps':
        showToast('Apps em breve!', '📱');
        break;

      case 'invite-server':
        voiceUserContextMenu.style.display = 'none';
        showToast('Convite enviado para ' + userName + '!', '✉️');
        break;

      case 'unfriend':
        voiceUserContextMenu.style.display = 'none';
        if (confirm('Deseja desfazer amizade com ' + userName + '?')) {
          const idx = friendsList.findIndex(f => f.name === userName);
          if (idx !== -1) {
            friendsList.splice(idx, 1);
            localStorage.setItem('badiscord_friends', JSON.stringify(friendsList));
            if (typeof renderFriendsList === 'function') renderFriendsList();
            if (typeof renderMembersSidebar === 'function') renderMembersSidebar();
          }
          showToast('Amizade com ' + userName + ' desfeita', '💔');
        }
        break;

      case 'ignore':
        voiceUserContextMenu.style.display = 'none';
        showToast(userName + ' foi ignorado', '🚫');
        break;

      case 'block':
        voiceUserContextMenu.style.display = 'none';
        if (confirm('Deseja bloquear ' + userName + '?')) {
          showToast(userName + ' foi bloqueado!', '🚫');
        }
        break;

      case 'roles':
        showToast('Gerenciamento de cargos em breve!', '🏷️');
        break;
    }
  });

  // Stream header click
  document.getElementById('vctxStreamHeader')?.addEventListener('click', () => {
    voiceUserContextMenu.style.display = 'none';
    const gameName = vctxTargetUser?.game || 'tela';
    showToast('Pedido para transmitir ' + gameName + ' enviado!', '🖥️');
  });

  // Volume slider
  const vctxVolumeSlider = document.getElementById('vctxVolumeSlider');
  if (vctxVolumeSlider) {
    vctxVolumeSlider.addEventListener('input', () => {
      // Visual feedback - change track color
      const val = vctxVolumeSlider.value;
      const pct = val / 200 * 100;
      vctxVolumeSlider.style.background = 'linear-gradient(to right, #5865F2 0%, #5865F2 ' + pct + '%, #4e5058 ' + pct + '%, #4e5058 100%)';
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
    openVoiceUserContextMenu(e.clientX, e.clientY, {
      name: userProfile.displayName || 'Bads',
      tag: userProfile.tag || '0001',
      fullTag: (userProfile.displayName || 'Bads') + '#' + (userProfile.tag || '0001'),
      avatarUrl: userProfile.avatarUrl,
      bannerColor: userProfile.bannerColor || '#5865F2',
      game: typeof detectedGame !== 'undefined' && detectedGame ? detectedGame.name : '',
      isOwner: true
    });
  });

  // Add right-click to sidebar channel user items
  document.addEventListener('contextmenu', (e) => {
    const channelUser = e.target.closest('.channel-user-item');
    if (!channelUser) return;
    e.preventDefault();
    openVoiceUserContextMenu(e.clientX, e.clientY, {
      name: userProfile.displayName || 'Bads',
      tag: userProfile.tag || '0001',
      fullTag: (userProfile.displayName || 'Bads') + '#' + (userProfile.tag || '0001'),
      avatarUrl: userProfile.avatarUrl,
      bannerColor: userProfile.bannerColor || '#5865F2',
      game: typeof detectedGame !== 'undefined' && detectedGame ? detectedGame.name : '',
      isOwner: true
    });
  });

  // Add right-click to member-items in the members sidebar
  document.addEventListener('contextmenu', (e) => {
    const memberItem = e.target.closest('.member-item');
    if (!memberItem) return;
    // Only show voice context menu if user is in a voice channel
    if (!currentChannel) return;
    e.preventDefault();
    const nameEl = memberItem.querySelector('.member-name');
    const memberName = nameEl ? nameEl.textContent.replace(/\s*👑\s*$/, '').replace(/#\d+$/, '').trim() : 'Membro';

    // Find friend data
    const friendData = friendsList.find(f => f.name === memberName);
    const isMe = memberName === (userProfile.displayName || 'Bads');

    openVoiceUserContextMenu(e.clientX, e.clientY, {
      name: memberName,
      tag: friendData ? friendData.tag : (isMe ? userProfile.tag : '0000'),
      fullTag: memberName + '#' + (friendData ? friendData.tag : (isMe ? userProfile.tag : '0000')),
      avatarUrl: isMe ? userProfile.avatarUrl : null,
      bannerColor: friendData ? friendData.color : (isMe ? userProfile.bannerColor : '#5865F2'),
      game: friendData ? friendData.game : (isMe && typeof detectedGame !== 'undefined' && detectedGame ? detectedGame.name : ''),
      isOwner: isMe
    });
  });
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
      traits: [...(target.traits || ['', '', '', '', ''])]
    };

    if (srvSettingsTitle) srvSettingsTitle.textContent = target.name;
    if (srvPreviewName) srvPreviewName.textContent = target.name;
    if (srvDescriptionInput) srvDescriptionInput.value = tempServerState.description;

    // Traits
    for (let i = 1; i <= 5; i++) {
      const traitInput = document.getElementById(`trait${i}`);
      if (traitInput) traitInput.value = tempServerState.traits[i - 1] || '';
    }

    updateServerPreview();
    if (srvSaveBar) srvSaveBar.style.display = 'none';
    serverSettingsOverlay.style.display = 'flex';
  }

  function closeServerSettings() {
    if (serverSettingsOverlay) serverSettingsOverlay.style.display = 'none';
    if (srvSaveBar) srvSaveBar.style.display = 'none';
  }

  function updateServerPreview() {
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

  function markUnsavedChanges() {
    if (srvSaveBar) srvSaveBar.style.display = 'flex';
  }

  // Event Listeners
  if (btnCloseServerSettings) {
    btnCloseServerSettings.addEventListener('click', closeServerSettings);
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
    inputServerIconFile.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = (event) => {
          tempServerState.iconUrl = event.target.result;
          updateServerPreview();
          markUnsavedChanges();
        };
        reader.readAsDataURL(file);
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
    btnSaveServerSettings.addEventListener('click', () => {
      if (!currentSrvEditing) return;
      currentSrvEditing.bannerColor = tempServerState.bannerColor;
      currentSrvEditing.iconUrl = tempServerState.iconUrl;
      currentSrvEditing.description = tempServerState.description;
      currentSrvEditing.traits = tempServerState.traits;
      currentSrvEditing.serverTag = tempServerState.serverTag || 'KBM!';
      currentSrvEditing.serverTagBadge = tempServerState.serverTagBadge || '🗡️';
      currentSrvEditing.serverTagColor = tempServerState.serverTagColor || '#eb459e';

      saveServers();
      renderServersBar();
      if (typeof showToast === 'function') {
        showToast('Configurações e Tag do servidor salvas com sucesso!', '✅');
      }
      if (srvSaveBar) srvSaveBar.style.display = 'none';
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
    srvSettingsBtnDelete.addEventListener('click', () => {
      if (!currentSrvEditing) return;
      if (confirm(`Tem certeza que deseja excluir permanentemente o servidor "${currentSrvEditing.name}"?`)) {
        closeServerSettings();
        const idx = servers.findIndex(s => s.id === currentSrvEditing.id);
        if (idx !== -1) {
          servers.splice(idx, 1);
          saveServers();
          if (servers.length > 0) {
            selectServer(servers[0].id);
          } else {
            switchView('home');
          }
          renderServersBar();
          showToast('Servidor excluído.', '🗑️');
        }
      }
    });
  }

  // Expor globalmente para atalhos
  window.openServerSettings = openServerSettings;
})();


// ==========================================
// SISTEMA COMPLETO DE AUTENTICAÇÃO: LOGIN, REGISTRO & 2FA
// ==========================================
(function() {
  const authOverlay = document.getElementById('authOverlay');
  const viewAuthLogin = document.getElementById('viewAuthLogin');
  const viewAuthRegister = document.getElementById('viewAuthRegister');
  const viewAuthForgot = document.getElementById('viewAuthForgot');
  const viewAuth2FA = document.getElementById('viewAuth2FA');

  // Alternadores de tela
  const btnGoToRegister = document.getElementById('btnGoToRegister');
  const btnGoToLoginFromReg = document.getElementById('btnGoToLoginFromReg');
  const btnGoToForgot = document.getElementById('btnGoToForgot');
  const btnBackToLoginFromForgot = document.getElementById('btnBackToLoginFromForgot');
  const btnBackToLoginFrom2FA = document.getElementById('btnBackToLoginFrom2FA');

  // Inputs e Botões
  const loginEmail = document.getElementById('loginEmail');
  const loginPassword = document.getElementById('loginPassword');
  const btnLoginSubmit = document.getElementById('btnLoginSubmit');

  const regEmail = document.getElementById('regEmail');
  const regDisplayName = document.getElementById('regDisplayName');
  const regUsername = document.getElementById('regUsername');
  const regPassword = document.getElementById('regPassword');
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

  // Gerenciamento de Banco Local de Usuários
  function getRegisteredAccounts() {
    try {
      const data = localStorage.getItem('badiscord_registered_users');
      return data ? JSON.parse(data) : [];
    } catch (e) {
      return [];
    }
  }

  function saveRegisteredAccounts(accounts) {
    try {
      localStorage.setItem('badiscord_registered_users', JSON.stringify(accounts));
    } catch (e) {}
  }

  // Verificar se há sessão ativa
  const activeSession = localStorage.getItem('badiscord_session_active');
  if (!activeSession) {
    // Abrir tela de autenticação
    if (authOverlay) authOverlay.style.display = 'flex';
  }

  // Navegação
  if (btnGoToRegister) btnGoToRegister.addEventListener('click', () => switchAuthView('register'));
  if (btnGoToLoginFromReg) btnGoToLoginFromReg.addEventListener('click', () => switchAuthView('login'));
  if (btnGoToForgot) btnGoToForgot.addEventListener('click', () => switchAuthView('forgot'));
  if (btnBackToLoginFromForgot) btnBackToLoginFromForgot.addEventListener('click', () => switchAuthView('login'));
  if (btnBackToLoginFrom2FA) btnBackToLoginFrom2FA.addEventListener('click', () => switchAuthView('login'));

  // 1. LOGIN
  if (btnLoginSubmit) {
    btnLoginSubmit.addEventListener('click', () => {
      const email = loginEmail ? loginEmail.value.trim() : '';
      const pass = loginPassword ? loginPassword.value : '';

      if (!email || !pass) {
        showToast('Preencha seu e-mail e senha.', '⚠️');
        return;
      }

      const users = getRegisteredAccounts();
      const found = users.find(u => (u.email.toLowerCase() === email.toLowerCase() || u.username.toLowerCase() === email.toLowerCase()));

      if (found) {
        if (found.password !== pass) {
          showToast('Senha incorreta!', '❌');
          return;
        }
        // Conectar conta existente
        userProfile.displayName = found.displayName || found.username;
        userProfile.username = found.username;
        userProfile.tag = found.tag || '0001';
        saveUserProfile();
        applyUserProfile();
      } else {
        // Criar ou entrar como usuário padrão
        const usernamePart = email.split('@')[0] || 'Bads';
        userProfile.displayName = usernamePart;
        userProfile.username = usernamePart.toLowerCase();
        saveUserProfile();
        applyUserProfile();
      }

      localStorage.setItem('badiscord_session_active', 'true');
      if (authOverlay) authOverlay.style.display = 'none';
      showToast(`Bem-vindo de volta, ${userProfile.displayName}!`, '👋');
    });
  }

  // 2. REGISTRO DE CONTA
  if (btnRegisterSubmit) {
    btnRegisterSubmit.addEventListener('click', () => {
      const email = regEmail ? regEmail.value.trim() : '';
      const dispName = regDisplayName ? regDisplayName.value.trim() : '';
      const username = regUsername ? regUsername.value.trim() : '';
      const pass = regPassword ? regPassword.value : '';

      if (!email || !username || !pass) {
        showToast('Preencha os campos obrigatórios (*).', '⚠️');
        return;
      }
      if (pass.length < 6) {
        showToast('A senha deve ter no mínimo 6 caracteres.', '⚠️');
        return;
      }

      const users = getRegisteredAccounts();
      if (users.some(u => u.email.toLowerCase() === email.toLowerCase())) {
        showToast('Esse e-mail já está registrado.', '⚠️');
        return;
      }

      const tagRandom = String(Math.floor(1000 + Math.random() * 9000));
      const newUser = {
        email,
        displayName: dispName || username,
        username,
        tag: tagRandom,
        password: pass,
        twoFactorEnabled: true
      };

      users.push(newUser);
      saveRegisteredAccounts(users);

      // Logar imediatamente com a nova conta
      userProfile.displayName = newUser.displayName;
      userProfile.username = newUser.username;
      userProfile.tag = newUser.tag;
      saveUserProfile();
      applyUserProfile();

      localStorage.setItem('badiscord_session_active', 'true');
      if (authOverlay) authOverlay.style.display = 'none';
      showToast(`Conta criada com sucesso! Olá, ${newUser.displayName}#${newUser.tag}!`, '🎉');
    });
  }

  // 3. RECUPERAÇÃO DE CONTA — ENVIAR 2FA
  if (btnSend2FACode) {
    btnSend2FACode.addEventListener('click', () => {
      const email = forgotEmail ? forgotEmail.value.trim() : '';
      if (!email) {
        showToast('Informe o seu e-mail cadastrado.', '⚠️');
        return;
      }

      targetRecoveryEmail = email;
      // Gera código de 6 dígitos
      active2FACode = String(Math.floor(100000 + Math.random() * 900000));

      if (authGenerated2FACode) {
        authGenerated2FACode.textContent = active2FACode;
      }

      switchAuthView('2fa');
      showToast(`Código 2FA enviado para ${email}!`, '📩');
    });
  }

  // 4. CONFIRMAR 2FA E REDEFINIR SENHA
  if (btnConfirm2FAReset) {
    btnConfirm2FAReset.addEventListener('click', () => {
      const codeTyped = input2FACode ? input2FACode.value.trim() : '';
      const newPass = inputNewPassword2FA ? inputNewPassword2FA.value : '';

      if (!codeTyped || codeTyped !== active2FACode) {
        showToast('Código de 2 fatores inválido ou incorreto.', '❌');
        return;
      }

      if (!newPass || newPass.length < 6) {
        showToast('A nova senha deve ter no mínimo 6 caracteres.', '⚠️');
        return;
      }

      const users = getRegisteredAccounts();
      const user = users.find(u => u.email.toLowerCase() === targetRecoveryEmail.toLowerCase());
      if (user) {
        user.password = newPass;
        saveRegisteredAccounts(users);
        userProfile.displayName = user.displayName;
        userProfile.username = user.username;
        userProfile.tag = user.tag;
        saveUserProfile();
        applyUserProfile();
      }

      localStorage.setItem('badiscord_session_active', 'true');
      if (authOverlay) authOverlay.style.display = 'none';
      showToast('Senha redefinida com sucesso via 2FA! Conectado.', '🔐');
    });
  }

  // Permitir deslogar pelo menu de presença ou configurações
  window.logoutBADISCORD = function() {
    localStorage.removeItem('badiscord_session_active');
    if (authOverlay) {
      switchAuthView('login');
      authOverlay.style.display = 'flex';
    }
  };

  const menuItemSwitchAccount = document.getElementById('menuItemSwitchAccount');
  if (menuItemSwitchAccount) {
    menuItemSwitchAccount.addEventListener('click', () => {
      window.logoutBADISCORD();
    });
  }
})();
