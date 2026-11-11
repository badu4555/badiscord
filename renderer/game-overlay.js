(() => {
  const channelElement = document.getElementById('overlayChannel');
  const countElement = document.getElementById('overlayParticipantCount');
  const membersElement = document.getElementById('overlayMembers');
  const activityElement = document.getElementById('overlayActivity');
  const activityListElement = document.getElementById('overlayActivityList');
  const recentActivities = [];

  function renderActivity(activity) {
    if (activity?.id && activity.text && !recentActivities.some((item) => item.id === activity.id)) {
      recentActivities.unshift(activity);
      recentActivities.splice(4);
    }
    activityListElement.replaceChildren();
    recentActivities.forEach((item) => {
      const row = document.createElement('div');
      row.className = `overlay-activity-item ${item.text.includes('saiu') ? 'left' : 'joined'}`;
      row.textContent = item.text;
      activityListElement.appendChild(row);
    });
    activityElement.hidden = recentActivities.length === 0;
  }

  function renderState(state) {
    if (!state?.visible) return;
    channelElement.textContent = state.channelName || 'Voz conectada';
    const participants = Array.isArray(state.participants) ? state.participants : [];
    countElement.textContent = `${participants.length} ${participants.length === 1 ? 'pessoa na call' : 'pessoas na call'}`;
    membersElement.replaceChildren();
    participants.slice(0, 20).forEach((participant) => {
      const row = document.createElement('div');
      row.className = `overlay-member${participant.isSpeaking ? ' speaking' : ''}`;

      const avatar = document.createElement('div');
      avatar.className = 'overlay-avatar';
      avatar.textContent = (participant.name || 'U').slice(0, 1).toUpperCase();
      if (participant.avatarUrl) {
        const image = document.createElement('img');
        image.src = participant.avatarUrl;
        image.alt = '';
        image.onerror = () => {
          image.remove();
          avatar.textContent = (participant.name || 'U').slice(0, 1).toUpperCase();
        };
        avatar.replaceChildren(image);
      }

      const name = document.createElement('span');
      name.className = 'overlay-member-name';
      name.textContent = participant.name || 'Usuário';

      const stateIcon = document.createElement('span');
      stateIcon.className = `overlay-member-state${participant.isMuted ? ' muted' : ''}`;
      stateIcon.textContent = participant.isStreaming ? '▣' : (participant.isMuted ? '⌁' : '♫');
      stateIcon.title = participant.isStreaming ? 'Transmitindo' : (participant.isMuted ? 'Microfone mutado' : 'Microfone ativo');

      row.append(avatar, name, stateIcon);
      membersElement.appendChild(row);
    });
    renderActivity(state.activity);
  }

  window.gameOverlayAPI?.onState(renderState);
})();
