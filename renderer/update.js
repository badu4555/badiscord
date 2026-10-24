const title = document.getElementById('title');
const message = document.getElementById('message');
const version = document.getElementById('version');
const progress = document.getElementById('progress');
const progressValue = document.getElementById('progressValue');
const progressLabel = document.getElementById('progressLabel');
const primaryAction = document.getElementById('primaryAction');
const laterAction = document.getElementById('laterAction');

function renderUpdateState(state) {
  version.textContent = state.currentVersion
    ? `Versão instalada: ${state.currentVersion}${state.version ? ` · Nova versão: ${state.version}` : ''}`
    : '';
  progress.hidden = state.status !== 'downloading';
  primaryAction.disabled = false;
  primaryAction.hidden = false;
  laterAction.hidden = false;

  switch (state.status) {
    case 'checking':
      title.textContent = 'Procurando atualização';
      message.textContent = 'Verificando se há uma versão nova do BADISCORD.';
      primaryAction.hidden = true;
      break;
    case 'available':
      title.textContent = 'Atualização disponível';
      message.textContent = 'Baixe a nova versão para manter o BADISCORD atualizado.';
      primaryAction.textContent = 'Atualizar agora';
      break;
    case 'downloading': {
      const percent = Math.max(0, Math.min(100, Number(state.percent) || 0));
      title.textContent = 'Baixando atualização';
      message.textContent = 'Aguarde enquanto os arquivos da atualização são baixados.';
      primaryAction.disabled = true;
      primaryAction.textContent = 'Baixando...';
      progressValue.style.width = `${percent}%`;
      progressLabel.textContent = `${Math.round(percent)}%`;
      break;
    }
    case 'downloaded':
      title.textContent = 'Atualização pronta';
      message.textContent = 'A atualização foi baixada. Reinicie o BADISCORD para concluir.';
      primaryAction.textContent = 'Reiniciar e atualizar';
      break;
    case 'error':
      title.textContent = 'Não foi possível atualizar';
      message.textContent = 'Verifique sua conexão e tente novamente.';
      primaryAction.textContent = 'Tentar novamente';
      break;
    default:
      title.textContent = 'Atualização do BADISCORD';
      message.textContent = 'Você pode continuar usando o aplicativo.';
      primaryAction.hidden = true;
  }
}

primaryAction.addEventListener('click', async () => {
  primaryAction.disabled = true;
  try {
    const state = await window.desktopUpdate.getState();
    if (state.status === 'downloaded') {
      await window.desktopUpdate.install();
    } else if (state.status === 'error') {
      await window.desktopUpdate.retry();
    } else {
      await window.desktopUpdate.download();
    }
  } catch (error) {
    message.textContent = error.message || 'Não foi possível iniciar a atualização.';
    primaryAction.disabled = false;
  }
});

laterAction.addEventListener('click', () => window.desktopUpdate.close());
window.desktopUpdate.onState(renderUpdateState);
window.desktopUpdate.getState().then(renderUpdateState).catch((error) => {
  title.textContent = 'Erro ao carregar atualização';
  message.textContent = error.message || 'Feche esta janela e tente novamente.';
  primaryAction.hidden = true;
});
